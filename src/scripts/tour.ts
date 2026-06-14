/**
 * Tour-state island (#62) — the one earned exception to the zero-client-JS rule
 * for `/hiring`, mirroring `src/scripts/player.ts`. A single vanilla-TS module,
 * no framework, that turns the stacked beats into a single-screen stepper:
 *
 *   - sets `html[data-tour-js]` so the page's CSS flips from the no-JS stacked
 *     layout to the one-beat-per-screen stepper (chrome gated behind that flag);
 *   - injects one dot per beat into `[data-tour-dots]`;
 *   - `show(step)`: reveals only the active `[data-step]` (`.is-active`), syncs
 *     the active dot, disables Back at step 0, relabels Next per position
 *     ("Start the tour →" at 0, "Next →" in the middle, "Continue to the full
 *     site →" on the last beat — where Next navigates to /library), resets the
 *     active step's `<details>` to closed, and hides the top-bar resume CTA only
 *     on the ask beat (so every view has exactly one resume CTA);
 *   - wires prev/next clicks, dot clicks (jump), and ArrowLeft/ArrowRight.
 *
 * Progressive enhancement: with JS off, the flag is never set, so the CSS keeps
 * every beat stacked and scrollable, hides the stepper nav/dots, shows the
 * top-bar resume, and the `<details>` stay usable. State is in-memory only (no
 * localStorage — the tour always starts at the hook).
 *
 * Wrapped in an IIFE to keep declarations out of the page's global scope and
 * `astro check`'s shared-scope type-checking clean (same as player.ts).
 */

(() => {
  const root = document.querySelector<HTMLElement>('[data-tour]');
  if (!root) return; // not the tour page

  // Flip the page from the no-JS stacked layout into the stepper.
  document.documentElement.dataset.tourJs = '';

  const steps = Array.from(root.querySelectorAll<HTMLElement>('[data-step]'));
  if (steps.length === 0) return;

  const dotsHost = root.querySelector<HTMLElement>('[data-tour-dots]');
  const prevBtn = root.querySelector<HTMLButtonElement>('[data-tour-prev]');
  const nextBtn = root.querySelector<HTMLButtonElement>('[data-tour-next]');
  const resumeCta = document.querySelector<HTMLElement>('[data-tour-resume]');

  const last = steps.length - 1;
  // The ask beat owns the in-card resume CTA, so the top-bar one hides there.
  const ASK_INDEX = 7;
  const HANDOFF_HREF = '/library';

  let step = 0;

  // Build the dots once — one button per beat, jumping to its index on click.
  const dots: HTMLButtonElement[] = [];
  if (dotsHost) {
    steps.forEach((_, i) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'dot';
      dot.dataset.i = String(i);
      dot.setAttribute('aria-label', `Step ${i + 1} of ${steps.length}`);
      dot.addEventListener('click', (e) => {
        show(i);
        // Drop focus so the keyboard guard doesn't swallow the next Arrow key.
        (e.currentTarget as HTMLElement).blur();
      });
      dotsHost.appendChild(dot);
      dots.push(dot);
    });
  }

  /** Reveal `i`, hide the rest, and sync all the stepper chrome. */
  function show(i: number): void {
    step = Math.min(Math.max(i, 0), last);

    steps.forEach((section, idx) => {
      const active = idx === step;
      section.classList.toggle('is-active', active);
      // Per-step reset: collapse the active step's "More on this" on entry.
      if (active) {
        section
          .querySelectorAll<HTMLDetailsElement>('[data-tour-details]')
          .forEach((d) => {
            d.open = false;
          });
      }
    });

    dots.forEach((dot, idx) => dot.classList.toggle('on', idx === step));

    if (prevBtn) prevBtn.disabled = step === 0;

    if (nextBtn) {
      if (step === last) {
        nextBtn.textContent = 'Continue to the full site →';
      } else if (step === 0) {
        nextBtn.textContent = 'Start the tour →';
      } else {
        nextBtn.textContent = 'Next →';
      }
    }

    // One resume CTA per view: hide the top-bar CTA only on the ask beat.
    if (resumeCta) resumeCta.style.display = step === ASK_INDEX ? 'none' : '';
  }

  /** Advance, or hand off to the library from the last beat. */
  function next(): void {
    if (step === last) {
      location.assign(HANDOFF_HREF);
      return;
    }
    show(step + 1);
  }

  function prev(): void {
    if (step > 0) show(step - 1);
  }

  // Drop focus after the step change so the keyboard guard (which ignores
  // keydown over buttons) doesn't swallow the next ArrowLeft/ArrowRight while
  // the Back/Next button retains focus.
  prevBtn?.addEventListener('click', (e) => {
    prev();
    (e.currentTarget as HTMLElement).blur();
  });
  nextBtn?.addEventListener('click', (e) => {
    next();
    (e.currentTarget as HTMLElement).blur();
  });

  // Keyboard: arrows step the tour. Never hijack form fields, links, or buttons
  // (so arrows over a focused control don't double-fire) — mirrors player.ts.
  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, a, button, [contenteditable="true"]')) {
      return;
    }
    if (e.code === 'ArrowRight') {
      e.preventDefault();
      next();
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      prev();
    }
  });

  show(0);
})();
