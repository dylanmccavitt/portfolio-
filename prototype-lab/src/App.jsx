import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { ABOUT_REVEALS, CARD_REVEALS, CURRENT, MistSite } from "./frost/MistSite.jsx";
import { PROJECT_LOOKS, ProjectLook } from "./frost/ProjectLooks.jsx";
import "./frost/lab.css";

/**
 * The lab now carries ONE prototype: the locked mist-reveal direction.
 * Every earlier exploration (fracture surfaces, popouts, plays, fx, card
 * designs, page entries, flows) was pruned at Dylan's direction on
 * 2026-07-27 — they live in git history on prototype/frost-ui if ever
 * needed again.
 */

function Gallery({ navigate }) {
  useEffect(() => {
    document.title = "Frost effect lab · Dylan McCavitt";
  }, []);

  return (
    <main className="lab-gallery">
      <p className="lab-kicker">Prototype lab</p>
      <h1>Frost effect lab</h1>
      <p className="lab-lede">
        One prototype: the locked direction. Earlier explorations were
        retired and live in git history.
      </p>
      <h2 className="lab-section">Current direction <span>locked 2026-07-27</span></h2>
      <ol>
        <li>
          <a
            href="/current"
            onClick={(event) => {
              event.preventDefault();
              navigate("/current");
            }}
          >
            <span className="lab-num">{CURRENT.number}</span>
            <div>
              <strong>{CURRENT.name}</strong>
              <span className="lab-note">{CURRENT.instruction}</span>
            </div>
            <small>
              {CURRENT.component} <ArrowUpRight size={12} />
            </small>
          </a>
        </li>
      </ol>
      <h2 className="lab-section">Card reveals <span>how a Work card opens · mist locked, glitch trialing</span></h2>
      <ol>
        {CARD_REVEALS.map((entry) => (
          <li key={entry.slug}>
            <a
              href={`/cardsx/${entry.slug}`}
              onClick={(event) => {
                event.preventDefault();
                navigate(`/cardsx/${entry.slug}`);
              }}
            >
              <span className="lab-num">{entry.number}</span>
              <div>
                <strong>{entry.name}</strong>
                <span className="lab-note">{entry.instruction}</span>
              </div>
              <small>
                {entry.component} <ArrowUpRight size={12} />
              </small>
            </a>
          </li>
        ))}
      </ol>
      <h2 className="lab-section">About reveals <span>how the About prose arrives · exploring</span></h2>
      <ol>
        {ABOUT_REVEALS.map((entry) => (
          <li key={entry.slug}>
            <a
              href={`/aboutx/${entry.slug}`}
              onClick={(event) => {
                event.preventDefault();
                navigate(`/aboutx/${entry.slug}`);
              }}
            >
              <span className="lab-num">{entry.number}</span>
              <div>
                <strong>{entry.name}</strong>
                <span className="lab-note">{entry.instruction}</span>
              </div>
              <small>
                {entry.component} <ArrowUpRight size={12} />
              </small>
            </a>
          </li>
        ))}
      </ol>
      <h2 className="lab-section">Project page looks <span>layouts × effects · exploring</span></h2>
      <ol>
        {PROJECT_LOOKS.map((entry) => (
          <li key={entry.slug}>
            <a
              href={`/project/${entry.slug}`}
              onClick={(event) => {
                event.preventDefault();
                navigate(`/project/${entry.slug}`);
              }}
            >
              <span className="lab-num">{entry.number}</span>
              <div>
                <strong>{entry.name}</strong>
                <span className="lab-note">{entry.instruction}</span>
              </div>
              <small>
                {entry.component} <ArrowUpRight size={12} />
              </small>
            </a>
          </li>
        ))}
      </ol>
    </main>
  );
}

export function App() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function navigate(nextPath) {
    window.history.pushState({}, "", nextPath);
    setPath(nextPath);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  // /current is canonical; the old mist-cards route stays as an alias so
  // recent links keep working.
  if (/^\/(current|popout\/mist-cards)\/?$/.test(path)) {
    return <MistSite navigate={navigate} />;
  }
  const about = path.match(/^\/aboutx\/([a-z-]+)\/?$/);
  if (about && ABOUT_REVEALS.some((entry) => entry.slug === about[1])) {
    return <MistSite aboutVariant={about[1]} navigate={navigate} />;
  }
  const cards = path.match(/^\/cardsx\/([a-z-]+)\/?$/);
  if (cards && CARD_REVEALS.some((entry) => entry.slug === cards[1])) {
    return <MistSite cardVariant={cards[1]} navigate={navigate} />;
  }
  const look = path.match(/^\/project\/([a-z-]+)\/?$/);
  if (look && PROJECT_LOOKS.some((entry) => entry.slug === look[1])) {
    return <ProjectLook slug={look[1]} navigate={navigate} />;
  }
  return <Gallery navigate={navigate} />;
}
