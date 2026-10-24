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

test('README keeps provider authentication as a human-verified gate', () => {
  const readme=readFileSync(new URL('../../README.md',import.meta.url),'utf8');
  assert.match(readme,/yêu cầu người dùng hoàn tất các challenge chính thức trong Chrome/);
  assert.match(readme,/không có CAPTCHA\/MFA bypass/);
});
