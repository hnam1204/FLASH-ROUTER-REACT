import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { randomInt } from 'node:crypto';
import { chromium } from 'playwright';

const root = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

async function waitFor(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Services are expected to be unavailable while they start.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function start(command, args, env) {
  return spawn(command, args, { cwd: root, env, stdio: 'ignore', windowsHide: true, shell: process.platform === 'win32' });
}

function stop(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

test('dashboard creates and lists an account through the real local API', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'flash-router-e2e-'));
  const serverPort = randomInt(32000, 39000);
  const webPort = randomInt(39001, 45000);
  const env = { ...process.env, FLASH_ROUTER_DATA_DIR: dataDir, FLASH_ROUTER_HOST: '127.0.0.1', FLASH_ROUTER_PORT: String(serverPort), FLASH_ROUTER_WEB_PORT: String(webPort) };
  let server;
  let web;
  let browser;
  try {
    server = start(npmCommand, ['run', 'dev:server'], env);
    web = start(npmCommand, ['--workspace', '@flash-router/web', 'run', 'dev', '--', '--port', String(webPort)], env);
    browser = await chromium.launch({ headless: true });
    await waitFor(`http://127.0.0.1:${serverPort}/api/health/ready`);
    await waitFor(`http://127.0.0.1:${webPort}/`);
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${webPort}/`, { waitUntil: 'networkidle' });
    await page.getByLabel('Email tài khoản').fill('browser-e2e@example.com');
    const createResponse = page.waitForResponse((response) => response.url().endsWith('/api/accounts') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Thêm tài khoản' }).click();
    assert.equal((await createResponse).status(), 201);
    await page.getByRole('heading', { name: 'browser-e2e@example.com', exact: true }).waitFor({ state: 'visible', timeout: 10000 });
    assert.match(await page.locator('body').innerText(), /Đã gửi yêu cầu tạo tài khoản/);
  } finally {
    await browser?.close();
    stop(server);
    stop(web);
    await rm(dataDir, { recursive: true, force: true });
  }
});
