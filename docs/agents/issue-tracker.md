# Issue Tracker

GitHub issues in `DylanMcCavitt/portfolio-` are the durable contract surface for
Gepetto-managed repository delivery. Pull requests live in the same repository.

## Contract and delivery

- Gepetto persists the approved research and acceptance contract on the leaf
  issue under the `gepetto-research` marker.
- Implementation starts from the contract's exact approved base and uses one
  writer, one dedicated worktree, one branch, and one linked PR per leaf.
- The implementer persists criterion-by-criterion proof under the
  `gepetto-implementation` marker and binds it to the live PR head SHA.
- Independent review and finalization operate on that same exact head. A head
  change makes earlier head-bound proof stale.
- Merge, deployment, publication, migrations, issue/PR closure, review-thread
  resolution, and destructive cleanup remain behind their explicit gates.

## Required issue contract

The persisted contract names the problem, exact file scope, dependencies,
acceptance criteria and evidence, validation, risks, non-goals, desired base,
exact base SHA, branch convention, continuity constraints, and authority limits.
Treat it as complete scope; material conflicts return to Gepetto instead of being
resolved by widening the leaf.

## Pull requests

Use `.github/PULL_REQUEST_TEMPLATE.md`. Link the canonical leaf issue, record
exact base and head evidence, map checks and actual evidence to every acceptance
criterion, and document risks and continuity constraints. Do not use a closing
keyword unless issue-closure authority is explicit. An open issue is not, by
itself, evidence that a preview-targeted implementation is absent.

Agent-first redesign PRs target the contract's approved stack parent rooted at
`preview/agent-first-redesign`, never `main`, unless the persisted contract says
otherwise.

## Continuity

- Use the scope ledger to preserve product north star, Next, Later, Explicitly deferred, Do not preclude, Naming anchors, Open questions, and Future issue candidates.
- Do not collapse deferred capabilities into vague "future work"; name the long-term capability, why it is deferred, where it is tracked, and the constraint it imposes on V1.
- Open questions must stay explicit until answered by a human or by cited repo evidence.
- PRs and handoffs must record continuity constraints checked plus evidence.
- Contract changes must preserve the parent issue, dependencies, deferred-scope custody, open questions, and do-not-preclude constraints.
