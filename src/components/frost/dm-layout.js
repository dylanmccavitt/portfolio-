const CORNERS = ["bottom-right", "bottom-left", "top-right", "top-left"];

const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);

/**
 * @typedef {{ x: number, y: number, width: number, height: number, weight?: number }} DmObstacle
 * @typedef {{ width: number, height: number }} DmSize
 * @typedef {{ x: number, y: number, w: number, h: number, placement: string }} DmFrame
 */

function intersectionArea(a, b) {
  const width = Math.max(0, Math.min(a.x + a.w, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.h, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

function candidateFrame(placement, viewport, width, height, margin, topInset) {
  const right = placement.endsWith("right");
  const bottom = placement.startsWith("bottom");
  return {
    x: right ? viewport.width - margin - width : margin,
    y: bottom ? viewport.height - margin - height : topInset,
    w: width,
    h: height,
    placement,
  };
}

/**
 * Chooses a stable screen corner with the least collision against visible page
 * content. Smaller frames are considered only when moving cannot clear enough
 * room, so the conversation remains readable instead of constantly shrinking.
 *
 * @param {{
 *   viewport: DmSize,
 *   desired: DmSize,
 *   obstacles?: DmObstacle[],
 *   previousPlacement?: string | null,
 *   margin?: number,
 *   topInset?: number
 * }} options
 * @returns {DmFrame}
 */
export function chooseDmFrame({
  viewport,
  desired,
  obstacles = [],
  previousPlacement = null,
  margin = 16,
  topInset = 72,
}) {
  const availableWidth = Math.max(260, viewport.width - margin * 2);
  const availableHeight = Math.max(240, viewport.height - topInset - margin);
  const preferredWidth = clamp(desired.width, 300, Math.min(560, availableWidth));
  const preferredHeight = clamp(desired.height, 260, Math.min(620, availableHeight));
  const sizes = [
    [preferredWidth, preferredHeight],
    [preferredWidth, Math.max(260, preferredHeight * 0.82)],
    [Math.max(300, preferredWidth * 0.86), Math.max(260, preferredHeight * 0.72)],
  ];

  /** @type {(DmFrame & { score: number }) | null} */
  let best = null;
  for (const [rawWidth, rawHeight] of sizes) {
    const width = Math.round(rawWidth);
    const height = Math.round(rawHeight);
    for (const placement of CORNERS) {
      const frame = candidateFrame(placement, viewport, width, height, margin, topInset);
      const overlap = obstacles.reduce(
        (total, obstacle) =>
          total + intersectionArea(frame, obstacle) * (obstacle.weight ?? 1),
        0,
      );
      const shrink = 1 - (width * height) / (preferredWidth * preferredHeight);
      const switchPenalty =
        previousPlacement && previousPlacement !== placement ? preferredWidth * 8 : 0;
      const score = overlap + shrink * preferredWidth * preferredHeight * 0.18 + switchPenalty;
      if (best === null || score < best.score) best = { ...frame, score };
    }
  }

  if (best === null) throw new Error("DM layout produced no candidates");
  const { score: _score, ...frame } = best;
  return frame;
}

/** @returns {DmObstacle[]} */
export function visibleDmObstacles(root, card) {
  if (!root) return [];
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const selector = "h1, h2, h3, p, a, button, dt, dd, figure";

  return Array.from(root.querySelectorAll(selector)).flatMap((node) => {
    if (card?.contains(node)) return [];
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return [];
    }
    const rect = node.getBoundingClientRect();
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    const right = Math.min(viewportWidth, rect.right);
    const bottom = Math.min(viewportHeight, rect.bottom);
    if (right <= left || bottom <= top) return [];
    return [{
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      weight: node.matches("a, button, figure") ? 2.4 : 1,
    }];
  });
}
