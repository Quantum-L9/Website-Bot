// L9_META: layer=test, role=website_improve_llm_policy, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskType } from '@quantum-l9/llm-router';
import {
  WEBSITE_IMPROVE_LLM_POLICY,
  assertWebsiteImprovePolicy,
  websiteImproveTask,
} from '../../src/intelligence/improve-llm-policy.js';

test('policy declares capability only — no provider/model/client fields', () => {
  for (const entry of Object.values(WEBSITE_IMPROVE_LLM_POLICY)) {
    const keys = Object.keys(entry);
    assert.ok(!keys.includes('provider'));
    assert.ok(!keys.includes('model'));
    assert.ok(!keys.includes('clientId'));
    assert.ok(!keys.includes('description'));
  }
});

test('no Website-Bot Improve operation owns final page-copy generation', () => {
  for (const entry of Object.values(WEBSITE_IMPROVE_LLM_POLICY)) {
    assert.notEqual(entry.type, TaskType.CONTENT_GENERATION);
  }
});

test('no Website-Bot Improve operation requests a search provider', () => {
  for (const entry of Object.values(WEBSITE_IMPROVE_LLM_POLICY)) {
    assert.equal(entry.requiresSearch, false);
  }
});

test('websiteImproveTask merges the policy entry with clientId and description', () => {
  const task = websiteImproveTask('WEBSITE_BLUEPRINT', 'client-1', 'blueprint for acme');
  assert.equal(task.clientId, 'client-1');
  assert.equal(task.description, 'blueprint for acme');
  assert.equal(task.type, TaskType.STRATEGIC_REASONING);
  assert.equal(task.requiresSearch, false);
});

test('assertWebsiteImprovePolicy passes for the shipped policy', () => {
  assert.doesNotThrow(() => assertWebsiteImprovePolicy());
});
