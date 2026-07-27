import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { CARDS, CurrentFrost, EFFECTS, ENTERS, FX, PLAYS, POPOUTS } from "./frost/CurrentFrost.jsx";
import "./frost/lab.css";

function GallerySection({ title, note, base, entries, navigate }) {
  return (
    <>
      <h2 className="lab-section">{title} <span>{note}</span></h2>
      <ol>
        {entries.map((entry) => (
          <li key={entry.slug}>
            <a
              href={`${base}/${entry.slug}`}
              onClick={(event) => {
                event.preventDefault();
                navigate(`${base}/${entry.slug}`);
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
    </>
  );
}

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
        that is live — with a different canvas effect or interaction over
        it. The layout is not a variable; only the surface changes.
      </p>
      <GallerySection title="Homepage surface" note="selected: 01 Fracture" base="/frost" entries={EFFECTS} navigate={navigate} />
      <GallerySection title="Project popouts" note="selected: 02 Break open" base="/popout" entries={POPOUTS} navigate={navigate} />
      <GallerySection title="Popout card" note="what the card is · exploring" base="/card" entries={CARDS} navigate={navigate} />
      <GallerySection title="Into the page" note="expanding a project to its page · exploring" base="/enter" entries={ENTERS} navigate={navigate} />
      <GallerySection title="UI × effects" note="other surfaces reacting to the visitor · exploring" base="/fx" entries={FX} navigate={navigate} />
      <GallerySection title="Fracture as UI" note="giving the crack a job · exploring" base="/play" entries={PLAYS} navigate={navigate} />
    </main>
  );
}

const ROUTES = [
  { prefix: "frost", entries: EFFECTS, props: (slug) => ({ effect: slug }) },
  { prefix: "popout", entries: POPOUTS, props: (slug) => ({ effect: "fracture", popout: slug }) },
  { prefix: "play", entries: PLAYS, props: (slug) => ({ effect: "fracture", play: slug }) },
  { prefix: "fx", entries: FX, props: (slug) => ({ fx: slug }) },
  { prefix: "card", entries: CARDS, props: (slug) => ({ effect: "fracture", card: slug }) },
  { prefix: "enter", entries: ENTERS, props: (slug) => ({ effect: "fracture", enter: slug }) },
];

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

  for (const route of ROUTES) {
    const match = path.match(new RegExp(`^\\/${route.prefix}\\/([a-z-]+)\\/?$`));
    const entry = match && route.entries.find((candidate) => candidate.slug === match[1]);
    if (entry) return <CurrentFrost {...route.props(entry.slug)} navigate={navigate} />;
  }
  return <Gallery navigate={navigate} />;
}
