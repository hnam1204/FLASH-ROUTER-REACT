import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';

test('scaffold declares only one Main branch in agent rules', () => {
  const rules = readFileSync(new URL('../../AGENTS.md',import.meta.url),'utf8');
  assert.match(rules,/ONLY branch `Main`/);
});

test('no profile directory is committed in source structure', () => {
  assert.equal(existsSync(new URL('../../profiles/',import.meta.url)),false);
});

test('real product not falsely marked as complete', () => {
  const readme=readFileSync(new URL('../../README.md',import.meta.url),'utf8');
  assert.match(readme,/chưa có ứng dụng hoàn chỉnh/);
});
