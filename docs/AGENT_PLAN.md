# Multi-Agent Implementation Plan — FLASH ROUTER

**Scheduling target:** prioritize usable MVP today; do not assert guaranteed completion. **7 GPT-5.6 Luna agents:** A0 lead + A1–A6 specialists. **Max 3 specialist writers in parallel** on a shared Main checkout. Confirm Luna model access in Codex first.

## Wave 0 — A0: Inspect and freeze contracts

1. Inspect repo, `git status`, branch `Main`, installed skill instructions and MCP capability smoke-test.
2. Establish package.json/npm workspaces, lockfile, TypeScript build, shared Zod contract, environment config, `.gitignore`.
3. Agree one API/schema contract; isolate file ownership; ban workers from committing/creating branches/worktrees.
4. Baseline `npm ci`, typecheck, lint, build, tests. Do not claim readiness while scripts are missing.

## Wave 1 — three writers in parallel

| Agent | Owns | Deliverable | Gate |
| --- | --- | --- | --- |
| A1 Backend | `apps/server/src/{accounts,database}`, DB migrations | Real SQLite CRUD, duplicate handling, paginated queries | Restart persistence, negative validations |
| A2 Chrome | `apps/server/src/{browser,sessions}` | Real `launchPersistentContext`, headed/headless config, lifecycle & locks | Two isolated profiles, persistence, no lock race |
| A3 UI | `apps/web` | Responsive single-page app with real API wiring, safe form, no seed/demo | Every visible control functional; mobile/desktop DevTools check |

**Important:** A3 uses contract from shared package. A2 never implements MFA bypass/unauthorized automation. A1 does not store passwords/TOTP secrets.

## Wave 2 — three writers in parallel

| Agent | Owns | Deliverable | Gate |
| --- | --- | --- | --- |
| A4 Observability | `apps/server/src/{jobs,events}` | SSE events, bounded queue, masked logs, diagnostics | Real job event round trip; no secrets |
| A5 Security/Deletion | `apps/server/src/deletion`, security tests | Crash-safe local deletion with path restrictions | Delete removes owned profile & related DB/artifacts; unrelated profiles survive |
| A6 QA/Release | `tests`, `scripts`, `docs`, `.github/workflows` | Windows clean-clone test, setup scripts, E2E, cleanup procedure, README | CI/ local tests, diagnostics redaction, no temp residue post-commit |

## Wave 3 — A0 integration and evidence

1. Start backend and UI for actual HTTP calls and Chrome launch.
2. Validate create -> open Chrome -> interactive supported authentication -> observe -> close/reopen -> delete.
3. Verify Chrome profile A and B never share auth state. Deletion never reaches default Chrome profile.
4. Benchmark progressive 1 / 3 / 5 Chrome first; 20+ only if hardware proves safe.
5. Cross-viewport QA and log sanitization. Tests must be real in production paths, fixtures limited to isolated test directories.

## Wave 4 — A0 release gate

- Run agreed tests; record command, output, PASS/FAIL and issue list.
- Commit on `Main` only if all required gates passed and no data loss.
- After commit SHA is known, delete only isolated `.tmp/test-runs/<run-id>` artifacts (retain permanent test code).
- Push only with owner authorization. Report link + commit SHA + clean-clone instructions.

## Integration conflicts

A0 owns root config, `packages/shared`, API spec, Git, dependency lockfile, integration scripts. Other agents coordinate before changing them. Never ask multiple agents to execute npm install or migrations simultaneously. All DevTools work on selected account/profile only.
