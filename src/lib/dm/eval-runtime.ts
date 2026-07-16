import type { DMLiveEvalCase } from './eval-corpus';
import {
  createUnavailableEvalPublicSourceSearch,
  type EvalProjectSource,
} from './eval-source';
import type { DMRuntimeDeps } from './runtime';
import type { DMSiteBrief } from './site-brief';

type DMEvalRuntimeSourceDeps = Pick<
  DMRuntimeDeps,
  'db' | 'projectLoader' | 'ragSearch' | 'siteBrief'
>;

/**
 * Wires source failures at the public tool seam without making the mandatory
 * startup brief unavailable. The supplied brief must already have been built
 * successfully from the same published eval source.
 */
export function createDMEvalRuntimeSourceDeps(
  testCase: DMLiveEvalCase,
  source: EvalProjectSource,
  startupSiteBrief: DMSiteBrief,
): DMEvalRuntimeSourceDeps {
  const projectToolUnavailable = testCase.toolFailure?.tool === 'searchProjects';
  return {
    db: source.db,
    projectLoader: projectToolUnavailable
      ? async () => { throw new Error('simulated eval project source unavailable'); }
      : source.projectLoader,
    ragSearch: testCase.toolFailure?.tool === 'searchPublicSources'
      ? createUnavailableEvalPublicSourceSearch()
      : source.publicSourceSearch,
    ...(projectToolUnavailable ? { siteBrief: startupSiteBrief } : {}),
  };
}
