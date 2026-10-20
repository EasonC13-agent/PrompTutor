# PrompTutor 0.1.3 real anonymous ChatGPT acceptance

## Artifact and source

- Runtime commit `ab7f897630b8762373f221222c7c53c516005bc3`, retaining prior backend/dashboard fixes.
- ZIP SHA-256 `dea7cce71194621d2fef7631dba9ea98da5472325618fb90a8aecc27584411cc`.
- Version 0.1.3, fixed developer extension ID `linjhjneagnaggeeljkgdjdlbldpdhhk`.
- All 26 runtime files fetched from the actual installed extension matched this ZIP, source and dist. No fabricated provider API responses or DOM fixtures were used in this live capture run.

## Demonstrated live ChatGPT pipeline

A real logged-out ChatGPT conversation navigated to `/uc/6ad7755c-d614-83ea-a591-64e92965e27d`. The installed extension admitted that exact canonical conversation, enabled the Share this chat checkbox, and the checkbox was explicitly selected. Homepage `/` is not granted a shared conversation identity.

The actual composer submitted the same harmless test prompt twice. Each real assistant reply was `Test acknowledged.` The early follow-up receipt retained the streaming control with only the first completed pair cached; the final receipt had two completed pairs with distinct pair hashes. No fake `/c/` URL, seeded consent or fixture answer was used.

The actual popup Sync Now control displayed `Synced 2 logs!`; the application received HTTP 200 at `/api/message-logs/batch`. An independent read-only SQLite query verified exactly two matching prompt/reply/URL/hash rows. The installed researcher dashboard showed two messages and one contributor; the personal dashboard showed one conversation with two messages and expanded matching text. Both manual and 15-second periodic refresh succeeded.

**Identity/backend boundary:** the extension retained the real Google identity established earlier, without exporting token values. This isolated application harness explicitly injected a test-local Google verifier. Express, Knex and file-backed SQLite were real and unmodified candidate code; provider responses, upload responses, SQL and dashboard reads were not mocked. This demonstrates live ChatGPT capture through isolated application persistence, not a production content upload.

## Independent review and automated checks

The narrow `/uc/` and actual list-turn DOM fix passed independent source review. Parent reran 117 node tests plus 56 legacy selector checks; the 19 focused review tests overlap that total. Do not add these counts. Synthetic streaming variants in unit fixtures do not establish every real streaming implementation.

## Other requested platforms

- Claude: actual first-party site rendered `/login` with Google/Apple/email/SSO controls and no usable composer after required assets were admitted. No Claude conversation capture has passed live acceptance.
- Gemini: existing Google cookies restored the owner's signed-in session without manual login. A fresh harmless real prompt/reply at `/app/6db58449a78dd046` established actual `user-query`/`model-response` DOM. Version 0.1.3 rejects its canonical identity and disables consent. A source implementation is in separate CloudCLI review; it is not this sealed artifact or a live Gemini capture PASS. Real markup includes a hidden duplicated/truncated accessibility label inside `.query-text`; extraction must exclude it.
- Grok: first-party page remained at Cloudflare security verification after exact required security assets were admitted. No usable composer, conversation route or turn DOM was observed. This is not evidence of a login requirement or successful collection. Reconstructed Grok adapter fixtures remain provisional.

## Cleanup and production boundary

Production collector traffic was denied before capture; the configured API endpoint was loopback. Master OFF serialized a real local DELETE that removed both QA rows, and final local SQLite count was zero. Final extension state: collection OFF, no capture cache, queue, consents or deletion receipts; original API configuration and real identity restored. Local backend/tunnel stopped and loopback listener closure verified.

Only the previously approved production administrator-configuration repair has been made. This PR's backend code is not deployed, Store distribution is unchanged, and the live test did not upload or delete production conversations. See acceptance-0.1.2.md for that configuration repair and prior failures. Do not conflate successful anonymous ChatGPT local-pipeline acceptance with four-platform or production-release approval.

Private evidence: task workspace `browser-qa/fixed013-live/REPORT.md`, actual installed pin comparison, independent SQLite readback, popup/HTTP/SQL/dashboard receipts and clean-up records. Retained conversation content is only the harmless test prompts/replies.
