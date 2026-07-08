import type { GithubRepositorySnapshot } from '@/lib/db/github-discovery';

const GITHUB_API_VERSION = '2022-11-28';
const GITHUB_USER_AGENT = 'portfolio-dm-scan';
const README_MARKDOWN_LIMIT = 200_000;

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
    const repoOwner = owner.trim();
    const repoName = name.trim();
    const repoUrl = `https://api.github.com/repos/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}`;

    let repoResponse: Response;
    try {
      repoResponse = await fetchImpl(repoUrl, {
        method: 'GET',
        headers: githubHeaders('application/vnd.github+json', token),
      });
    } catch {
      throw githubFetchError(repoOwner, repoName);
    }

    if (!repoResponse.ok) {
      throw githubFetchError(repoOwner, repoName, repoResponse.status);
    }

    let payload: GithubRepoApiResponse;
    try {
      payload = asRepoApiResponse(await repoResponse.json());
    } catch {
      throw githubFetchError(repoOwner, repoName);
    }

    const fullName = stringValue(payload.full_name) || `${repoOwner}/${repoName}`;
    const [apiOwner, apiName] = fullName.split('/');
    const readmeMarkdown = await fetchReadmeMarkdown(fetchImpl, repoOwner, repoName, token);

    return {
      owner: apiOwner || repoOwner,
      name: apiName || stringValue(payload.name) || repoName,
      fullName,
      htmlUrl: stringValue(payload.html_url) || `https://github.com/${repoOwner}/${repoName}`,
      description: nullableStringValue(payload.description),
      homepageUrl: nullableStringValue(payload.homepage),
      language: nullableStringValue(payload.language),
      topics: Array.isArray(payload.topics)
        ? payload.topics.filter((topic): topic is string => typeof topic === 'string')
        : [],
      isPrivate: payload.private === true,
      defaultBranch: nullableStringValue(payload.default_branch),
      pushedAt: nullableStringValue(payload.pushed_at),
      stars: numberValue(payload.stargazers_count),
      readmeMarkdown,
    };
  };
}

async function fetchReadmeMarkdown(
  fetchImpl: typeof fetch,
  owner: string,
  name: string,
  token: string | undefined,
): Promise<string | null> {
  try {
    const response = await fetchImpl(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/readme`,
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

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function truncateReadme(readme: string): string {
  return readme.length > README_MARKDOWN_LIMIT ? readme.slice(0, README_MARKDOWN_LIMIT) : readme;
}

type GithubRepoApiResponse = {
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
