/**
 * Admin draft detail — the one client island for the review page.
 *
 * It serializes the edit form and drives the three admin mutations (save,
 * approve, publish) against the existing JSON API routes. Every request sends
 * `Content-Type: application/json` (the CSRF defense the routes enforce) and
 * relies on the same-origin `SameSite=Lax` session cookie for auth. Feedback is
 * rendered inline via `textContent`/DOM nodes only, so nothing from a response
 * is ever injected as markup. Buttons are disabled while a request is in flight.
 */

const REQUIRED_STRING_FIELDS = ['slug', 'title', 'tagline', 'area', 'summary'] as const;
const JSON_ARRAY_FIELDS = ['details', 'metrics', 'links', 'media'] as const;

type ApiResponse = {
  ok?: boolean;
  code?: string;
  message?: string;
  projectId?: string;
  [key: string]: unknown;
};

type PayloadResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; message: string };

function initRoot(root: HTMLElement): void {
  const draftId = root.dataset.draftId?.trim();
  const form = root.querySelector<HTMLFormElement>('[data-admin-form]');
  const feedback = root.querySelector<HTMLElement>('[data-admin-feedback]');
  const saveBtn = root.querySelector<HTMLButtonElement>('[data-admin-save]');
  const approveBtn = root.querySelector<HTMLButtonElement>('[data-admin-approve]');
  const publishBtn = root.querySelector<HTMLButtonElement>('[data-admin-publish]');
  const confirmProvenance = root.querySelector<HTMLInputElement>('[data-admin-confirm-provenance]');
  const confirmPrivacy = root.querySelector<HTMLInputElement>('[data-admin-confirm-privacy]');
  if (!draftId || !form || !feedback) return;

  const buttons = [saveBtn, approveBtn, publishBtn].filter(
    (btn): btn is HTMLButtonElement => btn instanceof HTMLButtonElement,
  );
  let busy = false;

  const setBusy = (next: boolean): void => {
    busy = next;
    for (const btn of buttons) btn.disabled = next;
  };

  const showMessage = (tone: 'error' | 'success', text: string, link?: string): void => {
    feedback.dataset.tone = tone;
    const span = document.createElement('span');
    span.textContent = text;
    feedback.replaceChildren(span);
    if (link) {
      feedback.append(document.createTextNode(' '));
      const anchor = document.createElement('a');
      anchor.href = link;
      anchor.textContent = link;
      feedback.append(anchor);
    }
    feedback.hidden = false;
  };

  const send = async (url: string, body: Record<string, unknown>): Promise<ApiResponse | null> => {
    const res = await fetch(url, {
      method: url.endsWith('/approve') || url.endsWith('/publish') ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let json: ApiResponse;
    try {
      json = (await res.json()) as ApiResponse;
    } catch {
      json = {};
    }
    if (!res.ok || json.ok === false) {
      showMessage('error', json.message ?? `Request failed (${res.status}).`);
      return null;
    }
    return json;
  };

  const collectFields = (): PayloadResult => {
    const data = new FormData(form);
    const payload: Record<string, unknown> = {};

    for (const field of REQUIRED_STRING_FIELDS) {
      payload[field] = String(data.get(field) ?? '');
    }

    const activity = data.get('activity');
    if (activity !== null) payload.activity = String(activity);

    const yearRaw = String(data.get('year') ?? '').trim();
    const yearNum = Number(yearRaw);
    payload.year = yearRaw !== '' && Number.isInteger(yearNum) ? yearNum : yearRaw;

    for (const field of JSON_ARRAY_FIELDS) {
      const raw = String(data.get(field) ?? '').trim();
      if (!raw) continue;
      try {
        payload[field] = JSON.parse(raw);
      } catch {
        return { ok: false, message: `The ${field} field must be valid JSON (an array).` };
      }
    }

    return { ok: true, payload };
  };

  const run = async (task: () => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await task();
    } catch {
      showMessage('error', 'Something went wrong reaching the server. Try again.');
    } finally {
      setBusy(false);
    }
  };

  saveBtn?.addEventListener('click', () => {
    void run(async () => {
      const fields = collectFields();
      if (!fields.ok) {
        showMessage('error', fields.message);
        return;
      }
      const result = await send(`/api/admin/drafts/${draftId}`, fields.payload);
      if (result) showMessage('success', result.message ?? 'Draft fields saved.');
    });
  });

  approveBtn?.addEventListener('click', () => {
    void run(async () => {
      const result = await send(`/api/admin/drafts/${draftId}/approve`, {});
      if (result) showMessage('success', result.message ?? 'Draft approved for publish.');
    });
  });

  publishBtn?.addEventListener('click', () => {
    void run(async () => {
      const provenance = confirmProvenance?.checked === true;
      const privacy = confirmPrivacy?.checked === true;
      if (!provenance || !privacy) {
        showMessage('error', 'Confirm provenance and privacy review before publishing.');
        return;
      }
      const result = await send(`/api/admin/drafts/${draftId}/publish`, {
        confirmProvenance: provenance,
        confirmPrivacy: privacy,
      });
      if (!result) return;
      const slug = String(new FormData(form).get('slug') ?? '').trim();
      const url = slug ? `/projects/${slug}` : undefined;
      showMessage('success', result.message ?? 'Draft published.', url);
    });
  });
}

document.querySelectorAll<HTMLElement>('[data-admin-root]').forEach(initRoot);
