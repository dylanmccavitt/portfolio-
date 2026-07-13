# Bugbot review guidance

Use this contract for automatic and on-demand Bugbot PR reviews.
Repository-specific requirements in `AGENTS.md` and closer nested guidance remain authoritative.
The full review contract lives in `code_review.md`.

## Finding threshold

- Report only actionable problems introduced or materially worsened by the change.
- Prioritize correctness, security, privacy, data loss, availability, regressions, and backwards compatibility.
- Skip cosmetic preferences, style nits, and speculative concerns without a concrete failure mode.
- Do not widen the requested change. Record unrelated improvements separately.
- If there are no actionable findings, say so and list any residual proof gaps separately.

## Required analysis

- Compare the diff with the stated intent, acceptance criteria, and repository constraints.
- Trace changed behavior end to end, including callers, persistence, external boundaries, and failure paths.
- When relevant, scrutinize authorization, input validation, secrets and logging, concurrency, migrations, API compatibility, error handling, and rollback behavior.
- Check that tests exercise the changed behavior and meaningful failure modes; do not treat green checks alone as proof of correctness.

## Finding format

For each finding, include:

- severity and a concise title;
- the narrowest useful file and line reference;
- the concrete trigger and resulting impact;
- supporting evidence; and
- the smallest safe fix.

Do not post a finding unless another engineer can understand when it fails and why it matters.

## Portfolio constraints

- Zero client JS by default — progressive enhancement only where deliberate (`src/scripts/dm.ts`, `src/scripts/tour.ts`).
- No jargon in user-facing project descriptions — write for non-technical visitors.
- Deployed public project reads are published-DB only and fail closed; never overlay or fall back to `src/data/catalog.ts` in production reads.
- Never commit secrets (`AI_GATEWAY_API_KEY`, `OPENAI_API_KEY`, database URLs, or similar).

## Merge boundary

A clean Bugbot review is supporting evidence, not merge authority. Human acceptance and repository merge rules remain controlling.
