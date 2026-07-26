import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { CurrentFrost, EFFECTS } from "./frost/CurrentFrost.jsx";
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

  const match = path.match(/^\/frost\/([a-z-]+)\/?$/);
  const effect = match && EFFECTS.find((entry) => entry.slug === match[1]);

  return effect ? (
    <CurrentFrost effect={effect.slug} navigate={navigate} />
  ) : (
    <Gallery navigate={navigate} />
  );
}
