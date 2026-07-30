import { useEffect, useState } from "react";
import { PrototypeGallery, PrototypeRoute, PROTOTYPES } from "./PrototypeRoutes.jsx";
import { SignalRemixRoute } from "./SignalRemixes.jsx";
import { FrostRoute } from "./FrostRoute.jsx";

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

  const prototype = PROTOTYPES.find((item) => item.path === path);

  return prototype ? (
    prototype.slug === "signal-frost" ? (
      <FrostRoute prototype={prototype} navigate={navigate} />
    ) : prototype.remix ? (
      <SignalRemixRoute prototype={prototype} navigate={navigate} />
    ) : (
      <PrototypeRoute prototype={prototype} navigate={navigate} />
    )
  ) : (
    <PrototypeGallery navigate={navigate} />
  );
}
