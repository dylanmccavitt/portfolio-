import { useEffect, useRef } from "react";

/**
 * Feed content-sampling canvas engines (the card glitch) in browsers
 * without drawElementImage. The engine probes its source canvas for
 * `getContext("2d").drawElementImage` and `requestPaint`; both are
 * shimmed here so the engine takes its native path, and
 * "drawElementImage" blits a rasterized SVG-foreignObject snapshot of the
 * content instead. TEXT CONTENT ONLY — external <img> elements don't
 * survive foreignObject rasterization. WebKit needs the retina scale as
 * an inner `transform: scale(n)`, never SVG viewBox scaling.
 */

function collectCss() {
  let css = "";
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) css += rule.cssText + "\n";
    } catch {}
  }
  return css;
}

async function inlineFonts(css) {
  const matches = [...css.matchAll(/url\((?:"|')?([^)"']+\.woff2?[^)"']*)(?:"|')?\)/g)];
  const urls = [...new Set(matches.map((m) => m[1]))];
  await Promise.all(urls.map(async (u) => {
    try {
      const abs = new URL(u, document.baseURI);
      if (abs.origin !== location.origin) return;
      const buf = await (await fetch(abs.href)).arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      css = css.split(u).join(`data:font/woff2;base64,${btoa(bin)}`);
    } catch {}
  }));
  return css;
}

let cssPromise = null;
function snapshotCss() {
  cssPromise ??= inlineFonts(collectCss());
  return cssPromise;
}

async function rasterize(content) {
  const w = Math.max(content.clientWidth, 1);
  const h = Math.max(content.scrollHeight, 1);
  const css = await snapshotCss();
  const xml = new XMLSerializer().serializeToString(content);
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}">` +
    `<foreignObject width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="transform:scale(${scale});transform-origin:top left;width:${w}px;height:${h}px">` +
    `<style>${css.replace(/</g, "\\3c ")}</style>` +
    `<main class="frost" style="margin:0">${xml}</main>` +
    `</div></foreignObject></svg>`;
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
  return img;
}

export function SnapshotFx({ create, options, className, style, children }) {
  const contentRef = useRef(null);
  const sourceRef = useRef(null);
  const outputRef = useRef(null);

  useEffect(() => {
    const content = contentRef.current;
    const source = sourceRef.current;
    const output = outputRef.current;
    if (!content || !source || !output) return;
    let dead = false;
    let img = null;
    let instance = null;
    let rebuildTimer = 0;

    const ctx = source.getContext("2d");
    ctx.drawElementImage = () => {
      if (img) ctx.drawImage(img, 0, 0, source.width, source.height);
    };
    source.requestPaint = () => {
      if (source.onpaint) source.onpaint();
    };

    const build = async () => {
      try {
        const next = await rasterize(content);
        if (dead) return;
        img = next;
        source.requestPaint();
      } catch (error) {
        console.warn("SnapshotFx rasterize failed:", error);
      }
    };

    instance = create({ source, content, output }, options);
    build();

    const ro = new ResizeObserver(() => {
      clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(build, 300);
    });
    ro.observe(content);

    return () => {
      dead = true;
      clearTimeout(rebuildTimer);
      ro.disconnect();
      instance?.destroy?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={className} style={{ position: "relative", ...style }}>
      <div ref={contentRef}>{children}</div>
      <canvas
        ref={sourceRef}
        aria-hidden
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", visibility: "hidden" }}
      />
      <canvas
        ref={outputRef}
        aria-hidden
        className="snapfx-out"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      />
    </div>
  );
}
