import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { applyMigrations, createQueryable } from './db';
import { scanGithubRepositoryCandidate, type GithubRepositorySnapshot } from '@/lib/db/github-discovery';

interface GithubDiscoveryFixture {
  actor?: string;
  repo: GithubRepositorySnapshot;
}

async function readFixture(path: string): Promise<GithubDiscoveryFixture> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<GithubDiscoveryFixture>;
  if (!parsed.repo) throw new Error('GitHub discovery fixture requires a repo object.');
  return { actor: parsed.actor, repo: parsed.repo };
}

async function runGithubDiscoveryFixture(path: string, actor = 'manual-github-discovery'): Promise<void> {
  const fixture = await readFixture(path);
  const db = createQueryable();
  await applyMigrations(db);
  const result = await scanGithubRepositoryCandidate(db, {
    actor: fixture.actor ?? actor,
    repo: fixture.repo,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function main(): Promise<void> {
  const fixturePath = process.argv[2];
  if (!fixturePath) {
    throw new Error('Usage: tsx scripts/github-discovery.ts <repo-fixture.json> [actor]');
  }

  await runGithubDiscoveryFixture(fixturePath, process.argv[3]);
}

const isCli = process.argv[1] === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
