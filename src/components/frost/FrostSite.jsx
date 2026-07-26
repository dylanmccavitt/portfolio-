import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Hammer, Wrench, X } from "lucide-react";
import "@fontsource-variable/geist";
import "@fontsource/ibm-plex-mono";
import { Shatter } from "./Shatter.jsx";
import DmChat from "./DmChat.jsx";
import { SUBGREETING } from "@/lib/dm/client";
import { JOURNEY, PROFILE, PROJECTS } from "./frost-data.js";
import "./frost.css";

/**
 * @typedef {object} PublishedWorkProject The lean build-time shape index.astro
 * passes in, mapped from the published project detail read models.
 * @property {string} id
 * @property {string} href
 * @property {string} title
 * @property {string} statusLabel
 * @property {number} year
 * @property {string} line
 * @property {string} summary
 * @property {Array<{value: string, label: string}>} metrics
 * @property {Array<{label: string, href: string}>} links
 * @property {Array<{src: string, caption: string}>} shots
 */

const DESTINATIONS = [
  { id: "about", label: "About" },
  { id: "work", label: "Work" },
  { id: "journey", label: "Journey" },
  { id: "contact", label: "Contact" },
];

function shapeWorkProject(project) {
  return {
    id: project.id,
    href: project.href,
    title: project.title,
    eyebrow: `${project.statusLabel} · ${project.year}`,
    line: project.line,
    summary: project.summary,
    proof: (project.metrics ?? []).map((metric) => `${metric.value} · ${metric.label}`),
    links: project.links ?? [],
    shots: project.shots ?? [],
  };
}

/**
 * The published set drives the list; the curated entries in frost-data.js are
 * owner-approved homepage copy and lead the order. Without published projects
 * (island rendered standalone) the curated four still make a complete section.
 */
function buildWorkList(published) {
  if (!published?.length) {
    return PROJECTS.map((curated) => ({
      id: curated.id,
      href: `/projects/${curated.id}`,
      title: curated.title,
      eyebrow: curated.eyebrow,
      line: curated.line,
      summary: curated.summary,
      proof: curated.proof ?? [],
      links: [],
      shots: [],
    }));
  }

  const publishedById = new Map(published.map((project) => [project.id, project]));
  const curated = PROJECTS.filter((entry) => publishedById.has(entry.id));
  const curatedIds = new Set(curated.map((entry) => entry.id));

  return [
    ...curated.map((entry) => ({
      ...shapeWorkProject(publishedById.get(entry.id)),
      title: entry.title,
      eyebrow: entry.eyebrow,
      line: entry.line,
      summary: entry.summary,
      proof: entry.proof ?? [],
    })),
    ...published.filter((project) => !curatedIds.has(project.id)).map(shapeWorkProject),
  ];
}

function WorkRows({ projects, onOpen }) {
  return (
    <ol className="frost-work">
      {projects.map((project, index) => (
        <li key={project.id}>
          <a
            href={project.href}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onOpen(project);
            }}
          >
            <span className="frost-num">{String(index + 1).padStart(2, "0")}</span>
            <div>
              <strong>{project.title}</strong>
              <span>{project.line}</span>
            </div>
            <small>
              {project.eyebrow} <ArrowUpRight size={13} />
            </small>
          </a>
        </li>
      ))}
    </ol>
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

function AboutBlock() {
  return (
    <div className="frost-about">
      <p>{PROFILE.summary}</p>
      <p>
        I build backend systems, product software, and practical AI tools. I
        care about visible state, inspectable decisions, and products that make
        complicated work feel ordinary.
      </p>
    </div>
  );
}

function SiteLayout({ shatterRef, workList, onOpenProject, onDm }) {
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
      <header className="frost-site-head">
        <button className="frost-site-brand" onClick={() => go("about")}>
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
          <button
            className="frost-site-icon"
            title="Shatter the page"
            aria-label="Shatter the page"
            onClick={() => shatterRef.current?.crack?.()}
          >
            <Hammer size={14} />
          </button>
          <button
            className="frost-site-icon"
            title="Repair the page"
            aria-label="Repair the page"
            onClick={() => shatterRef.current?.repair?.()}
          >
            <Wrench size={14} />
          </button>
          <button className="frost-dm-button" onClick={onDm}>Ask DM</button>
        </div>
      </header>

      <section className="frost-site-section frost-site-hero" id="about">
        <p className="frost-kicker">Software engineer · New York City · {PROFILE.status.toLowerCase()}</p>
        <AboutBlock />
      </section>

      <section className="frost-site-section" id="work">
        <h2>Work</h2>
        <p className="frost-kicker">{workList.length} projects · shipped and building</p>
        <WorkRows projects={workList} onOpen={onOpenProject} />
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
  );
}

function ProjectFocus({ project, onClose }) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="frost-backdrop" onMouseDown={onClose}>
      <article
        className="frost-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="frost-focus-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="frost-close" onClick={onClose} aria-label={`Close ${project.title}`}>
          <X size={19} />
        </button>
        <p className="frost-kicker">{project.eyebrow}</p>
        <h2 id="frost-focus-title">{project.title}</h2>
        <p>{project.summary}</p>
        {project.proof.length > 0 && (
          <div className="frost-proof">
            {project.proof.map((proof) => <span key={proof}>{proof}</span>)}
          </div>
        )}
        {project.shots.length > 0 && (
          <div className="frost-gallery">
            {project.shots.map((shot) => (
              <figure key={shot.src}>
                <img src={shot.src} alt={shot.caption} loading="lazy" />
                <figcaption>{shot.caption}</figcaption>
              </figure>
            ))}
          </div>
        )}
        <nav className="frost-doc-actions" aria-label={`${project.title} links`}>
          {project.links.map((link) => (
            <a key={link.href} href={link.href} target="_blank" rel="noopener">{link.label}</a>
          ))}
          <a className="is-quiet" href={project.href}>
            Project page <ArrowUpRight size={14} />
          </a>
        </nav>
      </article>
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

/** @param {{ projects?: PublishedWorkProject[] }} props */
export default function FrostSite({ projects = [] }) {
  const [focusedProject, setFocusedProject] = useState(null);
  const [dmOpen, setDmOpen] = useState(false);
  const shatterRef = useRef(null);

  const workList = useMemo(() => buildWorkList(projects), [projects]);

  const effectMode = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("effect")
    : null;

  const Wrapper = effectMode === "off" ? "div" : Shatter;
  const wrapperProps = effectMode === "off"
    ? { className: "frost-effect" }
    : {
        className: "frost-effect",
        controlRef: shatterRef,
        snapshot: true,
        forceSnapshot: effectMode === "snapshot",
        invert: true,
        persist: true,
        regrow: 0,
        radius: 0.3,
        softness: 0.75,
        tileSize: 44,
        shards: 0.9,
        corner: 4,
        lift: 10,
        tilt: 0.8,
        scatter: 3,
        perspective: 1700,
        gapColor: [0.78, 0.87, 0.93],
        shadow: 0.2,
        shading: 0.34,
        refraction: 0.9,
        dispersion: 0.12,
        floatSpeed: 0.25,
        strength: 0.9,
        baseStrength: 0.5,
        followSpeed: 4.5,
      };

  return (
    <main className="frost" id="main">
      <Wrapper {...wrapperProps}>
        <div className="frost-page">
          <SiteLayout
            shatterRef={shatterRef}
            workList={workList}
            onOpenProject={setFocusedProject}
            onDm={() => setDmOpen(true)}
          />
          <footer className="frost-footer">
            <span>&copy; 2026 Dylan McCavitt</span>
            <span>Move the cursor: the glaze is crazed but readable; where you polish, it clears for good.</span>
          </footer>
        </div>
      </Wrapper>

      {focusedProject && (
        <ProjectFocus project={focusedProject} onClose={() => setFocusedProject(null)} />
      )}
      {dmOpen && <DmPanel onClose={() => setDmOpen(false)} />}
    </main>
  );
}
