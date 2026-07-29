import { Suspense, lazy, useState } from "react";
import { readDmSession, writeDmOpen } from "./dm-session.js";

/**
 * DM on the Paper pages. The static project pages are complete without any
 * JavaScript, so this island is strictly additive: it is rendered client-only
 * (nothing of it exists in the built HTML), and the page mounts it at all only
 * when a DM service is configured — the homepage's exact gate.
 *
 * Two jobs: a header "Ask DM" pill in the site's action language, and the
 * session pickup — a conversation opened anywhere on the site reappears here,
 * intact, because `dm-session.js` carries it across the navigation.
 *
 * Same chunking bargain as the homepage: the card is fetched on first open
 * (or straight away when a restored session says it was open), never before.
 */
const DmCard = lazy(() => import("./DmCard.jsx"));

/**
 * @param {{
 *   endpoint: string,
 *   manifest?: { anchors: string[], projectIds: string[], actions: string[] } | null,
 *   projects?: Array<{ id: string, slug?: string, href: string, title: string }>,
 * }} props
 */
export default function DmDock({ endpoint, manifest = null, projects = [] }) {
  // Client-only render, so reading the session in the initializer cannot
  // disagree with any server paint — there is none.
  const [open, setOpen] = useState(() => readDmSession().open);

  const toggle = (next) => {
    setOpen(next);
    writeDmOpen(next);
  };

  return (
    <>
      <button className="frost-dm-button" type="button" onClick={() => toggle(true)}>
        Ask DM
      </button>
      {open && (
        <Suspense fallback={null}>
          <DmCard
            endpoint={endpoint}
            manifest={manifest}
            projects={projects}
            onClose={() => toggle(false)}
          />
        </Suspense>
      )}
    </>
  );
}
