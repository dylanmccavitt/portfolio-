const PUBLIC_PROJECT_DB_FLAGS = ['PUBLIC_PROJECT_PAGES_FROM_DB', 'PORTFOLIO_PUBLIC_PROJECTS_FROM_DB'] as const;
const DATABASE_ENV_KEYS = ['DATABASE_URL', 'POSTGRES_URL', 'PORTFOLIO_DATABASE_URL', 'PORTFOLIO_POSTGRES_URL'] as const;
const TRUTHY_ENV_VALUES: Record<string, true> = { '1': true, true: true, yes: true, on: true };
const PUBLIC_PROJECT_SOURCE_VALUES = ['database', 'catalog_emergency'] as const;

type PublicProjectFlag = (typeof PUBLIC_PROJECT_DB_FLAGS)[number];
type DatabaseEnvKey = (typeof DATABASE_ENV_KEYS)[number];

export type PublicProjectEnv = Partial<Record<DatabaseEnvKey | PublicProjectFlag, string>> & {
  PUBLIC_PROJECT_SOURCE?: string;
  CI?: string;
  VERCEL?: string;
  VERCEL_ENV?: string;
  VERCEL_REGION?: string;
};

export type PublicProjectSourceMode = 'database' | 'catalog_development' | 'catalog_emergency';
export type PublicProjectDataErrorCode = 'empty_published_set' | 'invalid_source_mode' | 'missing_config' | 'read_failed';

export class PublicProjectDataError extends Error {
  readonly code: PublicProjectDataErrorCode;

  constructor(code: PublicProjectDataErrorCode, message: string) {
    super(message);
    this.name = 'PublicProjectDataError';
    this.code = code;
  }
}

export function resolvePublicProjectSourceModeFromEnv(
  env: PublicProjectEnv,
  options: { hasInjectedDb?: boolean } = {},
): PublicProjectSourceMode {
  const configuredSource = env.PUBLIC_PROJECT_SOURCE?.trim().toLowerCase();

  if (configuredSource) {
    if (!PUBLIC_PROJECT_SOURCE_VALUES.includes(configuredSource as (typeof PUBLIC_PROJECT_SOURCE_VALUES)[number])) {
      throw new PublicProjectDataError(
        'invalid_source_mode',
        `Invalid PUBLIC_PROJECT_SOURCE. Expected ${PUBLIC_PROJECT_SOURCE_VALUES.join(' or ')}.`,
      );
    }
    return configuredSource as (typeof PUBLIC_PROJECT_SOURCE_VALUES)[number];
  }

  if (options.hasInjectedDb) return 'database';

  // Deprecated compatibility flags are database-only. They never enable a
  // catalog escape hatch when the database read fails.
  if (PUBLIC_PROJECT_DB_FLAGS.some((key) => Object.hasOwn(TRUTHY_ENV_VALUES, env[key]?.trim().toLowerCase() ?? ''))) {
    return 'database';
  }

  // Every real Vercel build/function is database-only, including one whose DB
  // configuration is missing. Vercel env pulls also contain VERCEL=1, so pair
  // it with CI (build) or VERCEL_REGION (runtime) to preserve offline builds.
  if (isVercelExecution(env)) return 'database';

  // A configured local database is an intentional database source. Offline
  // local builds use the catalog as a development fixture, not as a fallback.
  if (hasPublicProjectDatabaseUrl(env)) return 'database';

  return 'catalog_development';
}

export function hasPublicProjectDatabaseUrl(env: PublicProjectEnv): boolean {
  return DATABASE_ENV_KEYS.some((key) => Boolean(env[key]?.trim()));
}

function isVercelExecution(env: PublicProjectEnv): boolean {
  if (env.VERCEL?.trim() !== '1') return false;
  const ci = env.CI?.trim().toLowerCase();
  return ci === '1' || ci === 'true' || Boolean(env.VERCEL_REGION?.trim());
}
