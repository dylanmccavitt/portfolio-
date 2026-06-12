/**
 * Player-state island — the one earned exception to the zero-client-JS rule
 * (repo CLAUDE.md). A single vanilla-TS module, no framework, that makes the
 * "now playing" metaphor work across real page navigations (MPA):
 *
 *   - persists `{ nowType, nowId, paused }` to localStorage;
 *   - hydrates the player bar (art / title / subline / seek rail) + `body.paused`
 *     (which freezes the equalizer) + the playing-row / hero equalizer states on
 *     every page load;
 *   - play/pause toggle, prev/next stepping through the catalog (or the resume
 *     tracks when a journey track is playing) with wraparound, navigating to the
 *     stepped item's page;
 *   - navigation = play: landing on a project / journey-track page marks it as
 *     now playing (prototype semantics);
 *   - select-then-open tracklist rows: the first click on a library row makes
 *     it the now-playing track in place (eq wave + hero + bar update, no
 *     navigation); clicking the selected row again opens its project page.
 *     With JS off the rows stay plain links;
 *   - keyboard: Space = play/pause, ArrowRight/Left = next/prev, scoped so it
 *     never hijacks form fields, links, or buttons.
 *
 * Behavior is a progressive enhancement: with JS off the bar renders its
 * server-side default and every control degrades to a plain link, so all
 * navigation still works. Ported from `15-player-v4.html` (`state`, `renderBar`,
 * `togglePlay`, `step`, and the keydown handler).
 *
 * Wrapped in an IIFE so its declarations stay module-scoped: Astro bundles each
 * `src=` script as a classic script, and `astro check` type-checks them in one
 * shared global scope, so a bare top-level `const` would collide with the other
 * page scripts (e.g. theme-switcher's `STORAGE_KEY`).
 */

(() => {
type NowType = 'p' | 'r';

interface PlaylistItem {
  id: string;
  sym: string;
  hue: string;
  title: string;
  sub: string;
  from: string;
  to: string;
  pct: number;
  href: string;
  /** Library-hero fields — present on project ('p') items only. */
  kind?: string;
  about?: string;
  badgeKind?: string;
  badgeLabel?: string;
  stack?: string;
}

interface Playlist {
  p: PlaylistItem[];
  r: PlaylistItem[];
}

interface PlayerState {
  nowType: NowType;
  nowId: string;
  paused: boolean;
}

const STORAGE_KEY = 'portfolio-player';

/** Read the playlist payload the bar embedded; bail out cleanly if it's absent. */
function readPlaylist(): Playlist | null {
  const el = document.querySelector<HTMLScriptElement>('[data-pb-playlist]');
  if (!el?.textContent) return null;
  try {
    const data = JSON.parse(el.textContent) as Playlist;
    if (!Array.isArray(data.p) || !Array.isArray(data.r)) return null;
    return data;
  } catch {
    return null;
  }
}

/** Find an item in the given list by id. */
function findItem(list: PlaylistItem[], id: string): PlaylistItem | undefined {
  return list.find((item) => item.id === id);
}

/**
 * Derive the now-playing item from the current URL — "navigation = play". A
 * project / journey-track page IS its item; anywhere else (library, home) has no
 * URL-driven item and we fall back to stored state.
 */
function itemFromPath(playlist: Playlist): { type: NowType; id: string } | null {
  const path = decodeURIComponent(location.pathname);
  const project = path.match(/^\/projects\/([^/]+)\/?$/);
  if (project && findItem(playlist.p, project[1])) return { type: 'p', id: project[1] };
  const track = path.match(/^\/journey\/([^/]+)\/?$/);
  if (track && findItem(playlist.r, track[1])) return { type: 'r', id: track[1] };
  return null;
}

/** Load persisted state, validating the stored id against the live playlist. */
function loadState(playlist: Playlist): PlayerState {
  const fallback: PlayerState = { nowType: 'p', nowId: playlist.p[0]?.id ?? '', paused: true };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PlayerState>;
    const nowType: NowType = parsed.nowType === 'r' ? 'r' : 'p';
    const list = playlist[nowType];
    // Reject removed / renamed ids so a stale store never crashes the bar.
    if (typeof parsed.nowId !== 'string' || !findItem(list, parsed.nowId)) return fallback;
    return { nowType, nowId: parsed.nowId, paused: parsed.paused !== false };
  } catch {
    return fallback;
  }
}

/** Persist state; swallow quota / privacy-mode errors. */
function saveState(state: PlayerState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* localStorage unavailable (private mode / quota) — bar still works in-page */
  }
}

const setText = (sel: string, value: string): void => {
  const el = document.querySelector(sel);
  if (el) el.textContent = value;
};

/** Re-render the bottom bar's now-playing slot + seek rail from current state. */
function renderBar(playlist: Playlist, state: PlayerState): void {
  const item = findItem(playlist[state.nowType], state.nowId);
  if (!item) return;

  const now = document.querySelector<HTMLAnchorElement>('[data-pb-now]');
  if (now) now.href = item.href;

  const artEl = document.querySelector<HTMLElement>('[data-pb-art]');
  if (artEl) {
    artEl.textContent = item.sym;
    artEl.style.setProperty('--a', item.hue);
  }
  setText('[data-pb-title]', item.title);
  setText('[data-pb-sub]', item.sub);
  setText('[data-pb-from]', item.from);
  setText('[data-pb-to]', item.to);

  const fill = document.querySelector<HTMLElement>('[data-pb-fill]');
  if (fill) fill.style.width = `${item.pct}%`;
  const knob = document.querySelector<HTMLElement>('[data-pb-knob]');
  if (knob) knob.style.left = `${item.pct}%`;

  // Keep the display-only progressbar's a11y values in sync with the rail (#28).
  const rail = document.querySelector<HTMLElement>('[data-pb-rail]');
  if (rail) {
    rail.setAttribute('aria-valuenow', String(Math.round(item.pct)));
    rail.setAttribute('aria-valuetext', `${item.from} to ${item.to}`);
  }
}

/** Reflect paused state on the body (freezes the eq + flips the play glyph). */
function applyPaused(paused: boolean): void {
  document.body.classList.toggle('paused', paused);
  const play = document.querySelector<HTMLElement>('[data-pb-play]');
  if (play) play.setAttribute('aria-label', paused ? 'Play' : 'Pause');
}

const BADGE_KINDS = ['dry', 'live', 'wip', 'done'];

/**
 * Reflect the playing item on in-page DOM hooks (#21/#22 contract): mark the
 * matching tracklist row, refresh the library "now playing" hero, and mark the
 * project-detail big-play button when the page IS the now-playing project.
 */
function applyViewState(playlist: Playlist, state: PlayerState): void {
  document.querySelectorAll<HTMLElement>('[data-track-id]').forEach((row) => {
    // Tracklist rows are project rows on library pages; journey rows carry no
    // data-track-id, so this only ever matches project ('p') now-playing.
    const playing = state.nowType === 'p' && row.dataset.trackId === state.nowId;
    row.classList.toggle('playing', playing);
    if (playing) row.setAttribute('data-playing', 'true');
    else row.removeAttribute('data-playing');
    // Keep the sr-only "Now playing" marker on the active row only (#28), so AT
    // announces the change when the island moves play state between rows.
    const n = row.querySelector<HTMLElement>('.n');
    if (n) {
      let label = n.querySelector<HTMLElement>('[data-now-playing-label]');
      if (playing && !label) {
        label = document.createElement('span');
        label.className = 'sr-only';
        label.dataset.nowPlayingLabel = '';
        label.textContent = 'Now playing. ';
        n.prepend(label);
      } else if (!playing && label) {
        label.remove();
      }
    }
  });

  // Library hero — only present on library/home pages, and only meaningful for a
  // project now-playing (the journey album has no `data-now-*` hero).
  const heroArt = document.querySelector<HTMLElement>('[data-now-art]');
  if (heroArt && state.nowType === 'p') {
    const item = findItem(playlist.p, state.nowId);
    if (item) {
      heroArt.textContent = item.sym;
      heroArt.style.setProperty('--a', item.hue);
      setText('[data-now-kind]', item.kind ?? '');
      setText('[data-now-title]', item.title);
      setText('[data-now-about]', item.about ?? '');
      setText('[data-now-stack]', item.stack ?? '');
      const badge = document.querySelector<HTMLElement>('[data-now-badge]');
      if (badge && item.badgeKind) {
        BADGE_KINDS.forEach((k) => badge.classList.remove(k));
        badge.classList.add(item.badgeKind);
        badge.textContent = item.badgeLabel ?? '';
      }
      const open = document.querySelector<HTMLAnchorElement>('[data-now-open]');
      if (open) open.href = item.href;
    }
  }

  const hero = document.querySelector<HTMLElement>('[data-play][data-project]');
  if (hero) {
    const playing = state.nowType === 'p' && hero.dataset.project === state.nowId;
    hero.classList.toggle('paused', playing && !state.paused);
  }
}

/** Step prev/next through the active list with wraparound, then navigate. */
function step(playlist: Playlist, state: PlayerState, dir: 1 | -1): void {
  const list = playlist[state.nowType];
  const i = list.findIndex((item) => item.id === state.nowId);
  if (i < 0 || list.length === 0) return;
  const next = list[(i + dir + list.length) % list.length];
  // Stepping starts playback (prototype: navigation = play), then navigates.
  saveState({ nowType: state.nowType, nowId: next.id, paused: false });
  location.assign(next.href);
}

/** Toggle play/pause in place (no navigation). */
function togglePlay(
  playlist: Playlist,
  state: PlayerState,
  persist: (s: PlayerState) => void,
): void {
  state.paused = !state.paused;
  applyPaused(state.paused);
  applyViewState(playlist, state);
  persist(state);
}

function init(): void {
  const playlist = readPlaylist();
  if (!playlist || playlist.p.length === 0) return; // not a player-shell page

  const state = loadState(playlist);

  // Navigation = play: a project / journey-track page becomes now playing.
  const fromPath = itemFromPath(playlist);
  if (fromPath && (fromPath.type !== state.nowType || fromPath.id !== state.nowId)) {
    state.nowType = fromPath.type;
    state.nowId = fromPath.id;
    state.paused = false;
  }
  saveState(state);

  // Hydrate everything from the resolved state.
  renderBar(playlist, state);
  applyPaused(state.paused);
  applyViewState(playlist, state);

  // Transport controls.
  document.querySelector('[data-pb-prev]')?.addEventListener('click', () => step(playlist, state, -1));
  document.querySelector('[data-pb-next]')?.addEventListener('click', () => step(playlist, state, 1));
  document
    .querySelector('[data-pb-play]')
    ?.addEventListener('click', () => togglePlay(playlist, state, saveState));

  // Tracklist rows: select-then-open. Clicking a row that isn't now playing
  // selects it in place (no navigation); clicking the now-playing row follows
  // the link to the project page. Journey rows carry no data-track-id, so the
  // album tracklist keeps its plain-link behavior.
  document.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[data-track-id]');
    if (!row || !row.dataset.trackId) return;
    const id = row.dataset.trackId;
    if (state.nowType === 'p' && state.nowId === id) return; // second click → open
    if (!findItem(playlist.p, id)) return;
    e.preventDefault();
    state.nowType = 'p';
    state.nowId = id;
    state.paused = false;
    saveState(state);
    renderBar(playlist, state);
    applyPaused(state.paused);
    applyViewState(playlist, state);
  });

  // Hero big-play (project detail): the page already IS the now-playing project
  // (navigation = play), so this toggles pause in place.
  document.querySelector<HTMLElement>('[data-play][data-project]')?.addEventListener('click', () => {
    togglePlay(playlist, state, saveState);
  });

  // Keyboard: Space = play/pause, arrows = prev/next. Never hijack form fields,
  // links, or buttons (so Space over a focused control doesn't double-fire).
  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, a, button, [contenteditable="true"]')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay(playlist, state, saveState);
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      step(playlist, state, 1);
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      step(playlist, state, -1);
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
})();
