# FLASH ROUTER — Engineering Rules

## Scope

Single-page responsive Windows-hosted local web application to manage authorized individual Chrome profiles and their session state. Product runs on each developer's own machine after Git clone. Repository contains no real account data, passwords, TOTP secrets, cookies or tokens.

## Git

- ONLY branch `Main` (case sensitive). No feature/dev branches, no worktrees.
- Lead A0 alone integrates changes and commits. Never push unless project owner explicitly authorizes.
- Workers own disjoint directories and must not edit shared contracts without A0 approval.
- Do not use `reset --hard`, force push, destructive cleanup outside the designated test area, or rewrite history.
- Never mark PASS without the command, exit status, evidence, environment and scope.

## Runtime engineering

- Real implementations: no mock/demo/fake UI, response, logs, data or buttons in the production build.
- Mocks/fixtures may exist ONLY in isolated automated tests; never in production runtime data.
- Authentication uses the legitimate provider flow with human verification when required. Do not bypass MFA, CAPTCHA, rate limits or protections, and do not promise unattended sign-in.
- No credential or TOTP-secret logging; do not export cookies/tokens for alternate reuse. Browser profiles hold their own local session state.
- Every browser profile maps to exactly one account ID. Never use the person's default Chrome profile.
- Deletion affects only an app-owned, canonicalized profile path after confirmation and process termination. Prove that removed local resources are gone; never claim erasure of backups, SSD remanence or remote provider-side data without evidence.
- User-facing UI copy in clear Vietnamese, no raw internal enum jargon. Owner link: https://zalo.me/0379052767. Wait for owner-provided logo; do not generate a surrogate official brand logo.
- Keep the UI single-page, responsive. Mobile accesses UI, not a local Windows Chrome process on the phone.

## Test and cleanup policy

- Permanent tests live under `tests/` and remain versioned.
- Each test run has a dedicated `.tmp/test-runs/<run-id>/`; never reuse real browser profiles.
- After required tests PASS and A0 commit succeeds, delete *only* that run's temporary artifacts; never delete test code, production data, failure evidence still required, or shared browser profiles.
- A0 reports commit SHA, tests, outstanding limitations and cleanup verification.

## Responsibilities

See `docs/AGENT_PLAN.md`. A0 must read relevant installed SKILL.md before assigning each worker. Skills on the local Windows device cannot be assumed available inside unrelated chat sandboxes.
