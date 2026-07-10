import type { GithubRepositorySnapshot, PortfolioManifestSnapshot } from '@/lib/db/github-discovery';

const GITHUB_API_VERSION = '2022-11-28';
const GITHUB_USER_AGENT = 'portfolio-dm-scan';
const README_MARKDOWN_LIMIT = 200_000;
export const PORTFOLIO_MANIFEST_MAX_BYTES = 64 * 1024;

export type GithubSnapshotFetcher = (owner: string, name: string) => Promise<GithubRepositorySnapshot>;

export class GithubSnapshotFetchError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GithubSnapshotFetchError';
  }
}

export function createGithubSnapshotFetcher(options: {
  token?: string;
  fetchImpl?: typeof fetch;
}): GithubSnapshotFetcher {
  const token = options.token?.trim();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  return async (owner: string, name: string) => {
    const requestedOwner = owner.trim();
    const requestedName = name.trim();
    const repoUrl = apiRepoUrl(requestedOwner, requestedName);
    const repoResponse = await githubGet(fetchImpl, repoUrl, token, 'application/vnd.github+json', requestedOwner, requestedName);

    let payload: GithubRepoApiResponse;
    try {
      payload = asRepoApiResponse(await repoResponse.json());
    } catch {
      throw githubFetchError(requestedOwner, requestedName);
    }

    const repositoryId = repositoryIdValue(payload.id);
    const fullName = stringValue(payload.full_name) || `${requestedOwner}/${requestedName}`;
    const [canonicalOwner, canonicalName] = fullName.split('/');
    const defaultBranch = stringValue(payload.default_branch);
    if (!repositoryId || !canonicalOwner || !canonicalName || !defaultBranch) {
      throw githubFetchError(requestedOwner, requestedName);
    }

    const sourceRevision = await fetchDefaultBranchHead(
      fetchImpl,
      canonicalOwner,
      canonicalName,
      defaultBranch,
      token,
    );
    const [readmeMarkdown, portfolioManifest] = await Promise.all([
      fetchReadmeMarkdown(fetchImpl, canonicalOwner, canonicalName, sourceRevision, token),
      fetchPortfolioManifest(fetchImpl, canonicalOwner, canonicalName, sourceRevision, token),
    ]);

    return {
      repositoryId,
      owner: canonicalOwner,
      name: canonicalName,
      fullName,
      htmlUrl: stringValue(payload.html_url) || `https://github.com/${canonicalOwner}/${canonicalName}`,
      description: nullableStringValue(payload.description),
      homepageUrl: nullableStringValue(payload.homepage),
      language: nullableStringValue(payload.language),
      topics: Array.isArray(payload.topics)
        ? payload.topics.filter((topic): topic is string => typeof topic === 'string')
        : [],
      isPrivate: payload.private === true,
      defaultBranch,
      sourceRevision,
      pushedAt: nullableStringValue(payload.pushed_at),
      stars: numberValue(payload.stargazers_count),
      readmeMarkdown,
      portfolioManifest,
    };
  };
}

async function fetchDefaultBranchHead(
  fetchImpl: typeof fetch,
  owner: string,
  name: string,
  defaultBranch: string,
  token: string | undefined,
): Promise<string> {
  const response = await githubGet(
    fetchImpl,
    `${apiRepoUrl(owner, name)}/commits/${encodeURIComponent(defaultBranch)}`,
    token,
    'application/vnd.github+json',
    owner,
    name,
  );
  try {
    const value = await response.json() as { sha?: unknown };
    const sha = stringValue(value.sha);
    if (/^[0-9a-f]{40}$/i.test(sha)) return sha.toLowerCase();
  } catch {
    // The stable error below intentionally excludes response content.
  }
  throw githubFetchError(owner, name);
}

async function fetchPortfolioManifest(
  fetchImpl: typeof fetch,
  owner: string,
  name: string,
  sourceRevision: string,
  token: string | undefined,
): Promise<PortfolioManifestSnapshot> {
  const url = `${apiRepoUrl(owner, name)}/contents/portfolio.json?ref=${encodeURIComponent(sourceRevision)}`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: githubHeaders('application/vnd.github.raw+json', token),
    });
  } catch {
    throw githubFetchError(owner, name);
  }

  if (response.status === 404) return { status: 'missing' };
  if (!response.ok) throw githubFetchError(owner, name, response.status);

  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > PORTFOLIO_MANIFEST_MAX_BYTES) {
    throw invalidManifestError('portfolio.json exceeds the 64 KiB limit.');
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > PORTFOLIO_MANIFEST_MAX_BYTES) {
    throw invalidManifestError('portfolio.json exceeds the 64 KiB limit.');
  }

  try {
    return { status: 'present', raw: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    throw invalidManifestError('portfolio.json must be valid UTF-8 JSON.');
  }
}

async function fetchReadmeMarkdown(
  fetchImpl: typeof fetch,
  owner: string,
  name: string,
  sourceRevision: string,
  token: string | undefined,
): Promise<string | null> {
  try {
    const response = await fetchImpl(
      `${apiRepoUrl(owner, name)}/readme?ref=${encodeURIComponent(sourceRevision)}`,
      {
      method: 'GET',
      headers: githubHeaders('application/vnd.github.raw+json', token),
      },
    );
    if (!response.ok) return null;
    return truncateReadme(await response.text());
  } catch {
    return null;
  }
}

async function githubGet(
  fetchImpl: typeof fetch,
  url: string,
  token: string | undefined,
  accept: string,
  owner: string,
  name: string,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(url, { method: 'GET', headers: githubHeaders(accept, token) });
  } catch {
    throw githubFetchError(owner, name);
  }
  if (!response.ok) throw githubFetchError(owner, name, response.status);
  return response;
}

function apiRepoUrl(owner: string, name: string): string {
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

function githubHeaders(accept: string, token: string | undefined): Headers {
  const headers = new Headers({
    Accept: accept,
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    'User-Agent': GITHUB_USER_AGENT,
  });
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return headers;
}

function githubFetchError(owner: string, name: string, status?: number): GithubSnapshotFetchError {
  if (status === 404) {
    return new GithubSnapshotFetchError(
      'github_fetch_failed',
      `GitHub repository ${owner}/${name} was not found or is not accessible (HTTP 404).`,
    );
  }
  const statusText = typeof status === 'number' ? ` (HTTP ${status})` : '';
  return new GithubSnapshotFetchError(
    'github_fetch_failed',
    `GitHub metadata fetch failed for ${owner}/${name}${statusText}.`,
  );
}

function invalidManifestError(message: string): GithubSnapshotFetchError {
  return new GithubSnapshotFetchError('invalid_manifest', message);
}

function asRepoApiResponse(value: unknown): GithubRepoApiResponse {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as GithubRepoApiResponse;
  throw new Error('GitHub repository response must be an object.');
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nullableStringValue(value: unknown): string | null {
  const text = stringValue(value);
  return text || null;
}

function repositoryIdValue(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return value.trim();
  return '';
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function truncateReadme(readme: string): string {
  return readme.length > README_MARKDOWN_LIMIT ? readme.slice(0, README_MARKDOWN_LIMIT) : readme;
}

type GithubRepoApiResponse = {
  id?: unknown;
  name?: unknown;
  full_name?: unknown;
  html_url?: unknown;
  description?: unknown;
  homepage?: unknown;
  language?: unknown;
  topics?: unknown;
  private?: unknown;
  default_branch?: unknown;
  pushed_at?: unknown;
  stargazers_count?: unknown;
};
