import { Glass } from "./components/canvasui/Glass.jsx";
import { ParticleReveal } from "./components/canvasui/ParticleReveal.jsx";
import { Peel } from "./components/canvasui/Peel.jsx";
import { FAMILY_ROUTES } from "./data.js";
import {
  BellaCaseStudy,
  CapabilityBadge,
  Intro,
  JourneyPreview,
  LabHeader,
  ProjectIndex,
  ProjectPreview,
  useDM,
  useSelectedProject,
} from "./Shared.jsx";

const ROUTES = FAMILY_ROUTES[0].routes;

function PortfolioWorld({ variant }) {
  if (variant === "particle") {
    return (
      <div className="portfolio-world portfolio-world--particle" aria-hidden="true">
        <span className="particle-orbit particle-orbit--1" />
        <span className="particle-orbit particle-orbit--2" />
        <div className="particle-sun">BUILD</div>
        <div className="particle-screen">
          <img src="/screenshots/agentic-trader/journal.webp" alt="" />
        </div>
        <p>Systems that leave a trail</p>
      </div>
    );
  }

  if (variant === "material") {
    return (
      <div className="portfolio-world portfolio-world--material" aria-hidden="true">
        <div className="material-card material-card--blue">PRODUCT</div>
        <div className="material-card material-card--image">
          <img src="/screenshots/bella/product-page.webp" alt="" />
        </div>
        <div className="material-card material-card--red">SHIP<br />THE<br />WHOLE<br />THING</div>
        <span className="material-flower">✺</span>
      </div>
    );
  }

  return (
    <div className="portfolio-world portfolio-world--refractive" aria-hidden="true">
      <div className="refractive-window refractive-window--store">
        <img src="/screenshots/bella/landing.webp" alt="" />
      </div>
      <div className="refractive-window refractive-window--admin">
        <img src="/screenshots/bella/admin-dash.webp" alt="" />
      </div>
      <span className="refractive-sticker">REAL<br />WORK</span>
      <p>Useful software,<br />minus the theater.</p>
    </div>
  );
}

function returnToWork() {
  document.querySelector("#work")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function PortfolioDocument({ variant, onAskDM }) {
  const { activeId, setActiveId, project } = useSelectedProject();
  return (
    <main className={`html-document html-document--${variant}`}>
      <div className="intro-world">
        <Intro onAskDM={onAskDM} />
        <PortfolioWorld variant={variant} />
      </div>
      <section className="work-composition">
        <ProjectIndex activeId={activeId} onSelect={setActiveId} />
        <div className="active-project" aria-live="polite">
          {project.id === "bellas-beads" ? (
            <BellaCaseStudy onReturn={returnToWork} layout={variant} />
          ) : (
            <ProjectPreview project={project} />
          )}
        </div>
      </section>
      <JourneyPreview onAskDM={onAskDM} />
    </main>
  );
}

export function RefractiveEditorial() {
  const { openDM, panel } = useDM();
  return (
    <div className="prototype-route refractive-route">
      <LabHeader
        family="HTML-in-Canvas"
        title="Refractive Editorial"
        siblingRoutes={ROUTES}
      />
      <CapabilityBadge engine="Canvas UI Glass" />
      <Glass
        className="canvasui-page"
        shape="circle"
        size={118}
        ior={1.4}
        edge={0.76}
        bevel={3}
        depth={145}
        aberration={0.25}
        reflection={0.45}
        shine={0.16}
        zoom={1.18}
        targets="h1, h2, .bella-hero img, .project-index button"
        follow={0.22}
      >
        <PortfolioDocument variant="refractive" onAskDM={openDM} />
      </Glass>
      {panel}
    </div>
  );
}

export function ParticleStoryline() {
  const { openDM, panel } = useDM();
  return (
    <div className="prototype-route particle-route">
      <LabHeader
        family="HTML-in-Canvas"
        title="Particle Storyline"
        siblingRoutes={ROUTES}
      />
      <CapabilityBadge engine="Canvas UI Particle Reveal" />
      <ParticleReveal
        className="canvasui-page"
        radius={430}
        softness={0.78}
        size={1}
        scatter={12}
        drift={0.18}
        aberration={2}
        bend={7}
        fade={0.7}
        threshold={0.08}
        background="#07111d"
        smoothing={0.18}
      >
        <PortfolioDocument variant="particle" onAskDM={openDM} />
      </ParticleReveal>
      {panel}
    </div>
  );
}

function PeelUnderLayer() {
  return (
    <div className="peel-under" aria-hidden="true">
      <img src="/screenshots/bella/admin-dash.webp" alt="" />
      <div>
        <p>Under the storefront</p>
        <strong>Admin operations, inventory, payments, and shipping.</strong>
      </div>
    </div>
  );
}

function MaterialDocument({ onAskDM }) {
  const { activeId, setActiveId, project } = useSelectedProject();
  return (
    <main className="html-document html-document--material">
      <div className="intro-world">
        <Intro onAskDM={onAskDM} compact />
        <PortfolioWorld variant="material" />
      </div>
      <section className="material-work">
        <ProjectIndex activeId={activeId} onSelect={setActiveId} />
        <div className="material-stage">
          {project.id === "bellas-beads" ? (
            <Peel
              className="material-peel"
              under={<PeelUnderLayer />}
              side="right"
              mode="cursor"
              reveal={240}
              zone={180}
              curl={260}
              bow={32}
              shade={0.22}
              shine={0.42}
              bulge={26}
              perspective={2400}
              smoothing={0.22}
            >
              <BellaCaseStudy onReturn={returnToWork} layout="material" />
            </Peel>
          ) : (
            <ProjectPreview project={project} />
          )}
        </div>
      </section>
      <JourneyPreview onAskDM={onAskDM} />
    </main>
  );
}

export function LayeredMaterial() {
  const { openDM, panel } = useDM();
  return (
    <div className="prototype-route material-route">
      <LabHeader
        family="HTML-in-Canvas"
        title="Layered Material"
        siblingRoutes={ROUTES}
      />
      <CapabilityBadge engine="Canvas UI Peel" />
      <div className="canvasui-page canvasui-page--plain">
        <MaterialDocument onAskDM={openDM} />
      </div>
      {panel}
    </div>
  );
}
