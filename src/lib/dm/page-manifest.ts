/**
 * THE PAGE-ACTION MANIFEST — the only DM data the browser is given.
 *
 * It carries no facts about anyone: the anchors are the section ids in the
 * homepage's own HTML, and the project ids are the Work cards' own
 * `data-project-id` values. A visitor can read both off the page they are
 * already looking at.
 *
 * It exists so `src/components/frost/dm-client.js` can drop any page action
 * whose target the site does not publish, without the client having to hold the
 * grounding corpus to do it. That corpus is not published and never reaches the
 * browser, which is why this module is deliberately separate from
 * `./corpus.ts`: a page can import the manifest without pulling the approved
 * profile or the career timeline into the build graph, and
 * `tests/dm-corpus.test.ts` fails any page or component that imports the corpus
 * builder instead.
 */

import { loadPublicProjectDetails } from '@/lib/public-projects';

/** The single-page site's section anchors, in document order. */
export const DM_PAGE_ANCHORS = ['about', 'work', 'journey', 'contact'] as const;

/**
 * The only action verbs a DM answer may target. Published so a consumer can
 * validate an action without inferring the vocabulary from prose.
 */
export const DM_PAGE_ACTIONS = ['go', 'lit', 'open', 'litContact'] as const;

/** Legal targets for a DM answer: anchors, project ids, and action verbs. */
export interface DmPageManifest {
  anchors: string[];
  projectIds: string[];
  actions: string[];
}

/** One definition, shared by the corpus's `page` block and the island prop. */
export function pageManifest(projectIds: string[]): DmPageManifest {
  return {
    anchors: [...DM_PAGE_ANCHORS],
    projectIds,
    actions: [...DM_PAGE_ACTIONS],
  };
}

/**
 * The manifest on its own, for `src/pages/index.astro` to hand the Frost island
 * at build time.
 */
export async function buildDmPageManifest(): Promise<DmPageManifest> {
  const { projects } = await loadPublicProjectDetails();
  return pageManifest(projects.map((project) => project.id));
}
