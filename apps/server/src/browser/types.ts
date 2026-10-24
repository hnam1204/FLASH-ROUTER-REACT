export type BrowserAvailability = 'available' | 'unavailable';

export type BrowserState =
  | 'STOPPED'
  | 'STARTING'
  | 'RUNNING'
  | 'STOPPING'
  | 'CRASHED'
  | 'LOCKED'
  | 'UNAVAILABLE';

export type BrowserReason =
  | 'PLAYWRIGHT_NOT_INSTALLED'
  | 'PLAYWRIGHT_LOAD_FAILED'
  | 'BROWSER_LAUNCH_FAILED'
  | 'PROFILE_BUSY'
  | 'PROFILE_NOT_OWNED'
  | 'PROFILE_PATH_INVALID'
  | 'PROFILE_ROOT_INVALID'
  | 'DEFAULT_CHROME_PROFILE_FORBIDDEN'
  | 'LOCK_PATH_INVALID'
  | 'LOCK_RELEASE_FAILED'
  | 'BROWSER_CLOSE_FAILED'
  | 'INVALID_ACCOUNT_ID';

export type ProfileInspection = 'absent' | 'owned' | 'not-owned' | 'invalid';

export interface BrowserContext {
  close(): Promise<void>;
  on(event: 'close', listener: () => void): void;
}

export interface BrowserRuntime {
  chromium?: {
    launchPersistentContext(
      userDataDir: string,
      options: { channel: string; headless: boolean },
    ): Promise<BrowserContext>;
  };
}

export interface BrowserProfilePaths {
  root: string;
  profile: string;
  marker: string;
  lock: string;
}

export interface BrowserSupervisorOptions {
  profilesRoot?: string;
  defaultHeadless?: boolean;
  browserChannel?: string;
  runtime?: BrowserRuntime;
  onUnexpectedClose?: (status: BrowserStatus) => void | Promise<void>;
}

export interface BrowserStartOptions {
  headless?: boolean;
  browserChannel?: string;
}

export interface BrowserStatus {
  accountId: string;
  state: BrowserState;
  availability: BrowserAvailability;
  profilePath: string | null;
  reason?: BrowserReason;
  headless?: boolean;
  startedAt?: string;
}

export interface BrowserOperationResult {
  ok: boolean;
  status: BrowserStatus;
  reason?: BrowserReason;
}

export interface BrowserRuntimeStatus {
  availability: BrowserAvailability;
  reason?: Extract<BrowserReason, 'PLAYWRIGHT_NOT_INSTALLED' | 'PLAYWRIGHT_LOAD_FAILED'>;
}
