import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BrowserSupervisor } from '../../apps/server/dist/browser/index.js';
import { DeletionCoordinator } from '../../apps/server/dist/deletion/index.js';

class FakeContext {
  #listeners = [];
  on(event, listener) { if (event === 'close') this.#listeners.push(listener); }
  async close() { this.#listeners.splice(0).forEach((listener) => listener()); }
}

test('deletion removes only the owned profile after browser close', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flash-router-deletion-'));
  const profilesRoot = join(root, 'profiles');
  const runtime = { chromium: { launchPersistentContext: async () => new FakeContext() } };
  const supervisor = new BrowserSupervisor({ profilesRoot, runtime });
  const deletion = new DeletionCoordinator(supervisor, { dataDir: root });
  try {
    assert.equal((await supervisor.start('delete@example.com', { headless: true })).ok, true);
    assert.equal((await supervisor.start('keep@example.com', { headless: true })).ok, true);
    await supervisor.stop('keep@example.com');
    const deletedPath = await supervisor.getProfilePath('delete@example.com');
    const keptPath = await supervisor.getProfilePath('keep@example.com');
    const result = await deletion.deleteAccount('delete@example.com');
    assert.equal(result.ok, true);
    await assert.rejects(() => stat(deletedPath), { code: 'ENOENT' });
    assert.equal((await stat(keptPath)).isDirectory(), true);
    const traversalAttempt = await deletion.deleteAccount('../escape');
    assert.equal(traversalAttempt.ok, false);
    assert.equal(traversalAttempt.code, 'INVALID_ACCOUNT_ID');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
