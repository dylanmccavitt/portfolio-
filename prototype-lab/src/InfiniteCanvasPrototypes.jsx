import { useCallback, useMemo, useState } from "react";
import {
  createShapeId,
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  Tldraw,
} from "tldraw";
import "tldraw/tldraw.css";
import { FAMILY_ROUTES, JOURNEY, PROFILE, PROJECTS } from "./data.js";
import { LabHeader, useDM } from "./Shared.jsx";

const ROUTES = FAMILY_ROUTES[1].routes;

class PortfolioShapeUtil extends ShapeUtil {
  static type = "portfolio";
  static props = {
    w: T.number,
    h: T.number,
    kind: T.string,
    variant: T.string,
    index: T.number,
  };

  getDefaultProps() {
    return { w: 640, h: 420, kind: "project", variant: "constellation", index: 0 };
  }

  getGeometry(shape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  component(shape) {
    const { kind, variant, index } = shape.props;
    return (
      <HTMLContainer
        className={`portfolio-shape portfolio-shape--${kind} portfolio-shape--${variant}`}
        style={{ width: shape.props.w, height: shape.props.h }}
      >
        <ShapeContent kind={kind} index={index} />
      </HTMLContainer>
    );
  }

  getIndicatorPath() {
    return undefined;
  }

  canResize() {
    return false;
  }

  canEdit() {
    return false;
  }

  getAriaDescriptor(shape) {
    return `Portfolio section: ${shape.props.kind}`;
  }
}

const SHAPE_UTILS = [PortfolioShapeUtil];

function ShapeContent({ kind, index }) {
  if (kind === "intro") {
    return (
      <article className="shape-content shape-intro">
        <p>Dylan McCavitt · New York City</p>
        <h1>Software engineer</h1>
        <strong>{PROFILE.focus}</strong>
        <span>{PROFILE.summary}</span>
      </article>
    );
  }
  if (kind === "bella") {
    return (
      <article className="shape-content shape-bella">
        <div className="shape-bella-copy">
          <p>Shipped client work · 2025</p>
          <h2>Bella&apos;s Beads</h2>
          <strong>From wireframe to handoff</strong>
          <span>
            A complete ecommerce platform for a handmade-jewelry business: browse,
            pay, ship, track, and operate.
          </span>
          <ul>
            <li>400+ commits</li>
            <li>Stripe · Shippo · Supabase · Resend</li>
            <li>Guest + account checkout</li>
          </ul>
        </div>
        <div className="shape-bella-images">
          <img src="/screenshots/bella/landing.webp" alt="Bella's Beads storefront" />
          <img src="/screenshots/bella/stripe.webp" alt="Bella's Beads checkout" />
          <img src="/screenshots/bella/admin-dash.webp" alt="Bella's Beads admin" />
        </div>
      </article>
    );
  }
  if (kind === "journey") {
    return (
      <article className="shape-content shape-journey">
        <p>Journey / résumé preview</p>
        <h2>Economics → legal ops → cyber risk → engineering</h2>
        <ol>
          {JOURNEY.map(([when, title, role]) => (
            <li key={`${when}-${title}`}>
              <span>{when}</span>
              <strong>{title}</strong>
              <small>{role}</small>
            </li>
          ))}
        </ol>
      </article>
    );
  }
  if (kind === "contact") {
    return (
      <article className="shape-content shape-contact">
        <p>Contact</p>
        <h2>Let&apos;s build something useful.</h2>
        <a href={`mailto:${PROFILE.email}`}>{PROFILE.email}</a>
        <span>New York City · U.S. citizen · No sponsorship required</span>
      </article>
    );
  }
  if (kind === "dm") {
    return (
      <article className="shape-content shape-dm">
        <p>Contextual guide</p>
        <h2>Ask DM</h2>
        <span>I&apos;m DM, Dylan McCavitt&apos;s portfolio guide.</span>
        <strong>DM is unavailable right now.</strong>
        <small>Browse grounded project evidence or contact Dylan directly.</small>
      </article>
    );
  }
  const project = PROJECTS[index] ?? PROJECTS[0];
  return (
    <article className="shape-content shape-project" style={{ "--shape-hue": project.hue }}>
      <p>
        {project.number} · {project.eyebrow}
      </p>
      <h2>{project.title}</h2>
      <strong>{project.line}</strong>
      <span>{project.summary}</span>
      {project.image ? <img src={project.image} alt={`${project.title} evidence`} /> : null}
      <ul>
        {project.proof.map((proof) => (
          <li key={proof}>{proof}</li>
        ))}
      </ul>
    </article>
  );
}

const LAYOUTS = {
  constellation: [
    ["intro", 760, 520, 700, 430, -80, -20],
    ["project", 520, 360, 0, 0, -800, -540],
    ["project", 520, 360, 1, 0, 520, -620],
    ["project", 520, 360, 2, 0, -860, 430],
    ["project", 520, 360, 3, 0, 600, 470],
    ["bella", 1120, 660, 0, 0, 1760, -100],
    ["journey", 980, 560, 0, 0, 2900, 700],
    ["contact", 620, 360, 0, 0, 3980, 420],
    ["dm", 540, 340, 0, 0, 4020, 940],
  ],
  archipelago: [
    ["intro", 980, 520, 0, 0, -1200, -520],
    ["project", 540, 380, 0, 0, -980, 300],
    ["project", 540, 380, 1, 0, -320, 520],
    ["project", 540, 380, 2, 0, 340, 360],
    ["project", 540, 380, 3, 0, 960, 600],
    ["bella", 1320, 760, 0, 0, 880, -600],
    ["journey", 1100, 620, 0, 0, 2540, -120],
    ["contact", 660, 380, 0, 0, 3880, -400],
    ["dm", 620, 380, 0, 0, 3820, 220],
  ],
  ribbon: [
    ["intro", 900, 500, 0, 0, -1000, -180],
    ["project", 520, 360, 0, 0, 80, -120],
    ["project", 520, 360, 1, 0, 720, 120],
    ["project", 520, 360, 2, 0, 1360, -100],
    ["project", 520, 360, 3, 0, 2000, 120],
    ["bella", 1260, 720, 0, 0, 2700, -280],
    ["journey", 1120, 620, 0, 0, 4140, -80],
    ["contact", 660, 380, 0, 0, 5460, -220],
    ["dm", 620, 380, 0, 0, 5460, 280],
  ],
};

function createPortfolioShapes(variant) {
  return LAYOUTS[variant].map(([kind, w, h, index, _unused, x, y], position) => ({
    id: createShapeId(`${variant}-${kind}-${position}`),
    type: "portfolio",
    x,
    y,
    isLocked: true,
    props: { w, h, kind, variant, index },
  }));
}

function AccessibleSpatialSummary() {
  return (
    <aside className="spatial-accessible-summary">
      <h2>Portfolio contents</h2>
      <p>{PROFILE.summary}</p>
      <ul>
        {PROJECTS.map((project) => (
          <li key={project.id}>
            <strong>{project.title}</strong>: {project.line}
          </li>
        ))}
      </ul>
      <p>Journey: economics, legal operations, cyber risk, and engineering.</p>
      <a href={`mailto:${PROFILE.email}`}>Contact Dylan</a>
    </aside>
  );
}

function SpatialControls({ editor, variant, onAskDM }) {
  const focus = useCallback(
    (kind, index = 0) => {
      if (!editor) return;
      const shapes = editor
        .getCurrentPageShapes()
        .filter(
          (shape) =>
            shape.type === "portfolio" &&
            shape.props.kind === kind &&
            (kind !== "project" || shape.props.index === index),
        );
      if (!shapes.length) return;
      const bounds = editor.getShapePageBounds(shapes[0]);
      if (!bounds) return;
      editor.zoomToBounds(bounds, {
        inset: window.innerWidth < 700 ? 28 : 90,
        animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? undefined
          : { duration: 420 },
      });
    },
    [editor],
  );

  return (
    <nav className={`spatial-controls spatial-controls--${variant}`} aria-label="Portfolio destinations">
      <button type="button" onClick={() => focus("intro")}>
        Dylan
      </button>
      {PROJECTS.map((project, index) => (
        <button key={project.id} type="button" onClick={() => focus("project", index)}>
          {project.title}
        </button>
      ))}
      <button type="button" onClick={() => focus("bella")}>
        Bella&apos;s Beads focus
      </button>
      <button type="button" onClick={() => focus("journey")}>
        Journey
      </button>
      <a href={`mailto:${PROFILE.email}`}>Contact</a>
      <button type="button" onClick={onAskDM}>
        Ask DM
      </button>
    </nav>
  );
}

function InfiniteCanvas({ variant, title }) {
  const [editor, setEditor] = useState(null);
  const { openDM, panel } = useDM();
  const shapes = useMemo(() => createPortfolioShapes(variant), [variant]);

  const onMount = useCallback(
    (nextEditor) => {
      nextEditor.createShapes(shapes);
      nextEditor.updateInstanceState({ isReadonly: true });
      nextEditor.setCameraOptions({
        isLocked: false,
        panSpeed: 1,
        zoomSpeed: 1,
      });
      requestAnimationFrame(() => {
        nextEditor.zoomToFit({
          inset: window.innerWidth < 700 ? 22 : 120,
          animation: { duration: 0 },
        });
      });
      setEditor(nextEditor);
    },
    [shapes],
  );

  return (
    <div className={`prototype-route spatial-route spatial-route--${variant}`}>
      <LabHeader family="Infinite canvas" title={title} siblingRoutes={ROUTES} />
      <p className="spatial-hint">Drag to explore · wheel or pinch to zoom · use destinations to reorient</p>
      <SpatialControls editor={editor} variant={variant} onAskDM={openDM} />
      <AccessibleSpatialSummary />
      <div className="tldraw-stage" data-testid={`canvas-${variant}`}>
        <Tldraw
          hideUi
          shapeUtils={SHAPE_UTILS}
          onMount={onMount}
          colorScheme="dark"
          options={{ maxPages: 1 }}
        />
      </div>
      {panel}
    </div>
  );
}

export function ProjectConstellation() {
  return <InfiniteCanvas variant="constellation" title="Project Constellation" />;
}

export function EditorialArchipelago() {
  return <InfiniteCanvas variant="archipelago" title="Editorial Archipelago" />;
}

export function CareerRibbon() {
  return <InfiniteCanvas variant="ribbon" title="Career Ribbon" />;
}
