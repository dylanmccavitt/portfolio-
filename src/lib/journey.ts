/**
 * The homepage Journey rows.
 *
 * The Journey list used to be its own hardcoded array in `frost-data.js`, which
 * meant the site had two career histories: the resume timeline, governed by the
 * public-track allowlist in `src/data/resume.ts`, and this one, governed by
 * nothing. The withheld-track class of drift — a job that is on the timeline and
 * deliberately off the site — could recur here without any check noticing.
 *
 * So the rows are built here instead, from `publicResumeTracks()`: the same one
 * door the resume page, the per-track OG images, and the DM corpus read. A
 * track outside `PUBLIC_RESUME_TRACK_IDS` cannot reach the homepage, and one
 * added to the allowlist appears everywhere at once. `JOURNEY_LABELS` supplies
 * display copy only — shorter dates and roles for a single-line row — and
 * cannot add, remove, or reorder anything.
 */
import { publicResumeTracks } from '@/data/resume';
import { JOURNEY_LABELS } from '@/components/frost/frost-data.js';

export interface JourneyRow {
  /** The resume track this row is, so a consumer can check it against the allowlist. */
  id: string;
  when: string;
  place: string;
  role: string;
}

interface JourneyLabel {
  when?: string;
  place?: string;
  role?: string;
}

const LABELS = JOURNEY_LABELS as Record<string, JourneyLabel | undefined>;

/** Every Journey row the homepage publishes, chronologically. */
export function publicJourneyRows(): JourneyRow[] {
  return publicResumeTracks().map((track) => {
    const label = LABELS[track.id] ?? {};
    return {
      id: track.id,
      when: label.when ?? track.when,
      place: label.place ?? track.title,
      role: label.role ?? track.role,
    };
  });
}
