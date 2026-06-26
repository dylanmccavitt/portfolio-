import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

export const DATABASE_ENV_KEYS = ['DATABASE_URL', 'POSTGRES_URL'] as const;

export type DatabaseEnvKey = (typeof DATABASE_ENV_KEYS)[number];
export type DatabaseEnv = Partial<Record<DatabaseEnvKey, string>>;
export type DbClient = NeonQueryFunction<false, false>;

export function getDatabaseUrl(env: DatabaseEnv = process.env): string {
  for (const key of DATABASE_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value) return value;
  }

  throw new Error(
    `Missing database connection string. Set ${DATABASE_ENV_KEYS.join(' or ')} from Vercel/Neon env; never commit it.`,
  );
}

export function createDbClient(connectionString = getDatabaseUrl()): DbClient {
  return neon(connectionString, { disableWarningInBrowsers: true });
}
