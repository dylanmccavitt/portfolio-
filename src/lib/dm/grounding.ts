import { z } from 'zod';
import type { AnswerBlock, DMChatRequest, ProjectEvidenceAtom, ProjectEvidenceAtomKind, ProjectFact, ProjectFactPacket, ProjectSummary, PublicRagCitation } from './contract';
import type { ProjectToolResultStatus, PublicDMDataTools } from './data-tools';

const ProjectClaimSchema = z.strictObject({
  text: z.string().trim().min(1).max(700),
  evidenceIds: z.array(z.string().min(1)).min(1).max(16),
});
const ProjectDraftSchema = z.strictObject({
  claims: z.array(ProjectClaimSchema).max(8),
  artifactProjectIds: z.array(z.string().min(1)).max(8).default([]),
});

export type ProjectDraft = z.infer<typeof ProjectDraftSchema>;
type ProjectIdentity = Pick<ProjectSummary, 'id' | 'slug' | 'title'>;

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
  const publicResumeOrContactIntent = /\b(resume|résumé|cv|contact|e[- ]?mail|reach|phone|location|education|degree|school|university|career|employment|employer|job history|open to work|availability)\b/;
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

  const projects = result.projects.map(projectFact);
  return {
    operation,
    status: result.resultStatus,
    ...(responseMode ? { responseMode } : {}),
    query: request.message,
    fallbackUsed: result.fallbackUsed === true || result.resultStatus === 'fallback',
    projects,
    citations: [],
    evidence: projectEvidenceAtoms(projects, []),
  };
}

export function withPacketCitations(packet: ProjectFactPacket, citations: PublicRagCitation[]): ProjectFactPacket {
  const allowed = new Set(packet.projects.map((project) => project.id));
  const selected = citations.filter((citation) => allowed.has(citation.projectId));
  return { ...packet, citations: selected, evidence: projectEvidenceAtoms(packet.projects, selected) };
}

export function projectDraftBlocks(
  request: DMChatRequest,
  draft: ProjectDraft,
  packet: ProjectFactPacket,
): AnswerBlock[] {
  const selectedIds = new Set(draft.artifactProjectIds);
  const items = packet.projects.filter((project) => selectedIds.has(project.id)).map(factSummary);
  const blocks: AnswerBlock[] = [];
  if (!requestExcludesProjectArtifacts(request.message) && items.length > 0) {
    blocks.push({ kind: 'projects', ids: items.map((project) => project.id), items });
  }
  const citationById = topCitationById(packet);
  const citedIds = new Set(draft.claims.flatMap((claim) => claim.evidenceIds));
  const citations = [...citationById.values()].filter((citation) => citedIds.has(`citation:${citation.ragSourceId}`));
  if (citations.length > 0) {
    blocks.push({ kind: 'evidence', ragSources: citations });
  }
  return blocks;
}

export function projectPacketPrompt(packet: ProjectFactPacket): string {
  const artifactLimit = requestedProjectArtifactLimit(packet.query);
  const artifactInstruction = artifactLimit === 0
    ? 'The latest request explicitly requires zero project cards. Keep artifactProjectIds empty, but still answer with grounded project claims.'
    : artifactLimit === 1
      ? 'The latest request explicitly requires exactly one project card. Select one project, write claims only about that project, and return that same single id in artifactProjectIds.'
      : 'artifactProjectIds is independent of claims. Keep it empty for terse factual follow-ups unless the user asks to show a card; otherwise select only useful, discussed projects.';
  return [
    'For project questions, return exactly one JSON grounded answer draft and no markdown outside it.',
    'Shape: {"claims":[{"text":"Direct natural-language answer sentence.","evidenceIds":["project-id:summary"]}],"artifactProjectIds":[]}.',
    'Answer the latest user question directly. Conversation history may identify the subject, but never inherit an older information need.',
    'Each claim must cite every fact it uses with ids from PROJECT_FACT_PACKET.evidence. Every substantive claim must cite at least one non-identity atom; identity-only evidence is allowed only when the entire claim is the project name. Do not write a name, number, status, date, technology, metric, or URL without citing its atom in that same claim.',
    'Use natural recruiter-friendly prose. Do not merely list fields or answer a different aspect of the selected project.',
    artifactInstruction,
    'RAG citations are optional and only available for explicit deep dives. Never imply missing source evidence exists.',
    `PROJECT_FACT_PACKET=${JSON.stringify(packet)}`,
  ].join('\n');
}

export function validateProjectDraft(
  raw: string,
  packet: ProjectFactPacket,
  latestQuestion = packet.query,
  publishedProjects: ProjectIdentity[] = packet.projects,
): { ok: true; draft: ProjectDraft } | { ok: false; reason: string } {
  const parsed = parseDraft(raw);
  if (!parsed.success) return { ok: false, reason: 'project draft was not valid structured JSON' };
  const draft = budgetProjectDraft(parsed.data, packet);
  if (draft.claims.length === 0 && packet.projects.length > 0) {
    return { ok: false, reason: 'project draft did not contain an answer claim' };
  }
  const atoms = new Map(packet.evidence.map((atom) => [atom.id, atom]));
  const packetProjectIds = new Set(packet.projects.map((project) => project.id));
  const discussedProjectIds = new Set(draft.claims.flatMap((claim) =>
    claim.evidenceIds.flatMap((id) => atoms.get(id)?.projectId ?? [])));

  if (new Set(draft.artifactProjectIds).size !== draft.artifactProjectIds.length) {
    return { ok: false, reason: 'duplicate artifact project reference' };
  }
  if (draft.artifactProjectIds.some((id) => !packetProjectIds.has(id))) {
    return { ok: false, reason: 'artifact project reference escaped fact packet' };
  }
  if (draft.artifactProjectIds.some((id) => !discussedProjectIds.has(id))) {
    return { ok: false, reason: 'artifact project was not selected by an answer claim' };
  }

  for (const claim of draft.claims) {
    if (new Set(claim.evidenceIds).size !== claim.evidenceIds.length) return { ok: false, reason: 'duplicate evidence reference' };
    const referenced = claim.evidenceIds.flatMap((id) => atoms.get(id) ?? []);
    if (referenced.length !== claim.evidenceIds.length) return { ok: false, reason: 'evidence reference escaped fact packet' };
    if (referenced.every((entry) => entry.kind === 'identity') && !isPureIdentityClaim(claim.text, referenced)) {
      return { ok: false, reason: 'substantive claim cited only project identity evidence' };
    }
    const claimProjects = new Set(referenced.map((entry) => entry.projectId));
    if (claimProjects.size > 1 && !/\b(?:both|compare|compared|comparison|versus|vs\.?|while|than)\b/i.test(claim.text)) {
      return { ok: false, reason: 'claim mixed project evidence without explicit comparison' };
    }
    if (claimProjects.size > 1 && [...claimProjects].some((projectId) => !claimNamesProject(claim.text, projectId, packet.projects))) {
      return { ok: false, reason: 'multi-project claim did not name every cited project' };
    }
    const unsupported = unsupportedSensitiveAtom(claim.text, referenced, packet.evidence);
    if (unsupported) return { ok: false, reason: `sensitive factual atom was not cited in its claim: ${unsupported.id}` };
    if (!identityLikeTokensAreGrounded(claim.text, referenced)) {
      return { ok: false, reason: 'claim included an uncited project-like identifier' };
    }
    if (!numbersAndUrlsAreGrounded(claim.text, referenced)) {
      return { ok: false, reason: 'claim included an uncited number or URL' };
    }
    if (!statusClaimsAreGrounded(claim.text, referenced)) {
      return { ok: false, reason: 'claim included an unsupported project status' };
    }
  }
  const requiredKindGroups = latestTurnEvidenceKindGroups(latestQuestion);
  const citedKinds = new Set(draft.claims.flatMap((claim) =>
    claim.evidenceIds.flatMap((id) => atoms.get(id)?.kind ?? [])));
  const missingKindGroups = requiredKindGroups.filter((group) => !group.some((kind) => citedKinds.has(kind)));
  if (missingKindGroups.length > 0) {
    const missing = missingKindGroups.map((group) => group.join(' or ')).join(' and ');
    return { ok: false, reason: `answer did not address every latest-turn information need (${missing})` };
  }
  if (requestedProjectArtifactLimit(latestQuestion) === 1 && !selectOneCardProject(draft, packet, latestQuestion, publishedProjects)) {
    return { ok: false, reason: 'one-card answer did not contain a complete claim for one selected project' };
  }
  return { ok: true, draft };
}

export function enforceProjectDraft(
  request: DMChatRequest,
  draft: ProjectDraft,
  packet: ProjectFactPacket,
  publishedProjects: ProjectIdentity[] = packet.projects,
): ProjectDraft {
  const artifactLimit = requestedProjectArtifactLimit(request.message);
  const terseFollowUp = isExplicitProjectCoreference(normalizeIdentityText(request.message))
    && !request.context?.projectIds?.length
    && !requestExplicitlyIncludesProjectArtifacts(request.message)
    && request.message.trim().split(/\s+/).length <= 8;
  if (artifactLimit === 0 || (terseFollowUp && artifactLimit === null)) {
    return { ...draft, artifactProjectIds: [] };
  }
  if (artifactLimit === 1) {
    const selection = selectOneCardProject(draft, packet, request.message, publishedProjects);
    return selection
      ? { claims: selection.claims, artifactProjectIds: [selection.projectId] }
      : { claims: [], artifactProjectIds: [] };
  }
  return draft;
}

export function requestExcludesProjectArtifacts(value: string): boolean {
  return requestedProjectArtifactLimit(value) === 0;
}

export function requestRequiresOneProjectArtifact(value: string): boolean {
  return requestedProjectArtifactLimit(value) === 1;
}

function budgetProjectDraft(draft: ProjectDraft, packet: ProjectFactPacket): ProjectDraft {
  const deepDive = packet.responseMode === 'deep-dive';
  const seen = new Set<string>();
  const claims = draft.claims.filter((claim) => {
    const normalized = claim.text.replace(/\s+/g, ' ').trim().toLowerCase();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  }).slice(0, deepDive ? 5 : 3);
  return {
    claims,
    artifactProjectIds: draft.artifactProjectIds.slice(0, deepDive ? 2 : 3),
  };
}

function selectOneCardProject(
  draft: ProjectDraft,
  packet: ProjectFactPacket,
  latestQuestion: string,
  publishedProjects: ProjectIdentity[],
): { projectId: string; claims: ProjectDraft['claims'] } | null {
  const atoms = new Map(packet.evidence.map((atom) => [atom.id, atom]));
  const claimProjectIds = draft.claims.map((claim) => projectIdsForClaim(claim, atoms));
  const candidates = [...new Set([
    ...draft.artifactProjectIds,
    ...claimProjectIds.flat(),
  ])];

  for (const projectId of candidates) {
    const claims = draft.claims.filter((_, index) => {
      const projectIds = claimProjectIds[index];
      return projectIds.length === 1 && projectIds[0] === projectId;
    });
    if (claims.length === 0) continue;
    if (!claims.some((claim) => claimNamesProject(claim.text, projectId, packet.projects))) continue;
    if (claims.some((claim) => publishedProjects.some((project) =>
      project.id !== projectId && claimNamesProject(claim.text, project.id, publishedProjects)))) continue;
    const citedKinds = new Set(claims.flatMap((claim) =>
      claim.evidenceIds.flatMap((id) => atoms.get(id)?.kind ?? [])));
    const addressesLatestTurn = latestTurnEvidenceKindGroups(latestQuestion)
      .every((group) => group.some((kind) => citedKinds.has(kind)));
    if (addressesLatestTurn) return { projectId, claims };
  }
  return null;
}

function projectIdsForClaim(
  claim: ProjectDraft['claims'][number],
  atoms: Map<string, ProjectEvidenceAtom>,
): string[] {
  return [...new Set(claim.evidenceIds.flatMap((id) => atoms.get(id)?.projectId ?? []))];
}

// Retrieval can return several chunks of one source under the same
// ragSourceId. Prose and the evidence block must stay within the per-claim
// citation-id budget, so every citation id resolves to exactly one chunk —
// the first, which retrieval ranks highest.
function topCitationById(packet: ProjectFactPacket): Map<string, PublicRagCitation> {
  const byId = new Map<string, PublicRagCitation>();
  for (const citation of packet.citations) {
    if (!byId.has(citation.ragSourceId)) byId.set(citation.ragSourceId, citation);
  }
  return byId;
}

export function renderProjectDraft(draft: ProjectDraft, packet: ProjectFactPacket): string {
  if (draft.claims.length === 0) {
    return 'I could not find enough published evidence to answer that question directly.';
  }
  const paragraphs = draft.claims.map((claim) => claim.text.trim());
  const disclosure = packet.status === 'fallback'
    ? 'I did not find an exact published match; these are the returned fallback records.'
    : packet.status === 'partial'
      ? 'The published records returned a partial set.'
      : '';
  return [disclosure, ...paragraphs].filter(Boolean).join('\n\n');
}

export function projectAnswerDisclosure(request: DMChatRequest, packet: ProjectFactPacket): string {
  if (
    packet.projects.length === 1
    && isSingularProjectCoreference(request.message)
    && /\b(?:architecture|implementation|technical|how\s+(?:it|this|the project)\s+works)\b/i.test(request.message)
    && packet.projects[0].about.length === 0
    && packet.projects[0].notes.length === 0
  ) {
    return 'The published record does not include a detailed architecture breakdown, so I will stick to what it does establish.';
  }
  return '';
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

export function invalidProjectDraftFallback(): string {
  return 'I could not produce a validated answer from the published project records for that question.';
}

function emptyPacket(query: string): ProjectFactPacket {
  return { operation: 'none', status: 'empty', query, fallbackUsed: false, projects: [], citations: [], evidence: [] };
}

function contextualProjectQuery(request: DMChatRequest): string {
  const fitCheck = request.context?.fitCheck?.jobDescription.trim();
  return [request.message.trim().slice(0, 300), ...(fitCheck ? [fitCheck.slice(0, 900)] : [])].join(' ');
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
  const withoutArtifactDirective = normalizeIdentityText(value)
    .replace(/\b(?:show|render|open) (?:only )?(?:one|1|a single) (?:project )?(?:card|artifact)\b/g, '')
    .replace(/\b(?:only one|a single) project\b/g, '')
    .replace(/\b(?:without|no) (?:showing |rendering |opening )?(?:any )?(?:project )?(?:cards|artifacts)\b/g, '')
    .replace(/\b(?:do not|don t) (?:show|render|open) (?:any )?(?:project )?(?:cards|artifacts)\b/g, '');
  return /\b(?:it|its|that|this|one|they|their|them|these|those|ones)\b|\b(?:what|how)\s+about\b/.test(withoutArtifactDirective);
}

function isPluralProjectCoreference(value: string): boolean {
  return /\b(?:they|their|them|these|those|ones)\b/.test(value);
}

function isSingularProjectCoreference(value: string): boolean {
  return isExplicitProjectCoreference(normalizeIdentityText(value)) && !isPluralProjectCoreference(normalizeIdentityText(value));
}

function requestedProjectArtifactLimit(value: string): 0 | 1 | null {
  const normalized = normalizeIdentityText(value);
  if (
    /\b(?:without|no) (?:showing |rendering |opening )?(?:any )?(?:project )?(?:cards|artifacts)\b/.test(normalized)
    || /\b(?:do not|don t) (?:show|render|open) (?:any )?(?:project )?(?:cards|artifacts)\b/.test(normalized)
  ) return 0;
  if (
    /\b(?:show|render|open) (?:only )?(?:one|1|a single) (?:project )?(?:card|artifact)\b/.test(normalized)
    || /\b(?:only one|a single) project\b/.test(normalized)
  ) return 1;
  return null;
}

function requestExplicitlyIncludesProjectArtifacts(value: string): boolean {
  const normalized = normalizeIdentityText(value);
  return /\b(?:show|render|open)\b.{0,40}\b(?:card|cards|artifact|artifacts)\b/.test(normalized)
    && requestedProjectArtifactLimit(value) !== 0;
}

function looksLikeNamedProjectQuestion(value: string): boolean {
  if (/\b(?:what is|tell me (?:more )?about|show me|how is|does|give me a deep dive (?:into|on|about))\s+[a-z0-9]+-[a-z0-9-]+\b/i.test(value)) return true;
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
      .filter((value): value is string => typeof value === 'string')
      .map(normalizeIdentityText)
      .filter((alias) => alias.length > 1);
    const lastIndex = Math.max(...aliases.map((alias) => padded.lastIndexOf(` ${alias} `)));
    return lastIndex >= 0 ? [{ id: project.id, lastIndex }] : [];
  }).sort((a, b) => a.lastIndex - b.lastIndex).map(({ id }) => id);
}

function claimNamesProject(
  text: string,
  projectId: string,
  projects: ProjectIdentity[],
): boolean {
  const project = projects.find((candidate) => candidate.id === projectId);
  if (!project) return false;
  const normalized = ` ${normalizeIdentityText(text)} `;
  return [project.id, project.slug, project.title]
    .filter((alias): alias is string => typeof alias === 'string')
    .map(normalizeIdentityText)
    .filter((alias) => alias.length > 1)
    .some((alias) => normalized.includes(` ${alias} `));
}

function normalizeIdentityText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function isBroadProjectOverviewQuery(value: string): boolean {
  const normalized = normalizeIdentityText(value)
    .replace(/\s+but show only (?:one|1|a single) project (?:card|artifact)$/, '')
    .replace(/\s+without (?:showing )?(?:any )?project (?:cards|artifacts)$/, '');
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
    wip: project.wip,
    money: project.money,
    stack: project.stack.map((entry, index) => {
      const [label, value] = Array.isArray(entry)
        ? entry
        : [String((entry as { label?: unknown }).label ?? ''), String((entry as { value?: unknown }).value ?? '')];
      return { id: `${project.id}:stack:${index}`, projectId: project.id, label, value };
    }),
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
    wip: project.wip,
    money: project.money,
    links: project.links.map((link) => ({ label: link.label, href: link.href })),
    metrics: project.metrics.map((metric) => ({ value: metric.value, label: metric.label })),
    about: project.about,
    notes: project.notes,
    stack: project.stack.map((entry) => ({ label: entry.label, value: entry.value })),
  };
}

function projectEvidenceAtoms(projects: ProjectFact[], citations: PublicRagCitation[]): ProjectEvidenceAtom[] {
  const atoms = projects.flatMap((project): ProjectEvidenceAtom[] => [
    atom(project, 'identity', 'Project', project.title, true, `${project.id}:identity`),
    atom(project, 'identity', 'Project slug', project.slug, true, `${project.id}:slug`),
    atom(project, 'link', 'Project page', project.href, true, `${project.id}:href`),
    atom(project, 'summary', 'Summary', project.summary),
    atom(project, 'tagline', 'Tagline', project.tagline),
    atom(project, 'status', 'Status', project.status.filter(Boolean).join(' / '), true),
    atom(project, 'year', 'Year', String(project.year), true),
    atom(project, 'activity', 'Activity', project.activity, true),
    atom(project, 'area', 'Area', project.area),
    ...project.about.map((value, index) => atom(project, 'about', `About ${index + 1}`, value, false, `${project.id}:about:${index}`)),
    ...project.notes.map((value, index) => atom(project, 'notes', `Note ${index + 1}`, value, false, `${project.id}:notes:${index}`)),
    ...project.stack.map((entry) => ({ id: entry.id, projectId: project.id, kind: 'stack' as const, label: entry.label, value: entry.value, sensitive: true })),
    ...project.metrics.map((entry) => ({ id: entry.id, projectId: project.id, kind: 'metric' as const, label: entry.label, value: entry.value, sensitive: true })),
    ...project.links.map((entry) => ({ id: entry.id, projectId: project.id, kind: 'link' as const, label: entry.label, value: entry.href, sensitive: true })),
  ]);
  const citationAtoms = [...topCitationById({
    operation: 'none', status: 'complete', query: '', fallbackUsed: false, projects, citations, evidence: [],
  }).values()].map((citation): ProjectEvidenceAtom => ({
    id: `citation:${citation.ragSourceId}`,
    projectId: citation.projectId,
    kind: 'citation',
    label: citation.filename ?? 'Approved source',
    value: citation.text,
    sensitive: true,
  }));
  return [...atoms, ...citationAtoms].filter((entry) => entry.value.trim().length > 0);
}

function atom(
  project: ProjectFact,
  kind: ProjectEvidenceAtomKind,
  label: string,
  value: string,
  sensitive = false,
  id = `${project.id}:${kind}`,
): ProjectEvidenceAtom {
  return { id, projectId: project.id, kind, label, value, sensitive };
}

function unsupportedSensitiveAtom(
  text: string,
  referenced: ProjectEvidenceAtom[],
  all: ProjectEvidenceAtom[],
): ProjectEvidenceAtom | null {
  const referencedIds = new Set(referenced.map((entry) => entry.id));
  const normalized = text.toLowerCase();
  const referencedSupport = referenced.map((entry) => `${entry.label} ${entry.value}`.toLowerCase()).join(' ');
  for (const candidate of all) {
    if (!candidate.sensitive || referencedIds.has(candidate.id)) continue;
    if (candidate.kind === 'identity' && referenced.some((entry) => entry.projectId === candidate.projectId && entry.kind === 'identity')) continue;
    const value = candidate.value.trim().toLowerCase();
    if (['public', 'live', 'done', 'shipped', 'published', 'today'].includes(value)) continue;
    if (value.length >= 3 && referencedSupport.includes(value)) continue;
    if (value.length >= 3 && normalized.includes(value)) return candidate;
  }
  return null;
}

function identityLikeTokensAreGrounded(text: string, referenced: ProjectEvidenceAtom[]): boolean {
  const support = referenced.map((entry) => `${entry.label} ${entry.value}`).join(' ').toLowerCase();
  const tokens = text.toLowerCase().match(/\b[a-z0-9]+(?:-[a-z0-9]+)+\b/g) ?? [];
  return tokens.every((token) => support.includes(token));
}

function isPureIdentityClaim(text: string, referenced: ProjectEvidenceAtom[]): boolean {
  const normalized = normalizeIdentityText(text);
  return referenced
    .filter((entry) => entry.kind === 'identity')
    .some((entry) => normalizeIdentityText(entry.value) === normalized);
}

function numbersAndUrlsAreGrounded(text: string, referenced: ProjectEvidenceAtom[]): boolean {
  const support = referenced.map((entry) => `${entry.label} ${entry.value}`).join(' ').toLowerCase();
  const tokens = text.match(/https?:\/\/\S+|\b\d+(?:[.:]\d+)*(?:\s*(?:kib|kb|mb|gb|%|et))?\b/gi) ?? [];
  return tokens.every((token) => support.includes(token.replace(/[),.;]+$/, '').toLowerCase()));
}

function statusClaimsAreGrounded(text: string, referenced: ProjectEvidenceAtom[]): boolean {
  const statuses = text.toLowerCase().match(/\b(?:live|dry-run|dry run|shipped|done|complete|completed|wip|in progress)\b/g) ?? [];
  if (statuses.length === 0) return true;
  const support = referenced.filter((entry) => entry.kind === 'status' || entry.kind === 'activity')
    .map((entry) => entry.value.toLowerCase().replaceAll('-', ' ')).join(' ');
  return statuses.every((status) => support.includes(status.replaceAll('-', ' ')));
}

function latestTurnEvidenceKindGroups(question: string): ProjectEvidenceAtomKind[][] {
  const normalized = question.toLowerCase();
  const groups: ProjectEvidenceAtomKind[][] = [];
  if (/\b(?:stack|language|framework|runtime|built with|technology|technologies)\b/.test(normalized)) groups.push(['stack']);
  if (/\b(?:status|live|shipped|done|complete|in progress|wip)\b/.test(normalized)) groups.push(['status']);
  if (/\b(?:when|year|date)\b/.test(normalized)) groups.push(['year', 'activity']);
  if (/\b(?:metric|number|how many|result|outcome)\b/.test(normalized)) groups.push(['metric']);
  if (/\b(?:link|repo|repository|url|where can i)\b/.test(normalized)) groups.push(['link']);
  if (/\b(?:area|category|field)\b/.test(normalized)) groups.push(['area']);
  if (/\b(?:source|citation)\b/.test(normalized)) groups.push(['citation']);
  if (/\b(?:architecture|implementation|technical|how\s+(?:it|this|the project)\s+works)\b/.test(normalized)) groups.push(['about', 'notes', 'summary']);
  return groups;
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
