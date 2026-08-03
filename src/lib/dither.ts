/**
 * Ordered-dither marks, rasterised at build time into inline SVG.
 *
 * The project pages are static Astro, so there is no reason to ship a canvas
 * and a hydration boundary for a 13px ornament: the dither pattern is fixed,
 * so it is computed here during the build and emitted as flat rects. Zero
 * client JS, and it survives with scripting off.
 *
 * Colour language: HUE is the project's area, DENSITY is how far along the
 * work is. Labels always stay in ink beside these marks, so nothing on the
 * page depends on colour alone.
 */

const BAYER8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];

/**
 * One hue per area. A categorical set validated against `--frost-surface`
 * for lightness, chroma, colour-blind separation (worst adjacent pair
 * ΔE 13.6 under deuteranopia) and 3:1 contrast. Assign by entity; never
 * cycle, and never add a fifth by generating one.
 */
export const AREA_HUE: Record<string, string> = {
  'AI & Developer Tools': '#2563EB',
  'Shipped & Client Work': '#B45309',
  'Side Projects & Experiments': '#0D9488',
  Coursework: '#A21CAF',
};

/** `--frost-ink`, for an area the map has not been taught yet. */
const FALLBACK_HUE = '#26343d';

/**
 * The Journey timeline's single accent hue. One hue for the whole list on
 * purpose: the rows carry no category, so colouring them per-row would
 * invent a distinction the data does not make.
 */
export const TIMELINE_HUE = '#2563EB';

export function hueForArea(area: string): string {
  return AREA_HUE[area] ?? FALLBACK_HUE;
}

/** How far along the work is. Keys are catalog `status[0]` values. */
const STATUS_DENSITY: Record<string, number> = { live: 0.95, done: 0.74, dry: 0.34 };

export function densityForStatus(key: string): number {
  return STATUS_DENSITY[key] ?? 0.6;
}

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

/** A density field over the unit square. Return < 0 for "outside the shape". */
type Field = (u: number, v: number) => number;

/**
 * Walk the grid and merge each run of lit cells in a row into one rect, so a
 * 13px orb is a dozen rects rather than ninety.
 */
function rects(gw: number, gh: number, field: Field): string {
  const out: string[] = [];
  for (let y = 0; y < gh; y++) {
    let runStart = -1;
    for (let x = 0; x <= gw; x++) {
      const lit =
        x < gw &&
        (() => {
          const d = field((x + 0.5) / gw, (y + 0.5) / gh);
          return d >= 0 && d > (BAYER8[y & 7][x & 7] + 0.5) / 64;
        })();
      if (lit && runStart === -1) runStart = x;
      if (!lit && runStart !== -1) {
        out.push(`<rect x="${runStart}" y="${y}" width="${x - runStart}" height="1"/>`);
        runStart = -1;
      }
    }
  }
  return out.join('');
}

function svg(gw: number, gh: number, w: number, h: number, color: string, body: string): string {
  // viewBox is in grid cells and width/height in CSS px, so the pattern scales
  // up with hard edges instead of being resampled.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${gw} ${gh}" ` +
    `width="${w}" height="${h}" shape-rendering="crispEdges" ` +
    `focusable="false" aria-hidden="true"><g fill="${color}">${body}</g></svg>`
  );
}

interface SwatchOptions {
  level: number;
  color: string;
  width?: number;
  height?: number;
  cell?: number;
}

/** A flat density swatch — the status mark beside a chip's label. */
export function ditherSwatchSvg({
  level,
  color,
  width = 15,
  height = 10,
  cell = 2,
}: SwatchOptions): string {
  const gw = Math.max(1, Math.round(width / cell));
  const gh = Math.max(1, Math.round(height / cell));
  return svg(gw, gh, width, height, color, rects(gw, gh, () => level));
}

interface OrbOptions {
  color: string;
  size?: number;
  cell?: number;
}

/**
 * A Lambert-shaded sphere. The lit side dithers away to nothing, so limb
 * darkening carries the silhouette — without it the ball reads as a crescent
 * rather than a ball. Marker sizes use a 1px cell: at 2px a 13px orb is six
 * cells across and stops reading as round.
 */
export function ditherOrbSvg({ color, size = 13, cell = 1 }: OrbOptions): string {
  const g = Math.max(1, Math.round(size / cell));
  const field: Field = (u, v) => {
    const x = u * 2 - 1;
    const y = v * 2 - 1;
    const r2 = x * x + y * y;
    if (r2 > 1) return -1;
    const r = Math.sqrt(r2);
    const z = Math.sqrt(1 - r2);
    // Light from the upper left, matching the page's implied light.
    const lambert = Math.max(0, x * -0.55 + y * -0.6 + z * 0.58);
    const shade = clamp01(1 - clamp01(0.1 + lambert * 1.08));
    const limb = clamp01((r - 0.7) / 0.3) ** 1.4;
    return Math.max(shade, limb * 0.92);
  };
  return svg(g, g, size, size, color, rects(g, g, field));
}
