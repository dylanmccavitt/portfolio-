import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCliJudgePrompt,
  codexJudge,
  describeJudgeConfig,
  DM_JUDGE_RUBRIC,
  extractJudgeScore,
  judgeForAnsweringModel,
  opusJudge,
  parseJudgeArg,
  runCliJudge,
  type DMCliJudge,
} from '@/lib/dm/judge';
import type { ProjectFactPacket } from '@/lib/dm/contract';

const KEYS = { hasGatewayKey: true, hasOpenaiKey: true };
const NO_OVERRIDES = {};

test('judge arg parses CLI presets, auto mode, and gateway model ids', () => {
  assert.deepEqual(parseJudgeArg('auto', KEYS, NO_OVERRIDES), { mode: 'auto' });

  const codex = parseJudgeArg('codex', KEYS, NO_OVERRIDES);
  assert.equal(codex.mode, 'fixed');
  assert.deepEqual(codex.mode === 'fixed' && codex.judge, {
    kind: 'cli',
    label: 'codex-cli',
    command: ['codex', 'exec', '--skip-git-repo-check', '-'],
  });

  for (const alias of ['opus', 'claude']) {
    const opus = parseJudgeArg(alias, KEYS, NO_OVERRIDES);
    assert.deepEqual(opus.mode === 'fixed' && opus.judge, {
      kind: 'cli',
      label: 'opus-cli',
      command: ['claude', '-p', '--model', 'opus'],
    });
  }

  const model = parseJudgeArg('openai/gpt-5.5', KEYS, NO_OVERRIDES);
  assert.equal(model.mode === 'fixed' && model.judge.kind, 'model');
  assert.equal(model.mode === 'fixed' && model.judge.label, 'openai/gpt-5.5');
});

test('auto routing is cross-family: codex judges anthropic answers, opus judges the rest', () => {
  const auto = { mode: 'auto' as const };
  assert.equal(judgeForAnsweringModel(auto, 'anthropic/claude-sonnet-4.6', NO_OVERRIDES).label, 'codex-cli');
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
  assert.deepEqual(opusJudge(env).command, ['claude', '-p', '--model', 'claude-opus-4-6']);
});

test('describeJudgeConfig names the routing so reports stay readable', () => {
  assert.match(describeJudgeConfig({ mode: 'auto' }), /codex-cli.*anthropic.*opus-cli/);
  assert.equal(describeJudgeConfig(parseJudgeArg('opus', KEYS, NO_OVERRIDES)), 'opus-cli');
});

test('CLI judge prompt carries the rubric and the payload', () => {
  const factPacket = {
    operation: 'searchProjects',
    status: 'complete',
    query: 'What is Loom?',
    fallbackUsed: false,
    projects: [
      {
        id: 'loom',
        slug: 'loom',
        title: 'Loom',
        href: '/projects/loom',
        area: 'Agents & MCP',
        status: ['done', 'Published'],
        year: 2026,
        activity: 'Published from the database',
        tagline: 'A durable agent workflow runtime.',
        summary: 'Coordinates tracked delivery work through a reviewed public workflow.',
        about: ['Coordinates tracked delivery work.'],
        notes: [],
        wip: false,
        money: false,
        stack: [{ id: 'loom:stack:0', projectId: 'loom', label: 'Language', value: 'TypeScript' }],
        metrics: [{ id: 'loom:metric:0', projectId: 'loom', value: '8', label: 'workflow stages' }],
        links: [{ id: 'loom:link:0', projectId: 'loom', label: 'Case study', href: '/projects/loom' }],
      },
    ],
    citations: [],
    evidence: [{ id: 'loom:identity', projectId: 'loom', kind: 'identity', label: 'Project', value: 'Loom', sensitive: true }],
  } satisfies ProjectFactPacket;
  const prompt = buildCliJudgePrompt({
    visitorQuestion: 'What is Loom?',
    answerText: 'Loom coordinates tracked delivery work.',
    answerBlocks: ['projects:loom'],
    factPacket,
    deterministicCheck: 'passed',
  });
  assert.ok(prompt.startsWith(DM_JUDGE_RUBRIC));
  assert.match(prompt, /"visitorQuestion": "What is Loom\?"/);
  assert.match(prompt, /"id": "loom"/);
  assert.match(prompt, /"value": "8"/);
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
});
