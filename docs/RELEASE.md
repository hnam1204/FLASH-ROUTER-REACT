# Release & first-time clone gate

1. Public or private status and LICENSE remain owner decisions. Do not create arbitrary licensing claims.
2. Initial repository branch MUST be `Main` (case-sensitive); do not create `main` or develop branches.
3. Owner controls GitHub push. Lead commits only after agreed acceptance checks; do not alter remote without permission.
4. Data path defaults are host-local config, never hardcoded to maintainer's D drive for all users. Profiles/db/logs not in Git.
5. On clean Windows, clone only `Main`, npm ci from committed lockfile, run documented setup/start, create one profile, open Chrome, observe state; verify absence of leaked credentials.
6. If a test fails, retain only the necessary sanitized evidence until diagnosed, then cleanup. After passing tests and successful commit, promptly clear run artifacts, not test source.
