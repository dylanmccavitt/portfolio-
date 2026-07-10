import { z } from 'zod';

export const PROJECT_AREAS = [
  'Shipped & Client Work',
  'Apps',
  'AI & Developer Tools',
  'Side Projects & Experiments',
  'Coursework',
] as const;

export const ProjectAreaSchema = z.enum(PROJECT_AREAS);
export type ProjectArea = z.infer<typeof ProjectAreaSchema>;

const NormalizedStringSchema = z.string().trim().min(1);

function hasAllowedProtocol(value: string, protocols: readonly string[]): boolean {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function isApprovedRootRelativePath(value: string, prefixes: readonly string[]): boolean {
  if (
    !value.startsWith('/')
    || value.startsWith('//')
    || value.includes('\\')
    || value.includes('%')
  ) return false;

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return false;
  }
  if (decoded.split(/[/?#]/).some((segment) => segment === '.' || segment === '..')) return false;

  const parsed = new URL(value, 'https://portfolio.invalid');
  return parsed.origin === 'https://portfolio.invalid' && prefixes.some((prefix) => parsed.pathname.startsWith(prefix));
}

function isMediaSource(value: string, prefixes: readonly string[]): boolean {
  return hasAllowedProtocol(value, ['https:']) || isApprovedRootRelativePath(value, prefixes);
}

export const ProjectLinkSchema = z.strictObject({
  label: NormalizedStringSchema,
  href: NormalizedStringSchema.refine((value) => hasAllowedProtocol(value, ['http:', 'https:']), {
    message: 'Project links must use http or https.',
  }),
});
export type ProjectLink = z.infer<typeof ProjectLinkSchema>;

export const ProjectMetricSchema = z.strictObject({
  value: NormalizedStringSchema,
  label: NormalizedStringSchema,
});
export type ProjectMetric = z.infer<typeof ProjectMetricSchema>;

export const ProjectDetailEntrySchema = z.strictObject({
  label: NormalizedStringSchema,
  value: NormalizedStringSchema,
});
export const ProjectDetailSchema = z.union([NormalizedStringSchema, ProjectDetailEntrySchema]);
export type ProjectDetailEntry = z.infer<typeof ProjectDetailEntrySchema>;
export type ProjectDetail = z.infer<typeof ProjectDetailSchema>;

export const PROJECT_SKELETON_KINDS = ['chart', 'dash', 'list', 'code', 'phone'] as const;
export const ProjectSkeletonKindSchema = z.enum(PROJECT_SKELETON_KINDS);
export type ProjectSkeletonKind = z.infer<typeof ProjectSkeletonKindSchema>;

const ImageSourceSchema = NormalizedStringSchema.refine(
  (value) => isMediaSource(value, ['/screenshots/']),
  { message: 'Project images must use https or an approved /screenshots/ path.' },
);
const VideoSourceSchema = NormalizedStringSchema.refine(
  (value) => isMediaSource(value, ['/screenshots/', '/demos/']),
  { message: 'Project videos and posters must use https or an approved /screenshots/ or /demos/ path.' },
);

export const ProjectImageMediaSchema = z.strictObject({
  kind: z.literal('image'),
  src: ImageSourceSchema,
  caption: NormalizedStringSchema,
  phone: z.boolean().optional(),
});
export const ProjectVideoMediaSchema = z.strictObject({
  kind: z.literal('video'),
  src: VideoSourceSchema,
  caption: NormalizedStringSchema,
  poster: VideoSourceSchema.optional(),
  phone: z.boolean().optional(),
});
export const ProjectSkeletonMediaSchema = z.strictObject({
  kind: z.literal('skeleton'),
  skeletonKind: ProjectSkeletonKindSchema,
  caption: NormalizedStringSchema,
});
export const ProjectMediaSchema = z.discriminatedUnion('kind', [
  ProjectImageMediaSchema,
  ProjectVideoMediaSchema,
  ProjectSkeletonMediaSchema,
]);
export type ProjectImageMedia = z.infer<typeof ProjectImageMediaSchema>;
export type ProjectVideoMedia = z.infer<typeof ProjectVideoMediaSchema>;
export type ProjectSkeletonMedia = z.infer<typeof ProjectSkeletonMediaSchema>;
export type ProjectMedia = z.infer<typeof ProjectMediaSchema>;

export const ProjectSlugSchema = z.string().trim().regex(
  /^[a-z0-9][a-z0-9-]{1,63}$/,
  'Slug must be 2-64 lowercase letters, numbers, or hyphens, starting with a letter or number.',
);
export const ProjectYearSchema = z.number().int().min(2000).max(2100);

export const PublicProjectFieldsSchema = z.strictObject({
  slug: ProjectSlugSchema,
  title: NormalizedStringSchema,
  tagline: NormalizedStringSchema,
  area: ProjectAreaSchema,
  year: ProjectYearSchema,
  summary: NormalizedStringSchema,
  activity: z.string().trim(),
  details: z.array(ProjectDetailSchema),
  metrics: z.array(ProjectMetricSchema),
  links: z.array(ProjectLinkSchema),
  media: z.array(ProjectMediaSchema),
});
export type PublicProjectFields = z.infer<typeof PublicProjectFieldsSchema>;

export const ProjectStatusSchema = z.tuple([
  z.enum(['dry', 'live', 'wip', 'done']),
  NormalizedStringSchema,
]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectSeekSchema = z.strictObject({
  from: NormalizedStringSchema,
  to: NormalizedStringSchema,
  pct: z.number().min(0).max(100),
});
export type ProjectSeek = z.infer<typeof ProjectSeekSchema>;

export const CatalogProjectSchema = z.strictObject({
  id: ProjectSlugSchema,
  title: NormalizedStringSchema,
  sym: NormalizedStringSchema,
  area: ProjectAreaSchema,
  status: ProjectStatusSchema,
  year: ProjectYearSchema,
  activity: z.string().trim(),
  hue: z.string().trim().regex(/^#[0-9a-f]{6}$/i),
  wip: z.boolean(),
  money: z.boolean(),
  line: NormalizedStringSchema,
  seek: ProjectSeekSchema,
  links: z.array(ProjectLinkSchema),
  metrics: z.array(ProjectMetricSchema),
  about: z.array(NormalizedStringSchema),
  notes: z.array(NormalizedStringSchema),
  stack: z.array(ProjectDetailEntrySchema),
  shots: z.array(ProjectMediaSchema),
});
export type CatalogProject = z.infer<typeof CatalogProjectSchema>;

export function parsePublicProjectFields(value: unknown): PublicProjectFields {
  return PublicProjectFieldsSchema.parse(value);
}

export function isProjectArea(value: unknown): value is ProjectArea {
  return ProjectAreaSchema.safeParse(value).success;
}
