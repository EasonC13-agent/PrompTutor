# PrompTutor 0.1.2 candidate acceptance

## Delivery boundary

This is a developer-mode repair candidate and an open pull request, not a deployed backend update, Store submission, or production readiness declaration. PR #2 targets `w`, whose baseline backend matches the deployed service; `main` contains an obsolete API.

- Candidate commit (runtime): `64ebea423a65221a16cc9247facfeae311720ab3`.
- ZIP SHA-256: `b42027d670bf53ec3c2cd3f24549994b9f5d80d31d279d2c3df054f39da045c4`.
- Version: `0.1.2`; 26 runtime files, 44 ZIP entries including directories.
- Every packaged file matched source and `dist` byte-for-byte, with no duplicate or extra members.
- Developer-mode identity restored from the project's historical public manifest key: `linjhjneagnaggeeljkgdjdlbldpdhhk`. A public key is not a private signing key. This developer package is not a new-item Store-upload package.

## Verified checks

### Automated and independent review

- Parent reran `npm test`: 107 tests passed, zero failed, followed by 56 legacy selector checks. Selector checks and synthetic DOM fixtures are not live-platform acceptance.
- GitHub regression CI passed on runtime commit `64ebea423a65221a16cc9247facfeae311720ab3`: run `39360031495`.
- Final independent bounded review approved the local developer candidate only. Its 106 tests exclude the build regression and overlap the parent's 107; do not add these totals together.
- Independent deferred-operation probes completed under watchdogs. Guidance writes settle before deletion, deleted guidance does not reappear, old consent epochs cannot retry or cache content, and wildcard/prefix sibling conversations remain untouched.
- Dashboard logout/account-switch/endpoint changes immediately clear content and fence stale data, JSON completions and errors. Message and guidance deletions are transactional and user-scoped.

### Actual installed browser and real local database

The exact ZIP was installed into an independent nonroot sandboxed headful Chrome runtime. Namespace/Seccomp sandbox, enforcing AppArmor, no-new-privileges, capability drops and read-only root were preserved; the shared browser was not modified.

- Actual manifest, fixed extension ID and MV3 worker were read back.
- Two QA-only DOM fixtures simulated persisted ChatGPT and Claude conversations. The installed overlays were explicitly opted in separately and the installed parser captured the prompt/response pairs.
- Actual popup **Sync Now** buttons triggered two first-attempt uploads, both HTTP 200. Popup uploaded counts advanced from 1 to 2 and pending count reached zero.
- The backend was the actual unmodified application with file-backed SQLite/Knex over real loopback HTTP, not API-response mocks. Only Google verification was injected for one test-local fake identity/token.
- SQL readback contained exactly two expected QA pairs: one ChatGPT-shaped fixture, one Claude-shaped fixture. There were 45 traced SQL queries.
- Actual researcher and personal-data pages rendered those records on initial read, manual refresh and the automatic refresh after 16 seconds. The configured refresh interval is 15 seconds.
- External traffic was denied before any QA identity/content was seeded. No production API requests were made by this final installed test. Owned processes, profiles, displays, tunnels, local database server and listeners were cleaned up and independently checked.

### Google entry point

A separate fresh-profile run installed the same exact ZIP and clicked the real Google sign-in control, with no test identity/endpoint seed. The official Google identifier page and the correct app name were observed; `redirect_uri_mismatch` no longer appeared. A parent visual inspection confirmed an empty Email or phone control.

The strict OAuth harness assertion **failed** because it looked for `input[type=email]`, while the rendered identifier field did not match that selector. The failed receipt is retained. This is positive browser/URL/visual entry evidence, not a green strict OAuth test and not completed authentication. No credentials, grant or tokens were entered/copied.

## What remains unverified

1. Real Google authentication is now verified (see the dated live check below). Explicit conversation consent and a harmless live ChatGPT/Claude conversation still need acceptance; fixture capture is not live-provider fidelity.
2. Authenticated production ingestion and visibility of newly captured production records have not been exercised. Existing production data was inspected read-only; production was not deployed or modified.
3. A backend deployment is required for the corrected aggregate counts, embedded conversation details and transactionally complete guidance deletion. The extension's refresh pages retain an existing-server fallback, but that is not a deployed backend repair.
4. Store publication, managed-browser policy acceptance, attachments, virtualized/offscreen history, and sites other than the documented persisted ChatGPT/Claude routes are outside this acceptance.
5. Live LLM-backed prompt guidance requires the configured provider key; transport/privacy tests do not prove provider inference.

## Dashboard access after installation and sign-in

- Open **Admin** in the extension popup using an account already on the backend administrator allowlist. This opens `src/admin/admin.html` inside the extension. It is not the public website homepage.
- Open **View My Data** for the signed-in user's own conversations, `src/view/view.html`.
- Both pages refresh every 15 seconds and provide **Refresh now**. Last client capture time and last successful refresh are labelled separately; neither invents a server-ingestion timestamp.

## Real Google / production read-only check — 2026-10-20

- The owner completed Google credential entry in the same isolated exact-0.1.2 installation. The expected account was re-read on the official basic profile/email consent page before continuing. The extension then persisted a real Google identity and access token; token bytes were neither printed nor exported. Collection remained OFF with zero pending messages.
- The real personal-data dashboard read the existing production service successfully: initial, manual and 15-second automatic refresh each returned HTTP 200 from `/api/my-chats`. The current account has no displayed conversation records; this does not prove that new production ingestion works.
- The researcher dashboard did **not** pass: `/api/admin/stats` and `/api/admin/chats` returned HTTP 403 for the owner-selected account on all three refresh checks. The earlier local researcher-dashboard acceptance remains valid only for the isolated candidate backend.
- Read-only deployment investigation found configuration drift: `docker exec` inherits a two-address `ADMIN_EMAILS` list, but the already-running Node application process has no `ADMIN_EMAILS` entry in its startup environment. `/app/.env`, loaded by `dotenv.config()`, contains a different two-address list excluding the owner-selected account. Reading a newly executed process's container environment is not verification of the serving process's effective administrator policy. The earlier account recommendation based only on that container environment was incomplete.
- No administrator permissions, production deployment, conversation records or Store release were changed. Do not fix this by weakening `adminOnly`, seeding an identity, or silently granting a new account access. The owner must approve the intended effective administrator list and deployment/configuration update; verify real HTTP 200 and rendered researcher statistics afterward.
- Keep the initiating extension popup alive through a manual OAuth handoff. A previous handoff closed that context before owner completion and did not yield a stored extension identity; that observation alone does not establish a Chrome lifecycle bug.

## Approved production configuration repair — 2026-10-20

The owner approved adding the already signed-in team account to the effective production administrator list and restarting only PrompTutor. The original two administrators were retained. The exact active `/app/.env` and a consistent SQLite backup were saved in an owner-only directory before an atomic configuration edit; no secrets were copied into the repository. PM2 app 0 `promptutor` was restarted through its existing supervisor; the listener's new process remained online on repeat inspection. The backend source SHA-256 remains `75b4916bc101b64fd4b7f5bd1f5a589ee4b187b035786ee53fb3763262c7fe39`: this was a configuration-only repair, not deployment of this PR.

- Real installed researcher and personal dashboards now both passed initial, manual and 15-second automatic refresh. All nine observed API responses were HTTP 200 (`/api/admin/stats`, `/api/admin/chats`, `/api/my-chats`, three refresh phases).
- The researcher dashboard displayed the existing six stored message records. The old backend still reported zero registered users although read-only SQL finds one distinct message contributor; this known aggregate-definition defect is fixed in the candidate backend but remains undeployed. DOM table-row counts include detail rows and are not message counts.
- Anonymous researcher API access remains HTTP 401. Readback confirmed all original administrators preserved and only the approved team account added.
- Production still has 6 message rows / 1 contributor / 0 guidance rows; collection stayed OFF with no pending data. No production conversation was uploaded or deleted.
- Remaining acceptance: harmless real ChatGPT/Claude persisted conversation capture, authenticated ingestion and new-record visibility; then deliberate candidate-backend deployment and separate extension distribution. Do not treat a configuration-only restart or seeded fixture as those checks.

## Retained earlier failures

Earlier 0.1.1 candidates were rejected by independent review and were not released. Their route-mocked tests did not establish persistence. One earlier QA interception missed a request and received production HTTP 401; a subsequent independent read-only database check still found the original 6 message rows / 1 contributor and 0 guidance rows. The final harness instead blocked external requests before seeding, and its acceptance must not be conflated with those failed diagnostics.

Detailed browser receipts, isolated QA databases, screenshots, confinement/cleanup proofs and private test harnesses are retained in the owner's task workspace. They contain no real study conversation exports and are not bundled into the extension.
