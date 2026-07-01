import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDbClient } from '../src/lib/db/client';

export interface QueryResult<Row = unknown> {
  rows: Row[];
}

export interface Queryable {
  query<Row = unknown>(sql: string, params?: unknown[]): Promise<QueryResult<Row>>;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = join(ROOT, 'db', 'migrations');
const SEEDS_DIR = join(ROOT, 'db', 'seeds');

const RESET_TABLES = [
  'rag_sources',
  'review_events',
  'evidence_sources',
  'project_drafts',
  'project_candidates',
  'scan_runs',
  'projects',
  'schema_migrations',
] as const;

export function splitSqlStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function sqlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  return entries.filter((entry) => entry.endsWith('.sql')).sort();
}

async function runSqlFile(db: Queryable, path: string): Promise<void> {
  const sql = await readFile(path, 'utf8');
  for (const statement of splitSqlStatements(sql)) {
    await db.query(statement);
  }
}

export async function ensureMigrationTable(db: Queryable): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export async function applyMigrations(db: Queryable, migrationsDir = MIGRATIONS_DIR): Promise<string[]> {
  await ensureMigrationTable(db);

  const applied: string[] = [];
  for (const name of await sqlFiles(migrationsDir)) {
    const existing = await db.query<{ name: string }>('SELECT name FROM schema_migrations WHERE name = $1', [name]);
    if (existing.rows.length > 0) continue;

    // No BEGIN/COMMIT here: the Neon HTTP driver (`neon()`) runs each query in
    // its own implicit transaction and does not support sessions, so explicit
    // transaction control either fails or silently does nothing. Migrations
    // must therefore stay statement-idempotent (IF NOT EXISTS et al.) so a
    // partial failure converges on re-run. The migration row is only recorded
    // after every statement succeeded.
    await runSqlFile(db, join(migrationsDir, name));
    await db.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    applied.push(name);
  }

  return applied;
}

export async function applySeeds(db: Queryable, seedsDir = SEEDS_DIR): Promise<string[]> {
  const applied: string[] = [];
  for (const name of await sqlFiles(seedsDir)) {
    await runSqlFile(db, join(seedsDir, name));
    applied.push(name);
  }

  return applied;
}

export async function resetDatabase(db: Queryable): Promise<void> {
  for (const table of RESET_TABLES) {
    await db.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
  }
}

export function createQueryable(): Queryable {
  const sql = createDbClient();
  return {
    async query<Row = unknown>(query: string, params?: unknown[]) {
      const rows = (await sql.query(query, params)) as Row[];
      return { rows };
    },
  };
}

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command === 'migrate') {
    const db = createQueryable();
    const applied = await applyMigrations(db);
    console.log(applied.length === 0 ? 'No migrations to apply.' : `Applied migrations: ${applied.join(', ')}`);
    return;
  }

  if (command === 'seed') {
    const db = createQueryable();
    await applyMigrations(db);
    const applied = await applySeeds(db);
    console.log(applied.length === 0 ? 'No seeds to apply.' : `Applied seeds: ${applied.join(', ')}`);
    return;
  }

  if (command === 'reset') {
    if (process.env.ALLOW_DB_RESET !== '1') {
      throw new Error('Refusing to reset an external database without ALLOW_DB_RESET=1.');
    }
    const db = createQueryable();
    await resetDatabase(db);
    const migrations = await applyMigrations(db);
    const seeds = await applySeeds(db);
    console.log(`Reset database. Migrations: ${migrations.length}; seeds: ${seeds.length}.`);
    return;
  }

  throw new Error('Usage: tsx scripts/db.ts migrate|seed|reset');
}

const isCli = process.argv[1] === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
