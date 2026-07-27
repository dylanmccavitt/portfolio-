import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, X } from "lucide-react";
import { Clouds } from "../components/canvasui/Clouds.tsx";
import { Frost } from "../components/canvasui/Frost.tsx";
import { Liquid } from "../components/canvasui/Liquid.jsx";
import { createGlitch } from "../components/canvasui/Glitch.jsx";
import { createLetterpress } from "../components/canvasui/Letterpress.jsx";
import { SnapshotFx } from "./SnapshotFx.jsx";
import { JOURNEY, PROFILE, PROJECTS } from "./frost-data.js";
import "./frost.css";
import "./lab.css";

/**
 * The locked direction (2026-07-27): bare page — no page-level canvas —
 * with mist doing the reveals. Work is a card grid where each card rests
 * under its own patch of canvasui Clouds fog; About's summary sits under a
 * wider pane of the same weather. Hover lifts the fog and the content
 * condenses in — all compositor CSS, zero React state changes on hover.
 * Earlier explorations (fracture, thaw, settle, flows) live in git history
 * on prototype/frost-ui.
 */

export const CURRENT = {
  slug: "current",
  number: "01",
  name: "Mist reveal",
  instruction: "The locked direction: a bare page where weather does the reveals — hover a Work card to lift its fog, melt the frost off the About prose, click a card to enter the project.",
  component: "Mist card grid + iced About, Clouds + Frost (canvasui)",
};

const DESTINATIONS = [
  { id: "about", label: "About" },
  { id: "work", label: "Work" },
  { id: "journey", label: "Journey" },
  { id: "contact", label: "Contact" },
];

/** About reveal variants, comparable at /aboutx/<slug>. Only fallback-safe
    engines: of the untried canvasui set, Glitch/Peel/RetroDither/
    ParticleReveal/Lamp/Letterpress all sample page content and are inert
    in stock Chrome — Liquid's dye is self-drawn, so it survives. */
export const ABOUT_REVEALS = [
  {
    slug: "condense",
    number: "01",
    name: "Condense",
    instruction: "No canvas at all — the prose condenses in as the section scrolls into view: blur to sharp, staggered, once.",
    component: "CSS scroll reveal",
  },
  {
    slug: "ink",
    number: "02",
    name: "Stir the water",
    instruction: "The prose rests soft under still water; moving across it stirs blue ink while the words come clear.",
    component: "Liquid (canvasui) + CSS clear",
  },
  {
    slug: "ice",
    number: "03",
    name: "Melt the frost",
    instruction: "The earlier take, kept for comparison: bare prose under feathered ice that melts under the pointer.",
    component: "Frost (canvasui)",
  },
  {
    slug: "press",
    number: "04",
    name: "Letterpress",
    instruction: "The prose is pressed into the page like type into damp paper; the impression deepens under the cursor.",
    component: "Letterpress (canvasui), snapshot-fed in stock Chrome",
  },
];

/** Card reveal variants, comparable at /cardsx/<slug>. */
export const CARD_REVEALS = [
  {
    slug: "mist",
    number: "01",
    name: "Mist",
    instruction: "The locked reveal: each card under its own fog; hover lifts it and the facts condense in.",
    component: "Clouds (canvasui) per card",
  },
  {
    slug: "glitch",
    number: "02",
    name: "Glitch through",
    instruction: "Hover corrupts the card's face in a burst — sliced, RGB-split — and what was underneath resolves: the shipped facts.",
    component: "Glitch (canvasui) per card, snapshot-fed",
  },
];

/** Shared ice: tinted to the site's frost blue (the engine default leans
    lavender — blue channel above 1), edges feathered via CSS mask. */
export const ICE_PROPS = {
  frost: 0.5,
  opacity: 0.88,
  meltRadius: 0.3,
  meltStrength: 1,
  refreeze: 4,
  haze: 0.6,
  detail: 2.4,
  tintThin: [0.78, 0.88, 0.96],
  tintThick: [0.9, 0.95, 0.99],
  tintStrength: 0.42,
};

const MIST_PROPS = {
  color: [0.93, 0.95, 0.96],
  opacity: 0.72,
  cover: 0.48,
  density: 2.6,
  shading: 0.05,
  wind: 1,
  windRadius: 240,
  speed: 0.25,
};

function buildWorkList() {
  return PROJECTS.map((curated) => ({
    id: curated.id,
    href: `/projects/${curated.id}`,
    title: curated.title,
    eyebrow: curated.eyebrow,
    line: curated.line,
    summary: curated.summary,
    proof: curated.proof ?? [],
    shots: curated.shots ?? [],
  }));
}

/** Per-card fog: the facts live in the card, a patch of Clouds rests over
    them, and the teaser is printed above the weather. */
function MistCard({ project, index, onOpen }) {
  const facts = (
    <div className="frost-thaw-facts">
      <a
        className="frost-thaw-open"
        href={project.href}
        aria-label={`Open ${project.title}`}
        onClick={(event) => {
          event.preventDefault();
          onOpen(project, event);
        }}
      />
      <p>{project.summary}</p>
      {project.proof.length > 0 && (
        <div className="frost-proof">
          {project.proof.slice(0, 3).map((proof) => <span key={proof}>{proof}</span>)}
        </div>
      )}
      <span className="frost-card-open">Open project <ArrowUpRight size={12} /></span>
    </div>
  );

  return (
    <li className="frost-mist-cell">
      <div className="popout-thaw">
        <div className="popout-thaw-sizer" aria-hidden="true">{facts}</div>
        <Clouds
          className="popout-thaw-effect"
          style={{ position: "absolute", inset: 0 }}
          {...MIST_PROPS}
        >
          {facts}
        </Clouds>
      </div>
      <div className="frost-thaw-teaser" aria-hidden="true">
        <span className="frost-num">{String(index + 1).padStart(2, "0")}</span>
        <p className="frost-kicker">{project.eyebrow}</p>
        <strong>{project.title}</strong>
      </div>
    </li>
  );
}

/** Glitch-through card: the teaser is a signal — hovering corrupts it in
    a burst (constant-glitch canvas flashed in by CSS, snapshot-fed so it
    works in stock Chrome) while the facts underneath resolve. All the
    reveal motion is CSS on :hover; the engine just keeps the corrupted
    frame ready. */
function GlitchCard({ project, index, onOpen }) {
  return (
    <li className="frost-glitch-cell">
      <a
        className="frost-thaw-open"
        href={project.href}
        aria-label={`Open ${project.title}`}
        onClick={(event) => {
          event.preventDefault();
          onOpen(project, event);
        }}
      />
      <div className="frost-glitch-facts" aria-hidden="true">
        <p>{project.summary}</p>
        {project.proof.length > 0 && (
          <div className="frost-proof">
            {project.proof.slice(0, 3).map((proof) => <span key={proof}>{proof}</span>)}
          </div>
        )}
        <span className="frost-card-open">Open project <ArrowUpRight size={12} /></span>
      </div>
      <div className="frost-glitch-top" aria-hidden="true">
        <SnapshotFx
          create={createGlitch}
          options={{ interval: 0, intensity: 1, slices: 26, shift: 34, rgbShift: 5, blocks: 0.6, noise: 0.4 }}
          className="frost-glitch-snap"
        >
          <div className="frost-glitch-teaser">
            <span className="frost-num">{String(index + 1).padStart(2, "0")}</span>
            <p className="frost-kicker">{project.eyebrow}</p>
            <strong>{project.title}</strong>
          </div>
        </SnapshotFx>
      </div>
    </li>
  );
}

/** About gets a different weather than the cards: no card chrome at all —
    the prose sits bare on the page under a pane of real ice (canvasui
    Frost, native in stock Chrome) that melts under the pointer, and the
    whole pane thins on hover so the words come fully clear. The body
    carries the page's own surface color because Frost's native tier
    samples transparent pixels as black. */
const ABOUT_PARAGRAPHS = [
  PROFILE.summary,
  "I build backend systems, product software, and practical AI tools. I care about visible state, inspectable decisions, and products that make complicated work feel ordinary.",
];

/** Condense: pure CSS — the prose blurs in from nothing the first time the
    section scrolls into view. */
function CondenseAbout() {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
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
      {ABOUT_PARAGRAPHS.map((text) => <p key={text.slice(0, 16)}>{text}</p>)}
    </div>
  );
}

/** Stir the water: the prose rests soft under still water; the cursor
    stirs self-drawn ink (works in stock Chrome) while CSS clears the
    words. */
function InkAbout() {
  return (
    <div className="frost-about-ink">
      <Liquid
        color={[0.35, 0.55, 0.78]}
        intensity={1.6}
        distortion={0.3}
        radius={0.25}
        force={1}
      >
        <div className="frost-about-body frost-ink-body">
          {ABOUT_PARAGRAPHS.map((text) => <p key={text.slice(0, 16)}>{text}</p>)}
        </div>
      </Liquid>
    </div>
  );
}

/** Letterpress: the prose pressed into the page, deepening under the
    cursor — snapshot-fed so it renders in stock Chrome. */
function PressAbout() {
  return (
    <SnapshotFx
      create={createLetterpress}
      options={{ depth: 0.16, spread: 1.5, grain: 0.05, threshold: 0.12, background: "#eef2f4" }}
      className="frost-about-press"
    >
      <div className="frost-about-body">
        {ABOUT_PARAGRAPHS.map((text) => <p key={text.slice(0, 16)}>{text}</p>)}
      </div>
    </SnapshotFx>
  );
}

function FrostAbout() {
  const body = (
    <div className="frost-about-body">
      {ABOUT_PARAGRAPHS.map((text) => <p key={text.slice(0, 16)}>{text}</p>)}
    </div>
  );

  return (
    <div className="frost-about-reveal">
      <div className="popout-thaw">
        <div className="popout-thaw-sizer" aria-hidden="true">{body}</div>
        <Frost
          className="popout-thaw-effect"
          style={{ position: "absolute", inset: 0 }}
          {...ICE_PROPS}
        >
          {body}
        </Frost>
      </div>
    </div>
  );
}

function JourneyRows() {
  return (
    <ol className="frost-journey">
      {JOURNEY.map(([year, place, role]) => (
        <li key={`${year}-${place}`}>
          <time>{year}</time>
          <strong>{place}</strong>
          <span>{role}</span>
        </li>
      ))}
    </ol>
  );
}

function ContactBlock() {
  return (
    <div className="frost-contact">
      <a href={`mailto:${PROFILE.email}`}>
        {PROFILE.email} <ArrowUpRight size={24} strokeWidth={1.6} />
      </a>
      <p>{PROFILE.status} · replies within a day.</p>
    </div>
  );
}

/** The in-lab stand-in for the /projects/[id] frost-doc page. */
function ProjectDoc({ project, onBack }) {
  const back = (event) => {
    event.preventDefault();
    onBack();
  };
  return (
    <main className="frost frost-doc">
      <header className="frost-doc-head">
        <a href="/" onClick={back}>Dylan McCavitt</a>
        <nav aria-label="Primary">
          <a href={project.href} onClick={back}>← All work</a>
        </nav>
      </header>
      <div className="frost-doc-title">
        <h1>{project.title}</h1>
        <p className="frost-kicker">{project.eyebrow}</p>
        <p style={{ maxWidth: 640, margin: "14px 0 0", fontSize: 15, lineHeight: 1.6 }}>{project.line}</p>
      </div>
      <section className="frost-doc-section" aria-labelledby="doc-shipped">
        <h2 id="doc-shipped">What shipped</h2>
        <p style={{ maxWidth: 640, margin: 0, fontSize: 14, lineHeight: 1.65, color: "var(--frost-muted)" }}>{project.summary}</p>
      </section>
      <section className="frost-doc-section" aria-labelledby="doc-evidence">
        <h2 id="doc-evidence">Evidence</h2>
        <div className="frost-doc-facts">
          {project.proof.map((proof) => <span key={proof}>{proof}</span>)}
        </div>
      </section>
      {project.shots.length > 0 && (
        <section className="frost-doc-section" aria-labelledby="doc-screens">
          <h2 id="doc-screens">Screens</h2>
          <div className="frost-gallery">
            {project.shots.map((shot) => (
              <figure key={shot.src}>
                <img src={shot.src} alt={shot.caption} loading="lazy" />
                <figcaption>{shot.caption}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
      <nav className="frost-doc-actions" aria-label="Project actions">
        <a className="is-quiet" href="/#work" onClick={back}>← All work</a>
      </nav>
    </main>
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
        <h2 id="frost-dm-title">Ask DM about Dylan&rsquo;s work.</h2>
        <p>The live chat runs on the real site; this lab keeps the panel as a placeholder.</p>
        <a href={`mailto:${PROFILE.email}`}>
          Contact Dylan directly <ArrowUpRight size={16} />
        </a>
      </section>
    </div>
  );
}

const ABOUT_BODIES = { condense: CondenseAbout, ink: InkAbout, ice: FrostAbout, press: PressAbout };
const ABOUT_KICKERS = {
  condense: "The short version",
  ink: "The short version · stir the water",
  ice: "The short version · melt the frost",
  press: "The short version · pressed into the page",
};

export function MistSite({ navigate, aboutVariant = "condense", cardVariant = "mist" }) {
  const AboutBody = ABOUT_BODIES[aboutVariant] ?? CondenseAbout;
  const Card = cardVariant === "glitch" ? GlitchCard : MistCard;
  const [current, setCurrent] = useState("about");
  const [dmOpen, setDmOpen] = useState(false);
  const [docProject, setDocProject] = useState(null);
  const [growFrom, setGrowFrom] = useState(null);
  const [growLive, setGrowLive] = useState(false);
  const workList = useMemo(() => buildWorkList(), []);

  useEffect(() => {
    document.title = `${CURRENT.name} · Frost effect lab`;
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  useEffect(() => {
    const sections = DESTINATIONS.flatMap((d) => {
      const section = document.getElementById(d.id);
      return section ? [section] : [];
    });
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
  }, [docProject]);

  const go = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const openProject = (project, event) => {
    const rect = event.currentTarget.closest("li")?.getBoundingClientRect();
    if (rect) {
      setGrowFrom({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
      setGrowLive(false);
      setDocProject(project);
      requestAnimationFrame(() => requestAnimationFrame(() => setGrowLive(true)));
      setTimeout(() => setGrowFrom(null), 520);
    } else {
      setDocProject(project);
    }
  };

  return (
    <div className="lab-route">
      <div className="lab-bar">
        <button onClick={() => navigate("/")}>
          <ArrowLeft size={13} /> Lab
        </button>
        <p>{CURRENT.instruction}</p>
      </div>

      <main className="frost" id="main">
        <div className="frost-effect frost-effect--none">
          <div className="frost-page">
            <div className="frost-site">
              <header className="frost-site-head">
                <button className="frost-site-brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
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
                  <button className="frost-dm-button" onClick={() => setDmOpen(true)}>Ask DM</button>
                </div>
              </header>

              <section className="frost-site-section frost-site-hero">
                <h1 className="frost-hero-name">{PROFILE.name}</h1>
                <p className="frost-kicker">{PROFILE.role}</p>
              </section>

              <section className="frost-site-section" id="about">
                <h2>About</h2>
                <p className="frost-kicker">{ABOUT_KICKERS[aboutVariant] ?? ABOUT_KICKERS.condense}</p>
                <AboutBody />
              </section>

              <section className="frost-site-section" id="work">
                <h2>Work</h2>
                <p className="frost-kicker">{workList.length} projects · shipped and building</p>
                <ol className={`frost-cards frost-cards--${cardVariant}`}>
                  {workList.map((project, index) => (
                    <Card key={project.id} project={project} index={index} onOpen={openProject} />
                  ))}
                </ol>
              </section>

              <section className="frost-site-section" id="journey">
                <h2>Journey</h2>
                <p className="frost-kicker">2019 — now</p>
                <JourneyRows />
              </section>

              <section className="frost-site-section" id="contact">
                <h2>Contact</h2>
                <p className="frost-kicker">Say hello</p>
                <ContactBlock />
              </section>
            </div>
            <footer className="frost-footer">
              <span>&copy; 2026 Dylan McCavitt</span>
              <span>{CURRENT.instruction}</span>
            </footer>
          </div>
        </div>

        {docProject && (
          <div
            className={`lab-doc-overlay${growFrom ? " is-grow" : ""} lab-doc--grow`}
            style={growFrom ? (growLive ? { top: 0, left: 0, width: "100%", height: "100%" } : growFrom) : undefined}
          >
            <ProjectDoc project={docProject} onBack={() => setDocProject(null)} />
          </div>
        )}
        {dmOpen && <DmPanel onClose={() => setDmOpen(false)} />}
      </main>
    </div>
  );
}
