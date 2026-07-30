import { useEffect, useId, useMemo, useState } from "react";
import { JOURNEY, PROFILE, PROJECTS } from "./data.js";
import { Link } from "./router.jsx";

export function LabHeader({ family, title, siblingRoutes = [] }) {
  return (
    <header className="lab-header">
      <Link href="/" className="lab-brand" aria-label="Prototype lab home">
        DM <span>prototype lab</span>
      </Link>
      <div className="lab-current">
        <span>{family}</span>
        <strong>{title}</strong>
      </div>
      <nav aria-label="Prototype variants">
        {siblingRoutes.map(([href, label]) => (
          <Link
            key={href}
            href={href}
            className={window.location.pathname === href ? "is-active" : ""}
          >
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

export function CapabilityBadge({ engine }) {
  const [capabilities, setCapabilities] = useState({
    htmlInCanvas: false,
    webgl: false,
    reducedMotion: false,
  });

  useEffect(() => {
    const probe = document.createElement("canvas");
    const context = probe.getContext("2d");
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let webgl = false;
    try {
      webgl = Boolean(probe.getContext("webgl2") || probe.getContext("webgl"));
    } catch {
      webgl = false;
    }
    setCapabilities({
      htmlInCanvas:
        typeof context?.drawElementImage === "function" &&
        typeof probe.requestPaint === "function",
      webgl,
      reducedMotion: media.matches,
    });
  }, []);

  const mode = capabilities.reducedMotion
    ? "reduced motion"
    : capabilities.htmlInCanvas && capabilities.webgl
      ? "live HTML-in-Canvas"
      : capabilities.webgl
        ? "semantic HTML + WebGL overlay"
        : "semantic HTML fallback";

  return (
    <p className="capability-badge" data-capability-mode={mode}>
      <span aria-hidden="true" />
      {engine}: {mode}
    </p>
  );
}

export function DMPanel({ onClose }) {
  const headingId = useId();
  return (
    <div className="dm-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="dm-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dm-panel-head">
          <div>
            <p>Contextual guide</p>
            <h2 id={headingId}>Ask DM</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close DM">
            Close
          </button>
        </div>
        <p className="dm-greeting">I&apos;m DM, Dylan McCavitt&apos;s portfolio guide.</p>
        <p className="dm-subgreeting">
          Ask me a question, browse grounded project evidence, read the resume, or
          contact Dylan directly.
        </p>
        <div className="dm-unavailable" role="status">
          <strong>DM is unavailable right now.</strong>
          <span>The prototype keeps the production unavailable-state contract.</span>
        </div>
        <div className="dm-actions">
          <a href="mailto:dylanmccavitt@outlook.com">Contact Dylan</a>
          <button type="button" onClick={onClose}>
            Keep browsing
          </button>
        </div>
      </section>
    </div>
  );
}

export function useDM() {
  const [open, setOpen] = useState(false);
  return {
    openDM: () => setOpen(true),
    panel: open ? <DMPanel onClose={() => setOpen(false)} /> : null,
  };
}

export function Intro({ onAskDM, compact = false }) {
  return (
    <section className={`portfolio-intro ${compact ? "is-compact" : ""}`} id="intro">
      <p className="eyebrow">Dylan McCavitt · New York City</p>
      <h1>{PROFILE.role}</h1>
      <p className="intro-focus">{PROFILE.focus}</p>
      <p className="intro-summary">{PROFILE.summary}</p>
      <div className="intro-actions">
        <a href="#work">Explore selected work</a>
        <button type="button" onClick={onAskDM}>
          Ask DM
        </button>
      </div>
    </section>
  );
}

export function ProjectIndex({ activeId, onSelect }) {
  return (
    <nav className="project-index" aria-label="Selected projects" id="work">
      <p className="section-label">Selected work</p>
      {PROJECTS.map((project) => (
        <button
          key={project.id}
          type="button"
          className={project.id === activeId ? "is-active" : ""}
          onClick={() => onSelect(project.id)}
        >
          <span>{project.number}</span>
          <strong>{project.title}</strong>
          <small>{project.line}</small>
        </button>
      ))}
    </nav>
  );
}

export function BellaCaseStudy({ onReturn, layout = "editorial" }) {
  const bella = PROJECTS[0];
  return (
    <article className={`bella-case bella-case--${layout}`} id="bella">
      <header>
        <p className="eyebrow">{bella.eyebrow}</p>
        <h2>{bella.title}</h2>
        <p>{bella.summary}</p>
      </header>
      <figure className="bella-hero">
        <img src={bella.images[0]} alt="Bella's Beads storefront landing page" />
        <figcaption>Storefront landing · real project capture</figcaption>
      </figure>
      <div className="bella-proof">
        {bella.proof.map((item) => (
          <div key={item}>
            <span aria-hidden="true" />
            <strong>{item}</strong>
          </div>
        ))}
      </div>
      <div className="bella-gallery">
        {bella.images.slice(1).map((src, index) => (
          <figure key={src}>
            <img
              src={src}
              alt={
                ["Bella's Beads product catalog", "Stripe checkout", "Admin dashboard"][
                  index
                ]
              }
            />
          </figure>
        ))}
      </div>
      <div className="case-actions">
        <button type="button" onClick={onReturn}>
          Return to selected work
        </button>
        <a href="https://bellasbeads.shop">Visit live site</a>
      </div>
    </article>
  );
}

export function ProjectPreview({ project }) {
  return (
    <article className="project-preview" style={{ "--project-hue": project.hue }}>
      <p className="eyebrow">{project.eyebrow}</p>
      <h2>{project.title}</h2>
      <p className="project-line">{project.line}</p>
      <p>{project.summary}</p>
      {project.image ? <img src={project.image} alt={`${project.title} project evidence`} /> : null}
      <ul>
        {project.proof.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </article>
  );
}

export function JourneyPreview({ onAskDM }) {
  return (
    <section className="journey-preview" id="journey">
      <header>
        <p className="section-label">Journey / résumé preview</p>
        <h2>Economics → legal ops → cyber risk → engineering</h2>
      </header>
      <ol>
        {JOURNEY.map(([when, title, role]) => (
          <li key={`${when}-${title}`}>
            <span>{when}</span>
            <strong>{title}</strong>
            <p>{role}</p>
          </li>
        ))}
      </ol>
      <div className="journey-actions">
        <a href="mailto:dylanmccavitt@outlook.com">Contact Dylan</a>
        <button type="button" onClick={onAskDM}>
          Ask DM about the journey
        </button>
      </div>
    </section>
  );
}

export function useSelectedProject() {
  const [activeId, setActiveId] = useState("bellas-beads");
  const project = useMemo(
    () => PROJECTS.find((candidate) => candidate.id === activeId) ?? PROJECTS[0],
    [activeId],
  );
  return { activeId, setActiveId, project };
}
