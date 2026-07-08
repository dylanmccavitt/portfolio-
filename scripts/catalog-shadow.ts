import { fileURLToPath } from 'node:url';
import { applyMigrations, createQueryable } from './db';
import {
  fetchCatalogShadowRecords,
  generateCatalogParityReport,
  importCatalogShadowRecords,
} from '@/lib/db/catalog-shadow';

async function importAndReport(): Promise<void> {
  const db = createQueryable();
  await applyMigrations(db);
  const imported = await importCatalogShadowRecords(db);
  const records = await fetchCatalogShadowRecords(db);
  const report = generateCatalogParityReport(records);

  console.log(JSON.stringify({ imported, report }, null, 2));
  if (report.status !== 'pass') {
    throw new Error('Catalog shadow parity failed.');
  }
}

async function reportOnly(): Promise<void> {
  const db = createQueryable();
  const records = await fetchCatalogShadowRecords(db);
  const report = generateCatalogParityReport(records);

  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'pass') {
    throw new Error('Catalog shadow parity failed.');
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command === 'import-and-report') {
    await importAndReport();
    return;
  }

  if (command === 'report') {
    await reportOnly();
    return;
  }

  throw new Error('Usage: tsx scripts/catalog-shadow.ts import-and-report|report');
}

const isCli = process.argv[1] === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
