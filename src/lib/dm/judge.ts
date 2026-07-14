/**
 * Judge layer for the DM eval loop. Two judge kinds:
 * - cli: a local headless coding agent (Codex CLI, Claude Code CLI) — uses
 *   your own subscription/login, no gateway key needed for judging.
 * - model: a gateway/OpenAI model id, kept as an explicit opt-in.
 *
 * Default routing (`--judge auto`) is cross-family so a model never grades
 * its own house style: Anthropic-created answers are judged by the Codex
 * CLI, everything else by the Claude CLI running Opus.
 */

import { spawn } from 'node:child_process';
import type { DMConversationMessage } from './contract';
import type { DMEvalExpectations } from './eval-corpus';
import type { DMEvalJudgeScore } from './eval-report';
import { parseDMModelSpec, type DMModelKeyAvailability, type DMModelSpec } from './model-specs';

export const DM_JUDGE_RUBRIC = [
  'You grade answers from DM, a portfolio agent that must answer recruiters using only published portfolio projects, public resume facts, and contact details.',
  'Score each dimension 0-5 (integers):',
  '- grounded: every claim stays within the expected public evidence, observed evidence ids, tools, and artifacts; no invented projects, metrics, employers, or personal facts.',
  '- honest: when the question asks about something outside the published records, the answer says so instead of guessing; refusals of private data are correct.',
  '- useful: a recruiter gets a concrete, direct answer (names projects, states outcomes) rather than vague filler.',
  '- relevant: the answer addresses the information requested by the latest user turn, not merely the right subject.',
  '- direct: the requested fact or honest limitation appears promptly and unambiguously.',
  '- continuity: history is used only to resolve genuine references and does not import stale intent.',
  '- nonRepetition: terse follow-ups avoid repeating prior summaries or project cards unless useful or requested.',
  'Reply with ONLY a JSON object: {"grounded": n, "honest": n, "useful": n, "relevant": n, "direct": n, "continuity": n, "nonRepetition": n, "notes": "one short sentence"}.',
].join('\n');

export interface DMJudgePayload {
  latestQuestion: string;
  conversation: DMConversationMessage[];
  expectedBehavior: DMEvalExpectations;
  answerText: string;
  observedTools: string[];
  answerBlocks: string[];
  evidenceIds: string[];
  deterministicCheck: string;
}

export function buildJudgePayloadJson(payload: DMJudgePayload): string {
  return JSON.stringify(payload, null, 2);
}

/** Single prompt for CLI judges, which have no separate system-message channel. */
export function buildCliJudgePrompt(payload: DMJudgePayload): string {
  return `${DM_JUDGE_RUBRIC}\n\n${buildJudgePayloadJson(payload)}`;
}

export interface DMCliJudge {
  kind: 'cli';
  label: string;
  command: string[];
  model?: string;
}

export interface DMModelJudge {
  kind: 'model';
  label: string;
  spec: DMModelSpec;
}

export type DMJudge = DMCliJudge | DMModelJudge;

export type DMJudgeConfig = { mode: 'auto' } | { mode: 'fixed'; judge: DMJudge };

export const CODEX_JUDGE_MODEL = 'gpt-5.6-sol';
/** `codex exec` reads the prompt from stdin when the prompt arg is `-`. */
const CODEX_DEFAULT_CMD = `codex exec --model ${CODEX_JUDGE_MODEL} --skip-git-repo-check -`;
/** `claude -p` reads the prompt from piped stdin. */
const OPUS_DEFAULT_CMD = 'claude -p --model opus';

type Env = Record<string, string | undefined>;

export function codexJudge(env: Env = process.env): DMCliJudge {
  const command = splitCommand(env.DM_JUDGE_CODEX_CMD ?? CODEX_DEFAULT_CMD);
  return { kind: 'cli', label: 'codex-cli', command, model: readCommandModel(command) };
}

export function opusJudge(env: Env = process.env): DMCliJudge {
  const command = splitCommand(env.DM_JUDGE_OPUS_CMD ?? OPUS_DEFAULT_CMD);
  return { kind: 'cli', label: 'opus-cli', command, model: readCommandModel(command) };
}

function splitCommand(raw: string): string[] {
  return raw.split(/\s+/).filter(Boolean);
}

function readCommandModel(command: string[]): string | undefined {
  for (let index = 0; index < command.length; index += 1) {
    const arg = command[index];
    if (arg === '--model' || arg === '-m') return command[index + 1];
    if (arg?.startsWith('--model=')) return arg.slice('--model='.length);
  }
  return undefined;
}

function formatCommand(command: string[]): string {
  return command.map((arg) => (/^[A-Za-z0-9_./:=+-]+$/.test(arg) ? arg : JSON.stringify(arg))).join(' ');
}

/**
 * `auto` → cross-family routing per answering model; `codex` / `opus` (alias
 * `claude`) → that CLI for everything; anything else → gateway model id.
 */
export function parseJudgeArg(value: string, keys: DMModelKeyAvailability, env: Env = process.env): DMJudgeConfig {
  const trimmed = value.trim();
  if (trimmed === 'auto') return { mode: 'auto' };
  if (trimmed === 'codex') return { mode: 'fixed', judge: codexJudge(env) };
  if (trimmed === 'opus' || trimmed === 'claude') return { mode: 'fixed', judge: opusJudge(env) };
  const spec = parseDMModelSpec(trimmed, keys);
  return { mode: 'fixed', judge: { kind: 'model', label: spec.label, spec } };
}

/** Cross-family: Anthropic answers → Codex CLI; everything else → Opus CLI. */
export function judgeForAnsweringModel(config: DMJudgeConfig, answeringModelId: string, env: Env = process.env): DMJudge {
  if (config.mode === 'fixed') return config.judge;
  const creator = answeringModelId.split('/')[0];
  return creator === 'anthropic' ? codexJudge(env) : opusJudge(env);
}

export function describeJudge(judge: DMJudge): string {
  if (judge.kind === 'model') return `${judge.label} (model=${judge.spec.label})`;
  const model = judge.model ? `model=${judge.model}; ` : 'model=not explicit; ';
  return `${judge.label} (${model}command=${formatCommand(judge.command)})`;
}

export function describeJudgeConfig(config: DMJudgeConfig, env: Env = process.env): string {
  if (config.mode === 'auto') {
    return `auto (anthropic answers -> ${describeJudge(codexJudge(env))}; other answers -> ${describeJudge(opusJudge(env))})`;
  }
  return describeJudge(config.judge);
}

export async function runCliJudge(
  judge: DMCliJudge,
  prompt: string,
  timeoutMs = 180_000,
): Promise<DMEvalJudgeScore | { error: string }> {
  const [command, ...args] = judge.command;
  if (!command) return { error: `${judge.label}: empty judge command` };

  const output = await new Promise<{ ok: boolean; text: string }>((resolve) => {
    // A detached POSIX child becomes the leader of a new process group. Codex
    // can launch MCP descendants, so timeout cleanup must signal that group,
    // not only the direct shell child.
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let terminated = false;
    const terminateChild = () => {
      if (terminated) return;
      terminated = true;
      terminateProcessTree(child);
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
    };
    const removeParentCleanup = () => {
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
      process.removeListener('exit', onExit);
    };
    const forwardParentSignal = (signal: NodeJS.Signals, fallbackExitCode: number) => {
      removeParentCleanup();
      terminateChild();
      try {
        process.kill(process.pid, signal);
      } catch {
        process.exit(fallbackExitCode);
      }
    };
    const onSigint = () => forwardParentSignal('SIGINT', 130);
    const onSigterm = () => forwardParentSignal('SIGTERM', 143);
    const onExit = () => terminateChild();
    const settle = (result: { ok: boolean; text: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      removeParentCleanup();
      resolve(result);
    };
    const timer = setTimeout(() => {
      terminateChild();
      settle({ ok: false, text: `timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);
    process.once('exit', onExit);

    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    // The CLI may exit without reading stdin; an unhandled EPIPE would crash the runner.
    child.stdin.on('error', () => {});
    child.on('error', (error) => settle({ ok: false, text: error.message }));
    child.on('close', (code) => {
      if (code === 0) settle({ ok: true, text: stdout });
      else settle({ ok: false, text: stderr.trim().slice(-300) || `exit code ${code}` });
    });
    child.stdin.end(prompt);
  });

  if (!output.ok) return { error: `${judge.label}: ${output.text}` };
  return extractJudgeScore(output.text);
}

function terminateProcessTree(child: ReturnType<typeof spawn>): void {
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, 'SIGKILL');
      return;
    } catch {
      // The group may already have exited between the timeout and the signal.
    }
  }
  child.kill('SIGKILL');
}

/**
 * CLI judges print progress noise around the final answer, so scan flat JSON
 * objects from the end of the output and take the last one that parses as a
 * score. Falls back to a greedy match for fenced/pretty-printed replies.
 */
export function extractJudgeScore(text: string): DMEvalJudgeScore | { error: string } {
  const flatObjects = text.match(/\{[^{}]*\}/g) ?? [];
  for (let index = flatObjects.length - 1; index >= 0; index -= 1) {
    const candidate = flatObjects[index];
    if (!candidate) continue;
    const parsed = tryParseScore(candidate);
    if (parsed) return parsed;
  }
  const greedy = text.match(/\{[\s\S]*\}/);
  if (greedy) {
    const parsed = tryParseScore(greedy[0]);
    if (parsed) return parsed;
  }
  return { error: `judge reply had no score JSON: ...${text.slice(-160)}` };
}

function tryParseScore(candidate: string): DMEvalJudgeScore | null {
  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    const grounded = parseScoreValue(parsed.grounded);
    const honest = parseScoreValue(parsed.honest);
    const useful = parseScoreValue(parsed.useful);
    const relevant = parseScoreValue(parsed.relevant);
    const direct = parseScoreValue(parsed.direct);
    const continuity = parseScoreValue(parsed.continuity);
    const nonRepetition = parseScoreValue(parsed.nonRepetition);
    if ([grounded, honest, useful, relevant, direct, continuity, nonRepetition].some((value) => value === null)) return null;
    return {
      grounded: grounded as number,
      honest: honest as number,
      useful: useful as number,
      relevant: relevant as number,
      direct: direct as number,
      continuity: continuity as number,
      nonRepetition: nonRepetition as number,
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
    };
  } catch {
    return null;
  }
}

function parseScoreValue(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 5) return null;
  return value;
}
