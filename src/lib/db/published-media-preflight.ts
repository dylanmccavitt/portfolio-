import { adaptLegacyProjectMedia } from '@/lib/projects/legacy-adapter';
import { ProjectMediaSchema } from '@/lib/projects/schema';

export interface PublishedMediaPreflightRecord {
  id: string;
  slug: string;
  media: unknown;
}

export interface PublishedMediaPreflightFinding {
  id: string;
  slug: string;
  code: 'invalid_media';
}

/**
 * Reuse the public-read media validation path before a release. The report is
 * deliberately redacted: records can identify a bad publication without
 * serializing unreviewed media content or URLs into operational evidence.
 */
export function findInvalidPublishedMedia(
  records: readonly PublishedMediaPreflightRecord[],
): PublishedMediaPreflightFinding[] {
  const findings: PublishedMediaPreflightFinding[] = [];
  for (const record of records) {
    try {
      const canonical = ProjectMediaSchema.array().safeParse(record.media);
      if (!canonical.success) adaptLegacyProjectMedia(record.media, record.id);
    } catch {
      findings.push({ id: record.id, slug: record.slug, code: 'invalid_media' });
    }
  }
  return findings;
}
