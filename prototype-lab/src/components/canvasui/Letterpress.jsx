"use client";;
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const DEFAULTS = {
  depth: 0.12,
  spread: 1.4,
  grain: 0.04,
  follow: 0.35,
  threshold: 0.1,
  background: "#000000",
  smoothing: 0.4,
};

const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main () {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uContent;
uniform vec2 uRes;
uniform vec2 uLight;
uniform float uDepth;
uniform float uSpread;
uniform float uGrain;
uniform float uThreshold;
uniform vec3 uBg;
uniform float uMaxX;
uniform float uCrisp;

float hash (vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec4 samp (vec2 p) {
  vec2 uv = p / uRes;
  uv = clamp(uv, vec2(0.001), vec2(uMaxX - 0.001, 0.999));
  return texture(uContent, uv);
}

float ink (vec2 p, float g0, float g1, vec3 lw) {
  return smoothstep(g0, g1, dot(abs(samp(p).rgb - uBg), lw));
}

void main () {
  vec2 pc = vec2(vUv.x, 1.0 - vUv.y) * uRes;
  if (pc.x > uMaxX * uRes.x) {
    outColor = vec4(0.0);
    return;
  }
  vec4 base = samp(pc);
  if (uCrisp > 0.5) {
    outColor = base;
    return;
  }

  float g0 = uThreshold * 0.6;
  float g1 = uThreshold * 1.6 + 0.01;
  vec3 lw = vec3(0.299, 0.587, 0.114);

  vec2 L = normalize(uLight) * max(uSpread, 0.5);
  float toward = ink(pc + L, g0, g1, lw);
  float away = ink(pc - L, g0, g1, lw);
  float rel = toward - away;

  vec3 col = base.rgb + rel * uDepth;

  float iC = ink(pc, g0, g1, lw);
  float halo = max(0.0, away - iC);
  col -= halo * uDepth * 0.35;

  float n = hash(floor(gl_FragCoord.xy / 2.0));
  col += (n - 0.5) * uGrain;

  outColor = vec4(col, base.a);
}`;

let colorProbe = null;

function parseColor(input) {
  if (typeof document === "undefined") return [0, 0, 0];
  if (!colorProbe) {
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    colorProbe = probe.getContext("2d", { willReadFrequently: true });
  }
  if (!colorProbe) return [0, 0, 0];
  colorProbe.fillStyle = "#000000";
  colorProbe.fillStyle = input;
  colorProbe.clearRect(0, 0, 1, 1);
  colorProbe.fillRect(0, 0, 1, 1);
  const data = colorProbe.getImageData(0, 0, 1, 1).data;
  return [data[0] / 255, data[1] / 255, data[2] / 255];
}

export function supportsHtmlInCanvas() {
  if (typeof document === "undefined") return false;
  const probe = document.createElement("canvas");
  const ctx = probe.getContext("2d");
  return Boolean(ctx &&
  typeof ctx.drawElementImage === "function" &&
  typeof probe.requestPaint === "function");
}

export function createLetterpress(elements, options = {}) {
  const config = { ...DEFAULTS, ...options };
  const { source, content, output } = elements;

  const gl = output.getContext("webgl2", {
    alpha: true,
    depth: false,
    stencil: false,
    antialias: false,
    premultipliedAlpha: false,
  });
  if (!gl || gl.isContextLost()) return null;

  const sourceCtx = source.getContext("2d");
  const paintable = source;
  const htmlInCanvas = Boolean(sourceCtx &&
  typeof sourceCtx.drawElementImage === "function" &&
  typeof paintable.requestPaint === "function");

  let contentDirty = false;
  let wake = () => {};

  if (htmlInCanvas) {
    paintable.onpaint = () => {
      try {
        sourceCtx.reset();
        sourceCtx.drawElementImage(content, 0, 0);
        contentDirty = true;
        wake();
      } catch {}
    };
  }

  function compile(type, text) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, text);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("Letterpress shader error:", gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  const vertexShader = compile(gl.VERTEX_SHADER, VERT);
  const fragmentShader = compile(gl.FRAGMENT_SHADER, FRAG);
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  const uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    uniforms[info.name] = gl.getUniformLocation(program, info.name);
  }

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const contentTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, contentTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 0])
  );

  let contentMaxX = 1;

  function syncCanvasSize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(output.clientWidth * dpr));
    const height = Math.max(1, Math.round(output.clientHeight * dpr));
    if (output.width !== width || output.height !== height) {
      output.width = width;
      output.height = height;
    }
    contentMaxX = Math.min(1, Math.max(0.05, content.clientWidth / Math.max(output.clientWidth, 1)));
    if (htmlInCanvas) {
      const cssWidth = Math.max(1, Math.round(source.clientWidth));
      const cssHeight = Math.max(1, Math.round(source.clientHeight));
      if (source.width !== cssWidth || source.height !== cssHeight) {
        source.width = cssWidth;
        source.height = cssHeight;
      }
      paintable.requestPaint();
    }
  }

  const DEFAULT_LIGHT = { x: -0.6, y: -0.8 };
  const light = { x: DEFAULT_LIGHT.x, y: DEFAULT_LIGHT.y, tx: DEFAULT_LIGHT.x, ty: DEFAULT_LIGHT.y };
  let bgKey = "";
  let bg = [0, 0, 0];

  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reducedMotion = motionQuery.matches;

  syncCanvasSize();

  function uploadContent() {
    if (!htmlInCanvas || !contentDirty) return;
    contentDirty = false;
    gl.bindTexture(gl.TEXTURE_2D, contentTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  function render() {
    uploadContent();
    const w = Math.max(output.clientWidth, 1);
    const h = Math.max(output.clientHeight, 1);
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, contentTexture);
    gl.uniform1i(uniforms.uContent, 0);
    gl.uniform2f(uniforms.uRes, w, h);
    gl.uniform2f(uniforms.uLight, light.x, light.y);
    gl.uniform1f(uniforms.uDepth, Math.max(config.depth, 0));
    gl.uniform1f(uniforms.uSpread, Math.max(config.spread, 0.5));
    gl.uniform1f(uniforms.uGrain, Math.max(config.grain, 0));
    gl.uniform1f(uniforms.uThreshold, Math.max(config.threshold, 0));
    if (config.background !== bgKey) {
      bgKey = config.background;
      bg = parseColor(config.background);
    }
    gl.uniform3f(uniforms.uBg, bg[0], bg[1], bg[2]);
    gl.uniform1f(uniforms.uMaxX, contentMaxX);
    gl.uniform1f(uniforms.uCrisp, reducedMotion || !htmlInCanvas ? 1 : 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, output.width, output.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  let raf = 0;
  let lastTime = performance.now();
  let destroyed = false;
  let running = false;
  let visible = true;

  function frame(now) {
    if (destroyed) return;
    if (!visible) {
      running = false;
      return;
    }
    const delta = Math.min((now - lastTime) / 1000, 1 / 30);
    lastTime = now;
    const tau = Math.max(config.smoothing, 1e-4);
    const k = reducedMotion ? 1 : 1 - Math.exp(-delta / tau);
    light.x += (light.tx - light.x) * k;
    light.y += (light.ty - light.y) * k;
    render();
    const settled =
      Math.abs(light.tx - light.x) < 0.002 &&
      Math.abs(light.ty - light.y) < 0.002;
    if (settled && !contentDirty) {
      light.x = light.tx;
      light.y = light.ty;
      running = false;
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (destroyed || running || !visible) return;
    running = true;
    lastTime = performance.now();
    raf = requestAnimationFrame(frame);
  }

  wake = start;
  start();

  function onMotionChange() {
    reducedMotion = motionQuery.matches;
    start();
  }
  motionQuery.addEventListener("change", onMotionChange);

  const observer = new ResizeObserver(() => {
    syncCanvasSize();
    start();
  });
  observer.observe(output);
  observer.observe(content);

  const intersection = new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1]?.isIntersecting ?? true;
    if (visible) start();
  });
  intersection.observe(output);

  const listenTarget = output.parentElement ?? output;

  function onPointerMove(event) {
    const rect = output.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const follow = Math.max(0, Math.min(1, config.follow));
    const dx = (event.clientX - cx) / Math.max(rect.width / 2, 1);
    const dy = (event.clientY - cy) / Math.max(rect.height / 2, 1);
    light.tx = DEFAULT_LIGHT.x * (1 - follow) + dx * follow * -1;
    light.ty = DEFAULT_LIGHT.y * (1 - follow) + dy * follow * -1;
    const len = Math.hypot(light.tx, light.ty) || 1;
    light.tx /= len;
    light.ty /= len;
    start();
  }

  function onPointerLeave() {
    light.tx = DEFAULT_LIGHT.x;
    light.ty = DEFAULT_LIGHT.y;
    start();
  }

  listenTarget.addEventListener("pointermove", onPointerMove);
  listenTarget.addEventListener("pointerleave", onPointerLeave);

  return {
    setOptions(next) {
      Object.assign(config, next);
      start();
    },
    resize() {
      syncCanvasSize();
      start();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      intersection.disconnect();
      motionQuery.removeEventListener("change", onMotionChange);
      listenTarget.removeEventListener("pointermove", onPointerMove);
      listenTarget.removeEventListener("pointerleave", onPointerLeave);
      gl.deleteTexture(contentTexture);
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      gl.deleteBuffer(quad);
      if (htmlInCanvas) paintable.onpaint = null;
    },
  };
}

const emptySubscribe = () => () => {};

export function Letterpress({
  children,
  className,
  style,
  ...options
}) {
  const sourceRef = useRef(null);
  const contentRef = useRef(null);
  const outputRef = useRef(null);
  const instanceRef = useRef(null);
  const [initialOptions] = useState(options);
  const [failed, setFailed] = useState(false);

  const supported = useSyncExternalStore(emptySubscribe, supportsHtmlInCanvas, () => false);
  const native = supported && !failed;

  useEffect(() => {
    if (!native) return;
    const source = sourceRef.current;
    const content = contentRef.current;
    const output = outputRef.current;
    if (!source || !content || !output) return;
    instanceRef.current = createLetterpress({ source, content, output }, initialOptions);
    if (native && !instanceRef.current) setFailed(true);
    return () => {
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, [initialOptions, native]);

  useEffect(() => {
    instanceRef.current?.setOptions(options);
  });

  return (
    <div className={className} style={{ position: "relative", ...style }}>
      <canvas
        ref={sourceRef}
        // @ts-expect-error experimental html-in-canvas attribute
        layoutsubtree="true"
        suppressHydrationWarning
        style={
          native
            ? { position: "absolute", inset: 0, width: "100%", height: "100%" }
            : { display: "none" }
        }>
        {native ? (
          <div
            ref={contentRef}
            style={{
              position: "relative",
              width: "100%",
              height: "100%",
              overflow: "auto",
            }}>
            {children}
          </div>
        ) : null}
      </canvas>
      {!native ? (
        <div
          ref={contentRef}
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            overflow: "auto",
          }}>
          {children}
        </div>
      ) : null}
      <canvas
        ref={outputRef}
        aria-hidden
        style={{
          ...(native
            ? {
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                pointerEvents: "none",
              }
            : { display: "none" }),
        }} />
    </div>
  );
}


export default Letterpress;
