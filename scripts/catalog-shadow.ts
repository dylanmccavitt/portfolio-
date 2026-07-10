import { fileURLToPath } from 'node:url';
import { createQueryable } from './db';
import {
  CatalogCutoverParityError,
  fetchCatalogParityRecords,
  generateCatalogParityReport,
  importCatalogShadowRecords,
  runCatalogCutover,
} from '@/lib/db/catalog-shadow';

async function importAndReport(): Promise<void> {
  const db = createQueryable();
  const imported = await importCatalogShadowRecords(db);
  const records = await fetchCatalogParityRecords(db);
  const report = generateCatalogParityReport(records);

  console.log(JSON.stringify({ imported, report }, null, 2));
  if (report.status !== 'pass') {
    throw new Error('Catalog shadow parity failed.');
  }
}

async function reportOnly(): Promise<void> {
  const db = createQueryable();
  const records = await fetchCatalogParityRecords(db);
  const report = generateCatalogParityReport(records);

  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'pass') {
    throw new Error('Catalog shadow parity failed.');
  }
}

async function cutover(apply: boolean): Promise<void> {
  const db = createQueryable();
  try {
    console.log(JSON.stringify(await runCatalogCutover(db, { apply }), null, 2));
  } catch (error) {
    if (error instanceof CatalogCutoverParityError) {
      console.log(JSON.stringify({ report: error.report }, null, 2));
    }
    throw error;
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

  if (command === 'cutover') {
    await cutover(process.argv.includes('--apply'));
    return;
  }

  throw new Error('Usage: tsx scripts/catalog-shadow.ts import-and-report|report|cutover [--apply]');
}

const isCli = process.argv[1] === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
