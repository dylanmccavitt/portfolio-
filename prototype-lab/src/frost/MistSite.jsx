import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, X } from "lucide-react";
import { Clouds } from "../components/canvasui/Clouds.tsx";
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
  instruction: "The locked direction: a bare page where mist does the reveals — hover a Work card or the About pane to lift the fog; click a card to enter the project.",
  component: "Card grid + About pane, Clouds (canvasui) per surface",
};

const DESTINATIONS = [
  { id: "about", label: "About" },
  { id: "work", label: "Work" },
  { id: "journey", label: "Journey" },
  { id: "contact", label: "Contact" },
];

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

/** About under the same weather: the summary rests beneath a wide fog
    pane; hovering lifts it and the words condense in. */
function MistAbout() {
  const body = (
    <div className="frost-mist-body">
      <p>{PROFILE.summary}</p>
      <p>
        I build backend systems, product software, and practical AI tools. I
        care about visible state, inspectable decisions, and products that make
        complicated work feel ordinary.
      </p>
    </div>
  );

  return (
    <div className="frost-mist-about">
      <div className="popout-thaw">
        <div className="popout-thaw-sizer" aria-hidden="true">{body}</div>
        <Clouds
          className="popout-thaw-effect"
          style={{ position: "absolute", inset: 0 }}
          {...MIST_PROPS}
        >
          {body}
        </Clouds>
      </div>
      <div className="frost-thaw-teaser frost-mist-hint" aria-hidden="true">
        <p className="frost-kicker">Clear the fog</p>
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

export function MistSite({ navigate }) {
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
                <p className="frost-kicker">The short version</p>
                <MistAbout />
              </section>

              <section className="frost-site-section" id="work">
                <h2>Work</h2>
                <p className="frost-kicker">{workList.length} projects · shipped and building</p>
                <ol className="frost-cards frost-cards--mist">
                  {workList.map((project, index) => (
                    <MistCard key={project.id} project={project} index={index} onOpen={openProject} />
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
