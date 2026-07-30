import { useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight, X } from "lucide-react";
import { Glitch } from "./components/canvasui/Glitch.jsx";
import { Liquid } from "./components/canvasui/Liquid.jsx";
import { Shatter } from "./components/canvasui/Shatter.jsx";
import { JOURNEY, PROFILE, PROJECTS } from "./data.js";

const DESTINATIONS = [
  { id: "about", number: "02", label: "About" },
  { id: "work", number: "03", label: "Work" },
  { id: "journey", number: "04", label: "Journey" },
  { id: "contact", number: "05", label: "Contact" },
];

const REMIXES = [
  { path: "/html/signal-tear", number: "01", label: "Tear" },
  { path: "/html/signal-current", number: "02", label: "Current" },
  { path: "/html/signal-fracture", number: "03", label: "Fracture" },
  { path: "/html/signal-mend", number: "04", label: "Mend" },
  { path: "/html/signal-frost", number: "05", label: "Frost" },
  { path: "/html/signal-ember", number: "06", label: "Ember" },
];

function route(navigate, path) {
  return (event) => {
    event.preventDefault();
    navigate(path);
  };
}

function Effect({ slug, children }) {
  if (slug === "signal-tear") {
    return (
      <Glitch
        className="signal-remix-effect"
        intensity={0.78}
        interval={2.8}
        duration={0.3}
        slices={22}
        shift={19}
        rgbShift={1.2}
        blocks={0.12}
        noise={0.04}
      >
        {children}
      </Glitch>
    );
  }

  if (slug === "signal-current") {
    return (
      <Liquid
        className="signal-remix-effect"
        simResolution={128}
        dyeResolution={512}
        densityDissipation={0.9}
        velocityDissipation={0.94}
        pressure={0.8}
        pressureIterations={5}
        curl={2.3}
        radius={0.15}
        force={0.24}
        intensity={0.82}
        distortion={0.36}
        blend={0.9}
        color={[0.31, 0.24, 0.21]}
        rainbow={false}
      >
        {children}
      </Liquid>
    );
  }

  if (slug === "signal-frost") {
    return (
      <Shatter
        className="signal-remix-effect"
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

  if (slug === "signal-ember") {
    return (
      <Shatter
        className="signal-remix-effect"
        invert
        persist
        regrow={0.015}
        radius={0.32}
        softness={0.7}
        tileSize={70}
        shards={0.8}
        corner={8}
        lift={18}
        tilt={1.0}
        scatter={5}
        perspective={1700}
        gapColor={[0.24, 0.1, 0.05]}
        shadow={0.3}
        shading={0.4}
        refraction={0.45}
        dispersion={0.05}
        floatSpeed={0.45}
        strength={0.92}
        baseStrength={0.7}
        followSpeed={4.5}
      >
        {children}
      </Shatter>
    );
  }

  if (slug === "signal-mend") {
    return (
      <Shatter
        className="signal-remix-effect"
        invert
        persist
        regrow={0}
        radius={0.34}
        softness={0.72}
        tileSize={62}
        shards={0.85}
        corner={6}
        lift={16}
        tilt={1.0}
        scatter={5}
        perspective={1700}
        gapColor={[0.12, 0.11, 0.1]}
        shadow={0.25}
        shading={0.35}
        refraction={0.5}
        dispersion={0.06}
        floatSpeed={0.35}
        strength={0.92}
        baseStrength={0.62}
        followSpeed={4.5}
      >
        {children}
      </Shatter>
    );
  }

  return (
    <Shatter
      className="signal-remix-effect"
      radius={0.18}
      softness={0.64}
      tileSize={52}
      shards={0.82}
      corner={6}
      lift={17}
      tilt={1.05}
      scatter={4}
      perspective={1700}
      gapColor={[0.15, 0.18, 0.2]}
      shadow={0.2}
      shading={0.32}
      refraction={0.62}
      dispersion={0.05}
      floatSpeed={0.5}
      strength={0.84}
      baseStrength={0}
      followSpeed={5}
    >
      {children}
    </Shatter>
  );
}

function Work({ onBella }) {
  return (
    <section className="signal-remix-section" aria-labelledby="signal-work-title">
      <div className="signal-remix-section-heading">
        <p>03 / Work</p>
        <h2 id="signal-work-title">Ideas shaped. Systems built. Impact earned.</h2>
      </div>
      <ol className="signal-remix-projects">
        {PROJECTS.map((project) => (
          <li key={project.id}>
            <span>{project.number}</span>
            <button onClick={project.id === "bellas-beads" ? onBella : undefined}>
              <strong>{project.title}</strong>
              <small>{project.line}</small>
              {project.id === "bellas-beads" && <ArrowUpRight size={18} />}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Journey() {
  return (
    <section className="signal-remix-section" aria-labelledby="signal-journey-title">
      <div className="signal-remix-section-heading">
        <p>04 / Journey</p>
        <h2 id="signal-journey-title">The path into software.</h2>
      </div>
      <ol className="signal-remix-journey">
        {JOURNEY.map(([year, place, role]) => (
          <li key={`${year}-${place}`}>
            <time>{year}</time>
            <strong>{place}</strong>
            <span>{role}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Contact() {
  return (
    <section className="signal-remix-section signal-remix-contact" aria-labelledby="signal-contact-title">
      <div className="signal-remix-section-heading">
        <p>05 / Contact</p>
        <h2 id="signal-contact-title">Let’s make the next useful thing.</h2>
      </div>
      <a href={`mailto:${PROFILE.email}`}>
        {PROFILE.email}
        <ArrowUpRight size={30} strokeWidth={1.4} />
      </a>
    </section>
  );
}

function About() {
  return (
    <section className="signal-remix-section signal-remix-about" aria-labelledby="signal-about-title">
      <div className="signal-remix-section-heading">
        <p>02 / About</p>
        <h2 id="signal-about-title">Economics to engineering, with the messy middle intact.</h2>
      </div>
      <div>
        <p>{PROFILE.summary}</p>
        <p>
          I build backend systems, product software, and practical AI tools.
          I care about visible state, inspectable decisions, and products that
          make complicated work feel ordinary.
        </p>
      </div>
    </section>
  );
}

function PortfolioSection({ active, onBella }) {
  if (active === "work") return <Work onBella={onBella} />;
  if (active === "journey") return <Journey />;
  if (active === "contact") return <Contact />;
  return <About />;
}

function BellaFocus({ onClose }) {
  const bella = PROJECTS[0];

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="signal-modal-backdrop" onMouseDown={onClose}>
      <article className="signal-modal signal-bella" onMouseDown={(event) => event.stopPropagation()}>
        <button className="signal-close" onClick={onClose} aria-label="Close Bella's Beads focus">
          <X size={20} />
        </button>
        <header>
          <p>Shipped client work / 2025</p>
          <h2>Bella’s Beads</h2>
          <p>{bella.summary}</p>
        </header>
        <div className="signal-bella-proof">
          {bella.proof.map((proof) => <span key={proof}>{proof}</span>)}
        </div>
        <div className="signal-bella-gallery">
          {bella.images.map((src, index) => (
            <figure key={src}>
              <img
                src={src}
                alt={[
                  "Bella's Beads storefront landing page",
                  "Bella's Beads product page",
                  "Bella's Beads Stripe checkout",
                  "Bella's Beads administration dashboard",
                ][index]}
              />
              <figcaption>{["Storefront", "Product", "Checkout", "Operations"][index]}</figcaption>
            </figure>
          ))}
        </div>
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
    <div className="signal-modal-backdrop" onMouseDown={onClose}>
      <section className="signal-modal signal-dm" role="dialog" aria-modal="true" aria-labelledby="signal-dm-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="signal-close" onClick={onClose} aria-label="Close DM">
          <X size={20} />
        </button>
        <p>Public portfolio guide</p>
        <h2 id="signal-dm-title">Ask DM about Dylan’s work.</h2>
        <p>
          DM answers only from Dylan’s published portfolio sources. It is
          unavailable in this local prototype.
        </p>
        <a href={`mailto:${PROFILE.email}`}>
          Contact Dylan instead <ArrowUpRight size={18} />
        </a>
      </section>
    </div>
  );
}

function CanvasStatus({ label }) {
  const [native, setNative] = useState(false);

  useEffect(() => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    setNative(Boolean(
      context &&
      typeof context.drawElementImage === "function" &&
      typeof canvas.requestPaint === "function"
    ));
  }, []);

  return (
    <span className="signal-canvas-status">
      Canvas UI / {label} / {native ? "HTML-in-Canvas active" : "semantic fallback"}
    </span>
  );
}

export function SignalRemixRoute({ prototype, navigate }) {
  const [active, setActive] = useState("about");
  const [bellaOpen, setBellaOpen] = useState(false);
  const [dmOpen, setDmOpen] = useState(false);

  useEffect(() => {
    document.title = `${prototype.name} · Dylan McCavitt`;
    setActive("about");
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [prototype.name, prototype.slug]);

  return (
    <main className={`signal-remix signal-remix--${prototype.slug}`}>
      <Effect slug={prototype.slug}>
        <div className="signal-remix-page">
          <aside className="signal-remix-picker" aria-label="Signal remix prototypes">
            <a href="/" onClick={route(navigate, "/")}>
              <ArrowLeft size={14} /> All prototypes
            </a>
            <div>
              {REMIXES.map((remix) => (
                <a
                  key={remix.path}
                  href={remix.path}
                  onClick={route(navigate, remix.path)}
                  aria-current={remix.path === prototype.path ? "page" : undefined}
                >
                  {remix.number} {remix.label}
                </a>
              ))}
            </div>
          </aside>

          <header className="signal-remix-header">
            <p>01 / Homepage</p>
            <p>{prototype.instruction}</p>
          </header>

          <section className="signal-remix-hero">
            <h1>Dylan McCavitt</h1>
            <p>{prototype.note}</p>
          </section>

          <nav className="signal-remix-nav" aria-label="Portfolio destinations">
            {DESTINATIONS.map((destination) => (
              <button
                key={destination.id}
                className={destination.id === active ? "is-active" : ""}
                aria-pressed={destination.id === active}
                onClick={() => setActive(destination.id)}
              >
                <span>{destination.number}</span>
                {destination.label}
              </button>
            ))}
            <button onClick={() => setDmOpen(true)}>
              <span>06</span>
              Ask DM
            </button>
          </nav>

          <PortfolioSection active={active} onBella={() => setBellaOpen(true)} />

          <footer className="signal-remix-footer">
            <span>Crafted with curiosity. Built with care. Always learning.</span>
            <CanvasStatus label={prototype.component} />
          </footer>
        </div>
      </Effect>

      {bellaOpen && <BellaFocus onClose={() => setBellaOpen(false)} />}
      {dmOpen && <DmPanel onClose={() => setDmOpen(false)} />}
    </main>
  );
}
