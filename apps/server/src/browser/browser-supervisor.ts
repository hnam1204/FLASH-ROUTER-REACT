import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  access,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type {
  BrowserOperationResult,
  BrowserContext,
  BrowserReason,
  BrowserProfilePaths,
  BrowserRuntime,
  BrowserRuntimeStatus,
  BrowserStartOptions,
  BrowserStatus,
  BrowserSupervisorOptions,
  ProfileInspection,
} from './types.js';

interface LoadedRuntime {
  module: BrowserRuntime;
  status: BrowserRuntimeStatus;
}

interface ProfileLock {
  file: FileHandle;
  path: string;
  token: string;
  releasePromise?: Promise<void>;
}

interface RunningBrowser {
  accountId: string;
  accountHash: string;
  profilePath: string;
  lock: ProfileLock;
  context: BrowserContext | null;
  state: 'STARTING' | 'RUNNING' | 'STOPPING';
  headless: boolean;
  startedAt: string;
  stopRequested: boolean;
  closePromise?: Promise<void>;
  finalizationPromise?: Promise<BrowserStatus>;
}

interface ProfileMarker {
  version: 1;
  accountHash: string;
}

interface LockMetadata {
  pid: number;
  startedAt: string;
  accountHash: string;
  token?: string;
}

const require = createRequire(import.meta.url);
const markerFileName = '.flash-router-profile.json';
let loadedRuntime: LoadedRuntime | undefined;

function isMissingModule(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'MODULE_NOT_FOUND';
}

function loadRuntime(): LoadedRuntime {
  if (loadedRuntime) {
    return loadedRuntime;
  }

  let lastError: unknown;
  for (const packageName of ['playwright', 'playwright-core']) {
    try {
      const candidate = require(packageName) as BrowserRuntime & { default?: BrowserRuntime };
      const module = candidate.default ?? candidate;
      if (module.chromium?.launchPersistentContext) {
        loadedRuntime = {
          module,
          status: { availability: 'available' },
        };
        return loadedRuntime;
      }
      lastError = new Error(`${packageName} does not expose chromium.launchPersistentContext`);
    } catch (error) {
      if (!isMissingModule(error)) {
        lastError = error;
      }
    }
  }

  loadedRuntime = {
    module: {},
    status: {
      availability: 'unavailable',
      reason: lastError ? 'PLAYWRIGHT_LOAD_FAILED' : 'PLAYWRIGHT_NOT_INSTALLED',
    },
  };
  return loadedRuntime;
}

function defaultProfilesRoot(): string {
  const dataRoot = process.env.FLASH_ROUTER_DATA_DIR
    ? resolve(process.env.FLASH_ROUTER_DATA_DIR)
    : process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, 'FLASH-ROUTER')
      : process.env.XDG_DATA_HOME
        ? join(process.env.XDG_DATA_HOME, 'flash-router')
        : join(homedir(), '.flash-router');

  return join(dataRoot, 'profiles');
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function isWithin(parent: string, child: string): boolean {
  const relativePath = relative(resolve(parent), resolve(child));
  return relativePath !== '' && !isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !relativePath.startsWith(sep);
}

function validateAccountId(accountId: string): void {
  if (
    typeof accountId !== 'string' ||
    accountId.length === 0 ||
    accountId.length > 256 ||
    accountId !== accountId.trim() ||
    /[\u0000-\u001f\u007f\\/]/u.test(accountId)
  ) {
    throw new BrowserSupervisorError('INVALID_ACCOUNT_ID', 'Account ID is invalid.');
  }
}

function accountHash(accountId: string): string {
  return createHash('sha256').update(accountId, 'utf8').digest('hex');
}

function errorReason(error: unknown, fallback: BrowserReason): BrowserReason {
  if (error instanceof BrowserSupervisorError) {
    return error.code;
  }
  return fallback;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export class BrowserSupervisorError extends Error {
  constructor(
    public readonly code: BrowserReason,
    message: string,
  ) {
    super(message);
    this.name = 'BrowserSupervisorError';
  }
}

export class BrowserSupervisor {
  private readonly options: Required<Pick<BrowserSupervisorOptions, 'defaultHeadless' | 'browserChannel'>> & {
    profilesRoot: string;
    runtime?: BrowserRuntime;
    onUnexpectedClose?: BrowserSupervisorOptions['onUnexpectedClose'];
  };

  private readonly running = new Map<string, RunningBrowser>();
  private readonly lastStatus = new Map<string, BrowserStatus>();

  constructor(options: BrowserSupervisorOptions = {}) {
    const configuredRoot = options.profilesRoot
      ?? process.env.FLASH_ROUTER_PROFILES_ROOT
      ?? defaultProfilesRoot();

    this.options = {
      profilesRoot: resolve(configuredRoot),
      defaultHeadless: options.defaultHeadless ?? false,
      browserChannel: options.browserChannel ?? 'chrome',
      runtime: options.runtime,
      onUnexpectedClose: options.onUnexpectedClose,
    };
  }

  runtimeStatus(): BrowserRuntimeStatus {
    return this.options.runtime ? { availability: 'available' } : loadRuntime().status;
  }

  private runtime(): LoadedRuntime {
    if (this.options.runtime) return { module: this.options.runtime, status: { availability: 'available' } };
    return loadRuntime();
  }

  async getProfilePaths(accountId: string): Promise<BrowserProfilePaths> {
    validateAccountId(accountId);
    const root = await this.ensureProfilesRoot();
    const profile = join(root, accountHash(accountId));
    return {
      root,
      profile,
      marker: join(profile, markerFileName),
      lock: join(root, `${accountHash(accountId)}.lock`),
    };
  }

  async getProfilePath(accountId: string): Promise<string> {
    return (await this.getProfilePaths(accountId)).profile;
  }

  async inspectProfileOwnership(accountId: string): Promise<ProfileInspection> {
    validateAccountId(accountId);
    const root = await this.inspectProfilesRoot();
    if (!root) {
      return 'invalid';
    }
    return this.inspectProfile(join(root, accountHash(accountId)), accountHash(accountId));
  }

  async status(accountId: string): Promise<BrowserStatus> {
    validateAccountId(accountId);
    const hash = accountHash(accountId);
    const active = this.running.get(hash);
    if (active) {
      return this.statusForActive(active);
    }

    const root = await this.inspectProfilesRoot();
    const profilePath = root ? join(root, hash) : null;
    if (root) {
      const lockState = await this.recoverStaleLock(join(root, `${hash}.lock`), hash);
      if (lockState === 'invalid') {
        return this.remember({
          accountId,
          state: 'UNAVAILABLE',
          availability: 'unavailable',
          profilePath,
          reason: 'LOCK_PATH_INVALID',
        }, hash);
      }
      if (lockState === 'present') {
        return this.remember({
          accountId,
          state: 'LOCKED',
          availability: 'available',
          profilePath,
          reason: 'PROFILE_BUSY',
        }, hash);
      }

      const ownership = profilePath ? await this.inspectProfile(profilePath, hash) : 'invalid';
      if (ownership === 'invalid') {
        return this.remember({
          accountId,
          state: 'UNAVAILABLE',
          availability: 'unavailable',
          profilePath,
          reason: 'PROFILE_PATH_INVALID',
        }, hash);
      }
      if (ownership === 'not-owned') {
        return this.remember({
          accountId,
          state: 'UNAVAILABLE',
          availability: 'unavailable',
          profilePath,
          reason: 'PROFILE_NOT_OWNED',
        }, hash);
      }
    }

    const runtime = this.runtime().status;
    if (runtime.availability === 'unavailable') {
      return this.remember({
        accountId,
        state: 'UNAVAILABLE',
        availability: 'unavailable',
        profilePath,
        reason: runtime.reason,
      }, hash);
    }

    const previous = this.lastStatus.get(hash);
    if (previous?.state === 'CRASHED') {
      return previous;
    }

    return this.remember({
      accountId,
      state: 'STOPPED',
      availability: 'available',
      profilePath,
    }, hash);
  }

  async start(accountId: string, options: BrowserStartOptions = {}): Promise<BrowserOperationResult> {
    validateAccountId(accountId);
    const hash = accountHash(accountId);
    const current = this.running.get(hash);
    if (current?.state === 'RUNNING') {
      return { ok: true, status: this.statusForActive(current) };
    }
    if (current) {
      return this.failure(this.statusForActive(current), 'PROFILE_BUSY');
    }

    const runtime = this.runtime();
    if (runtime.status.availability === 'unavailable') {
      const status = this.remember({
        accountId,
        state: 'UNAVAILABLE',
        availability: 'unavailable',
        profilePath: null,
        reason: runtime.status.reason,
      }, hash);
      return { ok: false, status, reason: runtime.status.reason };
    }

    let root: string;
    let profilePath: string | undefined;
    let lock: ProfileLock | undefined;
    try {
      root = await this.ensureProfilesRoot();
      profilePath = join(root, hash);
      lock = await this.acquireLock(root, hash);
      await this.ensureOwnedProfile(profilePath, root, hash);
    } catch (error) {
      const releaseReason = lock ? await this.releaseLockSafely(lock) : undefined;
      const reason = releaseReason ?? errorReason(error, 'PROFILE_ROOT_INVALID');
      const status = this.remember({
        accountId,
        state: reason === 'PROFILE_BUSY' ? 'LOCKED' : 'UNAVAILABLE',
        availability: reason === 'PROFILE_BUSY' ? 'available' : 'unavailable',
        profilePath: typeof profilePath === 'string' ? profilePath : null,
        reason,
      }, hash);
      return { ok: false, status, reason };
    }

    if (!lock) {
      const status = this.remember({
        accountId,
        state: 'UNAVAILABLE',
        availability: 'unavailable',
        profilePath: profilePath ?? null,
        reason: 'PROFILE_ROOT_INVALID',
      }, hash);
      return { ok: false, status, reason: 'PROFILE_ROOT_INVALID' };
    }

    const headless = options.headless ?? this.options.defaultHeadless;
    const record: RunningBrowser = {
      accountId,
      accountHash: hash,
      profilePath,
      lock,
      context: null,
      state: 'STARTING',
      headless,
      startedAt: new Date().toISOString(),
      stopRequested: false,
    };
    this.running.set(hash, record);
    this.lastStatus.set(hash, this.statusForActive(record));

    try {
      const context = await runtime.module.chromium!.launchPersistentContext(profilePath, {
        channel: options.browserChannel ?? this.options.browserChannel,
        headless,
      });
      record.context = context;
      context.on('close', () => {
        void this.handleUnexpectedClose(record);
      });
      record.state = 'RUNNING';
      const status = this.remember(this.statusForActive(record), hash);
      return { ok: true, status };
    } catch {
      this.running.delete(hash);
      const releaseReason = await this.releaseLockSafely(lock);
      const reason = releaseReason ?? 'BROWSER_LAUNCH_FAILED';
      const status = this.remember({
        accountId,
        state: reason === 'LOCK_RELEASE_FAILED' ? 'CRASHED' : 'UNAVAILABLE',
        availability: reason === 'LOCK_RELEASE_FAILED' ? 'available' : 'unavailable',
        profilePath,
        reason,
        headless,
      }, hash);
      return { ok: false, status, reason };
    }
  }

  async stop(accountId: string): Promise<BrowserOperationResult> {
    validateAccountId(accountId);
    const hash = accountHash(accountId);
    const active = this.running.get(hash);
    if (!active) {
      const status = await this.status(accountId);
      if (status.state === 'LOCKED') {
        return this.failure(status, 'PROFILE_BUSY');
      }
      return { ok: status.state === 'STOPPED', status, reason: status.reason };
    }
    if (!active.context) {
      return this.failure(this.statusForActive(active), 'PROFILE_BUSY');
    }

    active.state = 'STOPPING';
    active.stopRequested = true;
    this.lastStatus.set(hash, this.statusForActive(active));
    try {
      active.closePromise ??= active.context.close().finally(() => {
        active.closePromise = undefined;
      });
      await active.closePromise;
    } catch {
      const status = await this.finalizeClosedRecord(active, 'BROWSER_CLOSE_FAILED');
      return { ok: false, status, reason: 'BROWSER_CLOSE_FAILED' };
    }

    const status = await this.finalizeClosedRecord(active);
    if (status.state === 'STOPPED') {
      return { ok: true, status };
    }
    return this.failure(status, status.reason ?? 'LOCK_RELEASE_FAILED');
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.running.values()].map(async (record) => {
      await this.stop(record.accountId);
    }));
  }

  private async handleUnexpectedClose(record: RunningBrowser): Promise<void> {
    if (this.running.get(record.accountHash) !== record) {
      return;
    }

    const status = await this.finalizeClosedRecord(record);
    if (!record.stopRequested) await this.options.onUnexpectedClose?.(status);
  }

  private async finalizeClosedRecord(
    record: RunningBrowser,
    failureReason?: Extract<BrowserReason, 'BROWSER_CLOSE_FAILED'>,
  ): Promise<BrowserStatus> {
    if (record.finalizationPromise) {
      return record.finalizationPromise;
    }

    record.finalizationPromise = (async () => {
      if (this.running.get(record.accountHash) !== record) {
        return this.lastStatus.get(record.accountHash) ?? this.statusForActive(record);
      }

      this.running.delete(record.accountHash);
      const releaseReason = await this.releaseLockSafely(record.lock);
      const reason = releaseReason ?? failureReason;
      this.remember({
        accountId: record.accountId,
        state: reason ? 'CRASHED' : record.stopRequested ? 'STOPPED' : 'CRASHED',
        availability: releaseReason === 'LOCK_RELEASE_FAILED' ? 'unavailable' : 'available',
        profilePath: record.profilePath,
        reason,
        headless: record.headless,
        startedAt: record.startedAt,
      }, record.accountHash);
      return this.lastStatus.get(record.accountHash)!;
    })();

    return record.finalizationPromise;
  }

  private statusForActive(record: RunningBrowser): BrowserStatus {
    return {
      accountId: record.accountId,
      state: record.state,
      availability: 'available',
      profilePath: record.profilePath,
      headless: record.headless,
      startedAt: record.startedAt,
    };
  }

  private remember(status: BrowserStatus, hash: string): BrowserStatus {
    this.lastStatus.set(hash, status);
    return status;
  }

  private failure(status: BrowserStatus, reason: BrowserReason): BrowserOperationResult {
    return { ok: false, status: { ...status, reason }, reason };
  }

  private async ensureProfilesRoot(): Promise<string> {
    const configuredRoot = this.options.profilesRoot;
    this.assertNotDefaultChromePath(configuredRoot);
    await mkdir(configuredRoot, { recursive: true, mode: 0o700 });

    const rootStat = await lstat(configuredRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new BrowserSupervisorError('PROFILE_ROOT_INVALID', 'The profile root is not an owned directory.');
    }

    const canonicalRoot = await realpath(configuredRoot);
    this.assertNotDefaultChromePath(canonicalRoot);
    return canonicalRoot;
  }

  private async inspectProfilesRoot(): Promise<string | null> {
    const configuredRoot = this.options.profilesRoot;
    try {
      this.assertNotDefaultChromePath(configuredRoot);
      const rootStat = await lstat(configuredRoot);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        return null;
      }
      const canonicalRoot = await realpath(configuredRoot);
      this.assertNotDefaultChromePath(canonicalRoot);
      return canonicalRoot;
    } catch {
      return null;
    }
  }

  private assertNotDefaultChromePath(candidate: string): void {
    const roots = [
      process.env.LOCALAPPDATA,
      process.env.APPDATA,
    ].filter((value): value is string => Boolean(value)).map((value) => join(value, 'Google', 'Chrome', 'User Data'));

    if (roots.some((defaultRoot) => samePath(candidate, defaultRoot) || isWithin(defaultRoot, candidate))) {
      throw new BrowserSupervisorError(
        'DEFAULT_CHROME_PROFILE_FORBIDDEN',
        'The default Chrome profile location cannot be used.',
      );
    }
  }

  private async ensureOwnedProfile(profilePath: string, root: string, hash: string): Promise<void> {
    if (dirname(profilePath) !== root || basename(profilePath) !== hash) {
      throw new BrowserSupervisorError('PROFILE_PATH_INVALID', 'The profile path is outside the owned root.');
    }

    await mkdir(profilePath, { recursive: true, mode: 0o700 });
    const profileStat = await lstat(profilePath);
    if (!profileStat.isDirectory() || profileStat.isSymbolicLink()) {
      throw new BrowserSupervisorError('PROFILE_PATH_INVALID', 'The profile path is not an owned directory.');
    }

    const canonicalProfile = await realpath(profilePath);
    if (!samePath(dirname(canonicalProfile), root)) {
      throw new BrowserSupervisorError('PROFILE_PATH_INVALID', 'The profile path escapes the owned root.');
    }

    const markerPath = join(profilePath, markerFileName);
    if (await exists(markerPath)) {
      const markerStat = await lstat(markerPath);
      if (markerStat.isSymbolicLink() || !markerStat.isFile()) {
        throw new BrowserSupervisorError('PROFILE_NOT_OWNED', 'The profile ownership marker is invalid.');
      }
      let marker: ProfileMarker;
      try {
        marker = JSON.parse(await readFile(markerPath, 'utf8')) as ProfileMarker;
      } catch {
        throw new BrowserSupervisorError('PROFILE_NOT_OWNED', 'The profile ownership marker is unreadable.');
      }
      if (marker.version !== 1 || marker.accountHash !== hash) {
        throw new BrowserSupervisorError('PROFILE_NOT_OWNED', 'The profile belongs to another account mapping.');
      }
      return;
    }

    if ((await readdir(profilePath)).length > 0) {
      throw new BrowserSupervisorError('PROFILE_NOT_OWNED', 'An unmarked profile directory cannot be adopted.');
    }

    await writeFile(markerPath, `${JSON.stringify({ version: 1, accountHash: hash })}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
  }

  private async inspectProfile(profilePath: string, hash: string): Promise<'absent' | 'owned' | 'not-owned' | 'invalid'> {
    if (!(await exists(profilePath))) {
      return 'absent';
    }

    try {
      const profileStat = await lstat(profilePath);
      if (!profileStat.isDirectory() || profileStat.isSymbolicLink()) {
        return 'invalid';
      }
      const markerPath = join(profilePath, markerFileName);
      if (!(await exists(markerPath))) {
        return 'not-owned';
      }
      const markerStat = await lstat(markerPath);
      if (markerStat.isSymbolicLink() || !markerStat.isFile()) {
        return 'invalid';
      }
      const marker = JSON.parse(await readFile(markerPath, 'utf8')) as ProfileMarker;
      return marker.version === 1 && marker.accountHash === hash ? 'owned' : 'not-owned';
    } catch {
      return 'invalid';
    }
  }

  private async acquireLock(root: string, hash: string): Promise<ProfileLock> {
    const lockPath = join(root, `${hash}.lock`);
    let file: FileHandle;
    try {
      file = await open(lockPath, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        const lockState = await this.inspectLock(lockPath);
        if (lockState === 'invalid') {
          throw new BrowserSupervisorError('LOCK_PATH_INVALID', 'The profile lock path is invalid.');
        }
        throw new BrowserSupervisorError('PROFILE_BUSY', 'The profile is already locked.');
      }
      throw error;
    }

    try {
      const token = randomUUID();
      await file.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), accountHash: hash, token })}\n`, 'utf8');
      return { file, path: lockPath, token };
    } catch (error) {
      await file.close().catch(() => undefined);
      await rm(lockPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async inspectLock(lockPath: string): Promise<'absent' | 'present' | 'invalid'> {
    try {
      const lockStat = await lstat(lockPath);
      if (lockStat.isSymbolicLink() || !lockStat.isFile()) {
        return 'invalid';
      }
      return 'present';
    } catch {
      return 'absent';
    }
  }

  private async recoverStaleLock(lockPath: string, hash: string): Promise<'absent' | 'present' | 'invalid'> {
    const state = await this.inspectLock(lockPath);
    if (state !== 'present') return state;
    try {
      const metadata = JSON.parse(await readFile(lockPath, 'utf8')) as Partial<LockMetadata>;
      if (metadata.accountHash !== hash || typeof metadata.pid !== 'number') return 'invalid';
      try {
        process.kill(metadata.pid, 0);
        return 'present';
      } catch {
        await rm(lockPath, { force: false });
        return 'absent';
      }
    } catch {
      return 'invalid';
    }
  }

  private async releaseLock(lock: ProfileLock): Promise<void> {
    if (lock.releasePromise) return lock.releasePromise;
    lock.releasePromise = (async () => {
      await lock.file.close();
      try {
        const metadata = JSON.parse(await readFile(lock.path, 'utf8')) as Partial<LockMetadata>;
        if (metadata.token !== lock.token) throw new Error('lock token mismatch');
        await rm(lock.path, { force: false });
      } catch {
        throw new BrowserSupervisorError('LOCK_RELEASE_FAILED', 'The profile lock could not be released.');
      }
    })();
    return lock.releasePromise;
  }

  private async releaseLockSafely(lock: ProfileLock): Promise<Extract<BrowserReason, 'LOCK_RELEASE_FAILED'> | undefined> {
    try {
      await this.releaseLock(lock);
      return undefined;
    } catch {
      return 'LOCK_RELEASE_FAILED';
    }
  }
}
