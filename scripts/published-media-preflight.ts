import { fileURLToPath } from 'node:url';
import { createQueryable } from './db';
import { findInvalidPublishedMedia, type PublishedMediaPreflightRecord } from '@/lib/db/published-media-preflight';

/**
 * Read-only release compatibility gate. It deliberately selects only public
 * identifiers plus media, validates with the same canonical/legacy rules as
 * public rendering, and emits no media values in its report.
 */
export async function runPublishedMediaPreflight(): Promise<number> {
  const db = createQueryable();
  const result = await db.query<PublishedMediaPreflightRecord>(
    `SELECT id, slug, media
     FROM projects
     WHERE lifecycle_state = 'published'
     ORDER BY id`,
  );
  const findings = findInvalidPublishedMedia(result.rows);
  console.log(JSON.stringify({ status: findings.length === 0 ? 'pass' : 'fail', findings }, null, 2));
  return findings.length === 0 ? 0 : 1;
}

const isCli = process.argv[1] === fileURLToPath(import.meta.url);
if (isCli) {
  runPublishedMediaPreflight().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
