import { entities, type Entity } from "../data/topology/entities";

// ── Entity lookup ────────────────────────────────────────────────────────────

function getEntity(id: string): Entity | undefined {
  return (entities as Record<string, Entity>)[id];
}

// ── DOM refs ─────────────────────────────────────────────────────────────────

const mapEl = document.getElementById("topology-map");
const popcardContainerEl = document.getElementById("popcard-container");

if (!mapEl || !popcardContainerEl) {
  throw new Error("Topology: required DOM elements not found");
}

const map: HTMLElement = mapEl;
const popcardEl: HTMLElement = popcardContainerEl;

// ── State ────────────────────────────────────────────────────────────────────

let activeId: string | null = null;

// ── Highlight set ────────────────────────────────────────────────────────────

function buildHighlightSet(focusId: string | null): Set<string> {
  if (!focusId) return new Set();
  const set = new Set<string>();
  set.add(focusId);

  const entity = getEntity(focusId);
  if (entity?.related) {
    for (const r of entity.related) set.add(r);
  }

  return set;
}

// ── Highlights ───────────────────────────────────────────────────────────────

function applyHighlights(): void {
  const highlights = buildHighlightSet(activeId);
  const hasHighlight = Boolean(activeId);

  map.classList.toggle("has-focus", hasHighlight);

  // Nodes
  map.querySelectorAll<HTMLElement>(".topo__node").forEach((el) => {
    const id = el.dataset.entity ?? "";
    el.classList.toggle("is-highlighted", highlights.has(id));
    el.classList.toggle("is-active", id === activeId);
  });

  // Chips
  map.querySelectorAll<HTMLElement>(".topo__chip").forEach((el) => {
    const id = el.dataset.entity ?? "";
    el.classList.toggle("is-highlighted", highlights.has(id));
    el.classList.toggle("is-active", id === activeId);
  });

  // Zones
  map.querySelectorAll<HTMLElement>(".topo__zone").forEach((el) => {
    const id = el.dataset.entity ?? "";
    el.classList.toggle("is-highlighted", highlights.has(id));
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

function showPopCard(entityId: string, anchorEl: HTMLElement): void {
  const entity = getEntity(entityId);
  if (!entity) return;

  const badgesHtml = entity.badges
    .map((b) => `<span class="topo-popcard__badge">${escHtml(b)}</span>`)
    .join("");

  const relatedHtml =
    entity.related.length > 0
      ? `<div class="topo-popcard__related">
          <p class="topo-popcard__related-label">Connected to</p>
          ${entity.related
            .map((id) => {
              const rel = getEntity(id);
              const title = rel ? rel.title : id;
              return `<button class="topo-popcard__related-btn" data-navigate="${escHtml(id)}"><span class="topo-popcard__arrow">&rarr;</span> ${escHtml(title)}</button>`;
            })
            .join("")}
        </div>`
      : "";

  // Position near the clicked element
  const rect = anchorEl.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Start to the right, fall back to below if no room
  let left = rect.right + 12;
  let top = rect.top;

  // If right side would overflow, try left side
  if (left + 320 > vw - 16) {
    left = rect.left - 320 - 12;
  }
  // If still off screen, center below the element
  if (left < 16) {
    left = Math.max(16, Math.min(rect.left, vw - 336));
    top = rect.bottom + 12;
  }

  popcardEl.innerHTML = `
    <div class="topo-popcard" style="left:${left}px;top:${top}px">
      <div class="topo-popcard__header">
        <p class="topo-popcard__eyebrow">${escHtml(entity.kind)}</p>
        <button class="topo-popcard__close" aria-label="Close">&times;</button>
      </div>
      <h3 class="topo-popcard__title">${escHtml(entity.title)}</h3>
      <p class="topo-popcard__summary">${escHtml(entity.summary)}</p>
      ${badgesHtml ? `<div class="topo-popcard__badges">${badgesHtml}</div>` : ""}
      ${relatedHtml}
    </div>
  `;

  // Final viewport clamp
  const card = popcardEl.querySelector<HTMLElement>(".topo-popcard");
  if (card) {
    const cr = card.getBoundingClientRect();
    if (cr.bottom > vh - 16) card.style.top = `${vh - cr.height - 16}px`;
    if (cr.top < 16) card.style.top = "16px";
    if (cr.right > vw - 16) card.style.left = `${vw - cr.width - 16}px`;
    if (cr.left < 16) card.style.left = "16px";
  }

  // Wire up close button
  popcardEl
    .querySelector<HTMLButtonElement>(".topo-popcard__close")
    ?.addEventListener("click", (e) => {
      e.stopPropagation();
      resetView();
    });

  // Wire up related buttons
  popcardEl
    .querySelectorAll<HTMLButtonElement>("[data-navigate]")
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetId = btn.dataset.navigate!;
        const targetEl = map.querySelector<HTMLElement>(
          `[data-entity="${targetId}"]`,
        );
        if (targetEl) {
          focusEntity(targetId, targetEl);
        }
      });
    });
}

function hidePopCard(): void {
  popcardEl.innerHTML = "";
}

// ── Actions ──────────────────────────────────────────────────────────────────

function focusEntity(entityId: string, el: HTMLElement): void {
  activeId = entityId;
  applyHighlights();
  showPopCard(entityId, el);

  // Scroll the node into view smoothly
  el.scrollIntoView({ behavior: "smooth", block: "center" });
}

function resetView(): void {
  activeId = null;
  applyHighlights();
  hidePopCard();
}

// ── Events ───────────────────────────────────────────────────────────────────

map.addEventListener("click", (e: MouseEvent) => {
  const target = e.target as HTMLElement;

  // Click inside pop card — handled by its own listeners
  if (target.closest(".topo-popcard")) return;

  // If pop card is open, any click outside it dismisses it first
  if (activeId) {
    e.stopPropagation();
    resetView();
    return;
  }

  // Click on a node or chip
  const entityEl = target.closest<HTMLElement>("[data-entity]");
  if (entityEl?.dataset.entity) {
    e.stopPropagation();
    focusEntity(entityEl.dataset.entity, entityEl);
    return;
  }
});

document.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Escape" && activeId) resetView();
});

// ── Init ─────────────────────────────────────────────────────────────────────

applyHighlights();
