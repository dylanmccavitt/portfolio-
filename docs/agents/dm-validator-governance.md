# DM v2 validator governance

DM v2 gives the model ownership of visitor-facing prose. Runtime validation is
therefore a narrow safety boundary, not a second editor or an offline evaluator.
This rule governs the complete v2 `finalizeAnswer` execution and
`resolveV2FinalAnswer` resolution path.

## Hard-control allowlist

The v2 runtime may enforce only structural or operational controls:

- strict bounded schema types and sizes;
- current-run provenance by filtering unknown evidence ids and references to
  artifacts that the same run did not return;
- deterministic exclusion of forbidden/private sources and tools;
- streamed-prose/finalizer integrity with only CRLF/CR line-ending
  canonicalization and completely blank boundary-line removal;
- provider and configuration validity, cancellation, timeout, rate limits,
  step/token/resource budgets, and other availability bounds.

The finalizer may pass the untouched bounded input with request-local evidence
and artifact ledgers, deduplicate and filter those metadata references, preserve
the model-authored markdown and optional follow-up, and attach resolved
same-run public evidence and artifacts. Invalid metadata degrades by omission;
it does not replace otherwise valid prose with boilerplate.

## Terminal reconciliation

V2 has one deterministic terminal state machine. Streamed prose bytes remain
canonical when a finalizer is exact or narrowly equivalent. A valid
finalize-only result is emitted once through the standard text lifecycle before
its metadata. Structurally complete prose with no finalization attempt completes
with empty metadata. Material finalizer drift preserves the streamed prose,
discards all finalizer evidence, artifacts, limitations, and follow-up, and
records only a content-free `finalization_validation` diagnostic.

Normalization never rewrites output and never changes indentation, intra-line
spacing, interior blank lines, Unicode whitespace, punctuation, case, or
Markdown meaning. Partial or malformed text lifecycles, provider errors,
cancellation, timeout, overflow, invalid Unicode, and attempted invalid
finalization retain bounded safe termination and cannot enter completed history.

## Behavior stays out of runtime rejection

Runtime code must not reject, rewrite, force, or gate v2 prose, limitations,
citations, artifacts, or follow-ups for naturalness, composition coverage,
exact quote wording, stable-read preference, limitation wording or presence,
artifact usefulness or cardinality, or follow-up usefulness or presence. These
are behavior and answer-quality judgments.

Repair behavior in this order:

1. Add a failing case to the checked-in evaluation corpus.
2. Improve the prompt, approved public content, or evaluation rubric.
3. Re-run deterministic and, when separately authorized, live evaluation.

The public source boundary remains hard: published database projects, approved
public RAG sources, and canonical résumé/contact data only. Semantic privacy
quality is evaluated; private-source exclusion is deterministic.

## Exception evidence

A future runtime rejection rule needs a concrete privacy or security failure
mode. The same reviewable change must include the narrow rule, why existing
schema/provenance/source controls are insufficient, a negative regression that
demonstrates the failure, positive graceful-degradation coverage, this allowlist
update, and executable proof spanning the documentation and runtime boundary.
An annotation or behavioral preference is not exception evidence.

## Implementation and review checklist

- Trace the v2 `finalizeAnswer` `execute` body and `resolveV2FinalAnswer` end to
  end; keep every operation on the allowlist above.
- Confirm renamed helpers cannot bypass the executable source proof.
- Confirm known v1 validation and any rejection-result route fail the proof.
- Prove bounded markdown and optional follow-up remain model-authored, while
  unknown evidence ids and unavailable artifact references are stripped.
- Prove exact, narrowly equivalent, finalize-only, prose-only, material-drift,
  and unsafe lifecycle routes share the same canonical prose and metadata rules
  across the server, client, and response observer.
- Confirm v1 behavior is unchanged and `DM_CONTRACT` still defaults to v1.
- Re-run DM, eval, metrics, benchmark, proof, and repository verification at
  the exact candidate head.
- Do not combine this rule with model calls, paid qualification, configuration,
  deployment, database/corpus changes, runtime redesign, or v1 removal.
