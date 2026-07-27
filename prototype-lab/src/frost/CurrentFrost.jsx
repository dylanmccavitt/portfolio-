import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, X } from "lucide-react";
import { Clouds } from "../components/canvasui/Clouds.tsx";
import { Droplets } from "../components/canvasui/Droplets.tsx";
import { Frost } from "../components/canvasui/Frost.tsx";
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
];

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
];

/** Crack burst at a viewport point: feed jittered pointer moves to the page
    Shatter so the glaze visibly breaks where the visitor clicked. */
function burstFracture(x, y) {
  const host = document.querySelector(".frost-effect");
  if (!host) return;
  let step = 0;
  const timer = setInterval(() => {
    const angle = (step / 11) * Math.PI * 2;
    const spread = 14 + step * 7;
    host.dispatchEvent(new PointerEvent("pointermove", {
      clientX: x + Math.cos(angle * 2.7) * spread,
      clientY: y + Math.sin(angle * 1.9) * spread * 0.6,
      bubbles: false,
    }));
    if (++step > 11) clearInterval(timer);
  }, 26);
}

function EffectShell({ slug, overrides, children }) {
  if (slug === "freeze") {
    return (
      <Frost
        className="frost-effect frost-effect--canvasui"
        frost={0.45}
        opacity={0.7}
        meltStrength={0}
        introDuration={1}
        haze={0.6}
        detail={2}
        tintStrength={0.35}
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
        frost={0.07}
        opacity={0.62}
        meltRadius={0.24}
        meltStrength={0.8}
        refreeze={5}
        haze={0.55}
        detail={2}
        textureScale={2}
        tintStrength={0.32}
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
        color="#dfe9f0"
        opacity={0.6}
        cover={0.12}
        density={2.4}
        wind={0.7}
        windRadius={380}
        speed={0.5}
        shadow={0.04}
      >
        {children}
      </Clouds>
    );
  }

  if (slug === "rain") {
    return (
      <Droplets
        className="frost-effect frost-effect--canvasui"
        intensity={0.45}
        scale={0.42}
        refraction={0.24}
        staticDrops={0.25}
        interactive
        interactionRadius={0.3}
        interactionStrength={0.65}
        tint={[0.87, 0.92, 0.97]}
        tintStrength={0.12}
      >
        {children}
      </Droplets>
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
    shots: [],
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

function WorkRows({ projects, onOpen, expandedId }) {
  return (
    <ol className="frost-work">
      {projects.map((project, index) => (
        <li key={project.id}>
          <a
            href={project.href}
            onClick={(event) => {
              event.preventDefault();
              onOpen(project, event);
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

/** Break-the-ice: the email sits under a thick pane of ice; rubbing melts
    it clear for good, so making contact starts by literally breaking the
    ice. Built on the inline-safe canvasui Frost (the Shatter engine only
    supports full-page mounting), with the sizer/overlay pattern from the
    thaw card. Rubbing must not crack the page glaze, so a native listener
    stops pointer moves from reaching the page Shatter's ancestor listener. */
function SealedContact() {
  const stopRef = (node) => {
    node?.addEventListener("pointermove", (event) => event.stopPropagation());
  };

  const body = (
    <div className="frost-seal-body">
      <ContactBlock />
    </div>
  );

  return (
    <div ref={stopRef} className="frost-seal-stop">
      <div className="popout-thaw">
        <div className="popout-thaw-sizer" aria-hidden="true">{body}</div>
        <Frost
          className="popout-thaw-effect"
          style={{ position: "absolute", inset: 0 }}
          frost={0.6}
          opacity={0.92}
          meltRadius={0.28}
          meltStrength={1}
          refreeze={0}
          introDuration={1.2}
          haze={0.7}
          detail={2.4}
          tintStrength={0.4}
        >
          {body}
        </Frost>
      </div>
    </div>
  );
}

function SiteLayout({ workList, onOpenProject, onDm, expandedId, contactVariant }) {
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
        <WorkRows projects={workList} onOpen={onOpenProject} expandedId={expandedId} />
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

function ProjectFocus({ project, onClose, variant = "plain", origin }) {
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

  const card = (
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
      <ProjectDetailBody project={project} />
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

export function CurrentFrost({ effect, popout, play, navigate }) {
  const popoutMeta = popout ? POPOUTS.find((entry) => entry.slug === popout) ?? POPOUTS[0] : null;
  const playMeta = play ? PLAYS.find((entry) => entry.slug === play) ?? PLAYS[0] : null;
  const meta = popoutMeta ?? playMeta ?? (EFFECTS.find((entry) => entry.slug === effect) ?? EFFECTS[0]);
  const [focusedProject, setFocusedProject] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [burstOrigin, setBurstOrigin] = useState(null);
  const [dmOpen, setDmOpen] = useState(false);
  const [overInteractive, setOverInteractive] = useState(false);
  const workList = useMemo(() => buildWorkList(), []);

  useEffect(() => {
    document.title = `${meta.name} · Frost effect lab`;
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [meta.name]);

  // Popout routes open a project immediately where the treatment is visible
  // without hunting; entrance-driven variants wait for a real click instead.
  useEffect(() => {
    setFocusedProject(null);
    setExpandedId(null);
    if (!popoutMeta) return;
    if (popoutMeta.slug === "expand-row") setExpandedId(workList[0].id);
    else if (popoutMeta.slug !== "break-open") setFocusedProject(workList[0]);
  }, [popoutMeta?.slug, workList]);

  // Affordance play: fracture strength follows whether the pointer is over
  // something clickable inside the page.
  useEffect(() => {
    if (playMeta?.slug !== "affordance") return;
    const onOver = (event) => {
      setOverInteractive(Boolean(event.target?.closest?.(".frost-page a, .frost-page button")));
    };
    document.addEventListener("pointerover", onOver);
    return () => document.removeEventListener("pointerover", onOver);
  }, [playMeta?.slug]);

  const openProject = (project, event) => {
    if (popoutMeta?.slug === "expand-row") {
      setExpandedId((prev) => (prev === project.id ? null : project.id));
      return;
    }
    if (popoutMeta?.slug === "break-open" && event) {
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
      : "fracture"
    : playMeta
      ? "fracture"
      : meta.slug;

  const fractureOverrides = playMeta?.slug === "affordance"
    ? { strength: overInteractive ? 0.92 : 0, radius: 0.16, followSpeed: 6 }
    : undefined;

  const navEntries = popoutMeta ? POPOUTS : playMeta ? PLAYS : EFFECTS;
  const navBase = popoutMeta ? "/popout" : playMeta ? "/play" : "/frost";

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
              contactVariant={playMeta?.slug === "break-ice" ? "sealed" : "plain"}
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
            variant={popoutMeta?.slug ?? "plain"}
            origin={burstOrigin}
            onClose={() => setFocusedProject(null)}
          />
        )}
        {dmOpen && <DmPanel onClose={() => setDmOpen(false)} />}
      </main>
    </div>
  );
}
