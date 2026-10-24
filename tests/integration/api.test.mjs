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
      payload: { input: 'integration@example.com', name: 'Integration' },
    });
    assert.equal(create.statusCode, 201);
    const account = JSON.parse(create.body);
    assert.equal(account.email, 'integration@example.com');

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      payload: { input: '  INTEGRATION@example.com  ' },
    });
    assert.equal(duplicate.statusCode, 409);

    const list = await app.inject({ method: 'GET', url: '/api/accounts' });
    assert.equal(list.statusCode, 200);
    assert.equal(JSON.parse(list.body).accounts.length, 1);
  } finally {
    try {
      await app.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('SQLite metadata survives backend restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flash-router-restart-'));
  const databasePath = join(root, 'router.sqlite');
  try {
    const first = buildApp({ databasePath, dataDir: root, profilesRoot: join(root, 'profiles') });
    try {
      const create = await first.inject({ method: 'POST', url: '/api/accounts', payload: { input: 'persist@example.com', name: 'Persisted' } });
      assert.equal(create.statusCode, 201);
    } finally {
      await first.close();
    }
    const second = buildApp({ databasePath, dataDir: root, profilesRoot: join(root, 'profiles') });
    try {
      const list = await second.inject({ method: 'GET', url: '/api/accounts' });
      assert.equal(list.statusCode, 200);
      assert.equal(JSON.parse(list.body).accounts[0].email, 'persist@example.com');
    } finally {
      await second.close();
    }
  } finally {
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
      payload: { input: 'safe@example.com' },
    });
    assert.equal(create.statusCode, 403);
    assert.equal(create.headers['access-control-allow-origin'], undefined);

    const valid = await app.inject({ method: 'POST', url: '/api/accounts', headers: { origin: 'http://localhost:5173' }, payload: { input: 'safe@example.com' } });
    assert.equal(valid.statusCode, 201);
    const wrongDelete = await app.inject({ method: 'DELETE', url: `/api/accounts/${JSON.parse(valid.body).id}`, payload: { confirm: true, expectedEmail: 'wrong@example.com' } });
    assert.equal(wrongDelete.statusCode, 409);

    const missingConfirmationEmail = await app.inject({ method: 'DELETE', url: `/api/accounts/${JSON.parse(valid.body).id}`, payload: { confirm: true } });
    assert.equal(missingConfirmationEmail.statusCode, 400);

    const check = await app.inject({ method: 'POST', url: `/api/accounts/${JSON.parse(valid.body).id}/check`, payload: {} });
    assert.equal(check.statusCode, 200);
    const checkBody = JSON.parse(check.body);
    assert.equal(checkBody.sessionStatus, 'AUTH_UNKNOWN');
    assert.equal('profilePath' in checkBody.status, false);

    const traversal = await app.inject({ method: 'GET', url: '/api/accounts/..%2F..%2Fetc' });
    assert.equal(traversal.statusCode, 404);
  } finally {
    try {
      await app.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});
