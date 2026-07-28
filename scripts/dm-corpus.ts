/**
 * `npm run dm:corpus` — writes the DM grounding corpus out of this repository.
 *
 * The corpus is not published. The site serves no corpus document, so this
 * script is the only way it leaves here: the owner runs it, commits the result
 * into the DM service's own repository, and redeploys that service. The corpus
 * the service answers from is therefore a SNAPSHOT — a content change here does
 * not reach DM until this script is re-run and the service redeployed.
 *
 *   npm run dm:corpus                      # to stdout
 *   npm run dm:corpus -- ../dm-agent-service/corpus.json
 *
 * This is a thin wrapper on purpose. `src/lib/dm/corpus.ts` stays the single
 * builder and the single place the publication boundary is enforced; nothing
 * here filters, reshapes, or adds to what it returns.
 */
import { writeFile } from 'node:fs/promises';
import { buildDmCorpus } from '@/lib/dm/corpus';

const corpus = await buildDmCorpus();
const json = `${JSON.stringify(corpus, null, 2)}\n`;

const out = process.argv[2];
if (out === undefined || out === '-') {
  process.stdout.write(json);
} else {
  await writeFile(out, json, 'utf8');
  process.stderr.write(`wrote ${Buffer.byteLength(json)} bytes to ${out}\n`);
}
