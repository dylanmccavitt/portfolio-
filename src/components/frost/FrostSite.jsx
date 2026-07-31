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

/** How long a tapped card corrupts before the project page is asked for.
    Matches the touch burst in `frost.css` (0.4s teaser, 0.5s canvas flash) —
    change one and change the other, or navigation lands mid-glitch. */
const BURST_MS = 520;

/** Latches true the first time the node scrolls into view, and stops
    observing. Without IntersectionObserver it latches immediately, so the
    content is never left hidden by a missing API. */
function useInView(threshold) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [threshold]);

  return [ref, seen];
}

/** Reveals children once, softly, when they first scroll into view. The
    hidden state is applied only under `@media (scripting: enabled)`, so
    the no-JS page stays complete. */
function FlowIn({ className, children }) {
  const [ref, seen] = useInView(0.12);

  return (
    <div ref={ref} className={`frost-flow-in${seen ? " is-in" : ""}${className ? ` ${className}` : ""}`}>
      {children}
    </div>
  );
}

/** About condenses in: the name and the prose blur to sharp, staggered,
    the first time the section scrolls into view. Pure CSS transition. */
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
      <p>
        Software engineer focused on agentic tooling, backed by full-stack experience —
        backend systems, product software, and the practical AI tools in the work below.
        The path here ran through economics, legal operations, and cyber risk before an
        M.S. in computer science.
      </p>
    </div>
  );
}

/** Glitch-through card: the teaser rides a snapshot-fed constant-glitch
    canvas held invisible; hover flashes the corrupted frame while the
    facts underneath resolve. All reveal motion is CSS on :hover — the
    engine just keeps the corrupted frame ready. The card is a real
    anchor to its project page, so the no-JS/`?effect=off` path is a
    plain link. */
function GlitchCard({ project, index, fx, isBursting }) {
  // Each card arrives on its own as it reaches the viewport, the way the
  // Journey block and the other sections do — the section wrapper fades the
  // heading in, and the cards below the fold wait their turn rather than
  // being revealed all at once by their parent.
  const [ref, seen] = useInView(0.16);

  const teaser = (
    <div className="frost-glitch-teaser">
      <span className="frost-num">{String(index + 1).padStart(2, "0")}</span>
      <p className="frost-kicker">{project.eyebrow}</p>
      <strong>{project.title}</strong>
    </div>
  );

  return (
    <li
      ref={ref}
      className={`frost-glitch-cell frost-card-in${seen ? " is-in" : ""}${
        isBursting ? " is-burst" : ""
      }`}
      data-project-id={project.id}
      data-project-href={project.href}
    >
      <a
        className="frost-glitch-open"
        href={project.href}
        aria-label={`Open ${project.title}`}
      />
      <div className="frost-glitch-facts frost-glitch-facts--rows" aria-hidden="true">
        <div className="frost-fact-row">
          <span className="frost-fact-key">Line</span>
          <p>{project.line}</p>
        </div>
        <div className="frost-fact-row">
          <span className="frost-fact-key">Open</span>
          <span className="frost-card-open">Project <ArrowUpRight size={12} /></span>
        </div>
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
    <ol className="frost-journey frost-journey-rail">
      {journey.map((row) => (
        <li key={row.id}>
          <time>{row.when}</time>
          <div className="frost-journey-copy">
            <strong>{row.place}</strong>
            <span>{row.role}</span>
          </div>
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
  const [burstId, setBurstId] = useState(null);

  /**
   * Touch: one tap opens the project. The glitch fires on the way out — the
   * card corrupts, then the page loads.
   *
   * It used to reveal instead: first tap flipped the card to its facts,
   * second tap navigated. On a phone that made every project two taps and
   * left the card sitting in a state the visitor had to tap out of, when what
   * a tap on a project plainly means is "open it". The facts are on the page
   * being opened anyway, so nothing is lost by going straight there.
   *
   * The card is still resolved from the tap COORDINATES (elementFromPoint),
   * never event.target — iOS retargets taps on the pointer-events-none teaser
   * to nodes outside the card, so target-based handling silently never fires.
   */
  useEffect(() => {
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

    let timer = 0;

    const onClick = (event) => {
      if (!window.matchMedia("(hover: none)").matches) return;
      const cell = cellFrom(event);
      const href = cell?.dataset.projectHref;
      if (!cell || !cell.dataset.projectId || !href) return;

      // Already on the way out: let the second tap fall through rather than
      // restarting the burst or stacking a second navigation.
      if (timer) return;

      // Reduced motion gets no burst to sit through — the link just works.
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      event.preventDefault();
      setBurstId(cell.dataset.projectId);
      timer = window.setTimeout(() => {
        window.location.assign(href);
      }, BURST_MS);
    };

    /**
     * Coming back from a project page, Safari can restore this page from the
     * back/forward cache with its JavaScript state intact rather than
     * reloading it — and this component's state is mid-tap: the burst class is
     * still on the card whose animation already ended on `forwards`, so it
     * would render blank, and the pending-navigation guard below is still
     * latched, so the next tap would skip its glitch. Both are cleared on the
     * way back in.
     *
     * A normal load fires this too, with nothing to undo.
     */
    const onPageShow = () => {
      if (timer) {
        window.clearTimeout(timer);
        timer = 0;
      }
      setBurstId(null);
    };

    document.addEventListener("click", onClick, true);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("pageshow", onPageShow);
      if (timer) window.clearTimeout(timer);
    };
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

  const onSectionLink = (event, id) => {
    event.preventDefault();
    go(id);
  };

  const onDmLink = (event) => {
    event.preventDefault();
    onDm();
  };

  const currentLabel =
    DESTINATIONS.find((destination) => destination.id === current)?.label ?? "About";

  return (
    <div className="frost-site frost-site--explore">
      <div className="frost-boot-fade">
        <header className="frost-site-head frost-site-head--minimal">
          {/* Name lives in the hero only. The sticky bar tracks the active
              section in mono — orientation without bringing back full nav. */}
          <a className="frost-sr-only" href="#main">
            {PROFILE.name} — top of page
          </a>
          <p className="frost-site-here" aria-live="polite">
            <span className="frost-site-here-label">{currentLabel}</span>
          </p>
          {/* Real hash links stay for no-JS / screen-reader jumps. */}
          <nav aria-label="Sections" className="frost-sr-only">
            {DESTINATIONS.map((destination) => (
              <a
                key={destination.id}
                className={destination.id === current ? "is-active" : ""}
                href={`#${destination.id}`}
                aria-current={destination.id === current ? "location" : undefined}
                onClick={(event) => onSectionLink(event, destination.id)}
              >
                {destination.label}
              </a>
            ))}
          </nav>
          <div className="frost-site-actions">
            <a
              className="frost-dm-button"
              href={`mailto:${PROFILE.email}`}
              onClick={onDmLink}
            >
              Ask DM
            </a>
          </div>
        </header>
      </div>

      {/* Brand-hero open: chromatic fringe on the name (settle-fringe), About
          prose absorbed so the first composition is one beat. `#about` stays
          for redirects / DM go. Ask DM lives only in the sticky bar
          (canvas: sticky-only + mono-chip); no See work — Work is next. */}
      <section className="frost-site-section frost-hero" id="about" aria-label="About">
        <p className="frost-kicker">{PROFILE.role}</p>
        <h1 className="frost-hero-title">{PROFILE.name}</h1>
        <p className="frost-hero-line">{PROFILE.focus}</p>
        <CondenseAbout />
      </section>

      <section className="frost-site-section frost-marginalia" id="work">
        <h2 className="frost-section-rail">Work</h2>
        <FlowIn>
          <p className="frost-kicker">{projects.length} projects · shipped and building</p>
          <ol className="frost-cards">
            {projects.map((project, index) => (
              <GlitchCard
                key={project.id}
                project={project}
                index={index}
                fx={fx}
                isBursting={project.id === burstId}
              />
            ))}
          </ol>
        </FlowIn>
      </section>

      <section className="frost-site-section frost-marginalia" id="journey">
        <h2 className="frost-section-rail">Journey</h2>
        <FlowIn>
          <p className="frost-kicker">2019 to now</p>
          <JourneyRows journey={journey} />
        </FlowIn>
      </section>

      <section className="frost-site-section frost-marginalia" id="contact">
        <h2 className="frost-section-rail">Contact</h2>
        <FlowIn>
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
 *   initialEffects?: boolean,
 * }} props
 */
export default function FrostSite({
  projects = [],
  journey = [],
  dmManifest = null,
  initialEffects = false,
}) {
  const [dmOpen, setDmOpen] = useState(false);
  const [effectsEnabled, setEffectsEnabled] = useState(initialEffects);

  // This page is static, so its server render cannot vary by query string.
  // Start both SSR and hydration from the same canvas-free tree, then enable
  // the default effect after hydration unless the URL explicitly opts out.
  useEffect(() => {
    const mode = new URLSearchParams(window.location.search).get("effect");
    setEffectsEnabled(mode !== "off");
  }, []);

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

  return (
    <main className="frost" id="main">
      <div className="frost-effect">
        <div className="frost-page">
          <SiteLayout
            projects={projects}
            journey={journey}
            fx={effectsEnabled}
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
