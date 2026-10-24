import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildApp } from '../../apps/server/dist/index.js';

test('API persists account metadata and rejects duplicate email', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flash-router-api-'));
  const databasePath = join(root, 'router.sqlite');
  const app = buildApp({ databasePath });
  try {
    const create = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      payload: { input: 'integration@example.com|secret-not-stored|totp-not-stored', name: 'Integration' },
    });
    assert.equal(create.statusCode, 201);
    const account = JSON.parse(create.body);
    assert.equal(account.email, 'integration@example.com');

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      payload: { input: 'integration@example.com|another|another' },
    });
    assert.equal(duplicate.statusCode, 409);

    const list = await app.inject({ method: 'GET', url: '/api/accounts' });
    assert.equal(list.statusCode, 200);
    assert.equal(JSON.parse(list.body).accounts.length, 1);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('API keeps secrets out of account responses and rejects foreign CORS origins', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flash-router-security-'));
  const app = buildApp({ databasePath: join(root, 'router.sqlite'), dataDir: root, profilesRoot: join(root, 'profiles') });
  try {
    const create = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: { origin: 'https://malicious.example' },
      payload: { input: 'safe@example.com|password-must-not-return|totp-must-not-return' },
    });
    assert.equal(create.statusCode, 201);
    assert.equal(create.headers['access-control-allow-origin'], undefined);
    assert.doesNotMatch(create.body, /password-must-not-return|totp-must-not-return/);

    const traversal = await app.inject({ method: 'GET', url: '/api/accounts/..%2F..%2Fetc' });
    assert.notEqual(traversal.statusCode, 200);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
