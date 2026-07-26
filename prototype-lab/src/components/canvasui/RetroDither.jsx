"use client";;
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const DEFAULTS = {
  radius: 0.5,
  softness: 1,
  pixelSize: 2,
  levels: 4,
  darkColor: [0, 0, 0],
  lightColor: [1, 1, 1],
  colorize: 0.1,
  contrast: 0.6,
  brightness: 0,
  strength: 0.75,
  baseStrength: 0,
  invert: 0,
  scanlines: 0,
  followSpeed: 3,
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
uniform vec2 uResolution;
uniform float uPixelSize;
uniform float uLevels;
uniform float uRadius;
uniform float uSoftness;
uniform vec2 uPointer;
uniform float uActive;
uniform vec3 uDark;
uniform vec3 uLight;
uniform float uColorize;
uniform float uContrast;
uniform float uBrightness;
uniform float uStrength;
uniform float uBase;
uniform float uInvert;
uniform float uScanlines;
uniform float uMaxX;

#define S(a, b, t) smoothstep(a, b, t)

float ditherQuant (float v, ivec2 cell) {
  float x = v * uLevels;
  int level = int(floor(fract(x) * 4.0));
  float add = 0.0;
  if (level == 1) {
    if (cell.x % 4 == (2 * cell.y) % 4) add = 1.0;
  } else if (level == 2) {
    if (cell.x % 2 != cell.y % 2) add = 1.0;
  } else if (level == 3) {
    if (cell.x % 4 != (2 * cell.y) % 4) add = 1.0;
  }
  return floor(x + add) / uLevels;
}

float bayer (ivec2 p) {
  int b[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(b[(p.y % 4) * 4 + (p.x % 4)]) + 0.5) / 16.0;
}

void main () {
  vec2 uv = vUv;

  if (uv.x > uMaxX) {
    outColor = vec4(0.0);
    return;
  }

  vec4 content = texture(uContent, vec2(uv.x, 1.0 - uv.y));

  vec2 frag = uv * uResolution;
  vec2 cell = floor(frag / uPixelSize);
  vec2 cellUv = (cell + 0.5) * uPixelSize / uResolution;
  cellUv = clamp(cellUv, vec2(0.001), vec2(uMaxX - 0.002, 0.999));
  vec4 pixel = texture(uContent, vec2(cellUv.x, 1.0 - cellUv.y));

  float lum = dot(pixel.rgb, vec3(0.299, 0.587, 0.114));
  lum = clamp((lum - 0.5) * uContrast + 0.5 + uBrightness, 0.0, 1.0);
  lum = mix(lum, 1.0 - lum, clamp(uInvert, 0.0, 1.0));
  float q = ditherQuant(lum, ivec2(cell));

  vec3 palette = mix(uDark, uLight, q);
  vec3 keepHue = pixel.rgb * (q / max(lum, 0.001));
  vec3 dithered = mix(keepHue, palette, clamp(uColorize, 0.0, 1.0));
  dithered *= 1.0 - uScanlines * 0.45 * mod(cell.y, 2.0);

  float aspect = uResolution.x / uResolution.y;
  float dist = length((uv - uPointer) * vec2(aspect, 1.0));
  float radius = max(uRadius * uActive, 1e-4);
  float inner = radius * (1.0 - clamp(uSoftness, 0.0, 1.0));
  float lens = (1.0 - S(inner, radius, dist)) * uActive;
  float mask = clamp(max(lens, clamp(uBase, 0.0, 1.0)), 0.0, 1.0)
    * clamp(uStrength, 0.0, 1.0);

  float apply = step(bayer(ivec2(cell)), mask);

  vec3 col = mix(content.rgb, dithered, apply);
  float alpha = mix(content.a, pixel.a, apply);
  outColor = vec4(col, alpha);
}`;

export function supportsHtmlInCanvas() {
  if (typeof document === "undefined") return false;
  const probe = document.createElement("canvas");
  const ctx = probe.getContext("2d");
  return Boolean(ctx &&
  typeof ctx.drawElementImage === "function" &&
  typeof probe.requestPaint === "function");
}

export function createRetroDither(elements, options = {}) {
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
      console.error("RetroDither shader error:", gl.getShaderInfoLog(shader));
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

  syncCanvasSize();

  const pointer = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, active: 0, target: 0 };

  function uploadContent() {
    if (!htmlInCanvas || !contentDirty) return;
    contentDirty = false;
    gl.bindTexture(gl.TEXTURE_2D, contentTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  function render() {
    uploadContent();
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, contentTexture);
    gl.uniform1i(uniforms.uContent, 0);
    gl.uniform2f(uniforms.uResolution, output.width, output.height);
    const dpr = output.width / Math.max(output.clientWidth, 1);
    gl.uniform1f(uniforms.uPixelSize, Math.max(config.pixelSize, 1) * dpr);
    gl.uniform1f(uniforms.uLevels, Math.max(config.levels, 1));
    gl.uniform1f(uniforms.uRadius, Math.max(config.radius, 0.01));
    gl.uniform1f(uniforms.uSoftness, config.softness);
    gl.uniform2f(uniforms.uPointer, pointer.x, pointer.y);
    gl.uniform1f(uniforms.uActive, pointer.active);
    gl.uniform3f(
      uniforms.uDark,
      config.darkColor[0],
      config.darkColor[1],
      config.darkColor[2]
    );
    gl.uniform3f(
      uniforms.uLight,
      config.lightColor[0],
      config.lightColor[1],
      config.lightColor[2]
    );
    gl.uniform1f(uniforms.uColorize, config.colorize);
    gl.uniform1f(uniforms.uContrast, Math.max(config.contrast, 0));
    gl.uniform1f(uniforms.uBrightness, config.brightness);
    gl.uniform1f(uniforms.uStrength, config.strength);
    gl.uniform1f(uniforms.uBase, config.baseStrength);
    gl.uniform1f(uniforms.uInvert, config.invert);
    gl.uniform1f(uniforms.uScanlines, config.scanlines);
    gl.uniform1f(uniforms.uMaxX, contentMaxX);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, output.width, output.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  let raf = 0;
  let lastTime = performance.now();
  let destroyed = false;
  let running = false;
  let visible = true;

  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reducedMotion = motionQuery.matches;

  function frame(now) {
    if (destroyed) return;
    if (!visible) {
      running = false;
      return;
    }
    const delta = Math.min((now - lastTime) / 1000, 1 / 30);
    lastTime = now;
    const ease = reducedMotion
      ? 1
      : 1 - Math.exp(-delta * Math.max(config.followSpeed, 0.5));
    pointer.x += (pointer.tx - pointer.x) * ease;
    pointer.y += (pointer.ty - pointer.y) * ease;
    pointer.active += (pointer.target - pointer.active) * ease;
    render();
    const settled =
      Math.abs(pointer.tx - pointer.x) < 5e-4 &&
      Math.abs(pointer.ty - pointer.y) < 5e-4 &&
      Math.abs(pointer.target - pointer.active) < 1e-3;
    if (settled && !contentDirty) {
      pointer.x = pointer.tx;
      pointer.y = pointer.ty;
      pointer.active = pointer.target;
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
    pointer.tx = (event.clientX - rect.left) / Math.max(rect.width, 1);
    pointer.ty = 1 - (event.clientY - rect.top) / Math.max(rect.height, 1);
    pointer.target = 1;
    start();
  }

  function onPointerLeave() {
    pointer.target = 0;
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

export function RetroDither({
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
    const source = sourceRef.current;
    const content = contentRef.current;
    const output = outputRef.current;
    if (!source || !content || !output) return;
    instanceRef.current = createRetroDither({ source, content, output }, initialOptions);
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
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }} />
    </div>
  );
}


export default RetroDither;
