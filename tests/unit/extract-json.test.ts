// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, JsonExtractionError } from '../../src/services/extractJson.js';

void test('plain JSON parses unchanged', () => {
  assert.deepEqual(extractJson('[{"question":"Q","answer":"A"}]'), [{ question: 'Q', answer: 'A' }]);
  assert.deepEqual(extractJson('  {"a":1}  '), { a: 1 });
});

void test('json code fence is stripped', () => {
  const raw = '```json\n[{"question":"Q1","answer":"A1"}]\n```';
  assert.deepEqual(extractJson(raw), [{ question: 'Q1', answer: 'A1' }]);
});

void test('bare code fence is stripped', () => {
  const raw = '```\n{"faqs":[]}\n```';
  assert.deepEqual(extractJson(raw), { faqs: [] });
});

void test('fence without trailing newline before close is handled', () => {
  const raw = '```json\n{"a":[1,2]}```';
  // Opening fence dropped; no closing fence line → balanced scan recovers.
  assert.deepEqual(extractJson(raw), { a: [1, 2] });
});

void test('prose-wrapped JSON is recovered by balanced scan', () => {
  const raw = 'Here are your FAQs:\n[{"question":"Q","answer":"A"}]\nHope this helps!';
  assert.deepEqual(extractJson(raw), [{ question: 'Q', answer: 'A' }]);
});

void test('braces and fences inside JSON strings do not confuse the scanner', () => {
  const payload = { answer: 'Use ``` fences and {curly} [square] chars "safely" \\ ok' };
  const raw = `Sure!\n${JSON.stringify(payload)}\nDone.`;
  assert.deepEqual(extractJson(raw), payload);
});

void test('unparseable content fails closed with JsonExtractionError', () => {
  assert.throws(() => extractJson('I could not generate the FAQs, sorry.'), JsonExtractionError);
  assert.throws(() => extractJson('```json\nnot json at all\n```'), JsonExtractionError);
  assert.throws(() => extractJson('{"unterminated": '), JsonExtractionError);
});

void test('extraction error reports every failed strategy', () => {
  try {
    extractJson('```json\n{broken\n```');
    assert.fail('expected throw');
  } catch (error) {
    assert.ok(error instanceof JsonExtractionError);
    assert.ok(error.attempts.length >= 1);
  }
});

