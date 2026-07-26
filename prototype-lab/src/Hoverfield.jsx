import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUpRight, X } from "lucide-react";
import { JOURNEY, PROFILE, PROJECTS } from "./data.js";

const NAV_ITEMS = [
  ["Work", "work"],
  ["Journey", "journey"],
  ["About", "about"],
  ["Contact", "contact"],
];

function scrollToId(id) {
  document.getElementById(id)?.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
  });
}

function CapabilityNote() {
  const [support, setSupport] = useState("Checking canvas");

  useEffect(() => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const htmlCanvas =
      typeof context?.drawElementImage === "function" &&
      typeof canvas.requestPaint === "function";
    const webgl = Boolean(
      canvas.getContext("webgl2") || canvas.getContext("webgl"),
    );

    setSupport(
      htmlCanvas
        ? "HTML-in-Canvas active"
        : webgl
          ? "Semantic HTML · canvas fallback"
          : "Semantic HTML fallback",
    );
  }, []);

  return (
    <span className="capability-note">
      <span aria-hidden="true" />
      {support}
    </span>
  );
}

function ElasticTitle({ title, active }) {
  const titleRef = useRef(null);
  const [pointer, setPointer] = useState(null);

  function handlePointerMove(event) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const bounds = titleRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setPointer({
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
      width: bounds.width,
      height: bounds.height,
    });
  }

  return (
    <span
      ref={titleRef}
      className="elastic-title"
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setPointer(null)}
      aria-hidden="true"
    >
      {title.split("").map((character, index) => {
        const center = ((index + 0.5) / title.length) * (pointer?.width || 1);
        const distance = pointer ? Math.abs(pointer.x - center) : Infinity;
        const influence = pointer
          ? Math.max(0, 1 - distance / Math.max(190, pointer.width * 0.24))
          : 0;
        const direction = pointer
          ? (center - pointer.x) / Math.max(190, pointer.width * 0.24)
          : 0;
        const vertical = pointer
          ? ((pointer.y / pointer.height) - 0.5) * -18 * influence
          : 0;

        return (
          <span
            key={`${character}-${index}`}
            style={{
              transform: `translate(${direction * 34 * influence}px, ${vertical}px) scaleX(${1 + influence * 0.2}) scaleY(${1 - influence * 0.08})`,
              opacity: active || influence > 0 ? 1 : 0.94,
            }}
          >
            {character === " " ? "\u00a0" : character}
          </span>
        );
      })}
    </span>
  );
}

function ProjectPreview({ project, onOpen }) {
  return (
    <aside className="project-preview" aria-live="polite">
      <div className="preview-meta">
        <span><i aria-hidden="true" />Selected</span>
        <span>{project.id === "bellas-beads" ? "2025" : "In progress"}</span>
      </div>
      <p className="preview-eyebrow">{project.eyebrow}</p>
      <h3>{project.line}</h3>
      <ul aria-label={`${project.title} highlights`}>
        {project.proof.map((item) => <li key={item}>{item}</li>)}
      </ul>
      {project.id === "bellas-beads" ? (
        <button className="preview-link" onClick={onOpen}>
          View case study <ArrowDown size={18} strokeWidth={1.7} />
        </button>
      ) : (
        <span className="preview-link preview-link--static">
          Project preview
        </span>
      )}
    </aside>
  );
}

function BellaCaseStudy({ onReturn }) {
  const bella = PROJECTS[0];

  return (
    <article className="case-study" id="bellas-focus">
      <header className="case-heading">
        <p>01 / Complete focus</p>
        <h2>Bella’s Beads</h2>
        <p>{bella.summary}</p>
      </header>
      <dl className="case-facts">
        <div><dt>Role</dt><dd>Freelance full-stack developer</dd></div>
        <div><dt>Scope</dt><dd>Storefront through production handoff</dd></div>
        <div><dt>Outcome</dt><dd>400+ commits · four integrations</dd></div>
      </dl>
      <div className="case-story">
        <p className="case-kicker">The work</p>
        <p>
          I turned an early wireframe into a complete ecommerce platform for a
          handmade-jewelry business. Customers can browse, check out as a guest
          or account holder, pay, and track fulfillment; the owner gets the
          administrative path needed to run the store.
        </p>
      </div>
      <div className="case-gallery">
        {bella.images.map((src, index) => (
          <figure key={src} className={index === 0 ? "case-shot case-shot--wide" : "case-shot"}>
            <img
              src={src}
              alt={[
                "Bella's Beads storefront landing page",
                "Bella's Beads product page",
                "Bella's Beads Stripe checkout",
                "Bella's Beads administration dashboard",
              ][index]}
            />
            <figcaption>
              {["Storefront", "Product discovery", "Checkout", "Operations"][index]}
            </figcaption>
          </figure>
        ))}
      </div>
      <button className="return-button" onClick={onReturn}>
        Return to Work <ArrowDown size={18} strokeWidth={1.7} />
      </button>
    </article>
  );
}

function DmDialog({ open, onClose }) {
  const closeRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="dm-backdrop" onMouseDown={onClose}>
      <section
        className="dm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dm-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Close DM">
          <X size={22} />
        </button>
        <p className="section-label">Public portfolio guide</p>
        <h2 id="dm-title">Ask DM about Dylan’s work.</h2>
        <p>
          DM answers from Dylan’s published portfolio sources. Private notes,
          visitor chats, credentials, and unsupported claims are never public
          sources.
        </p>
        <div className="dm-status">
          <span aria-hidden="true" />
          DM is unavailable in this local prototype.
        </div>
        <a href={`mailto:${PROFILE.email}`} className="pill-button">
          Contact Dylan instead <ArrowUpRight size={18} />
        </a>
      </section>
    </div>
  );
}

export function Hoverfield() {
  const [activeId, setActiveId] = useState(PROJECTS[0].id);
  const [bellaOpen, setBellaOpen] = useState(false);
  const [dmOpen, setDmOpen] = useState(false);
  const activeProject =
    PROJECTS.find((project) => project.id === activeId) || PROJECTS[0];

  useEffect(() => {
    document.title = "Dylan McCavitt · Work";
  }, []);

  function openBella() {
    setBellaOpen(true);
    requestAnimationFrame(() => scrollToId("bellas-focus"));
  }

  function returnToWork() {
    setBellaOpen(false);
    requestAnimationFrame(() => scrollToId("work"));
  }

  return (
    <main className="hoverfield">
      <header className="site-header">
        <button className="wordmark" onClick={() => scrollToId("work")}>
          Dylan McCavitt
        </button>
        <p>Software engineer <span aria-hidden="true">·</span> New York City</p>
        <nav aria-label="Portfolio">
          {NAV_ITEMS.map(([label, id]) => (
            <button key={id} onClick={() => scrollToId(id)}>{label}</button>
          ))}
          <button className="ask-button" onClick={() => setDmOpen(true)}>
            Ask DM <ArrowUpRight size={17} strokeWidth={1.8} />
          </button>
        </nav>
      </header>

      <section className="work-section" id="work" aria-labelledby="work-heading">
        <div className="section-intro">
          <p className="section-label">Selected portfolio / 2025—26</p>
          <h1 id="work-heading">Work</h1>
          <p>
            Backend systems, product software, and practical AI tools.
            Move through the titles to inspect the work.
          </p>
        </div>

        <div className="project-list">
          {PROJECTS.map((project) => {
            const isActive = project.id === activeId;
            return (
              <div className={`project-row ${isActive ? "is-active" : ""}`} key={project.id}>
                <button
                  className="project-select"
                  onClick={() => setActiveId(project.id)}
                  onPointerEnter={() => setActiveId(project.id)}
                  aria-pressed={isActive}
                  aria-label={`Select ${project.title}`}
                >
                  <span className="project-number">{project.number}</span>
                  <span className="project-title-copy">{project.title}</span>
                  <ElasticTitle title={project.title} active={isActive} />
                  <span className="project-kind">
                    {["Client work", "AI tooling", "Automation", "Systems"][Number(project.number) - 1]}
                  </span>
                </button>
                {isActive && (
                  <div className="mobile-preview">
                    <ProjectPreview project={project} onOpen={openBella} />
                  </div>
                )}
              </div>
            );
          })}
          <div className="desktop-preview">
            <ProjectPreview project={activeProject} onOpen={openBella} />
          </div>
        </div>
        <div className="work-footer">
          <p><span aria-hidden="true" /> Move your cursor. The interface is elastic.</p>
          <CapabilityNote />
        </div>
      </section>

      {bellaOpen && <BellaCaseStudy onReturn={returnToWork} />}

      <section className="journey-section" id="journey" aria-labelledby="journey-heading">
        <div className="section-heading">
          <p className="section-label">Experience / résumé preview</p>
          <h2 id="journey-heading">Journey</h2>
        </div>
        <ol className="journey-list">
          {JOURNEY.map(([year, place, role]) => (
            <li key={`${year}-${place}`}>
              <time>{year}</time>
              <strong>{place}</strong>
              <span>{role}</span>
            </li>
          ))}
        </ol>
        <div className="text-link" aria-label="Résumé preview">
          Résumé preview <span>The complete journey is summarized above</span>
        </div>
      </section>

      <section className="about-section" id="about" aria-labelledby="about-heading">
        <p className="section-label">About</p>
        <h2 id="about-heading">
          Economics to legal operations to cyber risk to software engineering.
        </h2>
        <div>
          <p>{PROFILE.summary}</p>
          <p>
            I like systems where the hard work is visible: clear states,
            inspectable decisions, and products that make complicated tasks
            feel ordinary.
          </p>
        </div>
      </section>

      <section className="contact-section" id="contact" aria-labelledby="contact-heading">
        <p className="section-label">Contact / {PROFILE.status}</p>
        <h2 id="contact-heading">Let’s make the next useful thing.</h2>
        <a href={`mailto:${PROFILE.email}`} className="contact-link">
          {PROFILE.email} <ArrowUpRight size={40} strokeWidth={1.4} />
        </a>
      </section>

      <footer className="site-footer">
        <span>© 2026 Dylan McCavitt</span>
        <CapabilityNote />
      </footer>

      <DmDialog open={dmOpen} onClose={() => setDmOpen(false)} />
    </main>
  );
}
