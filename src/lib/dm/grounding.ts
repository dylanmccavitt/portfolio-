import { z } from 'zod';
import type { AnswerBlock, DMChatRequest, ProjectFact, ProjectFactPacket, ProjectSummary, PublicRagCitation } from './contract';
import type { ProjectToolResultStatus, PublicDMDataTools } from './data-tools';

const ProjectFactFieldSchema = z.enum(['summary', 'tagline', 'status', 'year', 'activity', 'area', 'about', 'notes']);
type ProjectFactField = z.infer<typeof ProjectFactFieldSchema>;
const ProjectClaimSchema = z.strictObject({
  projectId: z.string().min(1),
  fields: z.array(ProjectFactFieldSchema).min(1).max(8),
  metricIds: z.array(z.string()).max(8).default([]),
  linkIds: z.array(z.string()).max(8).default([]),
  citationIds: z.array(z.string()).max(8).default([]),
});
const ProjectDraftSchema = z.strictObject({
  // A response may intentionally decline every retrieved artifact. Retrieval is
  // evidence for the model, not an instruction to open an artifact canvas.
  claims: z.array(ProjectClaimSchema).max(8),
});

export type ProjectDraft = z.infer<typeof ProjectDraftSchema>;

export function isProjectDeepDiveRequest(message: string): boolean {
  return /\b(?:deep[ -]dive|details?|technical|implementation|architecture|sources?|evidence|citations?)\b|\bhow\s+(?:it|this|the project)\s+works\b/i.test(message);
}

export function requestNeedsProjectFacts(request: DMChatRequest): boolean {
  if (request.context?.projectIds?.length || request.context?.fitCheck) return true;
  const current = request.message.trim();
  const normalized = current.toLowerCase();
  if (!normalized || /^(?:hi|hello|hey|thanks|thank you|good (?:morning|afternoon|evening))[!.?\s]*$/.test(normalized)) {
    return false;
  }
  const strongProjectIntent = /\b(projects?|built|build|ship|shipped|backend|client|automation|tool|tooling|apps?|integration|live|done|portfolio|most impressive|best|strongest|top)\b|\bfavorite\s+(?:project|work|portfolio)\b/;
  const publicResumeOrContactIntent = /\b(resume|résumé|cv|contact|email|reach|phone|location|education|degree|school|university|career|employment|employer|job history|open to work|availability)\b/;
  if (publicResumeOrContactIntent.test(normalized) && !strongProjectIntent.test(normalized)) return false;

  if (strongProjectIntent.test(normalized) || looksLikeNamedProjectQuestion(current)) return true;

  // History is allowed only to resolve an explicit current-turn reference such
  // as "What about its architecture?". It never inherits project intent.
  return isExplicitProjectCoreference(normalized) && Boolean(request.conversation?.length);
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
  if (isSingleTokenIdentityQuestion(request.message) && !request.context?.projectIds?.length && !request.context?.fitCheck && namedProjectIds.length === 0) {
    return emptyPacket(request.message);
  }
  if (isExplicitProjectCoreference(normalized) && !request.context?.projectIds?.length && !request.context?.fitCheck && namedProjectIds.length === 0) {
    return emptyPacket(request.message);
  }
  const namedProjectRequest = Boolean(request.context?.projectIds?.length || namedProjectIds.length);
  let operation: ProjectFactPacket['operation'];
  let responseMode: ProjectFactPacket['responseMode'];
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
    responseMode = 'representative-overview';
    result = await tools.rankProjects({
      intent: 'representative shipped live client product AI automation work',
      limit: 3,
    });
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

  if (!responseMode) {
    if (isProjectDeepDiveRequest(request.message)) responseMode = 'deep-dive';
    else if (namedProjectRequest && result.projects.length === 1) responseMode = 'single-project';
  }

  return {
    operation,
    status: result.resultStatus,
    ...(responseMode ? { responseMode } : {}),
    query: request.message,
    fallbackUsed: result.fallbackUsed === true || result.resultStatus === 'fallback',
    projects: result.projects.map(projectFact),
    citations: [],
  };
}

export function withPacketCitations(packet: ProjectFactPacket, citations: PublicRagCitation[]): ProjectFactPacket {
  const allowed = new Set(packet.projects.map((project) => project.id));
  return { ...packet, citations: citations.filter((citation) => allowed.has(citation.projectId)) };
}

export function projectDraftBlocks(draft: ProjectDraft, packet: ProjectFactPacket): AnswerBlock[] {
  const selectedIds = new Set(draft.claims.map((claim) => claim.projectId));
  const items = packet.projects.filter((project) => selectedIds.has(project.id)).map(factSummary);
  if (items.length === 0) return [];
  const ids = items.map((project) => project.id);
  const blocks: AnswerBlock[] = [{ kind: 'projects', ids, items }];
  const citationIds = new Set(draft.claims.flatMap((claim) => claim.citationIds));
  const citations = packet.citations.filter((citation) => citationIds.has(citation.ragSourceId) && selectedIds.has(citation.projectId));
  if (citations.length > 0) {
    blocks.push({ kind: 'evidence', ragSources: citations });
  }
  return blocks;
}

export function projectPacketPrompt(packet: ProjectFactPacket): string {
  return [
    'For project questions, return exactly one JSON answer plan and no markdown or prose fields.',
    'Shape: {"claims":[{"projectId":"...","fields":["summary","status"],"metricIds":[],"linkIds":[],"citationIds":[]}]}.',
    'Allowed fields: summary, tagline, status, year, activity, area, about, notes.',
    'Ordinary answers: select at most three projects, three short fields per project, and one metric. Prefer summary and status.',
    'Deep dives: select at most two projects, four fields, two metrics, one link, and two citations per project.',
    'Use about or notes only for an explicit deep-dive, details, implementation, architecture, source, evidence, or citation request.',
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
  return { ok: true, draft: budgetProjectDraft(draft, packet) };
}

function budgetProjectDraft(draft: ProjectDraft, packet: ProjectFactPacket): ProjectDraft {
  const deepDive = packet.responseMode === 'deep-dive';
  const projects = new Map(packet.projects.map((project) => [project.id, project]));
  return {
    claims: draft.claims.slice(0, deepDive ? 2 : 3).map((claim) => {
      const project = projects.get(claim.projectId);
      const selected = uniqueProjectFields(claim.fields);
      const shortFields = selected.filter((field) => field !== 'about' && field !== 'notes');
      const fields = uniqueProjectFields(deepDive
        ? ['summary', ...selected.filter((field) => field === 'about' || field === 'notes'), ...shortFields]
        : ['summary', ...shortFields]
      ).slice(0, deepDive ? 4 : 3);
      return {
        projectId: claim.projectId,
        fields,
        metricIds: claim.metricIds.filter((id) => project?.metrics.some((metric) => metric.id === id)).slice(0, deepDive ? 2 : 1),
        linkIds: deepDive
          ? claim.linkIds.filter((id) => project?.links.some((link) => link.id === id)).slice(0, 1)
          : [],
        citationIds: deepDive ? claim.citationIds.slice(0, 2) : [],
      };
    }),
  };
}

function uniqueProjectFields(fields: ProjectFactField[]): ProjectFactField[] {
  return [...new Set(fields)];
}

export function renderProjectDraft(draft: ProjectDraft, packet: ProjectFactPacket): string {
  if (draft.claims.length === 0) {
    return 'I could not select a published project that directly answers that question.';
  }
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
      if (citation) facts.push(`Approved source${citation.filename ? ` ${citation.filename}` : ''}: ${compactSentence(citation.text, 320)}`);
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

function renderProjectField(project: ProjectFact, field: ProjectFactField): string[] {
  switch (field) {
    case 'summary':
      return [compactSentence(project.summary)];
    case 'tagline':
      return [compactSentence(project.tagline)];
    case 'status':
      return [`Status: ${project.status[1] || project.status[0]}.`];
    case 'year':
      return [`Year: ${project.year}.`];
    case 'activity':
      return [`Activity: ${sentence(project.activity)}`];
    case 'area':
      return [`Area: ${project.area}.`];
    case 'about':
      return project.about.slice(0, 2).map((value) => compactSentence(value));
    case 'notes':
      return project.notes.slice(0, 1).map((value) => compactSentence(value, 220));
  }
}

function sentence(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

function compactSentence(value: string, maxLength = 280): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return sentence(normalized);
  const clipped = normalized.slice(0, maxLength - 1);
  const boundary = clipped.lastIndexOf(' ');
  return `${clipped.slice(0, boundary > maxLength / 2 ? boundary : clipped.length).trimEnd()}…`;
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
  const fitCheck = request.context?.fitCheck?.jobDescription.trim();
  return [request.message.trim(), ...(fitCheck ? [fitCheck] : [])].join(' ').slice(-1_200);
}

function resolveNamedProjectIds(request: DMChatRequest, projects: ProjectSummary[]): string[] {
  const current = normalizeIdentityText(request.message);
  const currentMatches = identityMatches(current, projects);
  if (currentMatches.length > 0) return currentMatches;
  if (!isExplicitProjectCoreference(current)) return [];

  const conversation = request.conversation?.slice(-6).toReversed() ?? [];
  for (const message of conversation) {
    const matches = identityMatches(normalizeIdentityText(message.content), projects);
    if (matches.length > 0) {
      return isPluralProjectCoreference(current) ? matches : [matches.at(-1) as string];
    }
  }
  return [];
}

function isExplicitProjectCoreference(value: string): boolean {
  return /\b(?:it|its|that|this|one|they|their|them|these|those|ones)\b|\b(?:what|how)\s+about\b/.test(value);
}

function isPluralProjectCoreference(value: string): boolean {
  return /\b(?:they|their|them|these|those|ones)\b/.test(value);
}

function looksLikeNamedProjectQuestion(value: string): boolean {
  if (/\b[a-z0-9]+-[a-z0-9-]+\b/i.test(value)) return true;
  if (isSingleTokenIdentityQuestion(value)) return true;
  const namedWords = value.match(/\b[A-Z][a-zA-Z0-9]+\b/g) ?? [];
  return namedWords.some((word) => !['Dylan', 'What', 'Which', 'Tell', 'Show', 'Give', 'How', 'Is', 'Has', 'Does'].includes(word));
}

function isSingleTokenIdentityQuestion(value: string): boolean {
  const match = normalizeIdentityText(value).match(/^(?:what is|tell me about|show me|give me|how is) ([a-z0-9]+)$/);
  return Boolean(match && !['project', 'projects', 'work', 'portfolio'].includes(match[1]));
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
  const subject = String.raw`(?:dylan(?:s| s)?|his|your|the)?\s*(?:projects|portfolio|work)`;
  return new RegExp(`^(?:tell me about|show me|give me an overview of|overview of)\\s+${subject}$`).test(normalized)
    || /^(?:what projects (?:has|did) dylan (?:build|built|ship|shipped)|what has dylan (?:built|shipped))$/.test(normalized);
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
    summary: project.summary ?? project.line,
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
    summary: project.summary,
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
