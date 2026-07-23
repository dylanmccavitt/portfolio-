import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  completedAssistantHistoryText,
  validateFinalizationResult,
} from '@/lib/dm/client';

test('the client validates the structured answer envelope', () => {
  const result = validateFinalizationResult({
    status: 'accepted',
    repairAttempted: false,
    answer: {
      segments: [{ text: 'Grounded answer.', evidenceIds: [], evidence: [] }],
      artifacts: [],
      limitations: [],
    },
  });

  assert.ok(result && result.status === 'accepted');
  assert.equal(result.answer.segments[0]?.text, 'Grounded answer.');
  assert.equal(validateFinalizationResult({ status: 'accepted', repairAttempted: false }), null);
});

test('the client keeps model text inert and excludes incomplete turns from history', async () => {
  const source = await readFile(new URL('../src/scripts/dm.ts', import.meta.url), 'utf8');

  assert.match(source, /this\.streamedProseEl\.textContent = this\.text/);
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|DOMParser|marked\(|markdown-it/);
  assert.match(source, /return completedAssistantHistoryText\(this\.text, this\.completed\)/);
  assert.match(source, /const assistantText = turn\.historyText\(\)/);
  assert.match(source, /resetGuideHistory\(history, generation\)/);
});

test('cancelled or malformed turns cannot enter history and a later success recovers', () => {
  assert.equal(completedAssistantHistoryText('Already visible.', false), null);
  assert.equal(completedAssistantHistoryText('', false), null);
  assert.equal(completedAssistantHistoryText('Recovered answer.', true), 'Recovered answer.');
});
