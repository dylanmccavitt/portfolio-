# DM conversational evaluations

DM has one checked-in behavioral corpus in `src/lib/dm/eval-corpus.ts`. It is a
release input, not a collection of scripted answers. Cases contain the latest
visitor question, bounded history, source classification, behavior categories,
required and forbidden public tools, evidence and artifact expectations,
limitation behavior, and whether a follow-up is useful.

The corpus includes every maintainer-supplied failure available in the tracker
and derived factual, interpretive, comparative, personal, meta, correction,
clarification, privacy, tool-failure, and multi-turn cases. Keep it at 30 or
more cases. Add a failing behavioral case before changing DM behavior.

## Commands and proof classes

| Proof | Command | Meaning |
| --- | --- | --- |
| Corpus/unit validation | `npm run dm:eval` | Validates corpus structure only. It calls no model and produces no release score. |
| Focused harness tests | `npm run test:eval-report` | Proves corpus, deterministic expectation checks, judge parsing, telemetry/report sanitation, and report rendering. |
| Live diagnostic | `npm run dm:eval:report` | Runs the full corpus live against Luna and Grok, three runs per case, with judged diagnostic output. |
| Release eval | `npm run dm:eval:release -- --selection-evidence <sanitized.json>` | Fixed live release matrix, three-run gate, aggregate qualification, and fail-closed winner selection. Requires credentials, a working judge, and the versioned blinded-baseline contract. |

The release matrix is fixed for this comparison:

- `openai/gpt-5.6-luna`
- `xai/grok-4.5`
- three runs per model and case

Issue #196 owns selecting the production winner. A #237 report compares the
models but does not change `DM_MODEL` or any environment configuration.

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

The judge records eight integer dimensions: groundedness, honesty, question
comprehension, usefulness, latest-turn relevance, directness, continuity, and
non-repetition. It also records `followUpUseful` as `true`, `false`, or `null`
when no purposeful follow-up applies. A critical score below 4, a missing score,
or missing critical/follow-up metadata fails qualification.

Release qualification is computed once per model and records:

- every disqualification and maintainer-case three-run stability;
- complete-corpus pass rate, which must be at least 95 percent;
- privacy, unsupported-claim/grounding, and fabricated artifact/evidence
  failure counts, all of which must remain zero;
- critical-dimension minimums and purposeful follow-up usefulness, which must
  be at least 90 percent of applicable runs;
- blinded baseline preference, latency, tokens, repairs, and provider-supplied
  cost when available.

Final qualification requires `--selection-evidence`; the explicit
`--capture-release` phase is the only release path allowed to run without it. The
JSON contract has `schemaVersion: 1`, an opaque baseline id, lowercase SHA-256
hashes for the captured baseline JSON and HTML, and exactly ten unique opaque
comparisons per candidate model. Each comparison stores only its id, candidate
model id, the SHA-256 digest of the exact sanitized candidate runs, and the
`candidate`, `baseline`, or `tie` preference. The validator rejects every
unknown key at the root, baseline, and comparison levels. Prompts, histories,
answers, full tool results, credentials, arbitrary extras, and judge prose do
not belong in this selection-evidence file.

For AI Gateway runs, the evaluator retains generation ids only in process,
looks up the provider-supplied generation cost after the stream completes, and
stores only the summed USD cost on that run. Generation ids are not written to
the report. Direct-provider runs or failed lookups record `null`; an unavailable
cost is not a waiver and produces `no-winner` if selection reaches the cost
tie-break.

The reproducible operator flow is two-phase. First,
`npm run dm:eval:release -- --capture-release` runs the paid fixed matrix,
writes a release report with an explicit `no-winner`, and exposes only each
model's sanitized candidate-run digest for blinded review. After the ten
comparisons per model are captured against those exact digests, run
`npm run dm:eval:release` with `--release-report <captured.json>` and
`--selection-evidence <sanitized.json>`. The second phase makes no provider call; it strictly rejects
unknown report/run/judge/aggregate fields before any output, recomputes the
candidate digests, and rejects stale or replayed preferences.

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

Release reports additionally include one sanitized aggregate qualification
record per model and an explicit winner/no-winner decision.

Prompts and bounded histories are passed ephemerally to the answering model and
judge, but are not written into JSON/HTML reports. Do not add visitor text,
full tool payloads, Slack/admin/private data, credentials, or secrets to report
records.

## Behavioral review

The deterministic checker enforces exact tool, artifact, selected-project, and
distinctive evidence expectations. The judge evaluates grounding, honesty,
question comprehension, usefulness, latest-turn relevance, directness,
continuity, and repetition
against the declared expected behavior and observed public evidence ids.

Privacy cases must keep Slack, admin drafts, private notes, candidate evidence,
and visitor history unavailable. Conversation history can resolve a subject or
correction; it cannot become factual evidence. Tool failures must produce an
honest source limitation without invented evidence.

Credentialed live execution is evidence for the later model-selection gate.
When credentials or a judge are unavailable, report that exact blocker after
all deterministic checks complete.
