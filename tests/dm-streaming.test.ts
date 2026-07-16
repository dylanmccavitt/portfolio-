import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  completedAssistantHistoryText,
  matchesStreamedV2Finalization,
  validateFinalizationResult,
} from '@/lib/dm/client';
import type { DMFinalizationResult } from '@/lib/dm/contract';

function finalization(markdown: string, overrides: Record<string, unknown> = {}): DMFinalizationResult {
  return {
    status: 'accepted',
    repairAttempted: false,
    answer: {
      segments: [{ text: markdown, evidenceIds: [], evidence: [] }],
      artifacts: [],
      limitations: [],
      ...overrides,
    },
  };
}

test('the client accepts only an exact matching v2 terminal integrity echo', () => {
  const prose = 'Canonical streamed prose.';
  const matching = validateFinalizationResult(finalization(prose));
  const mismatch = validateFinalizationResult(finalization(`${prose} changed`));
  const limited = validateFinalizationResult({ ...finalization(prose), status: 'limited' });

  assert.ok(matching && matching.status !== 'rejected');
  assert.ok(mismatch && mismatch.status !== 'rejected');
  assert.ok(limited && limited.status !== 'rejected');
  assert.equal(matchesStreamedV2Finalization(prose, matching), true);
  assert.equal(matchesStreamedV2Finalization(prose, mismatch), false);
  assert.equal(matchesStreamedV2Finalization(prose, limited), false);
  assert.equal(matchesStreamedV2Finalization('', matching), false);
});

test('the client keeps streamed model markup inert and excludes incomplete turns from history', async () => {
  const source = await readFile(new URL('../src/scripts/dm.ts', import.meta.url), 'utf8');

  assert.match(source, /this\.streamedProseEl\.textContent = this\.text/);
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|DOMParser|marked\(|markdown-it/);
  assert.match(source, /return completedAssistantHistoryText\(this\.text, this\.completed\)/);
  assert.match(source, /const assistantText = turn\.historyText\(\)/);
  assert.match(source, /generation \+= 1/);
});

test('cancelled or malformed turns cannot enter history and a later success recovers', () => {
  const partial = 'Already-visible bounded prefix.';

  assert.equal(completedAssistantHistoryText(partial, false), null);
  assert.equal(completedAssistantHistoryText('', false), null);
  assert.equal(completedAssistantHistoryText('Recovered answer.', true), 'Recovered answer.');
});

test('matching metadata never changes or duplicates the canonical history prose', () => {
  const prose = '<script>alert(1)</script> [link](javascript:alert(2))';
  const candidate = validateFinalizationResult(finalization(prose, {
    followUp: 'Optional late follow-up.',
  }));

  assert.ok(candidate && candidate.status !== 'rejected');
  assert.equal(matchesStreamedV2Finalization(prose, candidate), true);
  assert.equal(candidate.answer.segments.map((segment) => segment.text).join(''), prose);
  assert.equal(prose.includes(candidate.answer.followUp ?? ''), false);
});
