"use client";;
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const DEFAULTS = {
  radius: 0.4,
  softness: 0.6,
  tileSize: 125,
  shards: 1,
  corner: 0,
  lift: 30,
  tilt: 2,
  scatter: 5,
  perspective: 1500,
  gapColor: [0, 0, 0],
  shadow: 0.5,
  shading: 0.5,
  refraction: 1.5,
  dispersion: 0.3,
  floatSpeed: 2,
  strength: 1,
  baseStrength: 0,
  followSpeed: 3,
  invert: false,
  persist: false,
  regrow: 0,
  snapshot: false,
  forceSnapshot: false,
};

const TIME_WRAP = Math.PI * 800;

const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
void main () {
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uContent;
uniform vec2 uResolution;
uniform vec2 uPointer;
uniform float uActive;
uniform float uRadius;
uniform float uSoftness;
uniform float uStrength;
uniform float uBase;
uniform float uInvert;
uniform sampler2D uHealTex;
uniform vec2 uHealSize;
uniform float uHealOff;
uniform float uPersist;
uniform float uTile;
uniform float uShards;
uniform float uCorner;
uniform float uLift;
uniform float uTilt;
uniform float uScatter;
uniform float uPersp;
uniform vec3 uGap;
uniform float uShadow;
uniform float uShading;
uniform float uRefract;
uniform float uDispersion;
uniform float uTime;
uniform float uMaxX;
uniform vec2 uScroll;
out vec4 outColor;

const float TAU = 6.28318530718;
const vec2 LIGHT = vec2(-0.514495755, 0.857492926);

vec2 hash22 (vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}

float smin (float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float shardD (vec2 q, vec2 cell, float k) {
  float jit = uTile * 0.8 * clamp(uShards, 0.0, 1.0);
  vec2 s0 = (hash22(cell) - 0.5) * jit;
  float d = uTile;
  for (int i = 0; i < 9; i++) {
    if (i == 4) continue;
    vec2 g = vec2(float(i % 3 - 1), float(i / 3 - 1));
    vec2 sn = g * uTile + (hash22(cell + g) - 0.5) * jit;
    vec2 diff = sn - s0;
    float e = -dot(q - s0 - diff * 0.5, normalize(diff));
    d = smin(d, e, k);
  }
  return d;
}

vec3 pick (vec2 uv) {
  vec2 c = vec2(
    clamp(uv.x, 0.0005, uMaxX - 0.0005),
    clamp(uv.y, 0.0005, 0.9995));
  return texture(uContent, vec2(c.x, 1.0 - c.y)).rgb;
}

float cellAct (vec2 cell, out vec2 sxy) {
  sxy = hash22(cell + 13.13);
  vec2 center = (cell + 0.5) * uTile;
  float aspect = uResolution.x / uResolution.y;
  vec2 cuv = (center - vec2(uScroll.x, -uScroll.y)) / uResolution;
  vec2 dv = vec2((cuv.x - uPointer.x) * aspect, cuv.y - uPointer.y);
  float radius = max(uRadius * uActive, 1e-4);
  float inner = radius * (1.0 - clamp(uSoftness, 0.0, 1.0));
  float lens = (1.0 - smoothstep(inner, radius, length(dv))) * uActive;
  float healed = 0.0;
  if (uPersist > 0.5) {
    healed = texture(uHealTex, vec2(
      (cell.x + 0.5) / uHealSize.x,
      (cell.y + uHealOff + 0.5) / uHealSize.y)).r;
  }
  float open = max(lens, healed);
  float baseAmt = clamp(uBase, 0.0, 1.0);
  float mask = mix(
    clamp(max(open, baseAmt), 0.0, 1.0),
    baseAmt * (1.0 - open),
    step(0.5, uInvert)) * clamp(uStrength, 0.0, 1.0);
  float th = sxy.x * 0.6;
  return smoothstep(th, th + 0.4, mask);
}

void cellDyn (
  vec2 cell,
  vec2 sxy,
  float act,
  out mat3 R,
  out float lift,
  out vec2 anchor,
  out float k
) {
  vec2 center = (cell + 0.5) * uTile;
  vec4 seed = vec4(sxy, hash22(cell + 27.7));

  float wob = sin(uTime + seed.z * TAU);
  float maxT = 0.2 * clamp(uTilt, 0.0, 3.0) * act;
  float rx = (seed.y - 0.5) * 2.0 * maxT
    * (0.75 + 0.25 * wob);
  float ry = (seed.z - 0.5) * 2.0 * maxT
    * (0.75 + 0.25 * cos(uTime * 0.7 + seed.w * TAU));
  float rz = (seed.w - 0.5) * 1.2 * maxT * (0.85 + 0.15 * wob);
  float cx = cos(rx); float sx = sin(rx);
  float cy = cos(ry); float sy = sin(ry);
  float cz = cos(rz); float sz = sin(rz);
  R = mat3(cz, sz, 0.0, -sz, cz, 0.0, 0.0, 0.0, 1.0)
    * mat3(cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy)
    * mat3(1.0, 0.0, 0.0, 0.0, cx, sx, 0.0, -sx, cx);

  lift = uLift * act * (0.72 + 0.36 * seed.y)
    * (0.86 + 0.14 * sin(uTime * 0.9 + seed.w * TAU));
  vec2 shift = (seed.zw - 0.5) * 2.0 * uScatter * act * (0.85 + 0.15 * wob);
  anchor = center + shift;
  k = max(min(uCorner * act, uTile * 0.45), 1e-2);
}

bool invMap (
  vec2 P,
  mat3 R,
  float lift,
  vec2 anchor,
  out vec2 q
) {
  vec2 w = P - anchor;
  float m11 = uPersp * R[0][0] + w.x * R[0][2];
  float m12 = uPersp * R[1][0] + w.x * R[1][2];
  float m21 = uPersp * R[0][1] + w.y * R[0][2];
  float m22 = uPersp * R[1][1] + w.y * R[1][2];
  float det = m11 * m22 - m12 * m21;
  if (abs(det) < 1e-4) return false;
  vec2 b = w * (uPersp - lift);
  q = vec2(m22 * b.x - m12 * b.y, m11 * b.y - m21 * b.x) / det;
  return true;
}

void main () {
  vec2 P = gl_FragCoord.xy;
  vec2 Pc = P + vec2(uScroll.x, -uScroll.y);
  vec2 uvR = P / uResolution;

  float aspect = uResolution.x / uResolution.y;
  float radius = max(uRadius * uActive, 1e-4);
  vec2 duv = vec2((uvR.x - uPointer.x) * aspect, uvR.y - uPointer.y);
  float slack = 3.0 * uTile / uResolution.y;
  float inner = radius * (1.0 - clamp(uSoftness, 0.0, 1.0));
  float lensB = (1.0
    - smoothstep(inner, radius, max(length(duv) - slack, 0.0))) * uActive;
  float maskB = mix(
    max(lensB, clamp(uBase, 0.0, 1.0)),
    clamp(uBase, 0.0, 1.0),
    step(0.5, uInvert)) * clamp(uStrength, 0.0, 1.0);
  if (maskB < 1e-4) {
    outColor = vec4(0.0);
    return;
  }

  vec2 cuvR = vec2(
    clamp(uvR.x, 0.0005, uMaxX - 0.0005),
    clamp(uvR.y, 0.0005, 0.9995));
  vec4 tex = texture(uContent, vec2(cuvR.x, 1.0 - cuvR.y));
  float guard = step(uvR.x, uMaxX) * tex.a;
  if (guard < 1e-4) {
    outColor = vec4(0.0);
    return;
  }

  vec2 baseCell = floor(Pc / uTile);
  float act; mat3 R; float lift; vec2 anchor; float k;
  vec2 sxy; vec2 q;

  float shadowGain = clamp(uShadow, 0.0, 2.0) * 0.5;
  float shadowA = 0.0;
  float shadowZ = 0.0;
  vec2 shadowCell = vec2(1e6);

  float sumA = 0.0;
  float maxAct = 0.0;
  float k1 = -1e9; float a1 = 0.0; vec3 c1 = vec3(0.0);
  vec2 cell1 = vec2(1e6);
  float k2 = -1e9; float a2 = 0.0; vec3 c2 = vec3(0.0);
  vec2 cell2 = vec2(1e6);

  float restReach = uTile * 0.95 + 3.0;
  float reach = uTile * 1.8 + uScatter + uLift * 0.4;
  float rr = max(reach, uTile + uScatter + uLift);

  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 cell = baseCell + vec2(float(i), float(j));
      vec2 center = (cell + 0.5) * uTile;
      vec2 cp = center - Pc;
      float cd = dot(cp, cp);
      if (cd > rr * rr) continue;
      act = cellAct(cell, sxy);
      maxAct = max(maxAct, act);

      if (act < 1e-3) {
        if (cd > restReach * restReach) continue;
        float d = shardD(Pc - center, cell, 1e-2);
        float a = 1.0 - smoothstep(-1.5, 1.5, -d);
        if (a < 0.003) continue;
        sumA += a;
        if (0.0 > k1) {
          k2 = k1; a2 = a1; c2 = c1; cell2 = cell1;
          k1 = 0.0; a1 = a; c1 = tex.rgb; cell1 = cell;
        } else if (0.0 > k2) {
          k2 = 0.0; a2 = a; c2 = tex.rgb; cell2 = cell;
        }
        continue;
      }

      cellDyn(cell, sxy, act, R, lift, anchor, k);

      if (shadowGain > 1e-3 && lift > 0.5) {
        vec2 qs = Pc + LIGHT * lift * 0.5 - anchor;
        float blur = max(lift * 0.4, 1.0);
        float srad = uTile * 0.95 + blur;
        if (dot(qs, qs) < srad * srad) {
          float sA = 1.0 - smoothstep(-blur, blur, -shardD(qs, cell, k));
          sA *= shadowGain * act * act;
          if (sA > shadowA) {
            shadowA = sA;
            shadowZ = lift;
            shadowCell = cell;
          }
        }
      }

      if (cd > reach * reach) continue;
      if (!invMap(Pc, R, lift, anchor, q)) continue;
      float d = shardD(q, cell, k);
      float a = 1.0 - smoothstep(-1.5, 1.5, -d);
      if (a < 0.003) continue;
      vec2 uvS = (center + q - vec2(uScroll.x, -uScroll.y)) / uResolution;
      vec3 n = R * vec3(0.0, 0.0, 1.0);
      float rA = uRefract * act * act;
      vec3 col;
      if (rA < 1e-3) {
        col = pick(uvS);
      } else {
        vec2 refr = -n.xy * (rA * uTile * 0.25) / uResolution;
        float spread = uDispersion * 0.6;
        if (spread < 1e-3) {
          col = pick(uvS + refr);
        } else {
          col = vec3(
            pick(uvS + refr * (1.0 + spread)).r,
            pick(uvS + refr).g,
            pick(uvS + refr * (1.0 - spread)).b);
        }
      }
      col *= clamp(
        1.0 + clamp(uShading, 0.0, 2.0) * act * dot(n.xy, LIGHT) * 0.6,
        0.0, 2.0);
      sumA += a;
      if (lift > k1) {
        k2 = k1; a2 = a1; c2 = c1; cell2 = cell1;
        k1 = lift; a1 = a; c1 = col; cell1 = cell;
      } else if (lift > k2) {
        k2 = lift; a2 = a; c2 = col; cell2 = cell;
      }
    }
  }

  if (maxAct < 1e-3 && shadowA < 1e-3) {
    outColor = vec4(0.0);
    return;
  }

  if (shadowA > 1e-3) {
    if (any(notEqual(cell1, shadowCell))) {
      c1 *= 1.0 - shadowA * clamp((shadowZ - k1) / (uTile * 0.2), 0.0, 1.0);
    }
    if (any(notEqual(cell2, shadowCell))) {
      c2 *= 1.0 - shadowA * clamp((shadowZ - k2) / (uTile * 0.2), 0.0, 1.0);
    }
  }

  float cover = clamp(sumA, 0.0, 1.0);
  float sep = max(uLift * 0.25, 2.0);
  float f = clamp((k1 - k2) / sep, 0.0, 1.0);
  float w1 = a1 * (0.5 + 0.5 * f);
  float w2 = a2 * (1.0 - w1);
  float layered = w1 + w2;
  vec3 shardCol = layered > 1e-6
    ? (c1 * w1 + c2 * w2) / layered
    : uGap;
  float bgRecv = shadowA * clamp(shadowZ / (uTile * 0.2), 0.0, 1.0);
  vec3 bg = uGap * (1.0 - bgRecv);
  outColor = vec4(mix(bg, shardCol, cover), guard);
}`;

export function supportsHtmlInCanvas() {
  if (typeof document === "undefined") return false;
  const probe = document.createElement("canvas");
  const ctx = probe.getContext("2d");
  return Boolean(ctx &&
  typeof ctx.drawElementImage === "function" &&
  typeof probe.requestPaint === "function");
}

export function createShatter(elements, options = {}) {
  const config = { ...DEFAULTS, ...options };
  const { source, content, output } = elements;

  const gl = output.getContext("webgl2", {
    alpha: true,
    depth: false,
    stencil: false,
    antialias: true,
    premultipliedAlpha: false,
  });
  if (!gl || gl.isContextLost()) return null;

  const sourceCtx = source.getContext("2d");
  const paintable = source;
  const htmlInCanvas = !config.forceSnapshot && Boolean(sourceCtx &&
  typeof sourceCtx.drawElementImage === "function" &&
  typeof paintable.requestPaint === "function");

  let contentDirty = false;
  let wake = () => {};

  const wantSnapshot = Boolean(config.snapshot) && !htmlInCanvas;
  let snapImg = null;
  let snapScale = 1;
  let snapBuilding = false;
  let snapQueued = false;
  let lastBlitY = -1;
  let rebuildTimer = 0;
  const snapCanvas = document.createElement("canvas");
  const snapCtx = snapCanvas.getContext("2d");

  function getScrollX() {
    return wantSnapshot ? (window.scrollX || 0) : content.scrollLeft;
  }

  function getScrollY() {
    return wantSnapshot ? (window.scrollY || 0) : content.scrollTop;
  }

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

  async function buildSnapshot() {
    if (!wantSnapshot) return;
    if (snapBuilding) {
      snapQueued = true;
      return;
    }
    snapBuilding = true;
    try {
      const w = Math.max(content.clientWidth, 1);
      const h = Math.max(content.scrollHeight, 1);
      const css = await inlineFonts(collectCss());
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
      snapImg = img;
      snapScale = scale;
      lastBlitY = -1;
      if (typeof window !== "undefined") {
        window.__shatterSnapshot = { src: img.src, w, h, scale };
      }
      blitSnapshot();
    } catch (error) {
      console.warn("Shatter snapshot render failed:", error);
    }
    snapBuilding = false;
    if (snapQueued) {
      snapQueued = false;
      buildSnapshot();
    }
  }

  function scheduleRebuild() {
    if (!wantSnapshot) return;
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(buildSnapshot, 350);
  }

  function blitSnapshot(force) {
    if (!snapImg) return;
    const y = getScrollY();
    if (!force && y === lastBlitY &&
      snapCanvas.width === output.width && snapCanvas.height === output.height) return;
    lastBlitY = y;
    if (snapCanvas.width !== output.width || snapCanvas.height !== output.height) {
      snapCanvas.width = Math.max(output.width, 1);
      snapCanvas.height = Math.max(output.height, 1);
    }
    const dpr = output.width / Math.max(output.clientWidth, 1);
    const w = Math.max(content.clientWidth, 1);
    const h = Math.max(output.clientHeight, 1);
    snapCtx.clearRect(0, 0, snapCanvas.width, snapCanvas.height);
    snapCtx.drawImage(
      snapImg,
      0, y * snapScale, w * snapScale, h * snapScale,
      0, 0, w * dpr, h * dpr
    );
    contentDirty = true;
    wake();
  }

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
      console.error("Shatter shader error:", gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  const vertexShader = compile(gl.VERTEX_SHADER, VERT);
  const fragmentShader = compile(gl.FRAGMENT_SHADER, FRAG);
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("Shatter link error:", gl.getProgramInfoLog(program));
  }

  const uniforms = {};
  const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < uniformCount; i++) {
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

  const healTexture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, healTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
  gl.activeTexture(gl.TEXTURE0);

  let healCols = 0;
  let healRows = 0;
  let healOff = 0;
  let healTile = 0;
  let healData = null;
  let healDirty = false;

  function syncHealGrid() {
    const dpr = output.width / Math.max(output.clientWidth, 1);
    const tilePx = Math.max(config.tileSize, 24) * dpr;
    const scrollRange = wantSnapshot
      ? Math.max(content.scrollHeight - output.clientHeight, 0)
      : Math.max(content.scrollHeight - content.clientHeight, 0);
    const maxScroll = scrollRange * dpr;
    const off = Math.ceil(maxScroll / tilePx) + 2;
    const cols = Math.ceil(output.width / tilePx) + 2;
    const rows = off + Math.ceil(output.height / tilePx) + 2;
    if (cols === healCols && rows === healRows && off === healOff &&
      Math.abs(tilePx - healTile) < 0.5) return;
    const next = new Uint8Array(cols * rows);
    if (healData && cols === healCols && Math.abs(tilePx - healTile) < 0.5) {
      const shift = off - healOff;
      for (let y = 0; y < healRows; y++) {
        const ny = y + shift;
        if (ny < 0 || ny >= rows) continue;
        next.set(healData.subarray(y * healCols, (y + 1) * healCols), ny * cols);
      }
    }
    healCols = cols;
    healRows = rows;
    healOff = off;
    healTile = tilePx;
    healData = next;
    healDirty = true;
  }

  let sweep = null;

  function sweepStamp(prog, mode) {
    const resW = output.width;
    const resH = output.height;
    if (!healData || resW < 2 || resH < 2 || healTile < 1) return;
    const aspect = resW / resH;
    const dpr = resW / Math.max(output.clientWidth, 1);
    const tile = healTile;
    const scrollY = getScrollY() * dpr;
    const r = prog * 1.6;
    const edge = 0.22;
    for (let row = 0; row < healRows; row++) {
      const cy = row - healOff;
      const cuvy = ((cy + 0.5) * tile + scrollY) / resH;
      for (let cx = 0; cx < healCols; cx++) {
        const cuvx = ((cx + 0.5) * tile) / resW;
        const dx = (cuvx - 0.5) * aspect;
        const dy = cuvy - 0.5;
        const d = Math.hypot(dx, dy);
        let lens;
        if (d <= r - edge) lens = 1;
        else if (d >= r) lens = 0;
        else {
          const t = (r - d) / edge;
          lens = t * t * (3 - 2 * t);
        }
        const idx = row * healCols + cx;
        if (mode === "repair") {
          const v = Math.round(lens * 255);
          if (v > healData[idx]) {
            healData[idx] = v;
            healDirty = true;
          }
        } else {
          const v = Math.round((1 - lens) * 255);
          if (v < healData[idx]) {
            healData[idx] = v;
            healDirty = true;
          }
        }
      }
    }
  }

  function stampHeal() {
    if (!config.persist || !healData || pointer.active < 0.01) return;
    const resW = output.width;
    const resH = output.height;
    if (resW < 2 || resH < 2 || healTile < 1) return;
    const aspect = resW / resH;
    const dpr = resW / Math.max(output.clientWidth, 1);
    const tile = healTile;
    const scrollY = getScrollY() * dpr;
    const radius = Math.max(config.radius, 0.01) * pointer.active;
    const inner = radius * (1 - Math.min(Math.max(config.softness, 0), 1));
    const minCx = Math.floor(((pointer.x - radius / aspect) * resW) / tile) - 1;
    const maxCx = Math.ceil(((pointer.x + radius / aspect) * resW) / tile) + 1;
    const minCy = Math.floor(((pointer.y - radius) * resH - scrollY) / tile) - 1;
    const maxCy = Math.ceil(((pointer.y + radius) * resH - scrollY) / tile) + 1;
    for (let cy = minCy; cy <= maxCy; cy++) {
      const row = cy + healOff;
      if (row < 0 || row >= healRows) continue;
      const cuvy = ((cy + 0.5) * tile + scrollY) / resH;
      for (let cx = minCx; cx <= maxCx; cx++) {
        if (cx < 0 || cx >= healCols) continue;
        const cuvx = ((cx + 0.5) * tile) / resW;
        const dx = (cuvx - pointer.x) * aspect;
        const dy = cuvy - pointer.y;
        const d = Math.hypot(dx, dy);
        let lens;
        if (d <= inner) lens = 1;
        else if (d >= radius) lens = 0;
        else {
          const t = (d - inner) / Math.max(radius - inner, 1e-5);
          lens = 1 - t * t * (3 - 2 * t);
        }
        const v = Math.round(lens * pointer.active * 255);
        const idx = row * healCols + cx;
        if (v > healData[idx]) {
          healData[idx] = v;
          healDirty = true;
        }
      }
    }
  }

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
    syncHealGrid();
  }

  syncCanvasSize();

  const pointer = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, active: 0, target: 0 };
  let time = 0;

  function uploadContent() {
    if ((!htmlInCanvas && !wantSnapshot) || !contentDirty) return;
    contentDirty = false;
    gl.bindTexture(gl.TEXTURE_2D, contentTexture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE,
      htmlInCanvas ? source : snapCanvas
    );
  }

  function render() {
    uploadContent();
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, contentTexture);
    gl.uniform1i(uniforms.uContent, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, healTexture);
    if (healDirty && healData) {
      healDirty = false;
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, healCols, healRows, 0, gl.RED, gl.UNSIGNED_BYTE, healData);
    }
    gl.uniform1i(uniforms.uHealTex, 1);
    gl.uniform2f(uniforms.uHealSize, Math.max(healCols, 1), Math.max(healRows, 1));
    gl.uniform1f(uniforms.uHealOff, healOff);
    gl.uniform1f(uniforms.uPersist, config.persist ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(uniforms.uResolution, output.width, output.height);
    const dpr = output.width / Math.max(output.clientWidth, 1);
    const tilePx = Math.max(config.tileSize, 24) * dpr;
    gl.uniform1f(uniforms.uTile, tilePx);
    gl.uniform1f(uniforms.uCorner, Math.max(config.corner, 0) * dpr);
    gl.uniform1f(uniforms.uLift, Math.max(config.lift, 0) * dpr);
    gl.uniform1f(uniforms.uTilt, config.tilt);
    gl.uniform1f(uniforms.uScatter, Math.max(config.scatter, 0) * dpr);
    gl.uniform1f(uniforms.uPersp, Math.max(config.perspective, 200) * dpr);
    gl.uniform3f(uniforms.uGap, config.gapColor[0], config.gapColor[1], config.gapColor[2]);
    gl.uniform1f(uniforms.uShadow, config.shadow);
    gl.uniform1f(uniforms.uShading, config.shading);
    gl.uniform1f(uniforms.uShards, Math.min(Math.max(config.shards, 0), 1));
    gl.uniform1f(uniforms.uRefract, Math.max(config.refraction, 0));
    gl.uniform1f(uniforms.uDispersion, Math.min(Math.max(config.dispersion, 0), 1));
    gl.uniform1f(uniforms.uTime, time);
    gl.uniform2f(uniforms.uPointer, pointer.x, pointer.y);
    gl.uniform1f(uniforms.uActive, pointer.active);
    gl.uniform1f(uniforms.uRadius, Math.max(config.radius, 0.01));
    gl.uniform1f(uniforms.uSoftness, config.softness);
    gl.uniform1f(uniforms.uStrength, config.strength);
    gl.uniform1f(uniforms.uBase, config.baseStrength);
    gl.uniform1f(uniforms.uInvert, config.invert ? 1 : 0);
    gl.uniform1f(uniforms.uMaxX, contentMaxX);
    gl.uniform2f(uniforms.uScroll, getScrollX() * dpr, getScrollY() * dpr);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, output.width, output.height);
    gl.disable(gl.BLEND);
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
    const rawDelta = (now - lastTime) / 1000;
    const delta = Math.min(rawDelta, 1 / 30);
    lastTime = now;
    const ease = reducedMotion
      ? 1
      : 1 - Math.exp(-delta * Math.max(config.followSpeed, 0.5));
    pointer.x += (pointer.tx - pointer.x) * ease;
    pointer.y += (pointer.ty - pointer.y) * ease;
    pointer.active += (pointer.target - pointer.active) * ease;
    const floating =
      !reducedMotion &&
      config.floatSpeed > 0.001 &&
      Math.min(config.strength, 1) > 0.001 &&
      (pointer.active > 1e-3 || Math.min(config.baseStrength, 1) > 0.001);
    if (floating) {
      time += delta * config.floatSpeed;
      if (time >= TIME_WRAP) time -= TIME_WRAP;
    }
    const settled =
      !floating &&
      !sweep &&
      Math.abs(pointer.tx - pointer.x) < 5e-4 &&
      Math.abs(pointer.ty - pointer.y) < 5e-4 &&
      Math.abs(pointer.target - pointer.active) < 1e-3;
    if (settled) {
      pointer.x = pointer.tx;
      pointer.y = pointer.ty;
      pointer.active = pointer.target;
    }
    if (wantSnapshot) blitSnapshot();
    stampHeal();
    if (sweep && healData) {
      sweep.t += Math.min(rawDelta, 0.25) / 1.4;
      sweepStamp(Math.min(sweep.t, 1), sweep.mode);
      if (sweep.t >= 1.15) {
        healData.fill(sweep.mode === "repair" ? 255 : 0);
        healDirty = true;
        sweep = null;
      }
    }
    if (config.persist && config.regrow > 0 && healData) {
      const dec = config.regrow * delta * 255;
      for (let i = 0; i < healData.length; i++) {
        if (healData[i] > 0) {
          healData[i] = Math.max(0, healData[i] - dec);
          healDirty = true;
        }
      }
    }
    render();
    if (settled && !contentDirty) {
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

  let lastContentWidth = content.clientWidth;
  const observer = new ResizeObserver(() => {
    syncCanvasSize();
    // A stale-width snapshot fractures a copy of the page that no longer
    // matches the live layout (window resized / moved between monitors),
    // which reads as a detached extra layer. Re-rasterize on width change.
    if (wantSnapshot && content.clientWidth !== lastContentWidth) {
      lastContentWidth = content.clientWidth;
      scheduleRebuild();
    }
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
  content.addEventListener("scroll", start, { passive: true });

  function onWindowScroll() {
    blitSnapshot();
    start();
  }

  let mutationObserver = null;
  if (wantSnapshot) {
    window.addEventListener("scroll", onWindowScroll, { passive: true });
    mutationObserver = new MutationObserver(scheduleRebuild);
    mutationObserver.observe(content, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    const kickoff = () => buildSnapshot();
    if (document.fonts?.ready) document.fonts.ready.then(kickoff, kickoff);
    else kickoff();
  }

  return {
    setOptions(next) {
      Object.assign(config, next);
      start();
    },
    resize() {
      syncCanvasSize();
      start();
    },
    reshatter() {
      if (healData) healData.fill(0);
      healDirty = true;
      start();
    },
    crack() {
      sweep = { mode: "crack", t: 0 };
      start();
    },
    repair() {
      sweep = { mode: "repair", t: 0 };
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
      content.removeEventListener("scroll", start);
      window.removeEventListener("scroll", onWindowScroll);
      clearTimeout(rebuildTimer);
      mutationObserver?.disconnect();
      gl.deleteTexture(contentTexture);
      gl.deleteTexture(healTexture);
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      gl.deleteBuffer(quad);
      if (htmlInCanvas) paintable.onpaint = null;
    },
  };
}

const emptySubscribe = () => () => {};

export function Shatter({
  children,
  className,
  style,
  controlRef,
  ...options
}) {
  const sourceRef = useRef(null);
  const contentRef = useRef(null);
  const outputRef = useRef(null);
  const instanceRef = useRef(null);
  const [initialOptions] = useState(options);
  const [failed, setFailed] = useState(false);

  const supported = useSyncExternalStore(emptySubscribe, supportsHtmlInCanvas, () => false);
  const native = supported && !failed && !options.forceSnapshot;
  const snapshotFixed = !native && Boolean(options.snapshot);

  useEffect(() => {
    const source = sourceRef.current;
    const content = contentRef.current;
    const output = outputRef.current;
    if (!source || !content || !output) return;
    instanceRef.current = createShatter({ source, content, output }, initialOptions);
    if (native && !instanceRef.current) setFailed(true);
    if (controlRef) controlRef.current = instanceRef.current;
    return () => {
      instanceRef.current?.destroy();
      instanceRef.current = null;
      if (controlRef) controlRef.current = null;
    };
  }, [initialOptions, native, controlRef]);

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
          position: snapshotFixed ? "fixed" : "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          zIndex: snapshotFixed ? 20 : undefined,
        }} />
    </div>
  );
}


export default Shatter;
