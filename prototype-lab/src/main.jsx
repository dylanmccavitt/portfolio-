import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource/ibm-plex-mono/400.css";
import { App } from "./App.jsx";
import "./prototype-routes.css";
import "./signal-remixes.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
