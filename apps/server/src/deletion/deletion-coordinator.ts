import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { lstat, readFile, realpath, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type {
  BrowserSupervisorPort,
  DeletionCompleteResult,
  DeletionCoordinatorOptions,
  DeletionFailureCode,
  DeletionResult,
} from './types.js';

const profileMarkerFile = '.flash-router-profile.json';

class DeletionError extends Error {
  constructor(
    public readonly code: DeletionFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'DeletionError';
  }
}

type OwnedRoots = {
  dataRoot: string;
  profilesRoot: string;
};

function isNotFound(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT';
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = canonicalOrResolved(left);
  const normalizedRight = canonicalOrResolved(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function canonicalOrResolved(path: string): string {
  const resolvedPath = resolve(path);
  try {
    return realpathSync.native(resolvedPath);
  } catch {
    return resolvedPath;
  }
}

function isDirectChild(parent: string, child: string): boolean {
  const childRelative = relative(resolve(parent), resolve(child));
  return childRelative !== ''
    && !isAbsolute(childRelative)
    && childRelative !== '..'
    && !childRelative.startsWith(`..${sep}`)
    && !childRelative.startsWith(sep)
    && !childRelative.includes(sep);
}

function isWithinOrSame(parent: string, child: string): boolean {
  return samePath(parent, child) || isWithin(parent, child);
}

function isWithin(parent: string, child: string): boolean {
  const childRelative = relative(resolve(parent), resolve(child));
  return childRelative !== '..'
    && !isAbsolute(childRelative)
    && !childRelative.startsWith(`..${sep}`)
    && !childRelative.startsWith(sep);
}

function accountHash(accountId: string): string {
  return createHash('sha256').update(accountId, 'utf8').digest('hex');
}

function validateAccountId(accountId: string): void {
  if (
    typeof accountId !== 'string'
    || accountId.length === 0
    || accountId.length > 256
    || accountId !== accountId.trim()
    || /[\u0000-\u001f\u007f]/u.test(accountId)
  ) {
    throw new DeletionError('INVALID_ACCOUNT_ID', 'The account ID is invalid.');
  }
}

function isOwnedMarker(value: unknown, hash: string): boolean {
  return typeof value === 'object'
    && value !== null
    && 'version' in value
    && 'accountHash' in value
    && (value as { version?: unknown }).version === 1
    && (value as { accountHash?: unknown }).accountHash === hash;
}

function configuredDataDir(options: DeletionCoordinatorOptions): string | undefined {
  const value = options.dataDir ?? process.env.FLASH_ROUTER_DATA_DIR;
  return value ? resolve(value) : undefined;
}

function rejectDefaultChromePath(dataRoot: string): void {
  const defaultRoots = [process.env.LOCALAPPDATA, process.env.APPDATA]
    .filter((value): value is string => Boolean(value))
    .map((value) => join(value, 'Google', 'Chrome', 'User Data'));
  if (defaultRoots.some((root) => isWithinOrSame(root, dataRoot))) {
    throw new DeletionError('DATA_ROOT_INVALID', 'The default Chrome profile location is not an app data root.');
  }
}

async function inspectDirectory(path: string, code: DeletionFailureCode, allowMissing: boolean): Promise<string | null> {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    if (allowMissing && isNotFound(error)) {
      return null;
    }
    throw new DeletionError(code, 'The configured deletion path is unavailable.');
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new DeletionError(code, 'The configured deletion path is not an owned directory.');
  }
  const canonicalPath = await realpath(path).catch(() => {
    throw new DeletionError(code, 'The configured deletion path cannot be canonicalized.');
  });
  if (!samePath(canonicalPath, path)) {
    throw new DeletionError(code, 'The configured deletion path escapes its owned location.');
  }
  return canonicalPath;
}

async function inspectOwnedProfile(profilePath: string, profilesRoot: string, hash: string): Promise<boolean> {
  const candidate = resolve(profilePath);
  const expectedPath = join(profilesRoot, hash);
  if (!samePath(candidate, expectedPath) || !isDirectChild(profilesRoot, candidate)) {
    throw new DeletionError('PROFILE_PATH_INVALID', 'The profile path is not the account-owned profile path.');
  }

  let profileStats;
  try {
    profileStats = await lstat(candidate);
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw new DeletionError('PROFILE_PATH_INVALID', 'The profile path cannot be inspected.');
  }
  if (!profileStats.isDirectory() || profileStats.isSymbolicLink()) {
    throw new DeletionError('PROFILE_PATH_INVALID', 'The profile path is not an owned directory.');
  }

  const canonicalProfile = await realpath(candidate).catch(() => {
    throw new DeletionError('PROFILE_PATH_INVALID', 'The profile path cannot be canonicalized.');
  });
  if (!samePath(canonicalProfile, candidate) || !samePath(dirname(canonicalProfile), profilesRoot)) {
    throw new DeletionError('PROFILE_PATH_INVALID', 'The profile path escapes the owned profiles root.');
  }

  const markerPath = join(candidate, profileMarkerFile);
  let markerStats;
  try {
    markerStats = await lstat(markerPath);
  } catch {
    throw new DeletionError('PROFILE_NOT_OWNED', 'The profile ownership marker is missing.');
  }
  if (!markerStats.isFile() || markerStats.isSymbolicLink()) {
    throw new DeletionError('PROFILE_NOT_OWNED', 'The profile ownership marker is invalid.');
  }

  let marker: unknown;
  try {
    marker = JSON.parse(await readFile(markerPath, 'utf8')) as unknown;
  } catch {
    throw new DeletionError('PROFILE_NOT_OWNED', 'The profile ownership marker is unreadable.');
  }
  if (!isOwnedMarker(marker, hash)) {
    throw new DeletionError('PROFILE_NOT_OWNED', 'The profile belongs to another account mapping.');
  }
  return true;
}

export class DeletionCoordinator {
  private readonly dataDir: string | undefined;

  constructor(
    private readonly browserSupervisor: BrowserSupervisorPort,
    options: DeletionCoordinatorOptions = {},
  ) {
    this.dataDir = configuredDataDir(options);
  }

  async deleteAccount(accountId: string): Promise<DeletionResult> {
    const reportedAccountId = typeof accountId === 'string' ? accountId : '';
    let safeProfilePath: string | undefined;

    try {
      validateAccountId(accountId);
      const roots = await this.resolveOwnedRoots();
      const hash = accountHash(accountId);
      const profilePath = await this.browserSupervisor.getProfilePath(accountId);
      safeProfilePath = resolve(profilePath);
      const initiallyOwned = await inspectOwnedProfile(profilePath, roots.profilesRoot, hash);

      const stopResult = await this.browserSupervisor.stop(accountId).catch(() => null);
      if (!stopResult?.ok) {
        return this.failed(reportedAccountId, 'BROWSER_STOP_FAILED', 'The browser could not be stopped safely.', safeProfilePath);
      }

      await inspectDirectory(roots.dataRoot, 'DATA_ROOT_INVALID', false);
      const currentProfilesRoot = await inspectDirectory(roots.profilesRoot, 'DATA_ROOT_INVALID', true);
      if (currentProfilesRoot && !samePath(currentProfilesRoot, roots.profilesRoot)) {
        throw new DeletionError('DATA_ROOT_INVALID', 'The profiles root changed outside its owned location.');
      }
      const currentlyOwned = await inspectOwnedProfile(profilePath, roots.profilesRoot, hash);
      if (currentlyOwned) {
        await rm(safeProfilePath, { recursive: true, force: false }).catch(() => {
          throw new DeletionError('PROFILE_REMOVE_FAILED', 'The owned profile could not be removed.');
        });
        try {
          await lstat(safeProfilePath);
          throw new DeletionError('PROFILE_NOT_REMOVED', 'The owned profile is still present.');
        } catch (error) {
          if (!isNotFound(error)) {
            throw error;
          }
        }
      }

      return {
        ok: true,
        status: 'complete',
        accountId,
        profilePath: safeProfilePath,
        removed: initiallyOwned || currentlyOwned,
      } satisfies DeletionCompleteResult;
    } catch (error) {
      if (error instanceof DeletionError) {
        return this.failed(reportedAccountId, error.code, error.message, safeProfilePath);
      }
      return this.failed(reportedAccountId, 'PROFILE_REMOVE_FAILED', 'The local profile deletion failed.', safeProfilePath);
    }
  }

  private async resolveOwnedRoots(): Promise<OwnedRoots> {
    if (!this.dataDir) {
      throw new DeletionError('DATA_ROOT_INVALID', 'FLASH_ROUTER_DATA_DIR is not configured.');
    }
    const dataRoot = await inspectDirectory(this.dataDir, 'DATA_ROOT_INVALID', false);
    if (!dataRoot) {
      throw new DeletionError('DATA_ROOT_INVALID', 'The configured data root is unavailable.');
    }
    rejectDefaultChromePath(dataRoot);

    const configuredProfilesRoot = resolve(
      process.env.FLASH_ROUTER_PROFILES_ROOT || join(dataRoot, 'profiles'),
    );
    if (!isDirectChild(dataRoot, configuredProfilesRoot)) {
      throw new DeletionError('DATA_ROOT_INVALID', 'The profiles root must be a direct child of the data root.');
    }
    const profilesRoot = await inspectDirectory(configuredProfilesRoot, 'DATA_ROOT_INVALID', true);
    return { dataRoot, profilesRoot: profilesRoot ?? configuredProfilesRoot };
  }

  private failed(
    accountId: string,
    code: DeletionFailureCode,
    message: string,
    profilePath?: string,
  ): DeletionResult {
    return {
      ok: false,
      status: 'failed',
      accountId,
      code,
      message,
      ...(profilePath ? { profilePath } : {}),
    };
  }
}
