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
  // The client is the Frost chat panel since #339; React text nodes keep model
  // output inert as long as no raw-HTML escape hatch appears in the source.
  const source = await readFile(new URL('../src/components/frost/DmChat.jsx', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|DOMParser|marked\(|markdown-it/);
  assert.match(source, /completedAssistantHistoryText\(text, true\)/);
  assert.match(source, /const assistantText = turnHistoryText\(live\)/);
  assert.match(source, /assistantText \? uiTextMessage\("assistant", assistantText\) : null/);
});

test('cancelled or malformed turns cannot enter history and a later success recovers', () => {
  assert.equal(completedAssistantHistoryText('Already visible.', false), null);
  assert.equal(completedAssistantHistoryText('', false), null);
  assert.equal(completedAssistantHistoryText('Recovered answer.', true), 'Recovered answer.');
});
