import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildCliJudgePrompt,
  CODEX_JUDGE_MODEL,
  codexJudge,
  describeJudge,
  describeJudgeConfig,
  DM_JUDGE_RUBRIC,
  extractJudgeScore,
  judgeForAnsweringModel,
  opusJudge,
  parseJudgeArg,
  runCliJudge,
  type DMCliJudge,
} from '@/lib/dm/judge';

const KEYS = { hasGatewayKey: true, hasOpenaiKey: true };
const NO_OVERRIDES = {};

test('judge arg parses CLI presets, auto mode, and gateway model ids', () => {
  assert.deepEqual(parseJudgeArg('auto', KEYS, NO_OVERRIDES), { mode: 'auto' });

  const codex = parseJudgeArg('codex', KEYS, NO_OVERRIDES);
  assert.equal(codex.mode, 'fixed');
  assert.deepEqual(codex.mode === 'fixed' && codex.judge, {
    kind: 'cli',
    label: 'codex-cli',
    command: ['codex', 'exec', '--model', 'gpt-5.6-sol', '--skip-git-repo-check', '-'],
    model: 'gpt-5.6-sol',
  });

  for (const alias of ['opus', 'claude']) {
    const opus = parseJudgeArg(alias, KEYS, NO_OVERRIDES);
    assert.deepEqual(opus.mode === 'fixed' && opus.judge, {
      kind: 'cli',
      label: 'opus-cli',
      command: ['claude', '-p', '--model', 'opus'],
      model: 'opus',
    });
  }

  const model = parseJudgeArg('openai/gpt-5.5', KEYS, NO_OVERRIDES);
  assert.equal(model.mode === 'fixed' && model.judge.kind, 'model');
  assert.equal(model.mode === 'fixed' && model.judge.label, 'openai/gpt-5.5');
});

test('auto routing is cross-family: codex judges anthropic answers, opus judges the rest', () => {
  const auto = { mode: 'auto' as const };
  const codex = judgeForAnsweringModel(auto, 'anthropic/claude-sonnet-4.6', NO_OVERRIDES);
  assert.equal(codex.label, 'codex-cli');
  assert.equal(codex.kind, 'cli');
  assert.equal(codex.kind === 'cli' && codex.model, CODEX_JUDGE_MODEL);
  assert.deepEqual(codex.kind === 'cli' && codex.command, [
    'codex',
    'exec',
    '--model',
    CODEX_JUDGE_MODEL,
    '--skip-git-repo-check',
    '-',
  ]);
  assert.match(describeJudge(codex), /model=gpt-5\.6-sol; command=codex exec --model gpt-5\.6-sol/);
  assert.equal(judgeForAnsweringModel(auto, 'openai/gpt-5.5', NO_OVERRIDES).label, 'opus-cli');
  assert.equal(judgeForAnsweringModel(auto, 'google/gemini-2.5-pro', NO_OVERRIDES).label, 'opus-cli');

  const fixed = parseJudgeArg('codex', KEYS, NO_OVERRIDES);
  assert.equal(judgeForAnsweringModel(fixed, 'openai/gpt-5.5', NO_OVERRIDES).label, 'codex-cli');
});

test('judge CLI commands can be overridden through env vars', () => {
  const env = {
    DM_JUDGE_CODEX_CMD: 'codex exec -m gpt-5.3-codex --skip-git-repo-check -',
    DM_JUDGE_OPUS_CMD: 'claude -p --model claude-opus-4-6',
  };
  assert.deepEqual(codexJudge(env).command, ['codex', 'exec', '-m', 'gpt-5.3-codex', '--skip-git-repo-check', '-']);
  assert.equal(codexJudge(env).model, 'gpt-5.3-codex');
  assert.deepEqual(opusJudge(env).command, ['claude', '-p', '--model', 'claude-opus-4-6']);
});

test('describeJudgeConfig names the routing so reports stay readable', () => {
  const autoDescription = describeJudgeConfig({ mode: 'auto' }, NO_OVERRIDES);
  assert.match(autoDescription, /anthropic answers -> codex-cli/);
  assert.match(autoDescription, /model=gpt-5\.6-sol/);
  assert.match(autoDescription, /command=codex exec --model gpt-5\.6-sol --skip-git-repo-check -/);
  assert.match(autoDescription, /other answers -> opus-cli/);
  assert.match(describeJudgeConfig(parseJudgeArg('opus', KEYS, NO_OVERRIDES)), /opus-cli \(model=opus; command=claude/);
});

test('CLI judge prompt carries the rubric and the payload', () => {
  const prompt = buildCliJudgePrompt({
    latestQuestion: 'What is Loom?',
    conversation: [],
    expectedBehavior: {
      requiredTools: ['getProject'],
      forbiddenTools: [],
      evidence: { requiredText: ['Loom'], forbiddenText: [] },
      artifacts: { required: ['projects'], forbidden: [], projectIds: ['loom'], linkProjectIds: [] },
      limitation: 'none',
      followUp: 'not-useful',
    },
    answerText: 'Loom coordinates tracked delivery work.',
    observedTools: ['getProject'],
    answerBlocks: ['projects:loom'],
    evidenceIds: ['loom:identity', 'loom:metric:0'],
    deterministicCheck: 'passed',
  });
  assert.ok(prompt.startsWith(DM_JUDGE_RUBRIC));
  assert.match(prompt, /"latestQuestion": "What is Loom\?"/);
  assert.match(prompt, /"requiredTools": \[/);
  assert.match(prompt, /"loom:metric:0"/);
  assert.ok(!prompt.includes('factPacket'));
});

test('score extraction takes the last valid JSON object out of noisy CLI output', () => {
  const noisy = [
    '[2026-07-09T02:00:00] codex exec session started',
    '{"event": "thinking", "tokens": 120}',
    'Here is my assessment.',
    '{"grounded": 5, "honest": 4, "useful": 5, "relevant": 5, "direct": 5, "continuity": 5, "nonRepetition": 5, "notes": "Concrete and correct."}',
  ].join('\n');
  assert.deepEqual(extractJudgeScore(noisy), { grounded: 5, honest: 4, useful: 5, relevant: 5, direct: 5, continuity: 5, nonRepetition: 5, notes: 'Concrete and correct.' });

  const outOfRange = extractJudgeScore('{"grounded": 9, "honest": -2, "useful": 3, "relevant": 5, "direct": 5, "continuity": 5, "nonRepetition": 5}');
  assert.ok('error' in outOfRange);

  const fractional = extractJudgeScore('{"grounded": 3.6, "honest": 5, "useful": 4, "relevant": 5, "direct": 5, "continuity": 5, "nonRepetition": 5}');
  assert.ok('error' in fractional);

  const missing = extractJudgeScore('no scores here');
  assert.ok('error' in missing);
});

test('runCliJudge captures scores from a real subprocess and reports failures', async () => {
  const listenerCounts = parentCleanupListenerCounts();
  const fake: DMCliJudge = {
    kind: 'cli',
    label: 'fake-cli',
    command: ['node', '-e', 'console.log("noise"); console.log(JSON.stringify({grounded: 4, honest: 5, useful: 4, relevant: 5, direct: 5, continuity: 5, nonRepetition: 5, notes: "ok"}))'],
  };
  assert.deepEqual(await runCliJudge(fake, 'prompt'), { grounded: 4, honest: 5, useful: 4, relevant: 5, direct: 5, continuity: 5, nonRepetition: 5, notes: 'ok' });

  const failing: DMCliJudge = { kind: 'cli', label: 'fail-cli', command: ['node', '-e', 'process.exit(3)'] };
  const failed = await runCliJudge(failing, 'prompt');
  assert.ok('error' in failed && failed.error.includes('exit code 3'));

  const missing: DMCliJudge = { kind: 'cli', label: 'missing-cli', command: ['definitely-not-a-real-binary-xyz'] };
  const notFound = await runCliJudge(missing, 'prompt');
  assert.ok('error' in notFound);
  assert.deepEqual(parentCleanupListenerCounts(), listenerCounts, 'completed judges must remove parent cleanup listeners');
});

test('runCliJudge timeout kills the spawned process group before report writing continues', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dm-judge-timeout-'));
  const descendantPidPath = join(directory, 'descendant.pid');
  const reportPath = join(directory, 'report.json');
  let descendantPid: number | undefined;

  try {
    const descendantScript = 'setInterval(() => {}, 1000)';
    const launcherScript = [
      "const { spawn } = require('node:child_process')",
      "const { writeFileSync } = require('node:fs')",
      `const descendant = spawn(process.execPath, ['-e', ${JSON.stringify(descendantScript)}], { stdio: 'inherit' })`,
      `writeFileSync(${JSON.stringify(descendantPidPath)}, String(descendant.pid))`,
      'setInterval(() => {}, 1000)',
    ].join(';');
    const hanging: DMCliJudge = {
      kind: 'cli',
      label: 'hanging-cli',
      command: [process.execPath, '-e', launcherScript],
    };

    const timedOut = await runCliJudge(hanging, 'prompt', 500);
    assert.ok('error' in timedOut && timedOut.error.includes('timed out after 500ms'));

    descendantPid = Number(await readFile(descendantPidPath, 'utf8'));
    await writeFile(reportPath, JSON.stringify({ judge: timedOut }));
    assert.match(await readFile(reportPath, 'utf8'), /timed out after 500ms/);
    assert.equal(await waitForProcessExit(descendantPid), true, `descendant ${descendantPid} survived judge timeout`);
  } finally {
    if (descendantPid && isProcessRunning(descendantPid)) process.kill(descendantPid, 'SIGKILL');
    await rm(directory, { recursive: true, force: true });
  }
});

test('runCliJudge kills its process group when the parent receives SIGTERM', { skip: process.platform === 'win32' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dm-judge-parent-abort-'));
  const pidsPath = join(directory, 'judge-pids.json');
  let harness: ChildProcess | undefined;
  let judgePids: { launcherPid: number; descendantPid: number } | undefined;

  try {
    const descendantScript = 'setInterval(() => {}, 1000)';
    const launcherScript = [
      "const { spawn } = require('node:child_process')",
      "const { writeFileSync } = require('node:fs')",
      `const descendant = spawn(process.execPath, ['-e', ${JSON.stringify(descendantScript)}], { stdio: 'inherit' })`,
      `writeFileSync(${JSON.stringify(pidsPath)}, JSON.stringify({ launcherPid: process.pid, descendantPid: descendant.pid }))`,
      'setInterval(() => {}, 1000)',
    ].join(';');
    const judgeModuleUrl = new URL('../src/lib/dm/judge.ts', import.meta.url).href;
    const harnessScript = [
      `import { runCliJudge } from ${JSON.stringify(judgeModuleUrl)}`,
      `const judge = ${JSON.stringify({
        kind: 'cli',
        label: 'parent-abort-cli',
        command: [process.execPath, '-e', launcherScript],
      })}`,
      "await runCliJudge(judge, 'prompt', 30_000)",
    ].join(';');

    harness = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', harnessScript], {
      cwd: process.cwd(),
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let harnessStderr = '';
    harness.stderr?.on('data', (chunk: Buffer) => (harnessStderr += chunk.toString()));
    const runningJudgePids = JSON.parse(await waitForFileContents(pidsPath)) as {
      launcherPid: number;
      descendantPid: number;
    };
    judgePids = runningJudgePids;

    const harnessExit = waitForChildExit(harness);
    assert.equal(harness.kill('SIGTERM'), true);
    const exit = await harnessExit;
    assert.equal(exit.signal, 'SIGTERM', `harness did not preserve SIGTERM semantics: ${harnessStderr}`);
    assert.equal(
      await waitForProcessExit(runningJudgePids.launcherPid),
      true,
      `judge launcher ${runningJudgePids.launcherPid} survived parent abort`,
    );
    assert.equal(
      await waitForProcessExit(runningJudgePids.descendantPid),
      true,
      `judge descendant ${runningJudgePids.descendantPid} survived parent abort`,
    );
  } finally {
    if (harness?.pid && isProcessRunning(harness.pid)) harness.kill('SIGKILL');
    if (judgePids?.launcherPid && isProcessRunning(judgePids.launcherPid)) process.kill(judgePids.launcherPid, 'SIGKILL');
    if (judgePids?.descendantPid && isProcessRunning(judgePids.descendantPid)) process.kill(judgePids.descendantPid, 'SIGKILL');
    await rm(directory, { recursive: true, force: true });
  }
});

function parentCleanupListenerCounts(): Record<string, number> {
  return {
    SIGINT: process.listenerCount('SIGINT'),
    SIGTERM: process.listenerCount('SIGTERM'),
    exit: process.listenerCount('exit'),
  };
}

async function waitForFileContents(path: string): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${path}`);
}

function waitForChildExit(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`child ${child.pid ?? 'unknown'} did not exit`)), 5_000);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function waitForProcessExit(pid: number): Promise<boolean> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (!isProcessRunning(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
  }
}
