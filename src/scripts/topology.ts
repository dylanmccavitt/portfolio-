import {
  entities,
  type EntityId,
  type Entity,
} from "../data/topology/entities";
import { layout } from "../data/topology/layout";

// ── Types ────────────────────────────────────────────────────────────────────

type Camera = { tx: number; ty: number; scale: number };
type Bounds = { x: number; y: number; w: number; h: number };
type DragState = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startTx: number;
  startTy: number;
  moved: boolean;
};

// ── Constants ────────────────────────────────────────────────────────────────

const VB_W = 2400;
const VB_H = 2800;
const SCENE_PAD = 200;
const MIN_SCALE = 0.5;
const MAX_SCALE = 3;

// ── DOM refs ─────────────────────────────────────────────────────────────────

const svg = document.getElementById("topology-svg") as SVGSVGElement | null;
const cameraEl = document.getElementById(
  "topology-camera",
) as SVGGElement | null;
const bgEl = document.getElementById("topology-bg") as SVGRectElement | null;
const popcardContainer = document.getElementById(
  "popcard-container",
) as HTMLElement | null;

if (!svg || !cameraEl || !bgEl || !popcardContainer) {
  throw new Error("Topology: required DOM elements not found");
}

// Narrow types after null check
const svgEl = svg;
const camGroupEl = cameraEl;
const backgroundEl = bgEl;
const popcardEl = popcardContainer;

// ── State ────────────────────────────────────────────────────────────────────

let camera: Camera;
let activeId: EntityId | null = null;
let dragState: DragState | null = null;
let lastDragEndedAt = 0;

// ── Camera math ──────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function computeSceneBounds(): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const f of layout.frames) {
    minX = Math.min(minX, f.x);
    minY = Math.min(minY, f.y);
    maxX = Math.max(maxX, f.x + f.w);
    maxY = Math.max(maxY, f.y + f.h);
  }
  for (const n of layout.nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
  }

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function getSvgRect(): DOMRect {
  return svgEl.getBoundingClientRect();
}

function pxPerUnit(): number {
  const rect = getSvgRect();
  return Math.min(rect.width / VB_W, rect.height / VB_H);
}

function constrainCamera(c: Camera): Camera {
  const scale = clamp(c.scale, MIN_SCALE, MAX_SCALE);
  const rect = getSvgRect();
  const vpW = rect.width || window.innerWidth;
  const vpH = rect.height || window.innerHeight;
  const ppu = pxPerUnit();
  const padPx = SCENE_PAD * ppu;

  const sw = sb.w * scale * ppu;
  const sh = sb.h * scale * ppu;
  const ox = sb.x * scale * ppu;
  const oy = sb.y * scale * ppu;

  const minTx = -(ox + sw) + vpW - padPx;
  const maxTx = -ox + padPx;
  const minTy = -(oy + sh) + vpH - padPx;
  const maxTy = -oy + padPx;

  return {
    scale,
    tx: clamp(c.tx, Math.min(minTx, maxTx), Math.max(minTx, maxTx)),
    ty: clamp(c.ty, Math.min(minTy, maxTy), Math.max(minTy, maxTy)),
  };
}

function centerOn(bounds: Bounds, scale: number): Camera {
  const rect = getSvgRect();
  const vpW = rect.width || window.innerWidth;
  const vpH = rect.height || window.innerHeight;
  const ppu = pxPerUnit();

  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;

  const tx = vpW / 2 - cx * scale * ppu;
  const ty = vpH / 2 - cy * scale * ppu;

  return constrainCamera({ tx, ty, scale });
}

function zoomAt(
  cam: Camera,
  anchorX: number,
  anchorY: number,
  newScale: number,
): Camera {
  const s = clamp(newScale, MIN_SCALE, MAX_SCALE);
  const ratio = s / cam.scale;
  return constrainCamera({
    scale: s,
    tx: anchorX - ratio * (anchorX - cam.tx),
    ty: anchorY - ratio * (anchorY - cam.ty),
  });
}

// ── Scene bounds (computed once) ─────────────────────────────────────────────

const sb = computeSceneBounds();
camera = centerOn(sb, 1);
const DEFAULT_CAMERA: Camera = { ...camera };

// ── Entity bounds lookup ─────────────────────────────────────────────────────

function getEntityBounds(id: string): Bounds | null {
  for (const f of layout.frames) {
    if (f.entityId === id) {
      return { x: f.x, y: f.y, w: f.w, h: f.h };
    }
  }
  for (const n of layout.nodes) {
    if (n.id === id) {
      return { x: n.x, y: n.y, w: n.w, h: n.h };
    }
  }
  return null;
}

// ── Highlight set ────────────────────────────────────────────────────────────

function buildHighlightSet(focusId: string | null): Set<string> {
  if (!focusId) return new Set();
  const set = new Set<string>();
  set.add(focusId);

  const entity = (entities as Record<string, Entity>)[focusId];
  if (entity?.related) {
    for (const r of entity.related) set.add(r);
  }

  // Chips: highlight parent and siblings
  for (const node of layout.nodes) {
    if (node.chips) {
      const isChip = node.chips.some((c) => c.id === focusId);
      if (isChip || node.id === focusId) {
        set.add(node.id);
        for (const chip of node.chips) set.add(chip.id);
      }
    }
  }

  // Frame members
  for (const frame of layout.frames) {
    if (frame.entityId === focusId && frame.members) {
      for (const m of frame.members) set.add(m);
    }
  }

  // Edges where either endpoint is in set
  for (const edge of layout.edges) {
    if (set.has(edge.from) || set.has(edge.to)) set.add(edge.id);
  }

  // Frame IDs for highlighted entity IDs
  for (const frame of layout.frames) {
    if (frame.entityId && set.has(frame.entityId)) set.add(frame.id);
  }

  return set;
}

// ── Rendering ────────────────────────────────────────────────────────────────

function applyCamera(): void {
  const ppu = pxPerUnit();
  // Transform the camera group in SVG-unit space
  const svgTx = camera.tx / (camera.scale * ppu);
  const svgTy = camera.ty / (camera.scale * ppu);

  camGroupEl.setAttribute(
    "transform",
    `scale(${camera.scale}) translate(${svgTx} ${svgTy})`,
  );
}

function applyHighlights(): void {
  const highlights = buildHighlightSet(activeId);
  const hasHighlight = Boolean(activeId);

  svgEl.classList.toggle("has-focus", hasHighlight);

  // Nodes
  document.querySelectorAll<SVGGElement>("[data-node-id]").forEach((el) => {
    const id = el.dataset.nodeId!;
    el.classList.toggle("is-highlighted", highlights.has(id));
    el.classList.toggle("is-active", id === activeId);
  });

  // Chips
  document.querySelectorAll<SVGGElement>("[data-chip-id]").forEach((el) => {
    const id = el.dataset.chipId!;
    el.classList.toggle("is-highlighted", highlights.has(id));
    el.classList.toggle("is-active", id === activeId);
  });

  // Frames
  document.querySelectorAll<SVGGElement>("[data-frame-id]").forEach((el) => {
    const id = el.dataset.frameId!;
    const entityId = el.dataset.entityId ?? "";
    el.classList.toggle(
      "is-highlighted",
      highlights.has(id) || highlights.has(entityId),
    );
  });

  // Edges
  document.querySelectorAll<SVGGElement>("[data-edge-id]").forEach((el) => {
    const id = el.dataset.edgeId!;
    const edgePath = el.querySelector(".topo-edge");
    if (edgePath) {
      edgePath.classList.toggle("is-highlighted", highlights.has(id));
    }
  });
}

// ── Pop Card ─────────────────────────────────────────────────────────────────

function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showPopCard(entityId: string, anchorX: number, anchorY: number): void {
  const entity = (entities as Record<string, Entity>)[entityId];
  if (!entity) return;

  const badgesHtml = entity.badges
    .map((b) => `<span class="topo-popcard__badge">${escHtml(b)}</span>`)
    .join("");

  const relatedHtml =
    entity.related.length > 0
      ? `<div>
          <p class="topo-popcard__related-label">Connected to</p>
          <div class="topo-popcard__related-list">
            ${entity.related
              .map((id) => {
                const rel = (entities as Record<string, Entity>)[id];
                const title = rel ? rel.title : id;
                return `<button class="topo-popcard__related-btn" data-navigate="${escHtml(id)}">${escHtml(title)}</button>`;
              })
              .join("")}
          </div>
        </div>`
      : "";

  popcardEl.innerHTML = `
    <div class="topo-popcard" style="left:${anchorX}px;top:${anchorY}px">
      <p class="topo-popcard__eyebrow">${escHtml(entity.kind)}</p>
      <h3 class="topo-popcard__title">${escHtml(entity.title)}</h3>
      <p class="topo-popcard__summary">${escHtml(entity.summary)}</p>
      <div class="topo-popcard__badges">${badgesHtml}</div>
      ${relatedHtml}
    </div>
  `;

  // Adjust position to stay in viewport
  const card = popcardEl.querySelector<HTMLElement>(".topo-popcard");
  if (card) {
    const cr = card.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (cr.right > vw - 16) card.style.left = `${vw - cr.width - 16}px`;
    if (cr.bottom > vh - 16) card.style.top = `${vh - cr.height - 16}px`;
    if (cr.left < 16) card.style.left = "16px";
    if (cr.top < 16) card.style.top = "16px";
  }

  // Wire up related buttons
  popcardEl
    .querySelectorAll<HTMLButtonElement>("[data-navigate]")
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetId = btn.dataset.navigate as EntityId;
        focusEntity(targetId);
      });
    });
}

function hidePopCard(): void {
  popcardEl.innerHTML = "";
}

// ── Actions ──────────────────────────────────────────────────────────────────

function focusEntity(entityId: EntityId): void {
  activeId = entityId;

  const bounds = getEntityBounds(entityId);
  if (bounds) {
    const focusScale = clamp(
      Math.min((VB_W * 0.3) / bounds.w, (VB_H * 0.3) / bounds.h),
      MIN_SCALE,
      MAX_SCALE,
    );
    camera = centerOn(bounds, focusScale);
  }

  applyCamera();
  applyHighlights();

  // Position pop card near the clicked element's screen position
  if (bounds) {
    const rect = getSvgRect();
    const ppu = pxPerUnit();
    const screenX =
      rect.left + (bounds.x + bounds.w) * camera.scale * ppu + camera.tx + 16;
    const screenY = rect.top + bounds.y * camera.scale * ppu + camera.ty;
    showPopCard(entityId, screenX, screenY);
  }
}

function resetView(): void {
  activeId = null;
  camera = { ...DEFAULT_CAMERA };
  applyCamera();
  applyHighlights();
  hidePopCard();
}

// ── Events: Pan ──────────────────────────────────────────────────────────────

svgEl.addEventListener("pointerdown", (e: PointerEvent) => {
  if (e.button !== 0) return;
  svgEl.setPointerCapture(e.pointerId);
  dragState = {
    pointerId: e.pointerId,
    startClientX: e.clientX,
    startClientY: e.clientY,
    startTx: camera.tx,
    startTy: camera.ty,
    moved: false,
  };
  svgEl.closest(".topology-screen")?.classList.add("topology-screen--dragging");
});

svgEl.addEventListener("pointermove", (e: PointerEvent) => {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  const dx = e.clientX - dragState.startClientX;
  const dy = e.clientY - dragState.startClientY;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragState.moved = true;
  camera = constrainCamera({
    scale: camera.scale,
    tx: dragState.startTx + dx,
    ty: dragState.startTy + dy,
  });
  applyCamera();
});

function endDrag(e: PointerEvent): void {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  if (dragState.moved) lastDragEndedAt = Date.now();
  dragState = null;
  svgEl
    .closest(".topology-screen")
    ?.classList.remove("topology-screen--dragging");
}

svgEl.addEventListener("pointerup", endDrag);
svgEl.addEventListener("pointercancel", endDrag);

// ── Events: Zoom ─────────────────────────────────────────────────────────────

svgEl.addEventListener(
  "wheel",
  (e: WheelEvent) => {
    e.preventDefault();
    const rect = getSvgRect();
    const ax = e.clientX - rect.left;
    const ay = e.clientY - rect.top;
    const mult = Math.exp(-e.deltaY * 0.0012);
    camera = zoomAt(camera, ax, ay, camera.scale * mult);
    applyCamera();
  },
  { passive: false },
);

// ── Events: Click ────────────────────────────────────────────────────────────

document.addEventListener("click", (e: MouseEvent) => {
  if (Date.now() - lastDragEndedAt < 140) return;

  const target = e.target as Element;

  // Click inside pop card — handled by its own listeners
  if (target.closest(".topo-popcard")) return;

  const entityEl = target.closest<HTMLElement>("[data-entity-click]");
  if (entityEl?.dataset.entityClick) {
    focusEntity(entityEl.dataset.entityClick as EntityId);
    return;
  }

  // Click on SVG background or empty area → reset
  if (
    target === backgroundEl ||
    (target.closest("#topology-svg") && !target.closest("[data-entity-click]"))
  ) {
    resetView();
  }
});

// Close on Escape
document.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Escape" && activeId) resetView();
});

// ── Events: Zoom buttons ─────────────────────────────────────────────────────

document.getElementById("zoom-in")?.addEventListener("click", () => {
  const rect = getSvgRect();
  camera = zoomAt(camera, rect.width / 2, rect.height / 2, camera.scale * 1.2);
  applyCamera();
});

document.getElementById("zoom-out")?.addEventListener("click", () => {
  const rect = getSvgRect();
  camera = zoomAt(camera, rect.width / 2, rect.height / 2, camera.scale / 1.2);
  applyCamera();
});

document.getElementById("reset-view")?.addEventListener("click", resetView);

// ── Init ─────────────────────────────────────────────────────────────────────

applyCamera();
applyHighlights();
