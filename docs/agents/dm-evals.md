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
| Release eval | `npm run dm:eval:release` | Fixed live release matrix and three-run gate. Requires credentials and a working judge. |

The release matrix is fixed for this comparison:

- `openai/gpt-5.6-luna`
- `xai/grok-4.5`
- three runs per model and case

Issue #196 owns selecting the production winner. A #237 report compares the
models but does not change `DM_MODEL` or any environment configuration.

## No offline release scores

Deterministic mocked responses in `src/lib/dm/eval-fixtures.ts` are named and
used as unit/benchmark fixtures only. The release runner does not import their
`modelText` or `answerPlan` fields. `npm run dm:eval` exits after corpus
validation and explicitly states that it produced no release-quality score.

Only `npm run dm:eval:release` may label output as a release score. It refuses
to run unless live mode, the exact two-model matrix, three runs, and a judge are
configured. Missing credentials are an environment blocker, never an offline
pass or waiver.

## Sanitized live records

Every live run records:

- case id and name (never the visitor prompt or conversation history);
- exact model id and run number;
- public tool names and stable evidence ids, never full tool results;
- step count, latency, input/output token use, repair count, and outcome;
- emitted artifact kinds and answer text;
- deterministic failure and judge dimensions/identity.

Prompts and bounded histories are passed ephemerally to the answering model and
judge, but are not written into JSON/HTML reports. Do not add visitor text,
full tool payloads, Slack/admin/private data, credentials, or secrets to report
records.

## Behavioral review

The deterministic checker enforces exact tool, artifact, selected-project, and
distinctive evidence expectations. The judge evaluates grounding, honesty,
usefulness, latest-turn relevance, directness, continuity, and repetition
against the declared expected behavior and observed public evidence ids.

Privacy cases must keep Slack, admin drafts, private notes, candidate evidence,
and visitor history unavailable. Conversation history can resolve a subject or
correction; it cannot become factual evidence. Tool failures must produce an
honest source limitation without invented evidence.

Credentialed live execution is evidence for the later model-selection gate.
When credentials or a judge are unavailable, report that exact blocker after
all deterministic checks complete.
