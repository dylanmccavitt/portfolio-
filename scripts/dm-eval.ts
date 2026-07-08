import { performance } from 'node:perf_hooks';
import { createEvalProjectDb, createStubModelForEvalCase, DM_EVAL_CASES, readNdjsonEvents } from '@/lib/dm/eval-fixtures';
import { createDMChatStream } from '@/lib/dm/runtime';

process.env.DM_METRICS ??= '0';

const TEST_CONFIG = { provider: 'openai' as const, model: 'offline-eval-model' };

async function main(): Promise<void> {
  const db = await createEvalProjectDb();
  let passed = 0;

  for (const testCase of DM_EVAL_CASES) {
    const started = performance.now();
    const events = await readNdjsonEvents(
      createDMChatStream({ message: testCase.prompt }, TEST_CONFIG, {
        db,
        model: createStubModelForEvalCase(testCase),
      }),
    );
    const elapsedMs = Math.round(performance.now() - started);
    const failure = testCase.expect(events);

    if (failure) {
      console.log(`FAIL ${testCase.name} (${elapsedMs}ms) - ${failure}`);
    } else {
      passed += 1;
      console.log(`PASS ${testCase.name} (${elapsedMs}ms)`);
    }
  }

  const total = DM_EVAL_CASES.length;
  const passRate = Math.round((passed / total) * 100);
  console.log(`SUMMARY ${passed}/${total} passed (${passRate}%)`);
  if (passed !== total) process.exitCode = 1;
}

await main();
