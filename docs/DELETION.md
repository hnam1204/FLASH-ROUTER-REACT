# Local Account Deletion: crash-safe contract

Deletion is destructive. Require explicit user confirmation and account identity verification. Never delete remote ChatGPT accounts unless a separate authenticated provider-side action is explicitly supported/requested.

1. Atomically set account state `DELETING` and stop new jobs/launches.
2. Cancel/finish owned jobs and close the correct browser process. Check PID/account mapping, release process lock.
3. Canonicalize `profilePath`; verify it is a direct child of owned `profilesRoot`. Reject symlink/reparse point/junction boundary escape and reject default Chrome paths.
4. Remove app-owned profile, logs, artifacts, local data for that account; purge related DB records and vault references.
5. Record and reconcile any partial failure with a *minimal* deletion progress record; retry safely after crash without re-creating profile.
6. Confirm absence of app-owned profile and account/related records. Only then return `LOCAL_DELETION_COMPLETE`.

Design review must include SQLite WAL, backups, snapshot/SSD-remanence limitations and permission failures. Claims of physical irrecoverability or provider-side session revocation are NOT allowed without independent evidence.
