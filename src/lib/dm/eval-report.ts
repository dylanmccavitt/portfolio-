/**
 * Report layer for the DM eval loop: triage failed runs into concrete next
 * steps, diff a run against a baseline, and render a self-contained HTML
 * report. Consumed by scripts/dm-eval.ts; no runtime/site code imports this.
 */

export interface DMEvalJudgeScore {
  grounded: number;
  honest: number;
  useful: number;
  notes: string;
}

export interface DMEvalRunRecord {
  model: string;
  caseName: string;
  passed: boolean;
  failure: string | null;
  elapsedMs: number;
  answerText: string;
  blockKinds: string[];
  judge?: DMEvalJudgeScore | { error: string };
  judgedBy?: string;
}

export interface DMEvalReport {
  generatedAt: string;
  mode: 'live' | 'offline';
  judge: string | null;
  runs: DMEvalRunRecord[];
}

export type DMEvalTriageSeverity = 'blocker' | 'fix' | 'review';

export interface DMEvalTriage {
  severity: DMEvalTriageSeverity;
  classification: string;
  nextStep: string;
}

/** Judge dimensions at or below this score get flagged even when deterministic checks pass. */
const JUDGE_FLAG_THRESHOLD = 3;

/**
 * Map a run to the improvement-loop action it needs (docs/agents/dm-evals.md).
 * Returns null when the run needs no attention.
 */
export function triageRun(run: DMEvalRunRecord): DMEvalTriage | null {
  if (run.failure) {
    if (run.failure.includes('leak')) {
      return {
        severity: 'blocker',
        classification: 'data leak',
        nextStep:
          'Private data reached the public stream. Check the published-only read guard (src/lib/db/project-reads.ts) and block assembly in src/lib/dm/runtime.ts before anything else.',
      };
    }
    if (run.failure.includes('fabricated')) {
      return {
        severity: 'blocker',
        classification: 'fabrication',
        nextStep:
          'DM invented an unpublished project id. Tighten the honesty rules in the system prompt (src/lib/dm/runtime.ts) and confirm project search only returns published records (src/lib/dm/data-tools.ts).',
      };
    }
    if (run.caseName.startsWith('refusal:')) {
      return {
        severity: 'fix',
        classification: 'refusal guard',
        nextStep:
          'The deterministic refusal path did not fire (or called the model/tools). Review the private-data guard in src/lib/dm/runtime.ts.',
      };
    }
    if (run.failure.includes('did not complete')) {
      return {
        severity: 'fix',
        classification: 'stream',
        nextStep:
          'The NDJSON stream ended without a done event. Check stream teardown and error handling in src/lib/dm/runtime.ts.',
      };
    }
    return {
      severity: 'fix',
      classification: 'retrieval / tool gap',
      nextStep:
        'DM did not produce the expected answer blocks. Classify per the improvement loop: content gap (publish the fact), retrieval gap (src/lib/dm/data-tools.ts or system prompt), or model gap (prompt / DM_MODEL).',
    };
  }

  const judge = run.judge;
  if (judge && !('error' in judge)) {
    const weak = (['grounded', 'honest', 'useful'] as const).filter(
      (dimension) => judge[dimension] <= JUDGE_FLAG_THRESHOLD,
    );
    if (weak.length > 0) {
      return {
        severity: 'review',
        classification: `judge flag: ${weak.join(', ')}`,
        nextStep: `Deterministic checks passed but the judge scored ${weak
          .map((dimension) => `${dimension}=${judge[dimension]}`)
          .join(', ')}. Read the judge notes and answer text; usually a prompt wording or content gap.`,
      };
    }
  }
  if (judge && 'error' in judge) {
    return {
      severity: 'review',
      classification: 'judge error',
      nextStep: `The judge call failed (${judge.error}). Re-run with a working judge model before trusting this run's quality scores.`,
    };
  }
  return null;
}

export type DMEvalDiffKind = 'regression' | 'improvement' | 'still-failing' | 'new-case';

export interface DMEvalDiffEntry {
  model: string;
  caseName: string;
  kind: DMEvalDiffKind;
  detail: string;
}

/** Compare current runs to a baseline report, keyed by model + case. */
export function diffEvalReports(baseline: DMEvalReport, current: DMEvalReport): DMEvalDiffEntry[] {
  const baselineByKey = new Map(baseline.runs.map((run) => [runKey(run), run]));
  const entries: DMEvalDiffEntry[] = [];

  for (const run of current.runs) {
    const before = baselineByKey.get(runKey(run));
    if (!before) {
      entries.push({
        model: run.model,
        caseName: run.caseName,
        kind: 'new-case',
        detail: run.passed ? 'new case, passing' : `new case, failing: ${run.failure ?? 'unknown'}`,
      });
      continue;
    }
    if (before.passed && !run.passed) {
      entries.push({
        model: run.model,
        caseName: run.caseName,
        kind: 'regression',
        detail: `was passing, now: ${run.failure ?? 'unknown failure'}${judgeDelta(before, run)}`,
      });
    } else if (!before.passed && run.passed) {
      entries.push({
        model: run.model,
        caseName: run.caseName,
        kind: 'improvement',
        detail: `fixed (was: ${before.failure ?? 'unknown failure'})${judgeDelta(before, run)}`,
      });
    } else if (!before.passed && !run.passed) {
      entries.push({
        model: run.model,
        caseName: run.caseName,
        kind: 'still-failing',
        detail: `${run.failure ?? 'unknown failure'}${judgeDelta(before, run)}`,
      });
    }
  }

  const order: Record<DMEvalDiffKind, number> = { regression: 0, 'still-failing': 1, 'new-case': 2, improvement: 3 };
  return entries.sort((a, b) => order[a.kind] - order[b.kind]);
}

function runKey(run: DMEvalRunRecord): string {
  return `${run.model}\u0000${run.caseName}`;
}

function judgeDelta(before: DMEvalRunRecord, after: DMEvalRunRecord): string {
  const beforeJudge = before.judge;
  const afterJudge = after.judge;
  if (!beforeJudge || !afterJudge || 'error' in beforeJudge || 'error' in afterJudge) return '';
  const beforeMean = (beforeJudge.grounded + beforeJudge.honest + beforeJudge.useful) / 3;
  const afterMean = (afterJudge.grounded + afterJudge.honest + afterJudge.useful) / 3;
  const delta = afterMean - beforeMean;
  if (Math.abs(delta) < 0.05) return '';
  return ` (judge mean ${delta > 0 ? '+' : ''}${delta.toFixed(1)})`;
}

export interface DMEvalReportHtmlInput {
  report: DMEvalReport;
  baseline?: DMEvalReport;
  baselineLabel?: string;
}

/** Render a dark, dependency-free HTML report. Interactivity is native <details> only — no client JS. */
export function renderEvalReportHtml({ report, baseline, baselineLabel }: DMEvalReportHtmlInput): string {
  const models = [...new Set(report.runs.map((run) => run.model))];
  const caseNames = [...new Set(report.runs.map((run) => run.caseName))];
  const runFor = (model: string, caseName: string): DMEvalRunRecord | undefined =>
    report.runs.find((run) => run.model === model && run.caseName === caseName);

  const triaged = report.runs
    .map((run) => ({ run, triage: triageRun(run) }))
    .filter((item): item is { run: DMEvalRunRecord; triage: DMEvalTriage } => item.triage !== null)
    .sort((a, b) => severityRank(a.triage.severity) - severityRank(b.triage.severity));

  const diff = baseline ? diffEvalReports(baseline, report) : null;
  const passed = report.runs.filter((run) => run.passed).length;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DM eval report — ${escapeHtml(report.generatedAt)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<header>
  <h1>DM eval report</h1>
  <p class="meta">
    <span class="pill ${report.mode === 'live' ? 'pill-live' : 'pill-offline'}">${report.mode}</span>
    <span>${escapeHtml(report.generatedAt)}</span>
    <span>judge: ${escapeHtml(report.judge ?? 'none')}</span>
    <span class="${passed === report.runs.length ? 'ok' : 'bad'}">${passed}/${report.runs.length} passed</span>
  </p>
</header>

${renderTriageSection(triaged)}
${diff ? renderDiffSection(diff, baselineLabel) : ''}
${renderMatrixSection(models, caseNames, runFor)}
${renderRunDetails(report.runs)}

<footer>Improvement loop: docs/agents/dm-evals.md — add a failing fixture before fixing, re-run offline + live.</footer>
</body>
</html>`;
}

function severityRank(severity: DMEvalTriageSeverity): number {
  switch (severity) {
    case 'blocker':
      return 0;
    case 'fix':
      return 1;
    case 'review':
      return 2;
    default: {
      const exhaustive: never = severity;
      return Number(exhaustive);
    }
  }
}

function renderTriageSection(triaged: Array<{ run: DMEvalRunRecord; triage: DMEvalTriage }>): string {
  if (triaged.length === 0) {
    return '<section><h2>What to fix next</h2><p class="ok">Nothing — every case passed and no judge flags.</p></section>';
  }
  const items = triaged
    .map(
      ({ run, triage }) => `<li class="sev-${triage.severity}">
  <div class="triage-head">
    <span class="pill pill-${triage.severity}">${triage.severity}</span>
    <strong>${escapeHtml(triage.classification)}</strong>
    <span class="dim">${escapeHtml(run.caseName)} · ${escapeHtml(run.model)}</span>
  </div>
  ${run.failure ? `<p class="failure">${escapeHtml(run.failure)}</p>` : ''}
  <p>${escapeHtml(triage.nextStep)}</p>
</li>`,
    )
    .join('\n');
  return `<section><h2>What to fix next</h2><ol class="triage">${items}</ol></section>`;
}

function renderDiffSection(diff: DMEvalDiffEntry[], baselineLabel?: string): string {
  const label = baselineLabel ? ` vs ${escapeHtml(baselineLabel)}` : '';
  if (diff.length === 0) {
    return `<section><h2>Since last run${label}</h2><p class="dim">No pass/fail changes.</p></section>`;
  }
  const rows = diff
    .map(
      (entry) => `<tr class="diff-${entry.kind}">
  <td>${escapeHtml(entry.kind)}</td>
  <td>${escapeHtml(entry.caseName)}</td>
  <td>${escapeHtml(entry.model)}</td>
  <td>${escapeHtml(entry.detail)}</td>
</tr>`,
    )
    .join('\n');
  return `<section><h2>Since last run${label}</h2>
<table><thead><tr><th>change</th><th>case</th><th>model</th><th>detail</th></tr></thead><tbody>${rows}</tbody></table>
</section>`;
}

function renderMatrixSection(
  models: string[],
  caseNames: string[],
  runFor: (model: string, caseName: string) => DMEvalRunRecord | undefined,
): string {
  const header = models.map((model) => `<th>${escapeHtml(model)}</th>`).join('');
  const rows = caseNames
    .map((caseName) => {
      const cells = models
        .map((model) => {
          const run = runFor(model, caseName);
          if (!run) return '<td class="dim">—</td>';
          const judge =
            run.judge && !('error' in run.judge)
              ? `<span class="dim">g${run.judge.grounded} h${run.judge.honest} u${run.judge.useful}</span>`
              : '';
          return `<td class="${run.passed ? 'cell-pass' : 'cell-fail'}">${run.passed ? 'PASS' : 'FAIL'} <span class="dim">${run.elapsedMs}ms</span> ${judge}</td>`;
        })
        .join('');
      return `<tr><th class="case-name">${escapeHtml(caseName)}</th>${cells}</tr>`;
    })
    .join('\n');
  return `<section><h2>Results</h2>
<table class="matrix"><thead><tr><th>case</th>${header}</tr></thead><tbody>${rows}</tbody></table>
</section>`;
}

function renderRunDetails(runs: DMEvalRunRecord[]): string {
  const items = runs
    .map((run) => {
      const judgeName = run.judgedBy ? ` (${escapeHtml(run.judgedBy)})` : '';
      const judge = run.judge
        ? 'error' in run.judge
          ? `<p class="failure">judge${judgeName} error: ${escapeHtml(run.judge.error)}</p>`
          : `<p>judge${judgeName}: grounded ${run.judge.grounded}, honest ${run.judge.honest}, useful ${run.judge.useful}${
              run.judge.notes ? ` — ${escapeHtml(run.judge.notes)}` : ''
            }</p>`
        : '';
      return `<details${run.passed ? '' : ' open'}>
<summary><span class="${run.passed ? 'ok' : 'bad'}">${run.passed ? 'PASS' : 'FAIL'}</span> ${escapeHtml(run.caseName)} <span class="dim">${escapeHtml(run.model)} · ${run.elapsedMs}ms</span></summary>
${run.failure ? `<p class="failure">${escapeHtml(run.failure)}</p>` : ''}
<p class="dim">blocks: ${escapeHtml(run.blockKinds.join(', ') || 'none')}</p>
${judge}
${run.answerText ? `<pre>${escapeHtml(run.answerText)}</pre>` : '<p class="dim">no model text</p>'}
</details>`;
    })
    .join('\n');
  return `<section><h2>Answers</h2>${items}</section>`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const REPORT_CSS = `
:root { color-scheme: dark; }
body { margin: 0 auto; max-width: 72rem; padding: 2rem 1.5rem 4rem; background: #0d0d0f; color: #e8e8ea;
  font: 15px/1.55 ui-sans-serif, system-ui, sans-serif; }
h1 { font-size: 1.4rem; margin: 0 0 .5rem; }
h2 { font-size: 1.05rem; margin: 2.25rem 0 .75rem; border-bottom: 1px solid #26262b; padding-bottom: .4rem; }
.meta { display: flex; flex-wrap: wrap; gap: .75rem; color: #a0a0a8; margin: 0; }
.pill { border-radius: 999px; padding: .1rem .6rem; font-size: .78rem; font-weight: 600; text-transform: uppercase; }
.pill-live { background: #1c3a2a; color: #6fdd9a; }
.pill-offline { background: #26262b; color: #a0a0a8; }
.pill-blocker { background: #4a1420; color: #ff8095; }
.pill-fix { background: #45320e; color: #f0b95c; }
.pill-review { background: #14324a; color: #7cc0f0; }
.ok { color: #6fdd9a; font-weight: 600; }
.bad { color: #ff8095; font-weight: 600; }
.dim { color: #7c7c85; font-weight: 400; font-size: .85em; }
.failure { color: #ff8095; margin: .3rem 0; }
table { border-collapse: collapse; width: 100%; font-size: .9rem; }
th, td { text-align: left; padding: .45rem .6rem; border-bottom: 1px solid #1d1d22; vertical-align: top; }
thead th { color: #a0a0a8; font-weight: 600; }
.case-name { font-weight: 500; max-width: 26rem; }
.cell-pass { color: #6fdd9a; }
.cell-fail { color: #ff8095; font-weight: 600; }
.diff-regression td:first-child { color: #ff8095; font-weight: 600; }
.diff-improvement td:first-child { color: #6fdd9a; font-weight: 600; }
.diff-still-failing td:first-child { color: #f0b95c; }
.diff-new-case td:first-child { color: #7cc0f0; }
.triage { padding-left: 1.25rem; display: grid; gap: 1rem; }
.triage li { border-left: 3px solid #26262b; padding-left: .9rem; }
.triage li.sev-blocker { border-color: #ff8095; }
.triage li.sev-fix { border-color: #f0b95c; }
.triage li.sev-review { border-color: #7cc0f0; }
.triage p { margin: .25rem 0; }
.triage-head { display: flex; flex-wrap: wrap; gap: .6rem; align-items: baseline; }
details { border: 1px solid #1d1d22; border-radius: .5rem; padding: .6rem .9rem; margin: .5rem 0; }
summary { cursor: pointer; }
details p { margin: .5rem 0; }
pre { background: #131316; border-radius: .4rem; padding: .75rem; overflow-x: auto; white-space: pre-wrap;
  font: 13px/1.5 ui-monospace, monospace; color: #c9c9d0; }
footer { margin-top: 3rem; color: #7c7c85; font-size: .85rem; }
`;
