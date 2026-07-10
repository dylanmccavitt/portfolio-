import { z } from 'zod';
import type { AnswerBlock, DMChatRequest, ProjectFact, ProjectFactPacket, ProjectSummary, PublicRagCitation } from './contract';
import type { ProjectToolResultStatus, PublicDMDataTools } from './data-tools';

const ProjectFactFieldSchema = z.enum(['tagline', 'status', 'year', 'activity', 'area', 'about', 'notes']);
const ProjectClaimSchema = z.strictObject({
  projectId: z.string().min(1),
  fields: z.array(ProjectFactFieldSchema).min(1).max(7),
  metricIds: z.array(z.string()).max(8).default([]),
  linkIds: z.array(z.string()).max(8).default([]),
  citationIds: z.array(z.string()).max(8).default([]),
});
const ProjectDraftSchema = z.strictObject({
  claims: z.array(ProjectClaimSchema).min(1).max(8),
});

export type ProjectDraft = z.infer<typeof ProjectDraftSchema>;

export function requestNeedsProjectFacts(request: DMChatRequest): boolean {
  if (request.context?.projectIds?.length || request.context?.fitCheck) return true;
  const current = request.message.trim().toLowerCase();
  if (!current || /^(?:hi|hello|hey|thanks|thank you|good (?:morning|afternoon|evening))[!.?\s]*$/.test(current)) {
    return false;
  }
  const strongProjectIntent = /\b(projects?|built|build|ship|shipped|backend|ai|client|automation|tool|tooling|apps?|integration|live|done|portfolio|most impressive|best|strongest|top|favorite)\b/;
  const publicResumeOrContactIntent = /\b(resume|résumé|cv|contact|email|reach|phone|location|education|degree|school|university|career|employment|employer|job history|open to work|availability)\b/;
  if (publicResumeOrContactIntent.test(current) && !strongProjectIntent.test(current)) return false;

  const recentConversation = request.conversation?.slice(-6).map((message) => message.content.toLowerCase()).join(' ') ?? '';
  if (strongProjectIntent.test(current) || strongProjectIntent.test(recentConversation)) return true;

  // Ambiguous factual turns default to grounded retrieval. This covers aliases,
  // unknown project names, and follow-ups such as “What about it?” without
  // maintaining a second project-name allowlist in the router.
  return true;
}

export async function retrieveProjectFactPacket(
  request: DMChatRequest,
  tools: PublicDMDataTools,
): Promise<ProjectFactPacket> {
  if (!requestNeedsProjectFacts(request)) return emptyPacket(request.message);

  const normalized = request.message.toLowerCase();
  const query = contextualProjectQuery(request);
  const allProjects = await tools.allPublishedProjects();
  const namedProjectIds = resolveNamedProjectIds(request, allProjects);
  let operation: ProjectFactPacket['operation'];
  let result: { projects: ProjectSummary[]; resultStatus: ProjectToolResultStatus; fallbackUsed?: boolean };

  if (request.context?.projectIds?.length) {
    operation = 'rankProjects';
    result = await tools.rankProjects({ ids: request.context.projectIds, limit: request.context.projectIds.length });
  } else if (namedProjectIds.length > 0) {
    operation = 'rankProjects';
    result = await tools.rankProjects({ ids: namedProjectIds, limit: namedProjectIds.length });
  } else if (/\b(most impressive|best|strongest|top|favorite)\b/.test(normalized)) {
    operation = 'rankProjects';
    result = await tools.rankProjects({ intent: query, limit: 3 });
  } else if (isBroadProjectOverviewQuery(normalized)) {
    operation = 'rankProjects';
    const overview = await tools.rankProjects({
      intent: 'representative shipped live client product AI automation work',
      limit: 3,
    });
    result = {
      ...overview,
      resultStatus: overview.projects.length > 0 ? 'complete' : 'empty',
    };
  } else {
    const status = statusIntent(normalized);
    if (status && isStatusListIntent(normalized)) {
      operation = 'filterProjects';
      result = await tools.filterProjects({ status, limit: 8 });
    } else {
      operation = 'searchProjects';
      result = await tools.searchProjects({ query, limit: 4 });
    }
  }

  return {
    operation,
    status: result.resultStatus,
    query: request.message,
    fallbackUsed: result.fallbackUsed === true || result.resultStatus === 'fallback',
    projects: result.projects.map(projectFact),
    citations: [],
  };
}

export function deterministicProjectOverview(packet: ProjectFactPacket): string | null {
  if (!isBroadProjectOverviewQuery(packet.query) || packet.projects.length === 0) return null;
  const projects = packet.projects.slice(0, 3);
  const introduction = projects.length === 3
    ? 'Here are three representative projects from Dylan’s published work.'
    : 'Here are representative projects from Dylan’s published work.';
  return [
    introduction,
    ...projects.map((project) => `${project.title} — ${sentence(project.tagline)}`),
    'Ask me to go deeper on any one of them.',
  ].join('\n\n');
}

export function withPacketCitations(packet: ProjectFactPacket, citations: PublicRagCitation[]): ProjectFactPacket {
  const allowed = new Set(packet.projects.map((project) => project.id));
  return { ...packet, citations: citations.filter((citation) => allowed.has(citation.projectId)) };
}

export function projectPacketBlocks(packet: ProjectFactPacket): AnswerBlock[] {
  if (packet.projects.length === 0) return [];
  const items = packet.projects.map(factSummary);
  const ids = items.map((project) => project.id);
  const blocks: AnswerBlock[] = [
    { kind: 'projects', ids, items },
    { kind: 'evidence', projectIds: ids, projects: items },
  ];
  if (packet.citations.length > 0) {
    blocks.push({ kind: 'evidence', projectIds: ids, ragSources: packet.citations });
  }
  return blocks;
}

export function projectPacketPrompt(packet: ProjectFactPacket): string {
  return [
    'For project questions, return exactly one JSON answer plan and no markdown or prose fields.',
    'Shape: {"claims":[{"projectId":"...","fields":["tagline","status"],"metricIds":[],"linkIds":[],"citationIds":[]}]}.',
    'Allowed fields: tagline, status, year, activity, area, about, notes.',
    'Select only ids and fields from PROJECT_FACT_PACKET. Every metric, link, and citation id must belong to that claim project.',
    'The server will render all prose from the selected facts. Do not add text, explanations, names, numbers, URLs, or facts outside this shape.',
    `PROJECT_FACT_PACKET=${JSON.stringify(packet)}`,
  ].join('\n');
}

export function validateProjectDraft(
  raw: string,
  packet: ProjectFactPacket,
): { ok: true; draft: ProjectDraft } | { ok: false; reason: string } {
  const parsed = parseDraft(raw);
  if (!parsed.success) return { ok: false, reason: 'project draft was not valid structured JSON' };
  const draft = parsed.data;
  const packetProjects = new Map(packet.projects.map((project) => [project.id, project]));
  const metrics = new Map(packet.projects.flatMap((project) => project.metrics.map((metric) => [metric.id, metric] as const)));
  const links = new Map(packet.projects.flatMap((project) => project.links.map((link) => [link.id, link] as const)));
  const citations = new Map(packet.citations.map((citation) => [citation.ragSourceId, citation] as const));
  const claimedProjects = new Set<string>();

  for (const claim of draft.claims) {
    if (claimedProjects.has(claim.projectId)) return { ok: false, reason: 'duplicate project claim' };
    claimedProjects.add(claim.projectId);
    if (!packetProjects.has(claim.projectId)) return { ok: false, reason: 'project reference escaped fact packet' };
    if (new Set(claim.fields).size !== claim.fields.length) return { ok: false, reason: 'duplicate project field reference' };
    if (new Set(claim.metricIds).size !== claim.metricIds.length) return { ok: false, reason: 'duplicate metric reference' };
    if (new Set(claim.linkIds).size !== claim.linkIds.length) return { ok: false, reason: 'duplicate link reference' };
    if (new Set(claim.citationIds).size !== claim.citationIds.length) return { ok: false, reason: 'duplicate citation reference' };
    if (claim.metricIds.some((id) => metrics.get(id)?.projectId !== claim.projectId)) {
      return { ok: false, reason: 'metric reference escaped claim project' };
    }
    if (claim.linkIds.some((id) => links.get(id)?.projectId !== claim.projectId)) {
      return { ok: false, reason: 'link reference escaped claim project' };
    }
    if (claim.citationIds.some((id) => citations.get(id)?.projectId !== claim.projectId)) {
      return { ok: false, reason: 'citation reference escaped claim project' };
    }
  }
  return { ok: true, draft };
}

export function renderProjectDraft(draft: ProjectDraft, packet: ProjectFactPacket): string {
  const projects = new Map(packet.projects.map((project) => [project.id, project]));
  const metrics = new Map(packet.projects.flatMap((project) => project.metrics.map((metric) => [metric.id, metric] as const)));
  const links = new Map(packet.projects.flatMap((project) => project.links.map((link) => [link.id, link] as const)));
  const citations = new Map(packet.citations.map((citation) => [citation.ragSourceId, citation] as const));
  const paragraphs = draft.claims.flatMap((claim) => {
    const project = projects.get(claim.projectId);
    if (!project) return [];
    const facts = claim.fields.flatMap((field) => renderProjectField(project, field));
    for (const id of claim.metricIds) {
      const metric = metrics.get(id);
      if (metric) facts.push(`Metric — ${metric.label}: ${metric.value}.`);
    }
    for (const id of claim.linkIds) {
      const link = links.get(id);
      if (link) facts.push(`${link.label}: ${link.href}.`);
    }
    for (const id of claim.citationIds) {
      const citation = citations.get(id);
      if (citation) facts.push(`Approved source${citation.filename ? ` ${citation.filename}` : ''}: ${sentence(citation.text)}`);
    }
    return [`${project.title}: ${facts.join(' ')}`];
  });
  const disclosure = packet.status === 'fallback'
    ? 'I did not find an exact published match; these are the returned fallback records.'
    : packet.status === 'partial'
      ? 'The published records returned a partial set.'
      : '';
  return [disclosure, ...paragraphs].filter(Boolean).join('\n\n');
}

function renderProjectField(project: ProjectFact, field: z.infer<typeof ProjectFactFieldSchema>): string[] {
  switch (field) {
    case 'tagline':
      return [sentence(project.tagline)];
    case 'status':
      return [`Status: ${project.status[1] || project.status[0]}.`];
    case 'year':
      return [`Year: ${project.year}.`];
    case 'activity':
      return [`Activity: ${sentence(project.activity)}`];
    case 'area':
      return [`Area: ${project.area}.`];
    case 'about':
      return project.about.map(sentence);
    case 'notes':
      return project.notes.map(sentence);
  }
}

function sentence(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

export function deterministicProjectFallback(packet: ProjectFactPacket): string {
  if (packet.projects.length === 0) {
    return 'I did not find a matching published project in the records returned for this question.';
  }
  const names = packet.projects.map((project) => project.title).join(', ');
  if (packet.status === 'fallback') {
    return `I did not find an exact published match. The returned fallback projects are ${names}.`;
  }
  if (packet.status === 'partial') {
    return `The published records returned a partial set: ${names}.`;
  }
  return `The published projects returned for this question are ${names}.`;
}

function emptyPacket(query: string): ProjectFactPacket {
  return { operation: 'none', status: 'empty', query, fallbackUsed: false, projects: [], citations: [] };
}

function contextualProjectQuery(request: DMChatRequest): string {
  const prior = request.conversation?.slice(-4).map((message) => message.content.trim()).filter(Boolean) ?? [];
  const fitCheck = request.context?.fitCheck?.jobDescription.trim();
  return [...prior, request.message.trim(), ...(fitCheck ? [fitCheck] : [])].join(' ').slice(-1_200);
}

function resolveNamedProjectIds(request: DMChatRequest, projects: ProjectSummary[]): string[] {
  const current = normalizeIdentityText(request.message);
  const currentMatches = identityMatches(current, projects);
  if (currentMatches.length > 0) return currentMatches;
  if (!/\b(it|that|this|one|what about|how about)\b/.test(current)) return [];

  const conversation = request.conversation?.slice(-6).toReversed() ?? [];
  for (const message of conversation) {
    const matches = identityMatches(normalizeIdentityText(message.content), projects);
    if (matches.length > 0) return [matches.at(-1) as string];
  }
  return [];
}

function identityMatches(text: string, projects: ProjectSummary[]): string[] {
  const padded = ` ${text} `;
  return projects.flatMap((project) => {
    const aliases = [project.id, project.slug, project.title]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 1)
      .map(normalizeIdentityText);
    return aliases.some((alias) => padded.includes(` ${alias} `)) ? [project.id] : [];
  });
}

function normalizeIdentityText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function isBroadProjectOverviewQuery(value: string): boolean {
  const normalized = normalizeIdentityText(value);
  if (!/\b(projects|portfolio|work)\b/.test(normalized)) return false;
  if (/\b(most impressive|best|strongest|top|favorite|live|shipped|client|backend|automation|technical|architecture|specific)\b/.test(normalized)) {
    return false;
  }
  return /\b(?:tell me about|overview|show me|what (?:has|did|are)|give me (?:an )?overview)\b/.test(normalized)
    || /\bdylan(?:s| s)? projects\b/.test(normalized);
}

function isStatusListIntent(value: string): boolean {
  return /\b(projects|work|ones|list|show|available|portfolio)\b/.test(value);
}

function projectFact(project: ProjectSummary): ProjectFact {
  return {
    id: project.id,
    slug: project.slug ?? project.href.split('/').filter(Boolean).at(-1) ?? project.id,
    title: project.title,
    href: project.href,
    area: String(project.area),
    status: project.status,
    year: project.year,
    activity: project.activity,
    tagline: project.line,
    about: project.about,
    notes: project.notes,
    metrics: project.metrics.map((metric, index) => {
      const [value, label] = Array.isArray(metric)
        ? metric
        : [String((metric as { value?: unknown }).value ?? ''), String((metric as { label?: unknown }).label ?? '')];
      return { id: `${project.id}:metric:${index}`, projectId: project.id, value, label };
    }),
    links: project.links.map((link, index) => {
      const [label, href] = Array.isArray(link)
        ? link
        : [String((link as { label?: unknown }).label ?? ''), String((link as { href?: unknown }).href ?? '')];
      return { id: `${project.id}:link:${index}`, projectId: project.id, label, href };
    }),
  };
}

function factSummary(project: ProjectFact): ProjectSummary {
  return {
    id: project.id,
    slug: project.slug,
    title: project.title,
    area: project.area as ProjectSummary['area'],
    status: project.status,
    year: project.year,
    activity: project.activity,
    line: project.tagline,
    href: project.href,
    wip: project.status[0] === 'wip',
    money: false,
    links: project.links.map((link) => ({ label: link.label, href: link.href })),
    metrics: project.metrics.map((metric) => ({ value: metric.value, label: metric.label })),
    about: project.about,
    notes: project.notes,
    stack: [],
  };
}

function parseDraft(raw: string) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? trimmed;
  try {
    return ProjectDraftSchema.safeParse(JSON.parse(fenced));
  } catch {
    return { success: false as const, error: new Error('invalid JSON') };
  }
}

function statusIntent(value: string): ProjectSummary['status'][0] | null {
  if (/\blive\b/.test(value)) return 'live';
  if (/\b(done|shipped|complete|completed)\b/.test(value)) return 'done';
  if (/\b(wip|in progress|building)\b/.test(value)) return 'wip';
  if (/\b(dry|dry-run)\b/.test(value)) return 'dry';
  return null;
}
