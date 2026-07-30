# Code review guidance

Use this contract for local reviews, pull request reviews, and independent agent reviews.
Repository-specific requirements in `AGENTS.md` and closer nested guidance remain authoritative.

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
- Run the repository's relevant validation commands when the environment permits. Separate executed proof from checks that could not run.

## Finding format

For each finding, include:

- severity and a concise title;
- the narrowest useful file and line reference;
- the concrete trigger and resulting impact;
- supporting evidence; and
- the smallest safe fix.

Do not post a finding unless another engineer can understand when it fails and why it matters.

## Final review and merge boundary

- Re-review the latest commit after material fixes; do not rely on a review of an older diff.
- Confirm required checks pass on the final commit and review conversations are resolved.
- A clean agent review is supporting evidence, not merge authority. Human acceptance and repository merge rules remain controlling.
