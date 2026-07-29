import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { ArrowUpRight, X } from "lucide-react";
import "@fontsource-variable/geist";
import "@fontsource/ibm-plex-mono";
import { SnapshotFx } from "./SnapshotFx.jsx";
import { createGlitch } from "./glitch.jsx";
import { resolveDmEndpoint } from "./dm-client.js";
import {
  DM_LIT_CONTACT_MS,
  DM_LIT_MS,
  readDmSession,
  takeDmActions,
  writeDmOpen,
} from "./dm-session.js";
import { PROFILE } from "./frost-data.js";
import "./frost.css";

/** The DM service, if one is configured for this build. Absent (or malformed)
    keeps the "being rebuilt" panel — the site never ships a half-live agent. */
const DM_ENDPOINT = resolveDmEndpoint(import.meta.env.PUBLIC_DM_ENDPOINT);

/** The card is a separate chunk, fetched on first open: the landing pays
    nothing up front for a surface most visitors never ask for, and never
    fetches the chunk at all when no service is configured. The build still
    emits it, and `.frost-dmc` is in the one stylesheet either way — what is
    saved is the request, not the bytes on the CDN. */
const DmCard = lazy(() => import("./DmCard.jsx"));

const DESTINATIONS = [
  { id: "about", label: "About" },
  { id: "work", label: "Work" },
  { id: "journey", label: "Journey" },
  { id: "contact", label: "Contact" },
];

const GLITCH_OPTIONS = { interval: 0, intensity: 1, slices: 26, shift: 34, rgbShift: 5, blocks: 0.6, noise: 0.4 };

/** Reveals children once, softly, when they first scroll into view. The
    hidden state is applied only under `@media (scripting: enabled)`, so
    the no-JS page stays complete. */
function FlowIn({ className, children }) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.12 }
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={`frost-flow-in${seen ? " is-in" : ""}${className ? ` ${className}` : ""}`}>
      {children}
    </div>
  );
}

/** About condenses in: the prose blurs to sharp, staggered, the first
    time the section scrolls into view. Pure CSS transition. */
function CondenseAbout() {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 }
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={`frost-about-condense${seen ? " is-in" : ""}`}>
      <p>Software Engineer currently focused on Agentic AI.</p>
    </div>
  );
}

/** Glitch-through card: the teaser rides a snapshot-fed constant-glitch
    canvas held invisible; hover flashes the corrupted frame while the
    facts underneath resolve. All reveal motion is CSS on :hover — the
    engine just keeps the corrupted frame ready. The card is a real
    anchor to its project page, so the no-JS/`?effect=off` path is a
    plain link. */
function GlitchCard({ project, index, fx, isHot }) {
  const teaser = (
    <div className="frost-glitch-teaser">
      <span className="frost-num">{String(index + 1).padStart(2, "0")}</span>
      <p className="frost-kicker">{project.eyebrow}</p>
      <strong>{project.title}</strong>
    </div>
  );

  return (
    <li
      className={`frost-glitch-cell${isHot ? " is-hot" : ""}`}
      data-project-id={project.id}
      data-project-href={project.href}
    >
      <a
        className="frost-glitch-open"
        href={project.href}
        aria-label={`Open ${project.title}`}
      />
      <div className="frost-glitch-facts" aria-hidden="true">
        <p>{project.line}</p>
        {project.proof.length > 0 && (
          <div className="frost-proof">
            {project.proof.slice(0, 3).map((proof) => <span key={proof}>{proof}</span>)}
          </div>
        )}
        <span className="frost-card-open">Open project <ArrowUpRight size={12} /></span>
      </div>
      <div className="frost-glitch-top" aria-hidden="true">
        {fx ? (
          <SnapshotFx create={createGlitch} options={GLITCH_OPTIONS} className="frost-glitch-snap">
            {teaser}
          </SnapshotFx>
        ) : (
          <div className="frost-glitch-snap">{teaser}</div>
        )}
      </div>
    </li>
  );
}

/** Built at build time from the resume's public-track allowlist; see
    `src/lib/journey.ts`. This component only renders what it is handed. */
function JourneyRows({ journey }) {
  return (
    <ol className="frost-journey">
      {journey.map((row) => (
        <li key={row.id}>
          <time>{row.when}</time>
          <strong>{row.place}</strong>
          <span>{row.role}</span>
        </li>
      ))}
    </ol>
  );
}

function ContactBlock() {
  return (
    <div className="frost-contact">
      <a href={`mailto:${PROFILE.email}`}>
        {PROFILE.email} <ArrowUpRight size={16} strokeWidth={1.6} />
      </a>
    </div>
  );
}

function SiteLayout({ projects, journey, fx, onDm }) {
  const [current, setCurrent] = useState("about");
  const [hotId, setHotId] = useState(null);

  // Touch has no hover: the first tap on a card plays the reveal, the second
  // tap navigates, and a tap outside reseals. Everything resolves the card
  // from the tap COORDINATES (elementFromPoint), never event.target — iOS
  // retargets taps on the pointer-events-none teaser to nodes outside the
  // card, so target-based handling silently never fires there.
  useEffect(() => {
    // iOS can dispatch a trailing duplicate click for one tap with a
    // different coordinate basis (~130px off), so resealing is guarded by
    // both recency and proximity to the revealed card.
    let lastRevealAt = 0;

    // Resolve the tapped card from the target when Safari gives a usable
    // one, else probe coordinates — including bases shifted by the
    // collapsed URL-bar delta, which offsets click coords from the layout
    // viewport that elementFromPoint uses.
    const cellFrom = (event) => {
      const fromTarget =
        event.target instanceof Element ? event.target.closest(".frost-glitch-cell") : null;
      if (fromTarget) return fromTarget;
      const deltas = [0];
      const vv = window.visualViewport;
      if (vv) {
        deltas.push(vv.offsetTop, -vv.offsetTop, window.innerHeight - vv.height, vv.height - window.innerHeight);
      }
      for (const dy of deltas) {
        const el = document.elementFromPoint(event.clientX, event.clientY + dy);
        const cell = el instanceof Element ? el.closest(".frost-glitch-cell") : null;
        if (cell) return cell;
      }
      return null;
    };

    const onClick = (event) => {
      if (!window.matchMedia("(hover: none)").matches) return;
      const cell = cellFrom(event);

      if (!cell || !cell.dataset.projectId) {
        const hot = document.querySelector(".frost-glitch-cell.is-hot");
        if (!hot || Date.now() - lastRevealAt < 450) return;
        const rect = hot.getBoundingClientRect();
        const near =
          event.clientX > rect.left - 40 &&
          event.clientX < rect.right + 40 &&
          event.clientY > rect.top - 160 &&
          event.clientY < rect.bottom + 160;
        if (!near) setHotId(null);
        return;
      }

      if (cell.classList.contains("is-hot")) {
        if (!(event.target instanceof Element && event.target.closest("a"))) {
          window.location.assign(cell.dataset.projectHref);
        }
        return;
      }

      event.preventDefault();
      lastRevealAt = Date.now();
      setHotId(cell.dataset.projectId);
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    const sections = DESTINATIONS
      .map((d) => document.getElementById(d.id))
      .filter(Boolean);
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setCurrent(visible.target.id);
      },
      { rootMargin: "-20% 0px -55% 0px", threshold: [0, 0.25, 0.5] }
    );
    sections.forEach((section) => io.observe(section));
    return () => io.disconnect();
  }, []);

  const go = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (typeof history !== "undefined") history.replaceState(null, "", `#${id}`);
  };

  return (
    <div className="frost-site">
      <div className="frost-boot-fade">
        <header className="frost-site-head">
          <button
            className="frost-site-brand"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          >
            Dylan McCavitt
          </button>
          <nav aria-label="Sections">
            {DESTINATIONS.map((destination) => (
              <button
                key={destination.id}
                className={destination.id === current ? "is-active" : ""}
                onClick={() => go(destination.id)}
              >
                {destination.label}
              </button>
            ))}
          </nav>
          <div className="frost-site-actions">
            <button className="frost-dm-button" onClick={onDm}>Ask DM</button>
          </div>
        </header>
      </div>

      <h1 className="frost-sr-only">{PROFILE.name}, {PROFILE.role}</h1>

      <section className="frost-site-section" id="about">
        <h2>About</h2>
        <p className="frost-kicker">The short version</p>
        <CondenseAbout />
      </section>

      <section className="frost-site-section" id="work">
        <FlowIn>
          <h2>Work</h2>
          <p className="frost-kicker">{projects.length} projects · shipped and building</p>
          <ol className="frost-cards">
            {projects.map((project, index) => (
              <GlitchCard
                key={project.id}
                project={project}
                index={index}
                fx={fx}
                isHot={project.id === hotId}
              />
            ))}
          </ol>
        </FlowIn>
      </section>

      <section className="frost-site-section" id="journey">
        <FlowIn>
          <h2>Journey</h2>
          <p className="frost-kicker">2019 to now</p>
          <JourneyRows journey={journey} />
        </FlowIn>
      </section>

      <section className="frost-site-section" id="contact">
        <FlowIn>
          <h2>Contact</h2>
          <ContactBlock />
        </FlowIn>
      </section>
    </div>
  );
}

function DmPanel({ onClose }) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="frost-backdrop" onMouseDown={onClose}>
      <section
        className="frost-modal frost-dm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="frost-dm-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="frost-close" onClick={onClose} aria-label="Close DM">
          <X size={19} />
        </button>
        <p className="frost-kicker">Public portfolio guide</p>
        <h2 id="frost-dm-title">DM is being rebuilt.</h2>
        <p>
          The portfolio&rsquo;s chat guide is getting a rework and will be back.
          In the meantime, the projects above cover the work, and Dylan is one
          email away.
        </p>
        <a href={`mailto:${PROFILE.email}`}>
          Contact Dylan directly <ArrowUpRight size={16} />
        </a>
      </section>
    </div>
  );
}

/**
 * Everything the island renders is handed to it at build time. `dmManifest` is
 * the only DM-related data the browser receives: section anchors and project
 * ids, which the corner card's allowlist needs and which are already in this
 * page's own HTML. No grounding corpus is published or fetched.
 *
 * @param {{
 *   projects?: Array<{ id: string, href: string, title: string, slug?: string,
 *     eyebrow: string, line: string, proof: string[] }>,
 *   journey?: Array<{ id: string, when: string, place: string, role: string }>,
 *   dmManifest?: { anchors: string[], projectIds: string[], actions: string[] } | null,
 * }} props
 */
export default function FrostSite({ projects = [], journey = [], dmManifest = null }) {
  const [dmOpen, setDmOpen] = useState(false);

  // Session pickup, after hydration so the server and client first paints
  // agree. Only the live-card path touches sessionStorage: with no endpoint
  // the panel behaves exactly as before. Two things can be waiting — an open
  // conversation (the card reappears, intact), and page actions a project-page
  // answer stashed for this page, each re-validated against the manifest at
  // execution time.
  useEffect(() => {
    if (!DM_ENDPOINT) return;
    if (readDmSession().open) setDmOpen(true);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const flash = (node, className, ms) => {
      if (!node) return;
      node.classList.add(className);
      window.setTimeout(() => node.classList.remove(className), ms);
    };
    for (const action of takeDmActions(dmManifest)) {
      if (action.type === "go") {
        document.getElementById(action.target)?.scrollIntoView({
          behavior: reduced ? "auto" : "smooth",
          block: "start",
        });
      } else if (action.type === "lit") {
        flash(
          Array.from(document.querySelectorAll(".frost-glitch-cell")).find(
            (cell) => cell.dataset.projectId === action.target
          ),
          "is-dm-lit",
          DM_LIT_MS
        );
      } else if (action.type === "litContact") {
        flash(document.querySelector(".frost-contact a"), "is-dm-lit-inline", DM_LIT_CONTACT_MS);
      }
    }
  }, [dmManifest]);

  const toggleDm = (open) => {
    setDmOpen(open);
    if (DM_ENDPOINT) writeDmOpen(open);
  };

  const effectMode = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("effect")
    : null;

  return (
    <main className="frost" id="main">
      <div className="frost-effect">
        <div className="frost-page">
          <SiteLayout
            projects={projects}
            journey={journey}
            fx={effectMode !== "off"}
            onDm={() => toggleDm(true)}
          />
          <footer className="frost-footer">
            <span>&copy; 2026 Dylan McCavitt</span>
            <span>Hover a project to see what shipped.</span>
          </footer>
        </div>
      </div>

      {dmOpen &&
        (DM_ENDPOINT ? (
          <Suspense fallback={null}>
            <DmCard
              endpoint={DM_ENDPOINT}
              manifest={dmManifest}
              projects={projects}
              onClose={() => toggleDm(false)}
            />
          </Suspense>
        ) : (
          <DmPanel onClose={() => setDmOpen(false)} />
        ))}
    </main>
  );
}
