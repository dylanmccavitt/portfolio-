import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronRight,
  X,
} from "lucide-react";
import { Glass } from "./components/canvasui/Glass.jsx";
import { ParticleReveal } from "./components/canvasui/ParticleReveal.jsx";
import { Peel } from "./components/canvasui/Peel.jsx";
import { Glitch } from "./components/canvasui/Glitch.jsx";
import { RetroDither } from "./components/canvasui/RetroDither.jsx";
import { Lamp } from "./components/canvasui/Lamp.jsx";
import { Letterpress } from "./components/canvasui/Letterpress.jsx";
import { JOURNEY, PROFILE, PROJECTS } from "./data.js";

export const PROTOTYPES = [
  {
    path: "/html/signal-tear",
    slug: "signal-tear",
    number: "01",
    name: "Signal Tear",
    component: "Glitch",
    instruction: "Watch the page: restrained broadcast tears interrupt and re-register the live type.",
    note: "Timed signal breaks cut across the editorial field, then snap the semantic page back into register.",
    remix: true,
  },
  {
    path: "/html/signal-current",
    slug: "signal-current",
    number: "02",
    name: "Signal Current",
    component: "Liquid",
    instruction: "Move the cursor: velocity bends and briefly stains the live type beneath it.",
    note: "A warm refractive current follows your movement and lets the typography recover after every pass.",
    remix: true,
  },
  {
    path: "/html/signal-fracture",
    slug: "signal-fracture",
    number: "03",
    name: "Signal Fracture",
    component: "Shatter",
    instruction: "Move the cursor: nearby letterforms lift into refractive shards and settle when you leave.",
    note: "Localized pieces split, float, and reassemble without turning the portfolio into a background illustration.",
    remix: true,
  },
  {
    path: "/html/signal-mend",
    slug: "signal-mend",
    number: "04",
    name: "Signal Mend",
    component: "Shatter (inverted)",
    instruction: "Move the cursor: wherever it passes, the page mends — and stays mended.",
    note: "The page starts in pieces; every place your attention touches knits back together for good.",
    remix: true,
  },
  {
    path: "/html/signal-frost",
    slug: "signal-frost",
    number: "05",
    name: "Signal Frost",
    component: "Shatter (inverted)",
    instruction: "Move the cursor: the glaze is crazed but readable; where you polish, it clears for good.",
    note: "A porcelain page under fine cracked glaze — legible everywhere, flawless wherever attention has been.",
    remix: true,
  },
  {
    path: "/html/signal-ember",
    slug: "signal-ember",
    number: "06",
    name: "Signal Ember",
    component: "Shatter (inverted)",
    instruction: "Move the cursor: attention seals the cooling cracks; neglect lets them slowly open again.",
    note: "A warm slab that mends under the cursor and re-fractures, gently, where nobody looks.",
    remix: true,
  },
  {
    path: "/html/prism-ledger",
    slug: "prism",
    number: "07",
    name: "Prism Ledger",
    component: "Glass",
    note: "A cool editorial ledger viewed through a moving refractive lens.",
  },
  {
    path: "/html/paper-layers",
    slug: "paper",
    number: "08",
    name: "Paper Layers",
    component: "Peel",
    note: "A warm serif portfolio with a second source layer beneath the page.",
  },
  {
    path: "/html/signal-dust",
    slug: "signal",
    number: "09",
    name: "Signal Dust",
    component: "Particle Reveal",
    note: "Loose field notes that gather into focus around the cursor.",
  },
  {
    path: "/html/broadcast-cut",
    slug: "broadcast",
    number: "10",
    name: "Broadcast Cut",
    component: "Glitch",
    note: "A sharp newsroom cut with timed signal breaks and hard typography.",
  },
  {
    path: "/html/pixel-proof",
    slug: "pixel",
    number: "11",
    name: "Pixel Proof",
    component: "Retro Dither",
    note: "A compact proof sheet with a cursor-driven dither inspection field.",
  },
  {
    path: "/html/desk-lamp",
    slug: "lamp",
    number: "12",
    name: "Desk Lamp",
    component: "Light Pass",
    note: "Fully legible at rest; the cursor only warms the ink it passes over.",
  },
  {
    path: "/html/letterpress",
    slug: "press",
    number: "13",
    name: "Letterpress",
    component: "Ink Relief",
    note: "Type pressed into the sheet; the cursor moves the light, never the letters.",
  },
];

const DESTINATIONS = [
  { id: "about", number: "01", label: "About", descriptor: "Background and focus" },
  { id: "work", number: "02", label: "Work", descriptor: "Selected projects" },
  { id: "journey", number: "03", label: "Journey", descriptor: "Résumé and path" },
  { id: "contact", number: "04", label: "Contact", descriptor: "Start a conversation" },
];

function route(navigate, path) {
  return (event) => {
    event.preventDefault();
    navigate(path);
  };
}

function PrototypeSwitcher({ current, navigate }) {
  return (
    <nav className="prototype-switcher" aria-label="Prototype options">
      <a href="/" onClick={route(navigate, "/")} className="switcher-back">
        <ArrowLeft size={15} /> All prototypes
      </a>
      <div>
        {PROTOTYPES.map((prototype) => (
          <a
            href={prototype.path}
            key={prototype.path}
            onClick={route(navigate, prototype.path)}
            aria-current={prototype.path === current ? "page" : undefined}
            aria-label={`Open ${prototype.name}`}
          >
            {prototype.number}
          </a>
        ))}
      </div>
    </nav>
  );
}

function WorkContent({ onBella }) {
  return (
    <section className="destination-content work-content" aria-labelledby="work-content-title">
      <header>
        <p>Selected work / 2025—26</p>
        <h2 id="work-content-title">Four projects, one useful thread.</h2>
      </header>
      <div className="work-list">
        {PROJECTS.map((project) => (
          <article key={project.id}>
            <span>{project.number}</span>
            <div>
              <h3>{project.title}</h3>
              <p>{project.line}</p>
            </div>
            {project.id === "bellas-beads" ? (
              <button onClick={onBella}>
                Full focus <ArrowUpRight size={17} />
              </button>
            ) : (
              <small>{project.eyebrow}</small>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function JourneyContent() {
  return (
    <section className="destination-content journey-content" aria-labelledby="journey-content-title">
      <header>
        <p>Résumé preview</p>
        <h2 id="journey-content-title">The path into software.</h2>
      </header>
      <ol>
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

function ContactContent() {
  return (
    <section className="destination-content contact-content" aria-labelledby="contact-content-title">
      <p>Contact / {PROFILE.status}</p>
      <h2 id="contact-content-title">Let’s make the next useful thing.</h2>
      <a href={`mailto:${PROFILE.email}`}>
        {PROFILE.email} <ArrowUpRight size={34} strokeWidth={1.5} />
      </a>
    </section>
  );
}

function AboutContent() {
  return (
    <section className="destination-content about-content" aria-labelledby="about-content-title">
      <p>About / New York City</p>
      <h2 id="about-content-title">
        Economics, legal operations, cyber risk, then engineering.
      </h2>
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

function DestinationContent({ active, onBella }) {
  if (active === "work") return <WorkContent onBella={onBella} />;
  if (active === "journey") return <JourneyContent />;
  if (active === "contact") return <ContactContent />;
  return <AboutContent />;
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
    <div className="focus-backdrop" onMouseDown={onClose}>
      <article className="bella-focus" onMouseDown={(event) => event.stopPropagation()}>
        <button className="close-control" onClick={onClose} aria-label="Close Bella's Beads focus">
          <X size={21} />
        </button>
        <header>
          <p>Shipped client work / 2025</p>
          <h2>Bella’s Beads</h2>
          <p>{bella.summary}</p>
        </header>
        <div className="bella-proof">
          {bella.proof.map((proof) => <span key={proof}>{proof}</span>)}
        </div>
        <div className="bella-gallery">
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
  return (
    <div className="dm-backdrop" onMouseDown={onClose}>
      <section className="dm-panel" role="dialog" aria-modal="true" aria-labelledby="dm-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="close-control" onClick={onClose} aria-label="Close DM"><X size={21} /></button>
        <p>Public portfolio guide</p>
        <h2 id="dm-title">Ask DM about Dylan’s work.</h2>
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

function CanvasCapability({ component }) {
  const [native, setNative] = useState(false);

  useEffect(() => {
    const probe = document.createElement("canvas");
    const context = probe.getContext("2d");
    setNative(
      Boolean(
        context &&
        typeof context.drawElementImage === "function" &&
        typeof probe.requestPaint === "function",
      ),
    );
  }, []);

  return (
    <p className="canvas-capability">
      <i aria-hidden="true" />
      Canvas UI / {component} / {native ? "HTML-in-Canvas active" : "semantic fallback"}
    </p>
  );
}

function PeelUnderLayer() {
  return (
    <div className="peel-under">
      <p>Below the interface</p>
      <strong>Published work. Inspectable decisions. No hidden pitch.</strong>
      <span>Dylan McCavitt / Portfolio source layer / 2026</span>
    </div>
  );
}

function EffectShell({ prototype, children }) {
  const common = { className: "canvas-effect-shell" };

  if (prototype.slug === "prism") {
    return (
      <Glass
        {...common}
        shape="circle"
        size={175}
        edge={0.64}
        aberration={1.5}
        blur={0.08}
        zoom={1.18}
        targets="[data-glass-target]"
      >
        {children}
      </Glass>
    );
  }

  if (prototype.slug === "paper") {
    return (
      <Peel
        {...common}
        under={<PeelUnderLayer />}
        side="right"
        reveal={220}
        zone={150}
        curl={260}
        bow={50}
        shine={0.45}
      >
        {children}
      </Peel>
    );
  }

  if (prototype.slug === "signal") {
    return (
      <ParticleReveal
        {...common}
        radius={320}
        softness={0.68}
        size={1.4}
        scatter={18}
        drift={0.45}
        aberration={12}
        bend={24}
        background="#d3a28d"
      >
        {children}
      </ParticleReveal>
    );
  }

  if (prototype.slug === "lamp") {
    return (
      <Lamp
        {...common}
        radius={340}
        softness={0.85}
        warmth={0.7}
        glow={0.6}
        grain={0.035}
        background="#e3dac4"
      >
        {children}
      </Lamp>
    );
  }

  if (prototype.slug === "press") {
    return (
      <Letterpress
        {...common}
        depth={0.12}
        spread={1.4}
        grain={0.04}
        follow={0.35}
        background="#dcdcd6"
      >
        {children}
      </Letterpress>
    );
  }

  if (prototype.slug === "broadcast") {
    return (
      <Glitch
        {...common}
        intensity={0.72}
        interval={4.5}
        duration={0.22}
        slices={18}
        shift={18}
        rgbShift={2}
        blocks={0.28}
        noise={0.12}
      >
        {children}
      </Glitch>
    );
  }

  return (
    <RetroDither
      {...common}
      radius={0.28}
      softness={0.72}
      pixelSize={3}
      levels={3}
      darkColor={[0.07, 0.1, 0.07]}
      lightColor={[0.83, 0.87, 0.68]}
      colorize={0.88}
      contrast={0.9}
      strength={0.86}
      baseStrength={0.04}
      scanlines={0}
    >
      {children}
    </RetroDither>
  );
}

function useScrollDrivenDom() {
  const pageRef = useRef(null);

  useEffect(() => {
    let frame = 0;

    function paint() {
      frame = 0;
      const page = pageRef.current;
      if (!page) return;
      const max = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
      const progress = Math.min(Math.max(window.scrollY / max, 0), 1);
      page.style.setProperty("--scroll", progress.toFixed(4));
      page.style.setProperty("--scroll-px", `${Math.round(window.scrollY)}px`);
      page.dataset.scrollPhase =
        progress < 0.24 ? "intro" : progress < 0.72 ? "content" : "footer";
    }

    function schedule() {
      if (!frame) frame = window.requestAnimationFrame(paint);
    }

    paint();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  return pageRef;
}

export function PrototypeRoute({ prototype, navigate }) {
  const [active, setActive] = useState("about");
  const [bellaOpen, setBellaOpen] = useState(false);
  const [dmOpen, setDmOpen] = useState(false);
  const pageRef = useScrollDrivenDom();

  useEffect(() => {
    document.title = `${prototype.name} · Dylan McCavitt`;
  }, [prototype.name]);

  return (
    <main className={`prototype prototype--${prototype.slug}`}>
      <EffectShell prototype={prototype}>
        <div className="prototype-page" data-glass-target ref={pageRef}>
          <PrototypeSwitcher current={prototype.path} navigate={navigate} />

          <header className="prototype-header">
            <div>
              <p>Dylan McCavitt</p>
              <span>Software engineer · New York City</span>
            </div>
            <p>{prototype.name}</p>
            <button onClick={() => setDmOpen(true)}>
              Ask DM <ArrowUpRight size={16} />
            </button>
          </header>

          <section className="prototype-intro">
            <p>{prototype.number} / {prototype.component} / {prototype.name}</p>
            <h1>Dylan McCavitt</h1>
            <p>{prototype.note}</p>
          </section>

          <div className="prototype-stage">
            <nav className="destination-nav" aria-label="Portfolio destinations">
              {DESTINATIONS.map((destination) => {
                const selected = destination.id === active;
                return (
                  <button
                    key={destination.id}
                    onClick={() => setActive(destination.id)}
                    aria-pressed={selected}
                    className={selected ? "is-active" : ""}
                  >
                    <span className="destination-number">{destination.number}</span>
                    <span className="destination-label">{destination.label}</span>
                    <span className="destination-descriptor">{destination.descriptor}</span>
                    <ChevronRight className="destination-arrow" size={24} strokeWidth={1.4} />
                  </button>
                );
              })}
            </nav>

            <div className="content-reveal">
              <DestinationContent active={active} onBella={() => setBellaOpen(true)} />
            </div>
          </div>

          <footer className="prototype-footer">
            <span>Click a destination. Compare the component language.</span>
            <span>{prototype.number} of {PROTOTYPES.length}</span>
          </footer>
          <CanvasCapability component={prototype.component} />
          <div className="scroll-meter" aria-hidden="true">
            <span />
          </div>
        </div>
      </EffectShell>

      {bellaOpen && <BellaFocus onClose={() => setBellaOpen(false)} />}
      {dmOpen && <DmPanel onClose={() => setDmOpen(false)} />}
    </main>
  );
}

export function PrototypeGallery({ navigate }) {
  useEffect(() => {
    document.title = "HTML-in-Canvas Prototypes · Dylan McCavitt";
  }, []);

  return (
    <main className="prototype-gallery">
      <header>
        <p>Local exploration / not a selected direction</p>
        <h1>Thirteen different Canvas UI systems.</h1>
        <p>
          Thirteen components, structures, type systems, and motion languages.
          The portfolio content stays constant.
        </p>
      </header>
      <ol>
        {PROTOTYPES.map((prototype) => (
          <li key={prototype.path} className={`gallery-item gallery-item--${prototype.slug}`}>
            <a href={prototype.path} onClick={route(navigate, prototype.path)}>
              <span>{prototype.number}</span>
              <div>
                <strong>{prototype.name}</strong>
                <small>{prototype.component}</small>
              </div>
              <p>{prototype.note}</p>
              <ArrowUpRight size={26} strokeWidth={1.4} />
            </a>
          </li>
        ))}
      </ol>
      <footer>
        <span>Semantic HTML first · Canvas-enhanced · complete fallback</span>
        <a href={`mailto:${PROFILE.email}`}>Contact Dylan</a>
      </footer>
    </main>
  );
}
