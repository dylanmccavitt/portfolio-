import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, X } from "lucide-react";
import { Clouds } from "../components/canvasui/Clouds.tsx";
import { Droplets } from "../components/canvasui/Droplets.tsx";
import { Frost } from "../components/canvasui/Frost.tsx";
import { Glass } from "../components/canvasui/Glass.jsx";
import { ParticleScroll } from "../components/canvasui/ParticleScroll.tsx";
import { Ripple } from "../components/canvasui/Ripple.tsx";
import { Shatter } from "../components/canvasui/Shatter.jsx";
import { JOURNEY, PROFILE, PROJECTS } from "./frost-data.js";
import "./frost.css";
import "./lab.css";

/**
 * The lab's single base layout: the CURRENT Frost site (per the live
 * preview branch + PR #347 — anchor Work rows, ProjectFocus modal, no
 * ellipses, name-first hero). Every prototype mounts a different canvas
 * effect or interaction over this exact layout; the layout itself is not
 * a variable.
 */

export const EFFECTS = [
  {
    slug: "fracture",
    number: "01",
    name: "Fracture",
    instruction: "The page rests whole. Moving the cursor shatters the glaze nearby; the shards settle back when you leave.",
    component: "Shatter",
  },
  {
    slug: "thaw",
    number: "02",
    name: "Thaw",
    instruction: "Real frost instead of cracked glaze: attention melts it clear, neglect lets it ice back over.",
    component: "Frost (canvasui)",
  },
  {
    slug: "pond",
    number: "03",
    name: "Pond",
    flagOnly: true,
    instruction: "Perfectly legible at rest. Every click sends rings across the surface that bend the type as they pass.",
    component: "Ripple (canvasui)",
  },
  {
    slug: "mist",
    number: "04",
    name: "Mist",
    instruction: "Cold morning fog over the page; your movement is the wind that thins it.",
    component: "Clouds (canvasui)",
  },
  {
    slug: "rain",
    number: "05",
    name: "Rain",
    instruction: "Condensation runs down the pane while the type stays readable; the cursor sweeps drops aside.",
    component: "Droplets (canvasui)",
  },
  {
    slug: "glaze",
    number: "06",
    name: "Glaze",
    instruction: "The current production effect: crazed everywhere from the start; where you polish, it clears for good.",
    component: "Shatter (inverted)",
  },
];

export const POPOUTS = [
  {
    slug: "plain",
    number: "01",
    name: "Plain",
    instruction: "Baseline — the ProjectFocus popout exactly as it ships in PR #347. A project opens on load; close it, then click any row.",
    component: "No effect",
  },
  {
    slug: "break-open",
    number: "02",
    name: "Break open",
    instruction: "Click a row: the glaze cracks at that exact spot and the project bursts out of the break.",
    component: "Shatter burst + entrance",
  },
  {
    slug: "expand-row",
    number: "03",
    name: "Expand row",
    instruction: "No popout at all — the row itself unfolds in place with the summary, proof, and links.",
    component: "Inline accordion",
  },
  {
    slug: "side-panel",
    number: "04",
    name: "Side panel",
    instruction: "The project slides in as a reading panel from the right, frost-doc style; the page stays where you left it.",
    component: "Drawer",
  },
  {
    slug: "freeze-world",
    number: "05",
    name: "Freeze world",
    instruction: "Opening a project freezes the page behind it; closing thaws the site back to the fracture surface.",
    component: "Frost (canvasui) on the page",
  },
  {
    slug: "reveal",
    number: "06",
    name: "Fracture reveal",
    instruction: "Hover a row: the glaze cracks and the project's details surface softly beneath it. Click: the page fractures straight into the project overview — no card at all.",
    component: "Fracture hover + direct page entry",
  },
  {
    slug: "cards",
    number: "07",
    name: "Card reveal",
    instruction: "Work as a grid of cards. Hover a card: the glaze fractures over it — and only it — while the shipped facts surface beneath. Click: fall through the break into the project.",
    component: "Card grid + fracture pinned to the card",
  },
  {
    slug: "thaw-cards",
    number: "08",
    name: "Thaw reveal",
    instruction: "Each card is a pane of real ice with the teaser printed on it. Hovering melts the pane clear — the facts were frozen underneath all along. Click falls through into the project.",
    component: "Card grid + Frost (canvasui) per card",
  },
  {
    slug: "mist-cards",
    number: "09",
    name: "Mist reveal",
    instruction: "Each card rests under its own patch of fog — the page itself is bare so the mist is the only weather. Hovering lifts the fog and the facts condense out; click enters the project.",
    component: "Card grid + Clouds (canvasui) per card, no page effect",
  },
];

/** Popouts where Work renders as a card grid instead of rows. */
const CARD_POPOUTS = ["cards", "thaw-cards", "mist-cards"];

export const PLAYS = [
  {
    slug: "affordance",
    number: "01",
    name: "Affordance cracks",
    instruction: "The glaze only cracks over things you can click — rows, nav, buttons. Fracture is the affordance, not decoration.",
    component: "Shatter, gated by hover target",
  },
  {
    slug: "break-ice",
    number: "02",
    name: "Break the ice",
    instruction: "The email address is sealed under a pane of ice. Rub it clear to say hello — it never freezes back.",
    component: "Frost (canvasui) seal",
  },
  {
    slug: "fault-line",
    number: "03",
    name: "Fault line",
    instruction: "Click a nav item: a fault line tears down the page toward the section while you travel to it.",
    component: "Shatter, scripted pointer path",
  },
  {
    slug: "press",
    number: "04",
    name: "Press",
    instruction: "Press and hold anywhere: the glaze strains wider under the pressure. Let go and it settles.",
    component: "Shatter, charge on hold",
  },
  {
    slug: "scratch",
    number: "05",
    name: "Scratch the receipts",
    instruction: "Every project hides its proof under a strip of ice. Scratch a row's strip to check the receipts.",
    component: "Frost (canvasui) per row",
  },
];

/** Non-fracture explorations: the UI reacting to (and through) other
    html-in-canvas effects. Each play pairs one effect with one UI signal. */
export const FX = [
  {
    slug: "echo",
    number: "01",
    name: "Echo",
    surface: "pond",
    flagOnly: true,
    instruction: "Every click rings outward from where it happened — rows, nav, closing a card. The pond answers your actions.",
    component: "Ripple (canvasui)",
  },
  {
    slug: "clearing",
    number: "02",
    name: "Clearing",
    surface: "mist",
    instruction: "Fog rests on the page. Click a nav item: wind parts the mist over where you're headed as you travel.",
    component: "Clouds (canvasui) + scripted wind",
  },
  {
    slug: "condensation",
    number: "03",
    name: "Condensation",
    surface: "rain",
    instruction: "Stay idle and the pane fogs up with rain; move again and the weather calms. The page notices neglect.",
    component: "Droplets (canvasui), idle-driven",
  },
  {
    slug: "loupe",
    number: "04",
    name: "Loupe",
    surface: "glass",
    instruction: "A reading lens follows the cursor and snaps onto project titles and the email, magnifying what matters.",
    flagOnly: true,
    component: "Glass (canvasui) with targets",
  },
  {
    slug: "settle",
    number: "05",
    name: "Settle",
    surface: "particle-scroll",
    instruction: "Below the fold the page is loose sand; scrolling settles it into crisp UI as you arrive.",
    flagOnly: true,
    component: "Particle Scroll (canvasui)",
  },
];

/** Crack burst at a viewport point: feed jittered pointer moves to the page
    effect so the glaze visibly breaks (or the fog gusts) where the visitor
    clicked. Shatter/Frost listen on the wrapper; Clouds listens on the
    content div inside it — dispatch to both, non-bubbling, so each engine
    hears it exactly once. */
function burstFracture(x, y) {
  const host = document.querySelector(".frost-effect");
  if (!host) return;
  const content = host.querySelector(":scope > div");
  let step = 0;
  const timer = setInterval(() => {
    const angle = (step / 11) * Math.PI * 2;
    const spread = 14 + step * 7;
    const move = new PointerEvent("pointermove", {
      clientX: x + Math.cos(angle * 2.7) * spread,
      clientY: y + Math.sin(angle * 1.9) * spread * 0.6,
      bubbles: false,
    });
    host.dispatchEvent(move);
    content?.dispatchEvent(move);
    if (++step > 11) clearInterval(timer);
  }, 26);
}

/** Contain the page fracture to the hovered card: swallow raw pointer moves
    before they bubble to the page Shatter, and re-dispatch them clamped
    well inside the hovered card so the crack opens in the card and nowhere
    else — never in the grid gaps, never spilling onto a neighbor. */
function containFracture(node) {
  if (!node || node.dataset.contained) return;
  node.dataset.contained = "1";
  node.addEventListener("pointermove", (event) => {
    event.stopPropagation();
    const host = document.querySelector(".frost-effect");
    if (!host) return;
    const card = event.target?.closest?.(".frost-cards > li");
    if (!card) {
      host.dispatchEvent(new PointerEvent("pointerleave", { bubbles: false }));
      return;
    }
    const r = card.getBoundingClientRect();
    const mx = r.width * 0.18;
    const my = r.height * 0.24;
    host.dispatchEvent(new PointerEvent("pointermove", {
      clientX: Math.min(Math.max(event.clientX, r.left + mx), r.right - mx),
      clientY: Math.min(Math.max(event.clientY, r.top + my), r.bottom - my),
      bubbles: false,
    }));
  });
}

/** Popout card designs: what the ProjectFocus card IS, independent of how
    it enters. All ride the fracture surface with a plain backdrop. */
export const CARDS = [
  {
    slug: "dossier",
    number: "01",
    name: "Dossier",
    instruction: "A denser reading card: what shipped, the evidence, the screens, and the way in — the project page in miniature.",
    component: "Card layout",
  },
  {
    slug: "split",
    number: "02",
    name: "Split",
    instruction: "An editorial spread: the words on the left, one big screen on the right.",
    component: "Card layout",
  },
  {
    slug: "filmstrip",
    number: "03",
    name: "Filmstrip",
    instruction: "Screens first: a scrollable strip up top, the words underneath.",
    component: "Card layout",
  },
  {
    slug: "ticket",
    number: "04",
    name: "Ticket",
    instruction: "A deliberate teaser: title, one line, three chips, one way in. The project page does the talking.",
    component: "Card layout",
  },
];

/** Expanding into the project page: what happens when the visitor wants
    more than the card. Each route opens the card with an "Open project"
    action; the transition into the page is the variable. */
export const ENTERS = [
  {
    slug: "grow",
    number: "01",
    name: "Grow",
    instruction: "Open project: the card itself grows until it IS the page — no context switch, the card was the page all along.",
    component: "FLIP-style expansion",
  },
  {
    slug: "settle-in",
    number: "02",
    name: "Settle in",
    flagOnly: true,
    instruction: "Open project: the page assembles from loose sand as you land — the settle surface, given a job.",
    component: "Particle Scroll entry",
  },
  {
    slug: "hero-sheet",
    number: "03",
    name: "Hero sheet",
    instruction: "Open project: the title docks as the page hero and the sections slide in beneath it.",
    component: "Staggered entrance",
  },
];

/** Everything that has been approved or leads its category, combined into
    one walkable journey. */
export const FLOW = [
  {
    slug: "flow",
    number: "01",
    name: "One flow",
    instruction: "Cracks mark what you can click; a row breaks open into the dossier card; the card grows into the page; contact means breaking the ice.",
    component: "fracture + affordance + break-open + dossier + grow + break-ice",
  },
  {
    slug: "mist-flow",
    number: "02",
    name: "Mist flow",
    instruction: "No glass at all — the site rests under fog. Wind parts the mist over where you're headed, cards clear to their facts on hover, a gust opens the project, and contact still means breaking the ice.",
    component: "Clouds surface + wind nav + mist cards + Frost seal — no Shatter",
  },
  {
    slug: "settle-flow",
    number: "03",
    name: "Settle flow",
    flagOnly: true,
    instruction: "The page below the fold is loose sand that settles as you scroll into it; hovering a card settles its facts into place; opening a project, the whole page settles in around you.",
    component: "ParticleScroll surface + settle-in entry + micro-settle reveal",
  },
];

/** The mist-reveal weather: dense enough that the fog itself is a presence
    on the page, not a rumor — the reveal reads as wind doing real work. */
const MIST_REVEAL_OVERRIDES = {
  cover: 0.46,
  opacity: 0.88,
  density: 3,
  shading: 0.12,
  wind: 1,
  windRadius: 340,
  speed: 0.26,
};

function EffectShell({ slug, overrides, children }) {
  // Bare page: no canvas at all — used when a variant should be judged on
  // its own local effect without the page surface competing.
  if (slug === "none") {
    return <div className="frost-effect frost-effect--none">{children}</div>;
  }

  if (slug === "freeze") {
    return (
      <Frost
        className="frost-effect frost-effect--canvasui"
        frost={0.45}
        opacity={0.68}
        meltStrength={0}
        introDuration={1}
        haze={0.62}
        detail={2}
        tintStrength={0.4}
      >
        {children}
      </Frost>
    );
  }

  if (slug === "glaze") {
    return (
      <Shatter
        className="frost-effect"
        snapshot
        invert
        persist
        regrow={0}
        radius={0.3}
        softness={0.75}
        tileSize={44}
        shards={0.9}
        corner={4}
        lift={10}
        tilt={0.8}
        scatter={3}
        perspective={1700}
        gapColor={[0.78, 0.87, 0.93]}
        shadow={0.2}
        shading={0.34}
        refraction={0.9}
        dispersion={0.12}
        floatSpeed={0.25}
        strength={0.9}
        baseStrength={0.5}
        followSpeed={4.5}
      >
        {children}
      </Shatter>
    );
  }

  if (slug === "thaw") {
    return (
      <Frost
        className="frost-effect frost-effect--canvasui"
        frost={0.08}
        opacity={0.58}
        meltRadius={0.26}
        meltStrength={0.85}
        refreeze={5}
        haze={0.6}
        detail={2}
        textureScale={2}
        tintStrength={0.38}
      >
        {children}
      </Frost>
    );
  }

  if (slug === "pond") {
    return (
      <Ripple
        className="frost-effect frost-effect--canvasui"
        trigger="click"
        amplitude={0.55}
        wavelength={90}
        rings={2}
        decay={0.9}
        refraction={110}
        dispersion={0.5}
        shine={0.45}
        interval={7}
      >
        {children}
      </Ripple>
    );
  }

  if (slug === "mist") {
    return (
      <Clouds
        className="frost-effect frost-effect--canvasui"
        color={[0.93, 0.96, 0.98]}
        opacity={0.55}
        cover={0.07}
        density={1.7}
        shading={0.05}
        wind={0.85}
        windRadius={430}
        speed={0.45}
        shadow={0.015}
        shadowOffsetX={120}
        {...overrides}
      >
        {children}
      </Clouds>
    );
  }

  if (slug === "rain") {
    return (
      <Droplets
        className="frost-effect frost-effect--canvasui"
        intensity={0.4}
        scale={0.48}
        refraction={0.3}
        staticDrops={0.22}
        interactive
        interactionRadius={0.3}
        interactionStrength={0.65}
        tint={[0.8, 0.89, 0.98]}
        tintStrength={0.85}
        {...overrides}
      >
        {children}
      </Droplets>
    );
  }

  if (slug === "glass") {
    return (
      <Glass
        className="frost-effect frost-effect--canvasui"
        size={150}
        zoom={1.35}
        follow={0.25}
        targets="[data-glass-target]"
      >
        {children}
      </Glass>
    );
  }

  if (slug === "particle-scroll") {
    return (
      <ParticleScroll
        className="frost-effect frost-effect--canvasui"
        point={0.66}
        band={380}
        spread={200}
        swirl={70}
      >
        {children}
      </ParticleScroll>
    );
  }

  // fracture (default surface)
  return (
    <Shatter
      className="frost-effect"
      snapshot
      radius={0.2}
      softness={0.66}
      tileSize={48}
      shards={0.85}
      corner={5}
      lift={15}
      tilt={1.0}
      scatter={4}
      perspective={1700}
      gapColor={[0.72, 0.82, 0.9]}
      shadow={0.22}
      shading={0.32}
      refraction={0.7}
      dispersion={0.08}
      floatSpeed={0.5}
      strength={0.86}
      baseStrength={0}
      followSpeed={5}
      {...overrides}
    >
      {children}
    </Shatter>
  );
}

const DESTINATIONS = [
  { id: "about", label: "About" },
  { id: "work", label: "Work" },
  { id: "journey", label: "Journey" },
  { id: "contact", label: "Contact" },
];

function buildWorkList() {
  return PROJECTS.map((curated) => ({
    id: curated.id,
    href: `/projects/${curated.id}`,
    title: curated.title,
    eyebrow: curated.eyebrow,
    line: curated.line,
    summary: curated.summary,
    proof: curated.proof ?? [],
    links: [],
    shots: curated.shots ?? [],
  }));
}

function ProjectDetailBody({ project }) {
  return (
    <>
      <p>{project.summary}</p>
      {project.proof.length > 0 && (
        <div className="frost-proof">
          {project.proof.map((proof) => <span key={proof}>{proof}</span>)}
        </div>
      )}
    </>
  );
}

/** The in-lab stand-in for the /projects/[id] frost-doc page, so page-entry
    transitions have a real destination. */
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

function WorkRows({ projects, onOpen, expandedId, scratch, reveal, hoveredId, onHover, revealCharge = 0 }) {
  return (
    <ol className="frost-work">
      {projects.map((project, index) => (
        <li
          key={project.id}
          onMouseEnter={reveal ? () => onHover(project.id) : undefined}
          onMouseLeave={reveal ? () => onHover(null) : undefined}
        >
          <a
            href={project.href}
            onClick={(event) => {
              event.preventDefault();
              onOpen(project, event);
            }}
          >
            <span className="frost-num">{String(index + 1).padStart(2, "0")}</span>
            <div>
              <strong data-glass-target>{project.title}</strong>
              <span>{project.line}</span>
            </div>
            <small>
              {project.eyebrow} <ArrowUpRight size={13} />
            </small>
          </a>
          {scratch && project.proof.length > 0 && <ScratchStrip project={project} />}
          {reveal && hoveredId === project.id && (
            <div
              className="frost-reveal"
              aria-hidden="true"
              style={{ opacity: revealCharge }}
            >
              <p>{project.summary}</p>
              {project.proof.length > 0 && (
                <div className="frost-proof">
                  {project.proof.map((proof) => <span key={proof}>{proof}</span>)}
                </div>
              )}
            </div>
          )}
          {expandedId === project.id && (
            <div className="frost-row-detail">
              <ProjectDetailBody project={project} />
              <nav className="frost-doc-actions" aria-label={`${project.title} links`}>
                <a className="is-quiet" href={project.href} onClick={(e) => e.preventDefault()}>
                  Project page <ArrowUpRight size={14} />
                </a>
              </nav>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

/** Thaw-reveal card: the shipped facts live under a pane of real ice
    (inline canvasui Frost, fallback-safe in stock Chrome); the teaser is
    printed on the ice and fades as hover melts the pane clear. The facts
    are snapshot-clone-hidden so the page glaze's shards never show them. */
function ThawCard({ project, index, onOpen }) {
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
    <li className="frost-thaw-cell">
      <SealedReveal
        className="frost-thaw-card"
        frostProps={{ frost: 0.55, opacity: 0.94, meltRadius: 0.34, introDuration: 0.9, refreeze: 4, haze: 0.72, tintStrength: 0.36 }}
      >
        {facts}
      </SealedReveal>
      <div className="frost-thaw-teaser" aria-hidden="true">
        <span className="frost-num">{String(index + 1).padStart(2, "0")}</span>
        <p className="frost-kicker">{project.eyebrow}</p>
        <strong>{project.title}</strong>
      </div>
    </li>
  );
}

/** Per-card fog: the facts live in the card, a patch of Clouds rests over
    them, and the teaser is printed above the weather. Hovering wipes the
    fog aside (Clouds listens on its own content div) while the facts
    condense in via pure CSS — no React state changes on hover at all, so
    the reveal costs zero re-renders. The page surface stays glass. */
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
    <li className="frost-mist-cell" ref={sealStopRef}>
      <div className="popout-thaw">
        <div className="popout-thaw-sizer" aria-hidden="true">{facts}</div>
        <Clouds
          className="popout-thaw-effect"
          style={{ position: "absolute", inset: 0 }}
          color={[0.93, 0.95, 0.96]}
          opacity={0.72}
          cover={0.48}
          density={2.6}
          shading={0.05}
          wind={1}
          windRadius={240}
          speed={0.25}
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

/** Card-reveal grid: each project is a card whose surface carries the
    teaser; the shipped facts sit absolutely beneath it, hidden from the
    snapshot clone (same trick as .frost-reveal) so the shard layer lifts
    only the card surface and the facts read as under the glaze.
    variant: "fracture" pins the page crack inside the hovered card;
    "thaw"/"mist" swap in per-card ice panes / fog patches. */
function WorkCards({ projects, onOpen, hoveredId, onHover, revealCharge, variant }) {
  if (variant === "thaw" || variant === "mist") {
    const Card = variant === "thaw" ? ThawCard : MistCard;
    return (
      <ol className={`frost-cards frost-cards--${variant}`}>
        {projects.map((project, index) => (
          <Card key={project.id} project={project} index={index} onOpen={onOpen} />
        ))}
      </ol>
    );
  }

  return (
    <ol
      className={`frost-cards frost-cards--${variant}`}
      ref={variant === "fracture" ? containFracture : undefined}
    >
      {projects.map((project, index) => (
        <li
          key={project.id}
          data-project={project.id}
          className={hoveredId === project.id ? "is-hot" : undefined}
          onMouseEnter={() => onHover(project.id)}
          onMouseLeave={() => onHover(null)}
        >
          <a
            href={project.href}
            onClick={(event) => {
              event.preventDefault();
              onOpen(project, event);
            }}
          >
            <span className="frost-num">{String(index + 1).padStart(2, "0")}</span>
            <p className="frost-kicker">{project.eyebrow}</p>
            <strong data-glass-target>{project.title}</strong>
          </a>
          {hoveredId === project.id && (
            <div
              className={`frost-card-under${variant === "settle" ? " frost-card-under--settle" : ""}`}
              aria-hidden="true"
              style={{ opacity: revealCharge }}
            >
              <p>{project.summary}</p>
              {project.proof.length > 0 && (
                <div className="frost-proof">
                  {project.proof.slice(0, 3).map((proof) => <span key={proof}>{proof}</span>)}
                </div>
              )}
              <span className="frost-card-open">Open project <ArrowUpRight size={12} /></span>
            </div>
          )}
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
      <a href={`mailto:${PROFILE.email}`} data-glass-target>
        {PROFILE.email} <ArrowUpRight size={24} strokeWidth={1.6} />
      </a>
      <p>{PROFILE.status} · replies within a day.</p>
    </div>
  );
}

/** Native pointermove stopper for inline seals: rubs must not reach the
    page Shatter's ancestor listener (a React handler runs too late).
    Module scope so it isn't rebuilt per render, and the stable listener
    reference makes repeat addEventListener calls no-ops. */
const stopSealMove = (event) => event.stopPropagation();
function sealStopRef(node) {
  node?.addEventListener("pointermove", stopSealMove);
}

/** Inline ice seal over arbitrary content, built on the inline-safe
    canvasui Frost (the Shatter engine only supports full-page mounting).
    A hidden copy sizes the box, the pane overlays it exactly. */
function SealedReveal({ className, frostProps, children }) {
  return (
    <div ref={sealStopRef} className={className}>
      <div className="popout-thaw">
        <div className="popout-thaw-sizer" aria-hidden="true">{children}</div>
        <Frost
          className="popout-thaw-effect"
          style={{ position: "absolute", inset: 0 }}
          meltStrength={1}
          refreeze={0}
          detail={2.4}
          {...frostProps}
        >
          {children}
        </Frost>
      </div>
    </div>
  );
}

/** Break-the-ice: making contact starts by literally breaking the ice. */
function SealedContact() {
  return (
    <SealedReveal
      className="frost-seal-stop"
      frostProps={{ frost: 0.6, opacity: 0.92, meltRadius: 0.28, introDuration: 1.2, haze: 0.7, tintStrength: 0.4 }}
    >
      <div className="frost-seal-body">
        <ContactBlock />
      </div>
    </SealedReveal>
  );
}

/** Scratch-the-receipts: a row's proof chips sit under their own strip of
    ice; the evidence is there, you just have to scratch for it. */
function ScratchStrip({ project }) {
  return (
    <SealedReveal
      className="frost-scratch"
      frostProps={{ frost: 0.55, opacity: 0.9, meltRadius: 0.32, introDuration: 0.9, haze: 0.6, tintStrength: 0.36 }}
    >
      <div className="frost-scratch-body">
        {project.proof.map((proof) => <span key={proof}>{proof}</span>)}
      </div>
    </SealedReveal>
  );
}

/** Scripted pointer path from the header toward a section while the smooth
    scroll runs. On the fracture surface the glaze tears along the way; on
    the mist surface the wind parts the fog over the destination. */
function tearToward(section) {
  const host = document.querySelector(".frost-effect");
  if (!host) return;
  // Shatter listens on the wrapper; Clouds on the content div inside it.
  const content = host.querySelector(":scope > div");
  const head = document.querySelector(".frost-site-head");
  const startY = head ? head.getBoundingClientRect().bottom + 10 : 70;
  const startX = window.innerWidth * 0.5;
  const started = performance.now();
  const duration = 850;
  const step = (now) => {
    const t = Math.min((now - started) / duration, 1);
    const rect = section.getBoundingClientRect();
    const targetY = Math.min(Math.max(rect.top + 60, 90), window.innerHeight - 80);
    const x = startX + Math.sin(t * Math.PI * 3.2) * 70 * (1 - t * 0.4);
    const y = startY + (targetY - startY) * t;
    const move = new PointerEvent("pointermove", { clientX: x, clientY: y });
    host.dispatchEvent(move);
    content?.dispatchEvent(move);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function SiteLayout({ workList, onOpenProject, onDm, expandedId, contactVariant, play, reveal, cardVariant, hoveredId, onHover, revealCharge }) {
  const [current, setCurrent] = useState("about");

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
  }, []);

  const go = (id) => {
    const section = document.getElementById(id);
    if (!section) return;
    if (play === "fault-line" || play === "clearing") tearToward(section);
    section.scrollIntoView({ behavior: "smooth", block: "start" });
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
          <button className="frost-dm-button" onClick={onDm}>Ask DM</button>
        </div>
      </header>

      <section className="frost-site-section frost-site-hero" id="about">
        <p className="frost-kicker">Software engineer · New York City · {PROFILE.status.toLowerCase()}</p>
        <div className="frost-about">
          <p>{PROFILE.summary}</p>
          <p>
            I build backend systems, product software, and practical AI tools. I
            care about visible state, inspectable decisions, and products that make
            complicated work feel ordinary.
          </p>
        </div>
      </section>

      <section className="frost-site-section" id="work">
        <h2>Work</h2>
        <p className="frost-kicker">{workList.length} projects · shipped and building</p>
        {cardVariant ? (
          <WorkCards
            projects={workList}
            onOpen={onOpenProject}
            hoveredId={hoveredId}
            onHover={onHover}
            revealCharge={revealCharge}
            variant={cardVariant}
          />
        ) : (
          <WorkRows
            projects={workList}
            onOpen={onOpenProject}
            expandedId={expandedId}
            scratch={play === "scratch"}
            reveal={reveal}
            hoveredId={hoveredId}
            onHover={onHover}
            revealCharge={revealCharge}
          />
        )}
      </section>

      <section className="frost-site-section" id="journey">
        <h2>Journey</h2>
        <p className="frost-kicker">2019 — now</p>
        <JourneyRows />
      </section>

      <section className="frost-site-section" id="contact">
        <h2>Contact</h2>
        <p className="frost-kicker">
          {contactVariant === "sealed" ? "Break the ice to say hello" : "Say hello"}
        </p>
        {contactVariant === "sealed" ? <SealedContact /> : <ContactBlock />}
      </section>
    </div>
  );
}

function CardContent({ project, cardStyle, onOpenPage }) {
  const actions = (
    <nav className="frost-doc-actions" aria-label={`${project.title} actions`}>
      <a
        className="is-fill"
        href={project.href}
        onClick={(event) => {
          event.preventDefault();
          onOpenPage?.(event);
        }}
      >
        Open project <ArrowUpRight size={14} />
      </a>
    </nav>
  );

  if (cardStyle === "ticket") {
    return (
      <>
        <p className="frost-kicker">{project.eyebrow}</p>
        <h2 id="frost-focus-title">{project.title}</h2>
        <p>{project.line}</p>
        <div className="frost-proof">
          {project.proof.slice(0, 3).map((proof) => <span key={proof}>{proof}</span>)}
        </div>
        {actions}
      </>
    );
  }

  if (cardStyle === "split") {
    return (
      <div className="lab-card-split">
        <div>
          <p className="frost-kicker">{project.eyebrow}</p>
          <h2 id="frost-focus-title">{project.title}</h2>
          <ProjectDetailBody project={project} />
          {actions}
        </div>
        {project.shots[0] && (
          <figure className="lab-card-side">
            <img src={project.shots[0].src} alt={project.shots[0].caption} />
            <figcaption>{project.shots[0].caption}</figcaption>
          </figure>
        )}
      </div>
    );
  }

  if (cardStyle === "filmstrip") {
    return (
      <>
        {project.shots.length > 0 && (
          <div className="lab-card-strip">
            {project.shots.map((shot) => (
              <img key={shot.src} src={shot.src} alt={shot.caption} />
            ))}
          </div>
        )}
        <p className="frost-kicker">{project.eyebrow}</p>
        <h2 id="frost-focus-title">{project.title}</h2>
        <ProjectDetailBody project={project} />
        {actions}
      </>
    );
  }

  if (cardStyle === "dossier") {
    return (
      <>
        <p className="frost-kicker">{project.eyebrow}</p>
        <h2 id="frost-focus-title">{project.title}</h2>
        <p>{project.line}</p>
        <h3 className="lab-card-h">What shipped</h3>
        <p>{project.summary}</p>
        <h3 className="lab-card-h">Evidence</h3>
        <div className="frost-proof">
          {project.proof.map((proof) => <span key={proof}>{proof}</span>)}
        </div>
        {project.shots.length > 0 && (
          <>
            <h3 className="lab-card-h">Screens</h3>
            <div className="frost-gallery frost-gallery--thumbs">
              {project.shots.map((shot) => (
                <figure key={shot.src}>
                  <img src={shot.src} alt={shot.caption} loading="lazy" />
                  <figcaption>{shot.caption}</figcaption>
                </figure>
              ))}
            </div>
          </>
        )}
        {actions}
      </>
    );
  }

  // classic — the PR #347 card, plus the way in when a page exists.
  return (
    <>
      <p className="frost-kicker">{project.eyebrow}</p>
      <h2 id="frost-focus-title">{project.title}</h2>
      <ProjectDetailBody project={project} />
      {onOpenPage && actions}
    </>
  );
}

function ProjectFocus({ project, onClose, variant = "plain", origin, cardStyle = "classic", onOpenPage }) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  if (variant === "side-panel") {
    return (
      <div className="frost-backdrop is-clear" onMouseDown={onClose}>
        <aside
          className="frost-drawer"
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
          <ProjectDetailBody project={project} />
          <nav className="frost-doc-actions" aria-label={`${project.title} links`}>
            <a className="is-quiet" href={project.href} onClick={(e) => e.preventDefault()}>
              Project page <ArrowUpRight size={14} />
            </a>
          </nav>
        </aside>
      </div>
    );
  }

  const widthClass = cardStyle === "split" || cardStyle === "filmstrip"
    ? " is-wide"
    : cardStyle === "ticket"
      ? " is-slim"
      : "";

  const card = (
    <article
      className={`frost-modal${widthClass}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="frost-focus-title"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <button className="frost-close" onClick={onClose} aria-label={`Close ${project.title}`}>
        <X size={19} />
      </button>
      <CardContent project={project} cardStyle={cardStyle} onOpenPage={onOpenPage} />
    </article>
  );

  if (variant === "break-open") {
    return (
      <div className="frost-backdrop is-clear" onMouseDown={onClose}>
        <div
          className="frost-burst-layer"
          style={origin ? { transformOrigin: `${origin[0]}px ${origin[1]}px` } : undefined}
        >
          {card}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`frost-backdrop${variant === "freeze-world" ? " is-frozen" : ""}`}
      onMouseDown={onClose}
    >
      {card}
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
        <p>The live chat runs on the real site; this lab keeps the panel as a placeholder.</p>
        <a href={`mailto:${PROFILE.email}`}>
          Contact Dylan directly <ArrowUpRight size={16} />
        </a>
      </section>
    </div>
  );
}

export function CurrentFrost({ effect, popout, play, fx, card, enter, flow, navigate }) {
  const popoutMeta = popout ? POPOUTS.find((entry) => entry.slug === popout) ?? POPOUTS[0] : null;
  const playMeta = play ? PLAYS.find((entry) => entry.slug === play) ?? PLAYS[0] : null;
  const fxMeta = fx ? FX.find((entry) => entry.slug === fx) ?? FX[0] : null;
  const cardMeta = card ? CARDS.find((entry) => entry.slug === card) ?? CARDS[0] : null;
  const enterMeta = enter ? ENTERS.find((entry) => entry.slug === enter) ?? ENTERS[0] : null;
  const flowMeta = flow ? FLOW.find((entry) => entry.slug === flow) ?? FLOW[0] : null;
  const mistFlow = flowMeta?.slug === "mist-flow";
  const settleFlow = flowMeta?.slug === "settle-flow";
  const meta = popoutMeta ?? playMeta ?? fxMeta ?? cardMeta ?? enterMeta ?? flowMeta
    ?? (EFFECTS.find((entry) => entry.slug === effect) ?? EFFECTS[0]);
  const [focusedProject, setFocusedProject] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [burstOrigin, setBurstOrigin] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [revealCharge, setRevealCharge] = useState(0);
  const hoverRef = useRef(false);
  const handleHover = (id) => {
    hoverRef.current = Boolean(id);
    if (id) setHoveredId(id);
    else setTimeout(() => { if (!hoverRef.current) setHoveredId(null); }, 450);
  };
  const [dmOpen, setDmOpen] = useState(false);
  const [overInteractive, setOverInteractive] = useState(false);
  const [pressCharge, setPressCharge] = useState(0);
  const [idleCharge, setIdleCharge] = useState(0);
  const [docProject, setDocProject] = useState(null);
  const [growFrom, setGrowFrom] = useState(null);
  const [growLive, setGrowLive] = useState(false);
  const workList = useMemo(() => buildWorkList(), []);

  useEffect(() => {
    document.title = `${meta.name} · Frost effect lab`;
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [meta.name]);

  // Popout/card/enter routes open a project immediately where the treatment
  // is visible without hunting; entrance-driven variants wait for a click.
  useEffect(() => {
    setFocusedProject(null);
    setExpandedId(null);
    setDocProject(null);
    if (cardMeta || enterMeta) {
      setFocusedProject(workList[0]);
      return;
    }
    if (!popoutMeta) return;
    if (popoutMeta.slug === "expand-row") setExpandedId(workList[0].id);
    else if (!["break-open", "reveal", ...CARD_POPOUTS].includes(popoutMeta.slug)) setFocusedProject(workList[0]);
  }, [popoutMeta?.slug, cardMeta?.slug, enterMeta?.slug, workList]);

  // Fracture reveal: one continuous eased charge for the whole list. It
  // never resets on hover changes, so moving row to row hands the opening
  // off fluidly and leaving eases shut instead of snapping.
  useEffect(() => {
    if (!["reveal", "cards"].includes(popoutMeta?.slug) && !settleFlow) return;
    let raf = 0;
    let charge = 0;
    let sent = -1;
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const target = hoverRef.current ? 1 : 0;
      charge += (target - charge) * Math.min(dt * (target ? 3 : 2.4), 1);
      if (Math.abs(target - charge) < 0.005) charge = target;
      const q = Math.round(charge * 60) / 60;
      if (q !== sent) { sent = q; setRevealCharge(q); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [popoutMeta?.slug, settleFlow]);

  // Enter routes: the card's "Open project" action transitions into the
  // in-lab project page per variant.
  const openPage = (event) => {
    const project = focusedProject;
    if (!project) return;
    if (enterMeta?.slug === "grow" || flowMeta) {
      const rect = event.currentTarget.closest(".frost-modal")?.getBoundingClientRect();
      if (rect) {
        setGrowFrom({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
        setGrowLive(false);
        requestAnimationFrame(() => requestAnimationFrame(() => setGrowLive(true)));
        setTimeout(() => setGrowFrom(null), 480);
      }
    }
    setDocProject(project);
    setFocusedProject(null);
  };

  // Affordance play: fracture strength follows whether the pointer is over
  // something clickable inside the page. (The mist flow has no fracture to
  // gate, so it opts out.)
  useEffect(() => {
    if (playMeta?.slug !== "affordance" && flowMeta?.slug !== "flow") return;
    const onOver = (event) => {
      setOverInteractive(Boolean(event.target?.closest?.(".frost-page a, .frost-page button")));
    };
    document.addEventListener("pointerover", onOver);
    return () => document.removeEventListener("pointerover", onOver);
  }, [playMeta?.slug, flowMeta]);

  // Press play: holding the pointer down charges the fracture field wider;
  // releasing lets it ease back.
  useEffect(() => {
    if (playMeta?.slug !== "press") return;
    let raf = 0;
    let holding = false;
    let charge = 0;
    let last = 0;
    const loop = (now) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const target = holding ? 1 : 0;
      charge += (target - charge) * Math.min(dt * (holding ? 2.2 : 4.5), 1);
      if (Math.abs(target - charge) < 0.01) charge = target;
      setPressCharge(Math.round(charge * 50) / 50);
      if (charge !== target) raf = requestAnimationFrame(loop);
    };
    const restart = (value) => {
      holding = value;
      last = performance.now();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    };
    const down = () => restart(true);
    const up = () => restart(false);
    document.addEventListener("pointerdown", down);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
    };
  }, [playMeta?.slug]);

  // Condensation fx: rain intensity follows how long the visitor has been
  // idle — 2s of stillness starts the build-up, ~8s reaches full weather.
  useEffect(() => {
    if (fxMeta?.slug !== "condensation") return;
    let lastActive = performance.now();
    const poke = () => { lastActive = performance.now(); };
    const timer = setInterval(() => {
      const idleMs = performance.now() - lastActive;
      const next = Math.min(Math.max((idleMs - 2000) / 6000, 0), 1);
      setIdleCharge(Math.round(next * 25) / 25);
    }, 400);
    for (const type of ["pointermove", "pointerdown", "keydown", "wheel"]) {
      document.addEventListener(type, poke, { passive: true });
    }
    return () => {
      clearInterval(timer);
      for (const type of ["pointermove", "pointerdown", "keydown", "wheel"]) {
        document.removeEventListener(type, poke);
      }
    };
  }, [fxMeta?.slug]);

  const openProject = (project, event) => {
    if (popoutMeta?.slug === "expand-row") {
      setExpandedId((prev) => (prev === project.id ? null : project.id));
      return;
    }
    if ((popoutMeta?.slug === "reveal" || CARD_POPOUTS.includes(popoutMeta?.slug) || mistFlow || settleFlow) && event) {
      burstFracture(event.clientX, event.clientY);
      const rect = event.currentTarget.getBoundingClientRect();
      setGrowFrom({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
      setGrowLive(false);
      setTimeout(() => {
        setDocProject(project);
        requestAnimationFrame(() => requestAnimationFrame(() => setGrowLive(true)));
        setTimeout(() => setGrowFrom(null), 520);
      }, 240);
      return;
    }
    if ((popoutMeta?.slug === "break-open" || flowMeta) && event) {
      const { clientX, clientY } = event;
      burstFracture(clientX, clientY);
      setBurstOrigin([clientX, clientY]);
      setTimeout(() => setFocusedProject(project), 330);
      return;
    }
    setFocusedProject(project);
  };

  const pageSlug = popoutMeta
    ? popoutMeta.slug === "freeze-world" && focusedProject
      ? "freeze"
      : popoutMeta.slug === "mist-cards"
        ? "none"
        : "fracture"
    : mistFlow
      ? "mist"
      : settleFlow
        ? "particle-scroll"
        : playMeta || cardMeta || enterMeta || flowMeta
          ? "fracture"
          : fxMeta
            ? fxMeta.surface
            : meta.slug;

  const fractureOverrides = popoutMeta?.slug === "cards"
    ? {
        // Card-sized: the crack must stay inside one card, so the radius
        // barely grows and the shards stay low — containFracture keeps the
        // center pinned, this keeps the spread from spilling past an edge.
        radius: 0.09 + revealCharge * 0.05,
        lift: 8 + revealCharge * 9,
        scatter: 2 + revealCharge * 2,
        tilt: 0.8 + revealCharge * 0.4,
        strength: 0.4 + revealCharge * 0.5,
        shards: 0.9,
        followSpeed: 6,
      }
    : mistFlow
      ? MIST_REVEAL_OVERRIDES
      : popoutMeta?.slug === "reveal"
    ? {
        radius: 0.13 + revealCharge * 0.2,
        lift: 10 + revealCharge * 16,
        scatter: 3 + revealCharge * 5,
        tilt: 0.9 + revealCharge * 0.6,
        strength: 0.5 + revealCharge * 0.46,
        shards: 0.85 + revealCharge * 0.1,
        followSpeed: 5,
      }
    : playMeta?.slug === "affordance" || flowMeta?.slug === "flow"
    ? { strength: overInteractive ? 0.92 : 0, radius: 0.16, followSpeed: 6 }
    : playMeta?.slug === "press"
      ? {
          radius: 0.2 + pressCharge * 0.3,
          strength: 0.86 + pressCharge * 0.14,
          lift: 15 + pressCharge * 18,
          scatter: 4 + pressCharge * 5,
          tilt: 1 + pressCharge * 0.8,
        }
      : fxMeta?.slug === "condensation"
        ? {
            intensity: 0.15 + idleCharge * 0.85,
            staticDrops: 0.12 + idleCharge * 0.55,
            fallSpeed: 1 + idleCharge * 0.6,
          }
        : fxMeta?.slug === "clearing"
          ? { cover: 0.2, opacity: 0.64, density: 2.1 }
          : undefined;

  const navEntries = popoutMeta ? POPOUTS : playMeta ? PLAYS : fxMeta ? FX : cardMeta ? CARDS : enterMeta ? ENTERS : flowMeta ? FLOW : EFFECTS;
  const navBase = popoutMeta ? "/popout" : playMeta ? "/play" : fxMeta ? "/fx" : cardMeta ? "/card" : enterMeta ? "/enter" : flowMeta ? "/flow" : "/frost";

  return (
    <div className="lab-route">
      <div className="lab-bar">
        <button onClick={() => navigate("/")}>
          <ArrowLeft size={13} /> All prototypes
        </button>
        <nav aria-label="Variants">
          {navEntries.map((entry) => (
            <button
              key={entry.slug}
              className={entry.slug === meta.slug ? "is-active" : ""}
              onClick={() => navigate(`${navBase}/${entry.slug}`)}
            >
              {entry.number} {entry.name}
            </button>
          ))}
        </nav>
        <p>{meta.instruction}</p>
      </div>

      <main className="frost" id="main">
        <EffectShell slug={pageSlug} key={pageSlug} overrides={fractureOverrides}>
          <div className="frost-page">
            <SiteLayout
              workList={workList}
              onOpenProject={openProject}
              onDm={() => setDmOpen(true)}
              expandedId={popoutMeta?.slug === "expand-row" ? expandedId : null}
              contactVariant={playMeta?.slug === "break-ice" || flowMeta ? "sealed" : "plain"}
              play={playMeta?.slug ?? fxMeta?.slug ?? (mistFlow ? "clearing" : undefined)}
              reveal={popoutMeta?.slug === "reveal"}
              cardVariant={
                popoutMeta?.slug === "cards" ? "fracture"
                : popoutMeta?.slug === "thaw-cards" ? "thaw"
                : popoutMeta?.slug === "mist-cards" || mistFlow ? "mist"
                : settleFlow ? "settle"
                : null
              }
              hoveredId={hoveredId}
              onHover={handleHover}
              revealCharge={revealCharge}
            />
            <footer className="frost-footer">
              <span>&copy; 2026 Dylan McCavitt</span>
              <span>{meta.instruction}</span>
            </footer>
          </div>
        </EffectShell>

        {focusedProject && (
          <ProjectFocus
            project={focusedProject}
            variant={popoutMeta?.slug ?? (flowMeta ? "break-open" : "plain")}
            origin={burstOrigin}
            cardStyle={cardMeta?.slug ?? (flowMeta ? "dossier" : "classic")}
            onOpenPage={enterMeta || cardMeta || flowMeta ? openPage : undefined}
            onClose={() => setFocusedProject(null)}
          />
        )}
        {docProject && (
          <div
            className={`lab-doc-overlay${growFrom ? " is-grow" : ""} lab-doc--${enterMeta?.slug ?? (flowMeta || popoutMeta?.slug === "reveal" || CARD_POPOUTS.includes(popoutMeta?.slug) ? "grow" : "plain")}`}
            style={growFrom ? (growLive ? { top: 0, left: 0, width: "100%", height: "100%" } : growFrom) : undefined}
          >
            {enterMeta?.slug === "settle-in" || settleFlow ? (
              <ParticleScroll className="lab-doc-effect" point={0.62} band={340} spread={190} swirl={60}>
                <ProjectDoc project={docProject} onBack={() => setDocProject(null)} />
              </ParticleScroll>
            ) : (
              <ProjectDoc project={docProject} onBack={() => setDocProject(null)} />
            )}
          </div>
        )}
        {dmOpen && <DmPanel onClose={() => setDmOpen(false)} />}
      </main>
    </div>
  );
}
