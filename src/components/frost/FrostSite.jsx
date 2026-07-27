import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, X } from "lucide-react";
import "@fontsource-variable/geist";
import "@fontsource/ibm-plex-mono";
import { SnapshotFx } from "./SnapshotFx.jsx";
import { createGlitch } from "./glitch.jsx";
import DmChat from "./DmChat.jsx";
import { SUBGREETING } from "@/lib/dm/client";
import { JOURNEY, PROFILE, PROJECTS } from "./frost-data.js";
import "./frost.css";

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
function GlitchCard({ project, fx }) {
  const teaser = (
    <div className="frost-glitch-teaser">
      <span className="frost-num">{project.number}</span>
      <p className="frost-kicker">{project.eyebrow}</p>
      <strong>{project.title}</strong>
    </div>
  );

  return (
    <li className="frost-glitch-cell">
      <a
        className="frost-glitch-open"
        href={`/projects/${project.id}`}
        aria-label={`Open ${project.title}`}
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
        {PROFILE.email} <ArrowUpRight size={16} strokeWidth={1.6} />
      </a>
    </div>
  );
}

function SiteLayout({ fx, onDm }) {
  const [current, setCurrent] = useState("about");

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

      <h1 className="frost-sr-only">{PROFILE.name} — {PROFILE.role}</h1>

      <section className="frost-site-section" id="about">
        <h2>About</h2>
        <p className="frost-kicker">The short version</p>
        <CondenseAbout />
      </section>

      <section className="frost-site-section" id="work">
        <FlowIn>
          <h2>Work</h2>
          <p className="frost-kicker">{PROJECTS.length} projects · shipped and building</p>
          <ol className="frost-cards">
            {PROJECTS.map((project) => (
              <GlitchCard key={project.id} project={project} fx={fx} />
            ))}
          </ol>
        </FlowIn>
      </section>

      <section className="frost-site-section" id="journey">
        <FlowIn>
          <h2>Journey</h2>
          <p className="frost-kicker">2019 — now</p>
          <JourneyRows />
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
        <h2 id="frost-dm-title">Ask DM about Dylan&rsquo;s work.</h2>
        <p>{SUBGREETING}</p>
        <DmChat />
        <a href={`mailto:${PROFILE.email}`}>
          Contact Dylan directly <ArrowUpRight size={16} />
        </a>
      </section>
    </div>
  );
}

export default function FrostSite() {
  const [dmOpen, setDmOpen] = useState(false);

  const effectMode = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("effect")
    : null;

  return (
    <main className="frost" id="main">
      <div className="frost-effect">
        <div className="frost-page">
          <SiteLayout fx={effectMode !== "off"} onDm={() => setDmOpen(true)} />
          <footer className="frost-footer">
            <span>&copy; 2026 Dylan McCavitt</span>
            <span>Hover a project to see what shipped.</span>
          </footer>
        </div>
      </div>

      {dmOpen && <DmPanel onClose={() => setDmOpen(false)} />}
    </main>
  );
}
