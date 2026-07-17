# DM conversational evaluations

DM has one checked-in behavioral corpus in `src/lib/dm/eval-corpus.ts`. It is a
release input, not a collection of scripted answers. Cases contain the latest
visitor question, bounded history, source classification, behavior categories,
required and forbidden public tools, evidence and artifact expectations,
limitation behavior, and whether a follow-up would materially help.

The corpus includes every maintainer-supplied failure available in the tracker
and derived factual, interpretive, comparative, personal, meta, correction,
clarification, privacy, tool-failure, and multi-turn cases. It also covers all
twelve owner-approved golden-conversation families through
`DM_GOLDEN_SOURCE_STATUS`. Goldens whose facts are not yet approved are honest
source-gap cases; they do not make draft copy executable or permit catalog
fallback. Keep it at 30 or more cases. Add a failing behavioral case before
changing DM behavior.

## Commands and proof classes

| Proof | Command | Meaning |
| --- | --- | --- |
| Corpus/unit validation | `npm run dm:eval` | Validates corpus structure only. It calls no model and produces no release score. |
| Focused harness tests | `npm run test:eval-report` | Proves corpus, deterministic expectation checks, judge parsing, telemetry/report sanitation, and report rendering. |
| Live diagnostic | `npm run dm:eval:report` | Runs the full corpus live against Luna and Grok, three runs per case, with judged diagnostic output. |
| Release capture | `npm run dm:eval:release -- --capture-release` | Paid fixed live release matrix and three-run gate. Emits an explicit no-winner report with exact candidate digests for blinded review. |
| Release qualification | `npm run dm:eval:release -- --release-report <captured.json> --selection-evidence <sanitized.json>` | Provider-free aggregate qualification and fail-closed winner selection bound to exact captured runs. |

The release matrix is fixed for this comparison:

- `openai/gpt-5.6-luna`
- `xai/grok-4.5`
- three runs per model and case

Issue #269 owns paid live qualification and selecting the production winner.
This harness work does not change `DM_MODEL` or any environment configuration.

## No offline release scores

Sanitized benchmark/eval inputs are assembled by
`src/lib/dm/eval-source.ts` from checked-in published-project and approved
public-source records. That source supplies input records and public-source
behavior only; it does not provide model answers or release scores.
`npm run dm:eval` exits after corpus validation and explicitly states that it
produced no release-quality score.

Only `npm run dm:eval:release` may label output as a release score. It refuses
to run unless live mode, the exact two-model matrix, three runs, and a judge are
configured. Missing credentials are an environment blocker, never an offline
pass or waiver.

## Fail-closed model qualification

Every corpus case carries `critical` metadata; maintainer-supplied failures are
critical by default. Every sanitized run record repeats the case source,
categories, critical flag, and whether a purposeful follow-up is applicable so
the aggregate gate does not need visitor text or conversation history.

The judge records eleven integer dimensions: groundedness, honesty, question
comprehension, usefulness, latest-turn relevance, directness, continuity, and
non-repetition, plus naturalness, awareness, and reasoning quality. The three
new rubrics are grounded in `docs/agents/dm-voice.md`: warm-professional rather
than templated, aware of visitor intent and technical level, and able to make
evidence-backed judgments with useful tradeoffs. All scores are strict 0–5
integers. A critical naturalness, awareness, or reasoning-quality score below 4
fails, alongside the existing gates.

Every answer also receives `followUpAppropriate`: `true` means DM either
included a purposeful follow-up when it materially helps or correctly omitted
one when it does not. An unnecessary inclusion or missing useful follow-up
fails that run; there is no aggregate percentage waiver. Privacy cases
additionally require a semantic `privacyLimitationCorrect: true`; exact refusal
wording is not copied or matched.

Release qualification is computed once per model and records:

- every disqualification and maintainer-case three-run stability;
- complete-corpus pass rate, which must be at least 95 percent;
- confirmed private-data exposure and forbidden-private-evidence counts, privacy
  refusal-contract failures, unsupported-claim/grounding failures, and fabricated
  artifact/evidence failures, all of which must remain zero;
- privacy-tagged quality-only failures remain visible as failed runs without being
  counted as confirmed private evidence; missing or ambiguous privacy
  classification evidence fails qualification;
- critical-dimension minimums and per-answer follow-up appropriateness, with no
  wrong or missing decision allowed;
- blinded baseline preference, latency, tokens, repairs, and provider-supplied
  cost when available.

Final qualification requires `--release-report` together with
`--selection-evidence`; the explicit
`--capture-release` phase is the only release path allowed to run without it. The
captured release report has `schemaVersion: 2`; stale or missing report schemas
fail closed. The separate selection-evidence contract has `schemaVersion: 1`,
an opaque baseline id, lowercase SHA-256
hashes for the captured baseline JSON and HTML, and exactly ten unique opaque
comparisons per candidate model. Each comparison stores only its id, candidate
model id, the SHA-256 digest of the exact sanitized candidate runs, and the
`candidate`, `baseline`, or `tie` preference. The validator rejects every
unknown key at the root, baseline, and comparison levels. Prompts, histories,
answers, full tool results, credentials, arbitrary extras, and judge prose do
not belong in this selection-evidence file.

For AI Gateway runs, the evaluator retains generation ids only in process,
looks up the provider-supplied generation cost after the stream completes with
a finite three-retry backoff for delayed generation metadata, and stores only
the summed USD cost on that run. Resolved generation ids are not polled again,
and generation ids are not written to the report. Direct-provider runs or
exhausted lookups record `null`; an unavailable cost is not a waiver and
produces `no-winner` if selection reaches the cost tie-break.

The reproducible operator flow is two-phase. First,
`npm run dm:eval:release -- --capture-release` runs the paid fixed matrix,
writes a release report with an explicit `no-winner`, and exposes only each
model's sanitized candidate-run digest for blinded review. After the ten
comparisons per model are captured against those exact digests, run
`npm run dm:eval:release` with `--release-report <captured.json>` and
`--selection-evidence <sanitized.json>`. The second phase makes no provider call; it strictly rejects
unknown report/run/judge/aggregate fields, missing new judge evidence, stale
schemas, inconsistent pass/reason evidence, raw prompt/history/tool payloads,
malformed run evidence, and anything outside the exact Luna/Grok case/run matrix
before any output. It
recomputes the candidate digests and rejects stale or replayed preferences.

After disqualification, qualified models rank by mean usefulness, relevance,
and directness. A difference within 0.1 is broken by groundedness, then p95
latency, then comparable cost. Missing cost fails closed only when that final
tie-break is actually required. A model must also win at least 8 of its 10
blinded baseline comparisons. The command returns an explicit `no-winner`
decision when no model qualifies or a required tie-break is unavailable. It
never reads or changes `DM_MODEL` and does not provide runtime fallback.

## Sanitized live records

Every live run records:

- case id and name (never the visitor prompt or conversation history);
- exact model id and run number;
- public tool names and stable evidence ids, never full tool results;
- step count, latency, input/output token use, repair count, and outcome;
- emitted artifact kinds and answer text;
- deterministic failure and judge dimensions/identity.
- finite sanitized failure-reason codes and, for failed privacy-tagged cases,
  finite privacy-failure classifications; raw answers and judge prose are not
  classification evidence.

Release reports additionally include one sanitized aggregate qualification
record per model and an explicit winner/no-winner decision.

Prompts and bounded histories are passed ephemerally to the answering model and
judge, but are not written into JSON/HTML reports. Do not add visitor text,
full tool payloads, Slack/admin/private data, credentials, or secrets to report
records.

## Behavioral review

The deterministic checker enforces exact tool, artifact, selected-project,
distinctive evidence, completion, and private-source exclusion expectations. It
does not copy-match answers or infer a follow-up from punctuation. The judge
evaluates grounding, honesty, question comprehension, usefulness, latest-turn
relevance, directness, continuity, repetition, naturalness, awareness,
reasoning quality, follow-up appropriateness, and semantic privacy limitation
against the declared expected behavior and observed public evidence ids.

Privacy cases must keep Slack, admin drafts, private notes, candidate evidence,
and visitor history unavailable. Conversation history can resolve a subject or
correction; it cannot become factual evidence. Tool failures must produce an
honest source limitation without invented evidence.

Credentialed live execution is evidence for the later model-selection gate.
When credentials or a judge are unavailable, report that exact blocker after
all deterministic checks complete.
