import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { Clouds } from "../components/canvasui/Clouds.tsx";
import { Droplets } from "../components/canvasui/Droplets.tsx";
import { Frost } from "../components/canvasui/Frost.tsx";
import { Liquid } from "../components/canvasui/Liquid.jsx";
import { PROJECTS } from "./frost-data.js";
import { ICE_PROPS } from "./MistSite.jsx";
import "./frost.css";
import "./lab.css";

/**
 * Project-page looks: what /projects/[id] could be, each variant a
 * different layout paired with a different canvasui effect. All effects
 * chosen work in stock Chrome (Clouds/Droplets fallback overlays, Frost
 * native). Bella's Beads is the stand-in content for every look.
 */

export const PROJECT_LOOKS = [
  {
    slug: "ledger",
    number: "01",
    name: "Ledger",
    instruction: "Baseline — the frost-doc page exactly as it ships today. Single column, no canvas.",
    component: "No effect",
  },
  {
    slug: "fog",
    number: "02",
    name: "Fog lifts",
    instruction: "You arrive under fog: the title block rests beneath mist that lifts on hover. Below, the story runs left with an evidence rail on the right.",
    component: "Clouds title block + two-column layout",
  },
  {
    slug: "rain",
    number: "03",
    name: "Rain on the screens",
    instruction: "A sticky rail holds the facts while rain runs down the screens; move over them to sweep the drops aside.",
    component: "Droplets over the gallery + rail layout",
  },
  {
    slug: "ice",
    number: "04",
    name: "Iced evidence",
    instruction: "An oversized editorial title; the evidence chips are sealed under a strip of ice — rub to check the receipts.",
    component: "Frost seal + centered editorial layout",
  },
  {
    slug: "ink",
    number: "05",
    name: "Ink on the screens",
    instruction: "Same rail layout as Rain, different weather: moving across the screens stirs blue ink through the water over them.",
    component: "Liquid (canvasui) over the gallery + rail layout",
  },
];

const MIST_PROPS = {
  color: [0.93, 0.95, 0.96],
  opacity: 0.72,
  cover: 0.48,
  density: 2.6,
  shading: 0.05,
  wind: 1,
  windRadius: 260,
  speed: 0.25,
};

function buildProject() {
  const curated = PROJECTS[0];
  return {
    ...curated,
    href: `/projects/${curated.id}`,
    proof: curated.proof ?? [],
    shots: curated.shots ?? [],
  };
}

/** Borderless weather overlay: hidden copy sizes the box, the effect pane
    covers it exactly. The body must be opaque for native-tier sampling. */
function WeatherOver({ Effect, effectProps, className, children }) {
  return (
    <div className={`look-weather ${className ?? ""}`}>
      <div className="popout-thaw">
        <div className="popout-thaw-sizer" aria-hidden="true">{children}</div>
        <Effect
          className="popout-thaw-effect"
          style={{ position: "absolute", inset: 0 }}
          {...effectProps}
        >
          {children}
        </Effect>
      </div>
    </div>
  );
}

function Chips({ proof }) {
  return (
    <div className="frost-doc-facts">
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

function LedgerLook({ project }) {
  return (
    <main className="frost frost-doc">
      <div className="frost-doc-title">
        <h1>{project.title}</h1>
        <p className="frost-kicker">{project.eyebrow}</p>
        <p style={{ maxWidth: 640, margin: "14px 0 0", fontSize: 15, lineHeight: 1.6 }}>{project.line}</p>
      </div>
      <section className="frost-doc-section">
        <h2>What shipped</h2>
        <p style={{ maxWidth: 640, margin: 0, fontSize: 14, lineHeight: 1.65, color: "var(--frost-muted)" }}>{project.summary}</p>
      </section>
      <section className="frost-doc-section">
        <h2>Evidence</h2>
        <Chips proof={project.proof} />
      </section>
      <section className="frost-doc-section">
        <h2>Screens</h2>
        <Screens shots={project.shots} />
      </section>
    </main>
  );
}

function FogLook({ project }) {
  return (
    <main className="frost frost-doc look-page">
      <WeatherOver Effect={Clouds} effectProps={MIST_PROPS} className="look-fog-head">
        <div className="look-fog-title">
          <p className="frost-kicker">{project.eyebrow}</p>
          <h1>{project.title}</h1>
          <p>{project.line}</p>
        </div>
      </WeatherOver>
      <div className="look-cols">
        <div className="look-cols-story">
          <h2>What shipped</h2>
          <p>{project.summary}</p>
          <Screens shots={project.shots.slice(0, 2)} />
        </div>
        <aside className="look-cols-rail">
          <h2>Evidence</h2>
          <Chips proof={project.proof} />
          <Screens shots={project.shots.slice(2)} className="frost-gallery--thumbs" />
        </aside>
      </div>
    </main>
  );
}

function RainLook({ project }) {
  return (
    <main className="frost frost-doc look-page">
      <div className="look-rail">
        <aside className="look-rail-side">
          <p className="frost-kicker">{project.eyebrow}</p>
          <h1>{project.title}</h1>
          <p className="look-rail-line">{project.line}</p>
          <Chips proof={project.proof} />
        </aside>
        <div className="look-rail-main">
          <h2>What shipped</h2>
          <p className="look-rail-summary">{project.summary}</p>
          <h2>Screens · sweep the rain aside</h2>
          <WeatherOver
            Effect={Droplets}
            effectProps={{
              intensity: 0.5,
              scale: 0.5,
              refraction: 0.3,
              staticDrops: 0.3,
              interactive: true,
              interactionRadius: 0.3,
              interactionStrength: 0.7,
              tint: [0.8, 0.89, 0.98],
              tintStrength: 0.85,
            }}
            className="look-rain-pane"
          >
            <div className="look-rain-body">
              <Screens shots={project.shots} />
            </div>
          </WeatherOver>
        </div>
      </div>
    </main>
  );
}

function IceLook({ project }) {
  return (
    <main className="frost frost-doc look-page look-ice">
      <div className="look-ice-head">
        <p className="frost-kicker">{project.eyebrow}</p>
        <h1>{project.title}</h1>
        <p>{project.line}</p>
      </div>
      <p className="look-ice-summary">{project.summary}</p>
      <h2 className="look-ice-h">Evidence · rub to check the receipts</h2>
      <WeatherOver
        Effect={Frost}
        effectProps={{
          // Realism pass: finer crystal detail, deeper haze, quieter tint —
          // the ice should read as texture, not as a colored film.
          ...ICE_PROPS,
          frost: 0.62,
          detail: 3.4,
          haze: 0.5,
          tintStrength: 0.28,
          meltRadius: 0.32,
          refreeze: 0,
        }}
        className="look-ice-strip"
      >
        <div className="look-ice-chips">
          <Chips proof={project.proof} />
        </div>
      </WeatherOver>
      <h2 className="look-ice-h">Screens</h2>
      <Screens shots={project.shots} className="look-ice-strip-gallery" />
    </main>
  );
}

function InkLook({ project }) {
  return (
    <main className="frost frost-doc look-page">
      <div className="look-rail">
        <aside className="look-rail-side">
          <p className="frost-kicker">{project.eyebrow}</p>
          <h1>{project.title}</h1>
          <p className="look-rail-line">{project.line}</p>
          <Chips proof={project.proof} />
        </aside>
        <div className="look-rail-main">
          <h2>What shipped</h2>
          <p className="look-rail-summary">{project.summary}</p>
          <h2>Screens · stir the water</h2>
          <Liquid
            color={[0.35, 0.55, 0.78]}
            intensity={1.8}
            distortion={0.35}
            radius={0.28}
            force={1.1}
          >
            <div className="look-rain-body">
              <Screens shots={project.shots} />
            </div>
          </Liquid>
        </div>
      </div>
    </main>
  );
}

const LOOK_BODIES = {
  ledger: LedgerLook,
  fog: FogLook,
  rain: RainLook,
  ice: IceLook,
  ink: InkLook,
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
