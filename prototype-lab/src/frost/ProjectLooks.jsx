import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { PROJECTS } from "./frost-data.js";
import { FlowIn } from "./MistSite.jsx";
import "./frost.css";
import "./lab.css";

/**
 * Project-page looks that fit the LOCKED UI (2026-07-27): bare paper
 * page, smooth arrivals (FlowIn), lifted near-white panes for evidence,
 * the chromatic fringe as the only accent. No canvas on these pages —
 * the glitch belongs to the homepage card reveals. Earlier weather looks
 * (fog/rain/ice/ink/glitch/dither) live in git history.
 */

export const PROJECT_LOOKS = [
  {
    slug: "paper",
    number: "01",
    name: "Paper",
    instruction: "The cleanest read: one column on the site's paper — title, story, evidence on a lifted pane, screens in a grid. Everything flows in as you scroll.",
    component: "No canvas · fringe accents",
  },
  {
    slug: "rail",
    number: "02",
    name: "Rail",
    instruction: "A sticky left rail holds the title and evidence while the story and screens scroll by on the right.",
    component: "No canvas · sticky rail",
  },
  {
    slug: "filmstrip",
    number: "03",
    name: "Filmstrip",
    instruction: "Screens lead: a full-width strip up top you can scrub through, the words beneath it.",
    component: "No canvas · media first",
  },
];

function buildProject() {
  const curated = PROJECTS[0];
  return {
    ...curated,
    href: `/projects/${curated.id}`,
    proof: curated.proof ?? [],
    shots: curated.shots ?? [],
  };
}

function Chips({ proof, className }) {
  return (
    <div className={`frost-doc-facts ${className ?? ""}`}>
      {proof.map((item) => <span key={item}>{item}</span>)}
    </div>
  );
}

function Screens({ shots, className }) {
  if (shots.length === 0) return null;
  return (
    <div className={`frost-gallery ${className ?? ""}`}>
      {shots.map((shot) => (
        <figure key={shot.src}>
          <img src={shot.src} alt={shot.caption} loading="lazy" />
          <figcaption>{shot.caption}</figcaption>
        </figure>
      ))}
    </div>
  );
}

function TitleBlock({ project, center }) {
  return (
    <div className={`look-title${center ? " look-title--center" : ""}`}>
      <p className="frost-kicker look-fringe">{project.eyebrow}</p>
      <h1>{project.title}</h1>
      <p className="look-title-line">{project.line}</p>
    </div>
  );
}

function PaperLook({ project }) {
  return (
    <main className="frost frost-doc look-page look-paper">
      <FlowIn>
        <TitleBlock project={project} />
      </FlowIn>
      <FlowIn>
        <section className="look-block">
          <h2>What shipped</h2>
          <p className="look-copy">{project.summary}</p>
        </section>
      </FlowIn>
      <FlowIn>
        <section className="look-block">
          <h2>Evidence</h2>
          <div className="look-paper-pane">
            <Chips proof={project.proof} />
          </div>
        </section>
      </FlowIn>
      <FlowIn>
        <section className="look-block">
          <h2>Screens</h2>
          <Screens shots={project.shots} />
        </section>
      </FlowIn>
    </main>
  );
}

function RailLook({ project }) {
  return (
    <main className="frost frost-doc look-page">
      <div className="look-rail">
        <aside className="look-rail-side">
          <TitleBlock project={project} />
          <div className="look-paper-pane">
            <Chips proof={project.proof} />
          </div>
        </aside>
        <div className="look-rail-main">
          <FlowIn>
            <h2>What shipped</h2>
            <p className="look-copy look-rail-summary">{project.summary}</p>
          </FlowIn>
          <FlowIn>
            <h2>Screens</h2>
            <Screens shots={project.shots} />
          </FlowIn>
        </div>
      </div>
    </main>
  );
}

function FilmstripLook({ project }) {
  return (
    <main className="frost frost-doc look-page">
      <FlowIn>
        <div className="look-film-strip">
          {project.shots.map((shot) => (
            <figure key={shot.src}>
              <img src={shot.src} alt={shot.caption} />
              <figcaption>{shot.caption}</figcaption>
            </figure>
          ))}
        </div>
      </FlowIn>
      <FlowIn>
        <TitleBlock project={project} center />
      </FlowIn>
      <FlowIn>
        <section className="look-block look-block--center">
          <p className="look-copy">{project.summary}</p>
          <div className="look-paper-pane">
            <Chips proof={project.proof} className="look-chips-center" />
          </div>
        </section>
      </FlowIn>
    </main>
  );
}

const LOOK_BODIES = {
  paper: PaperLook,
  rail: RailLook,
  filmstrip: FilmstripLook,
};

export function ProjectLook({ slug, navigate }) {
  const look = PROJECT_LOOKS.find((entry) => entry.slug === slug) ?? PROJECT_LOOKS[0];
  const project = buildProject();
  const Body = LOOK_BODIES[look.slug];

  useEffect(() => {
    document.title = `${look.name} · Project page looks`;
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [look.name]);

  return (
    <div className="lab-route">
      <div className="lab-bar">
        <button onClick={() => navigate("/")}>
          <ArrowLeft size={13} /> Lab
        </button>
        <nav aria-label="Looks">
          {PROJECT_LOOKS.map((entry) => (
            <button
              key={entry.slug}
              className={entry.slug === look.slug ? "is-active" : ""}
              onClick={() => navigate(`/project/${entry.slug}`)}
            >
              {entry.number} {entry.name}
            </button>
          ))}
        </nav>
        <p>{look.instruction}</p>
      </div>
      <div className="look-shell">
        <header className="frost-doc-head">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>Dylan McCavitt</a>
          <nav aria-label="Primary">
            <a href="/current" onClick={(e) => { e.preventDefault(); navigate("/current"); }}>← All work</a>
          </nav>
        </header>
        <Body project={project} />
      </div>
    </div>
  );
}
