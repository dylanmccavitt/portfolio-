import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { CurrentFrost, EFFECTS, PLAYS, POPOUTS } from "./frost/CurrentFrost.jsx";
import "./frost/lab.css";

function Gallery({ navigate }) {
  useEffect(() => {
    document.title = "Frost effect lab · Dylan McCavitt";
  }, []);

  return (
    <main className="lab-gallery">
      <p className="lab-kicker">Prototype lab · one layout, many surfaces</p>
      <h1>Frost effect lab</h1>
      <p className="lab-lede">
        Every prototype below is the current Frost site layout — the one
        that is live — with a different canvas effect over it. The layout is
        not a variable; only the surface changes.
      </p>
      <h2 className="lab-section">Homepage surface <span>selected: 01 Fracture</span></h2>
      <ol>
        {EFFECTS.map((effect) => (
          <li key={effect.slug}>
            <a
              href={`/frost/${effect.slug}`}
              onClick={(event) => {
                event.preventDefault();
                navigate(`/frost/${effect.slug}`);
              }}
            >
              <span className="lab-num">{effect.number}</span>
              <div>
                <strong>{effect.name}</strong>
                <span className="lab-note">{effect.instruction}</span>
              </div>
              <small>
                {effect.component} <ArrowUpRight size={12} />
              </small>
            </a>
          </li>
        ))}
      </ol>

      <h2 className="lab-section">Project popouts <span>on the fracture surface · deciding</span></h2>
      <ol>
        {POPOUTS.map((variant) => (
          <li key={variant.slug}>
            <a
              href={`/popout/${variant.slug}`}
              onClick={(event) => {
                event.preventDefault();
                navigate(`/popout/${variant.slug}`);
              }}
            >
              <span className="lab-num">{variant.number}</span>
              <div>
                <strong>{variant.name}</strong>
                <span className="lab-note">{variant.instruction}</span>
              </div>
              <small>
                {variant.component} <ArrowUpRight size={12} />
              </small>
            </a>
          </li>
        ))}
      </ol>

      <h2 className="lab-section">Fracture as UI <span>giving the crack a job · exploring</span></h2>
      <ol>
        {PLAYS.map((variant) => (
          <li key={variant.slug}>
            <a
              href={`/play/${variant.slug}`}
              onClick={(event) => {
                event.preventDefault();
                navigate(`/play/${variant.slug}`);
              }}
            >
              <span className="lab-num">{variant.number}</span>
              <div>
                <strong>{variant.name}</strong>
                <span className="lab-note">{variant.instruction}</span>
              </div>
              <small>
                {variant.component} <ArrowUpRight size={12} />
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

  const effectMatch = path.match(/^\/frost\/([a-z-]+)\/?$/);
  const effect = effectMatch && EFFECTS.find((entry) => entry.slug === effectMatch[1]);
  const popoutMatch = path.match(/^\/popout\/([a-z-]+)\/?$/);
  const popoutVariant = popoutMatch && POPOUTS.find((entry) => entry.slug === popoutMatch[1]);
  const playMatch = path.match(/^\/play\/([a-z-]+)\/?$/);
  const playVariant = playMatch && PLAYS.find((entry) => entry.slug === playMatch[1]);

  if (popoutVariant) {
    return <CurrentFrost effect="fracture" popout={popoutVariant.slug} navigate={navigate} />;
  }
  if (playVariant) {
    return <CurrentFrost effect="fracture" play={playVariant.slug} navigate={navigate} />;
  }
  return effect ? (
    <CurrentFrost effect={effect.slug} navigate={navigate} />
  ) : (
    <Gallery navigate={navigate} />
  );
}
