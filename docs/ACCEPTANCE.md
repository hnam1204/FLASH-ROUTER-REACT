# Acceptance Gates — FLASH ROUTER

The scaffold itself does NOT pass these gates. Each gate requires reproducible evidence and truthful PASS/FAIL reporting.

| Gate | Evidence |
| --- | --- |
| G01 Clean clone | On clean Windows host: `npm ci`, setup, build, start without modifying source |
| G02 Single Dashboard | Responsive React UI desktop/tablet/mobile; user language Vietnamese |
| G03 Real API | Every production UI action reaches real Fastify handler/database |
| G04 Registry | 1,000 metadata records paginated/searchable without fake seeds |
| G05 Chrome profiles | One owned profile per account, process lock, no cross-account leakage |
| G06 Session | Close/reopen valid local profile, status accurate as of observed time |
| G07 MFA behavior | Human-in-loop when provider requests verification; no false success |
| G08 Realtime console | Live SSE from actual jobs; filter by account/time/error; secret redaction |
| G09 Deletion | Confirmed delete closes Chrome and removes all app-owned local profile/DB/artifacts; crash recovery tested |
| G10 Resource | CPU/RAM/disk observations, bounded queue, no unsupported claims for 20+ Chrome |
| G11 Security | No secrets in logs/git; local API security; path traversal/junction defense |
| G12 Git | `Main` only, one integrator, commit SHA after green gates |
| G13 Cleanup | Temporary test run artifacts removed after passing tests/commit; test source retained |
| G14 Owner brand | `FLASH ROUTER`, @hnam1204 Zalo link, user-provided logo after receipt |

For each gate: date, environment, test command, expected vs actual, exit code, log/artifact pointer, reviewer and unresolved limitations. Never mark unimplemented as PASS.
