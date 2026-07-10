import {
  ProjectDetailSchema,
  ProjectDetailEntrySchema,
  ProjectLinkSchema,
  ProjectMediaSchema,
  ProjectMetricSchema,
  ProjectSeekSchema,
  ProjectStatusSchema,
  type ProjectDetail,
  type ProjectDetailEntry,
  type ProjectLink,
  type ProjectMedia,
  type ProjectMetric,
  type ProjectSeek,
  type ProjectStatus,
} from './schema';

function legacyError(projectId: string, field: string): Error {
  return new Error(`Project record ${projectId} has invalid legacy ${field}.`);
}

export function adaptLegacyProjectLinks(value: unknown, projectId: string): ProjectLink[] {
  if (!Array.isArray(value)) throw legacyError(projectId, 'links');
  return value.map((item) => {
    const candidate = Array.isArray(item) && item.length === 2
      ? { label: item[0], href: item[1] }
      : isRecord(item) && typeof item.label === 'string' && typeof item.url === 'string'
        ? { label: item.label, href: item.url }
        : item;
    const parsed = ProjectLinkSchema.safeParse(candidate);
    if (!parsed.success) throw legacyError(projectId, 'links');
    return parsed.data;
  });
}

export function adaptLegacyProjectMetrics(value: unknown, projectId: string): ProjectMetric[] {
  if (!Array.isArray(value)) throw legacyError(projectId, 'metrics');
  return value.map((item) => {
    const candidate = Array.isArray(item) && item.length === 2
      ? { value: item[0], label: item[1] }
      : isRecord(item) && typeof item.label === 'string' && typeof item.value === 'number'
        ? { value: String(item.value), label: item.label }
        : item;
    const parsed = ProjectMetricSchema.safeParse(candidate);
    if (!parsed.success) throw legacyError(projectId, 'metrics');
    return parsed.data;
  });
}

export function adaptLegacyProjectDetails(value: unknown, projectId: string): ProjectDetail[] {
  if (!Array.isArray(value)) throw legacyError(projectId, 'details');

  const details: ProjectDetail[] = [];
  for (const item of value) {
    if (isLegacyDetailMetadata(item)) continue;
    const candidate = Array.isArray(item) && item.length === 2
      ? { label: item[0], value: item[1] }
      : isRecord(item) && typeof item.label === 'string' && typeof item.value === 'number'
        ? { label: item.label, value: String(item.value) }
        : item;
    const parsed = ProjectDetailSchema.safeParse(candidate);
    if (!parsed.success) throw legacyError(projectId, 'details');
    details.push(parsed.data);
  }
  return details;
}

export function adaptLegacyProjectDetailEntries(value: unknown, projectId: string): ProjectDetailEntry[] {
  if (!Array.isArray(value)) throw legacyError(projectId, 'detail entries');
  return value.map((item) => {
    const candidate = Array.isArray(item) && item.length === 2
      ? { label: item[0], value: item[1] }
      : item;
    const parsed = ProjectDetailEntrySchema.safeParse(candidate);
    if (!parsed.success) throw legacyError(projectId, 'detail entries');
    return parsed.data;
  });
}

export function adaptLegacyProjectMedia(value: unknown, projectId: string): ProjectMedia[] {
  if (!Array.isArray(value)) throw legacyError(projectId, 'media');
  return value.map((item) => {
    const candidate = legacyMediaCandidate(item);
    const parsed = ProjectMediaSchema.safeParse(candidate);
    if (!parsed.success) throw legacyError(projectId, 'media');
    return parsed.data;
  });
}

export function adaptLegacyProjectStatus(value: unknown, projectId: string): ProjectStatus {
  const parsed = ProjectStatusSchema.safeParse(value);
  if (!parsed.success) throw legacyError(projectId, 'status');
  return parsed.data;
}

export function adaptLegacyProjectSeek(value: unknown, projectId: string): ProjectSeek {
  const parsed = ProjectSeekSchema.safeParse(value);
  if (!parsed.success) throw legacyError(projectId, 'seek');
  return parsed.data;
}

function legacyMediaCandidate(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (value.kind === 'image' || value.kind === 'video' || value.kind === 'skeleton') return value;

  const caption = [value.cap, value.caption, value.alt, value.label]
    .find((item): item is string => typeof item === 'string' && item.trim().length > 0);
  if (!caption) return value;

  const sourceKeys = ['img', 'video', 'src', 'url'].filter((field) => Object.hasOwn(value, field));
  if (sourceKeys.length > 1) return value;

  if (typeof value.video === 'string') {
    return {
      kind: 'video',
      src: value.video,
      caption,
      ...(typeof value.poster === 'string' ? { poster: value.poster } : {}),
      ...(typeof value.phone === 'boolean' ? { phone: value.phone } : {}),
    };
  }
  if (value.type === 'video' && typeof value.src === 'string') {
    return {
      kind: 'video',
      src: value.src,
      caption,
      ...(typeof value.poster === 'string' ? { poster: value.poster } : {}),
      ...(typeof value.phone === 'boolean' ? { phone: value.phone } : {}),
    };
  }
  if (typeof value.kind === 'string' && LEGACY_SKELETON_KINDS.has(value.kind)) {
    if (sourceKeys.length > 0) return value;
    return { kind: 'skeleton', skeletonKind: value.kind, caption };
  }

  const source = value.img ?? value.src ?? value.url;
  if (
    typeof source === 'string'
    && (value.type === undefined || value.type === 'image')
  ) {
    return {
      kind: 'image',
      src: source,
      caption,
      ...(typeof value.phone === 'boolean' ? { phone: value.phone } : {}),
    };
  }
  return value;
}

function isLegacyDetailMetadata(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === 1 && Object.hasOwn(value, 'provenance');
}

const LEGACY_SKELETON_KINDS = new Set(['chart', 'dash', 'list', 'code', 'phone']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
