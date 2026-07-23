import { collectionOwnsArrowKey } from './device-keyboard';

const desktopRenderer = window.matchMedia('(min-width: 769px)');
let stopRenderer: (() => void) | undefined;
let loadVersion = 0;

async function syncRenderer(): Promise<void> {
  const version = ++loadVersion;

  if (!desktopRenderer.matches) {
    stopRenderer?.();
    stopRenderer = undefined;
    document.documentElement.dataset.webgl = 'mobile-static';
    return;
  }

  const stage = document.querySelector<HTMLElement>('[data-device-stage]');
  const canvas = document.querySelector<HTMLCanvasElement>('[data-device-canvas]');
  if (!stage || !canvas || stopRenderer) return;

  const { startDevice } = await import('./device-renderer');
  if (version !== loadVersion || !desktopRenderer.matches) return;
  stopRenderer = startDevice(stage, canvas);
}

desktopRenderer.addEventListener('change', () => void syncRenderer());
window.addEventListener('pagehide', () => {
  loadVersion += 1;
  stopRenderer?.();
  stopRenderer = undefined;
}, { once: true });

void syncRenderer();

const keyboardCollections = [
  '.home-menu a, .home-menu-guide',
  '.work-row',
  '.journey-list a',
];

function activeCollection(): HTMLElement[] {
  for (const selector of keyboardCollections) {
    const items = Array.from(document.querySelectorAll<HTMLElement>(selector))
      .filter((item) => !item.hasAttribute('disabled'));
    if (items.length > 0) return items;
  }
  return [];
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]'));
}

function isNativeInteractiveTarget(target: HTMLElement | null): boolean {
  return Boolean(target?.closest('a[href], button, input, textarea, select, summary'));
}

document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) return;
  const dialog = document.querySelector<HTMLElement>('[data-dm-dialog]');
  if (dialog && !dialog.hidden) return;

  if (event.key === '/') {
    const trigger = document.querySelector<HTMLElement>('[data-dm-open]');
    if (trigger) {
      event.preventDefault();
      trigger.click();
    }
    return;
  }

  if (event.key === 'Escape') {
    if (window.location.pathname === '/') {
      if (document.referrer.startsWith(window.location.origin)) history.back();
      return;
    }
    event.preventDefault();
    window.location.assign(window.location.pathname.startsWith('/projects/') ? '/library' : '/');
    return;
  }

  const items = activeCollection();
  if (items.length === 0) return;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const activeIndex = items.findIndex((item) => item === active);
  const selectedIndex = Math.max(0, items.findIndex((item) =>
    item.classList.contains('selected') || item.classList.contains('is-key-selected')));
  const currentIndex = activeIndex >= 0 ? activeIndex : selectedIndex;
  const delta = event.key === 'ArrowDown' || event.key === 'ArrowRight'
    ? 1
    : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
      ? -1
      : 0;

  if (delta !== 0 && collectionOwnsArrowKey(activeIndex, isNativeInteractiveTarget(active))) {
    event.preventDefault();
    const nextIndex = (currentIndex + delta + items.length) % items.length;
    items.forEach((item, index) => item.classList.toggle('is-key-selected', index === nextIndex));
    items[nextIndex]?.focus();
    return;
  }

  if (event.key === 'Enter' && activeIndex >= 0) {
    event.preventDefault();
    items[activeIndex]?.click();
  }
});
