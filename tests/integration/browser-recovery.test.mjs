import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BrowserSupervisor } from '../../apps/server/dist/browser/index.js';

class FakeContext {
  #listeners = [];
  closed = false;
  on(event, listener) { if (event === 'close') this.#listeners.push(listener); }
  async close() { this.closed = true; this.#listeners.splice(0).forEach((listener) => listener()); }
  crash() { this.closed = true; this.#listeners.splice(0).forEach((listener) => listener()); }
}

function fakeRuntime(contexts) {
  return { chromium: { launchPersistentContext: async () => { const context = new FakeContext(); contexts.push(context); return context; } } };
}

test('browser crash preserves owned profile, releases lock, and permits restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flash-router-recovery-'));
  const contexts = [];
  const supervisor = new BrowserSupervisor({ profilesRoot: join(root, 'profiles'), runtime: fakeRuntime(contexts) });
  try {
    const first = await supervisor.start('crash@example.com', { headless: true });
    assert.equal(first.ok, true);
    const paths = await supervisor.getProfilePaths('crash@example.com');
    assert.equal((await stat(paths.profile)).isDirectory(), true);
    contexts[0].crash();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal((await supervisor.status('crash@example.com')).state, 'CRASHED');
    await assert.doesNotReject(() => readFile(paths.marker, 'utf8'));
    assert.equal((await supervisor.start('crash@example.com', { headless: true })).ok, true);
    assert.equal((await supervisor.stop('crash@example.com')).ok, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stale lock from a dead process is recovered without deleting profile data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flash-router-stale-lock-'));
  const supervisor = new BrowserSupervisor({ profilesRoot: join(root, 'profiles'), runtime: fakeRuntime([]) });
  try {
    const paths = await supervisor.getProfilePaths('stale@example.com');
    const hash = createHash('sha256').update('stale@example.com').digest('hex');
    await supervisor.start('stale@example.com', { headless: true });
    await supervisor.stop('stale@example.com');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(paths.lock, JSON.stringify({ pid: 2147483647, accountHash: hash, startedAt: new Date().toISOString() }));
    assert.equal((await supervisor.status('stale@example.com')).state, 'STOPPED');
    assert.equal((await stat(paths.profile)).isDirectory(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
