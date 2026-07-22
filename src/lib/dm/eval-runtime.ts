import type { DMLiveEvalCase } from './eval-corpus';
import { loadPublicProfileEntries } from '@/data/profile';
import {
  createUnavailableEvalPublicSourceSearch,
  type EvalProjectSource,
} from './eval-source';
import type { DMRuntimeDeps } from './runtime';

type DMEvalRuntimeSourceDeps = Pick<
  DMRuntimeDeps,
  'db' | 'projectLoader' | 'profileLoader' | 'ragSearch' | 'searchProjectsFailure'
>;

/**
 * Wires source failures at the public tool seam after the mandatory startup
 * brief has been built normally from the same published eval project loader.
 */
export function createDMEvalRuntimeSourceDeps(
  testCase: DMLiveEvalCase,
  source: EvalProjectSource,
): DMEvalRuntimeSourceDeps {
  const projectToolUnavailable = testCase.toolFailure?.tool === 'searchProjects';
  return {
    db: source.db,
    projectLoader: source.projectLoader,
    profileLoader: loadPublicProfileEntries,
    ragSearch: testCase.toolFailure?.tool === 'searchPublicSources'
      ? createUnavailableEvalPublicSourceSearch()
      : source.publicSourceSearch,
    ...(projectToolUnavailable ? {
      searchProjectsFailure: async (): Promise<never> => {
        throw new Error('simulated eval project search unavailable');
      },
    } : {}),
  };
}
