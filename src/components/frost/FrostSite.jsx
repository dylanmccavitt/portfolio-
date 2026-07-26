import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Hammer, Wrench, X } from "lucide-react";
import "@fontsource-variable/geist";
import "@fontsource/ibm-plex-mono";
import { Shatter } from "./Shatter.jsx";
import DmChat from "./DmChat.jsx";
import { SUBGREETING } from "@/lib/dm/client";
import { JOURNEY, PROFILE, PROJECTS } from "./frost-data.js";
import "./frost.css";

const DESTINATIONS = [
  { id: "about", label: "About" },
  { id: "work", label: "Work" },
  { id: "journey", label: "Journey" },
  { id: "contact", label: "Contact" },
];

function WorkRows({ onBella }) {
  return (
    <ol className="frost-work">
      {PROJECTS.map((project) => (
        <li key={project.id}>
          <span className="frost-num">{project.number}</span>
          <div>
            <strong>{project.title}</strong>
            <span>{project.line}</span>
          </div>
          {project.id === "bellas-beads" ? (
            <button onClick={onBella}>
              Full focus <ArrowUpRight size={14} />
            </button>
          ) : (
            <small>{project.eyebrow}</small>
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

function AboutBlock() {
  return (
    <div className="frost-about">
      <p>{PROFILE.summary}</p>
      <p>
        I build backend systems, product software, and practical AI tools. I
        care about visible state, inspectable decisions, and products that make
        complicated work feel ordinary.
      </p>
    </div>
  );
}

function SiteLayout({ shatterRef, onBella, onDm }) {
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
    if (typeof history !== "undefined") history.replaceState(null, "", `#${id}`);
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
          <button
            className="frost-site-icon"
            title="Shatter the page"
            aria-label="Shatter the page"
            onClick={() => shatterRef.current?.crack?.()}
          >
            <Hammer size={14} />
          </button>
          <button
            className="frost-site-icon"
            title="Repair the page"
            aria-label="Repair the page"
            onClick={() => shatterRef.current?.repair?.()}
          >
            <Wrench size={14} />
          </button>
          <button className="frost-dm-button" onClick={onDm}>Ask DM</button>
        </div>
      </header>

      <section className="frost-site-section frost-site-hero" id="about">
        <p className="frost-kicker">Software engineer · New York City · {PROFILE.status.toLowerCase()}</p>
        <AboutBlock />
      </section>

      <section className="frost-site-section" id="work">
        <h2>Work</h2>
        <p className="frost-kicker">Four projects · shipped and building</p>
        <WorkRows onBella={onBella} />
      </section>

      <section className="frost-site-section" id="journey">
        <h2>Journey</h2>
        <p className="frost-kicker">2019 — now</p>
        <JourneyRows />
      </section>

      <section className="frost-site-section" id="contact">
        <h2>Contact</h2>
        <p className="frost-kicker">Say hello</p>
        <ContactBlock />
      </section>
    </div>
  );
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
    <div className="frost-backdrop" onMouseDown={onClose}>
      <article className="frost-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="frost-close" onClick={onClose} aria-label="Close Bella's Beads focus">
          <X size={19} />
        </button>
        <p className="frost-kicker">Shipped client work / 2025</p>
        <h2>Bella&rsquo;s Beads</h2>
        <p>{bella.summary}</p>
        <div className="frost-proof">
          {bella.proof.map((proof) => <span key={proof}>{proof}</span>)}
        </div>
        <div className="frost-gallery">
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
        <p>{SUBGREETING}</p>
        <DmChat />
        <a href={`mailto:${PROFILE.email}`}>
          Contact Dylan directly <ArrowUpRight size={16} />
        </a>
      </section>
    </div>
  );
}

export default function FrostSite() {
  const [bellaOpen, setBellaOpen] = useState(false);
  const [dmOpen, setDmOpen] = useState(false);
  const shatterRef = useRef(null);

  const effectMode = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("effect")
    : null;

  const Wrapper = effectMode === "off" ? "div" : Shatter;
  const wrapperProps = effectMode === "off"
    ? { className: "frost-effect" }
    : {
        className: "frost-effect",
        controlRef: shatterRef,
        snapshot: true,
        forceSnapshot: effectMode === "snapshot",
        invert: true,
        persist: true,
        regrow: 0,
        radius: 0.3,
        softness: 0.75,
        tileSize: 44,
        shards: 0.9,
        corner: 4,
        lift: 10,
        tilt: 0.8,
        scatter: 3,
        perspective: 1700,
        gapColor: [0.78, 0.87, 0.93],
        shadow: 0.2,
        shading: 0.34,
        refraction: 0.9,
        dispersion: 0.12,
        floatSpeed: 0.25,
        strength: 0.9,
        baseStrength: 0.5,
        followSpeed: 4.5,
      };

  return (
    <main className="frost" id="main">
      <Wrapper {...wrapperProps}>
        <div className="frost-page">
          <SiteLayout
            shatterRef={shatterRef}
            onBella={() => setBellaOpen(true)}
            onDm={() => setDmOpen(true)}
          />
          <footer className="frost-footer">
            <span>&copy; 2026 Dylan McCavitt</span>
            <span>Move the cursor: the glaze is crazed but readable; where you polish, it clears for good.</span>
          </footer>
        </div>
      </Wrapper>

      {bellaOpen && <BellaFocus onClose={() => setBellaOpen(false)} />}
      {dmOpen && <DmPanel onClose={() => setDmOpen(false)} />}
    </main>
  );
}
