export type DeletionFailureCode =
  | 'INVALID_ACCOUNT_ID'
  | 'DATA_ROOT_INVALID'
  | 'PROFILE_PATH_INVALID'
  | 'PROFILE_NOT_OWNED'
  | 'BROWSER_STOP_FAILED'
  | 'PROFILE_REMOVE_FAILED'
  | 'PROFILE_NOT_REMOVED';

export interface BrowserSupervisorPort {
  getProfilePath(accountId: string): Promise<string>;
  stop(accountId: string): Promise<{ ok: boolean; reason?: string }>;
}

export interface DeletionCoordinatorOptions {
  dataDir?: string;
  profilesRoot?: string;
}

export interface DeletionCompleteResult {
  ok: true;
  status: 'complete';
  accountId: string;
  profilePath: string;
  removed: boolean;
}

export interface DeletionFailedResult {
  ok: false;
  status: 'failed';
  accountId: string;
  code: DeletionFailureCode;
  message: string;
  profilePath?: string;
}

export type DeletionResult = DeletionCompleteResult | DeletionFailedResult;
