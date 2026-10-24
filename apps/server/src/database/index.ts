import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { accountSchema, type Account } from '@flash-router/shared';

export type AccountCursor = {
  createdAt: string;
  id: string;
};

export type AccountPage = {
  items: Account[];
  nextCursor: string | null;
};

export type AccountMetadataPatch = {
  name?: string;
  plan?: string;
};

type AccountRow = {
  id: string;
  name: string;
  email: string;
  plan: string;
  session_status: Account['sessionStatus'];
  browser_status: Account['browserStatus'];
  automation_status: Account['automationStatus'];
  last_login_at: string | null;
  created_at: string;
};

export class DuplicateEmailError extends Error {
  constructor() {
    super('duplicate email');
    this.name = 'DuplicateEmailError';
  }
}

function toAccount(row: AccountRow): Account {
  return accountSchema.parse({
    id: row.id,
    name: row.name,
    email: row.email,
    plan: row.plan,
    sessionStatus: row.session_status,
    browserStatus: row.browser_status,
    automationStatus: row.automation_status,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
  });
}

function isDuplicateEmail(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed: accounts\.email/i.test(error.message);
}

function encodeCursor(cursor: AccountCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export class AccountDatabase {
  private readonly database: DatabaseSync;

  constructor(filename: string) {
    mkdirSync(dirname(filename), { recursive: true });
    this.database = new DatabaseSync(filename);
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL COLLATE NOCASE UNIQUE,
        plan TEXT NOT NULL DEFAULT 'Chưa xác định',
        session_status TEXT NOT NULL DEFAULT 'UNKNOWN',
        browser_status TEXT NOT NULL DEFAULT 'STOPPED',
        automation_status TEXT NOT NULL DEFAULT 'IDLE',
        last_login_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_accounts_created_id
        ON accounts (created_at DESC, id DESC);
    `);
  }

  isReady(): boolean {
    try {
      this.database.prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this.database.close();
  }

  createAccount(account: Account): Account {
    try {
      this.database.prepare(`
        INSERT INTO accounts (
          id, name, email, plan, session_status, browser_status,
          automation_status, last_login_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        account.id,
        account.name,
        account.email,
        account.plan,
        account.sessionStatus,
        account.browserStatus,
        account.automationStatus,
        account.lastLoginAt,
        account.createdAt,
      );
      return account;
    } catch (error) {
      if (isDuplicateEmail(error)) {
        throw new DuplicateEmailError();
      }
      throw error;
    }
  }

  getAccount(id: string): Account | null {
    const row = this.database.prepare(`
      SELECT id, name, email, plan, session_status, browser_status,
        automation_status, last_login_at, created_at
      FROM accounts
      WHERE id = ?
    `).get(id) as AccountRow | undefined;
    return row ? toAccount(row) : null;
  }

  listAccounts(query: string, limit: number, cursor?: AccountCursor): AccountPage {
    const search = query ? `%${query}%` : null;
    const statement = cursor
      ? this.database.prepare(`
        SELECT id, name, email, plan, session_status, browser_status,
          automation_status, last_login_at, created_at
        FROM accounts
        WHERE (created_at < ? OR (created_at = ? AND id < ?))
          AND (? IS NULL OR name LIKE ? OR email LIKE ?)
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `)
      : this.database.prepare(`
        SELECT id, name, email, plan, session_status, browser_status,
          automation_status, last_login_at, created_at
        FROM accounts
        WHERE (? IS NULL OR name LIKE ? OR email LIKE ?)
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `);
    const rows = (cursor
      ? statement.all(cursor.createdAt, cursor.createdAt, cursor.id, search, search, search, limit + 1)
      : statement.all(search, search, search, limit + 1)) as AccountRow[];
    const hasMore = rows.length > limit;
    const visibleRows = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = visibleRows.at(-1);
    return {
      items: visibleRows.map(toAccount),
      nextCursor: hasMore && lastRow
        ? encodeCursor({ createdAt: lastRow.created_at, id: lastRow.id })
        : null,
    };
  }

  updateAccount(id: string, patch: AccountMetadataPatch): Account | null {
    const result = this.database.prepare(`
      UPDATE accounts
      SET name = COALESCE(?, name), plan = COALESCE(?, plan)
      WHERE id = ?
    `).run(patch.name ?? null, patch.plan ?? null, id);
    return result.changes > 0 ? this.getAccount(id) : null;
  }

  updateRuntimeState(id: string, patch: Partial<Pick<Account, 'browserStatus' | 'sessionStatus' | 'automationStatus' | 'lastLoginAt'>>): Account | null {
    const result = this.database.prepare(`
      UPDATE accounts SET browser_status = COALESCE(?, browser_status),
        session_status = COALESCE(?, session_status), automation_status = COALESCE(?, automation_status),
        last_login_at = COALESCE(?, last_login_at) WHERE id = ?
    `).run(
      patch.browserStatus ?? null,
      patch.sessionStatus ?? null,
      patch.automationStatus ?? null,
      patch.lastLoginAt ?? null,
      id,
    );
    return result.changes > 0 ? this.getAccount(id) : null;
  }

  deleteAccount(id: string): boolean {
    const result = this.database.prepare('DELETE FROM accounts WHERE id = ?').run(id);
    return result.changes > 0;
  }
}
