# PrompTutor

An open-source browser extension for **data collection** and **real-time intervention** in student-chatbot interactions. PrompTutor combines privacy-preserving conversation logging with scaffolding that detects answer-seeking behavior and nudges students toward help-seeking queries.

## Features

### 1. Privacy-Preserving Data Collection
- Captures student-AI conversations from **ChatGPT** and **Claude** via DOM parsing
- Google bearer-token authentication; the backend derives a stable SHA-256 email identifier. This is pseudonymization, not anonymity.
- **Per-conversation consent toggle** — students choose what to share
- Full data transparency: students can view and delete their data at any time

### 2. Real-Time Prompt Guidance
- Detects **answer-seeking behavior** (e.g., "solve this for me") using LLM-based classification
- Displays a **scaffolding overlay** suggesting rephrased, help-seeking queries
- Three response options: **Use Suggestion**, **Edit My Prompt**, or **Send Anyway**
- All guidance interactions are logged for research analysis

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   Chrome Extension (Manifest V3)          │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ Content       │  │ Background   │  │ Popup UI       │  │
│  │ Scripts       │  │ Worker       │  │ (Auth/Settings/ │  │
│  │ (DOM Parser,  │  │ (Sync,       │  │  Consent)      │  │
│  │  Detector,    │  │  Alarms)     │  │                │  │
│  │  Guidance UI) │  │              │  │                │  │
│  └──────────────┘  └──────────────┘  └────────────────┘  │
└────────────────────────────┬─────────────────────────────┘
                             │ HTTPS + Google Auth
                             ▼
┌──────────────────────────────────────────────────────────┐
│                   Backend API (Node.js + Express)         │
│  POST /api/message-logs/batch - Upload consented pairs   │
│  POST /api/detect        - Answer-seeking classification │
│  POST /api/guidance-log  - Log guidance interactions     │
│  GET  /api/my-chats      - View own data                 │
│  DELETE /api/my-chats    - Delete own data (GDPR)        │
│  GET  /api/admin/*       - Admin dashboard endpoints     │
└────────────────────────────┬─────────────────────────────┘
                             │
                             ▼
                  SQLite or PostgreSQL
```

## Project Structure

```
PrompTutor/
├── manifest.json               # Chrome Extension manifest (V3)
├── src/
│   ├── background/index.js     # Service worker (sync, alarms)
│   ├── content/
│   │   ├── dom-parser.js       # Conversation capture via MutationObserver
│   │   ├── overlay.js          # Floating status indicator + toggle
│   │   ├── detector.js         # Answer-seeking detection (click-to-analyze)
│   │   └── guidance.js         # Scaffolding intervention overlay UI
│   ├── popup/
│   │   ├── index.html          # Extension popup
│   │   └── popup.js            # Auth, consent, mode selection
│   └── adapters/
│       ├── chatgpt/index.js    # ChatGPT DOM adapter
│       └── claude/index.js     # Claude DOM adapter
├── backend/
│   ├── index.js                # Express server
│   └── scripts/init-db.js     # Database schema
├── icons/                      # Extension icons
└── README.md
```

## Getting Started

### Prerequisites
- Node.js 22+ (tests and the current native SQLite dependency)
- SQLite by default, or PostgreSQL with `DB_CLIENT=pg`
- Google Cloud project (for OAuth)

### Backend Setup

```bash
cd backend
npm install
# Create backend/.env with the configuration below
npm run db:init
npm start
```

### Environment Variables

```env
PORT=13001
NODE_ENV=production
# Default: SQLite. PostgreSQL requires BOTH DB_CLIENT=pg and DATABASE_URL.
# DB_CLIENT=pg
# DATABASE_URL=postgresql://user:password@localhost:5432/promptutor
GOOGLE_CLIENT_ID=your-google-oauth-client-id
ADMIN_EMAILS=admin@example.com
OPENAI_API_KEY=your-key-for-detection
```

### Load Extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Run `npm ci` and `npm run build`, then select the generated **dist/** directory.
5. Developer-mode IDs depend on the unpacked directory unless a key is configured. The OAuth client must authorize the exact `https://<extension-id>.chromiumapp.org/` redirect URI. An unpacked install is not proof that Google login or a Store rollout works.

### Usage

1. Sign in via the extension popup (Google account)
2. Accept terms of service
3. Select mode:
   - **Data Collection Only** — passively collects conversation data
   - **Data Collection + Prompt Guidance** — also provides scaffolding intervention
4. Toggle data sharing on/off per conversation
5. Browse ChatGPT or Claude as usual

### Private dashboards and refresh

This backend follows the deployed `w` branch (`message_logs` and Google bearer-token authentication), **not the older `main` branch's `chat_logs` / `X-User-Id` API**. Do not deploy the old `main` backend over the current service.

- Open **My Chat Data** or **Admin** from the signed-in extension. These are extension-hosted pages (`src/view/view.html`, `src/admin/admin.html`), not public research-data pages. The public backend homepage remains a landing page.
- Both pages refresh every **15 seconds**, with a **Refresh now** button, request timeouts, and visible refresh/error status. Temporary failures retain the last successful data with a stale-data warning; authentication/authorization failures clear private content and require signing in again.
- The researcher dashboard refreshes global message/user totals and the selected 50-row page, retains the platform filter, and moves back to a valid page after deletions. “Total Users” counts distinct contributors in `message_logs`, not consent registrations.
- “Latest capture (client time)” is the newest stored `captured_at`; “Updated” is the last successful dashboard read. The existing schema does **not** record server ingestion time, so neither label claims a server receipt timestamp.
- My Chat Data counts **conversations**, loads 20 at a time, updates already-open messages, and preserves expanded conversations across refreshes. The updated backend can return user-scoped messages with `GET /api/my-chats?includeData=1`, including conversations without a `chat_id`. With an older server, existing chat-ID-based detail loading remains available.
- Private endpoints still require a verified Google access token for the configured OAuth client; researcher endpoints additionally require an `ADMIN_EMAILS` allowlist match. IDs or URL parameters never grant access. No unauthenticated dashboard/data endpoint was added.

Local regression tests (no production requests or records):

```bash
npm ci --prefix backend
npm test --prefix backend
```

The backend tests use a real in-memory SQLite database and local HTTP server; only Google token verification is replaced by a test-local injected client. UI tests execute the actual extension page scripts in jsdom with controlled fetch/storage/timers. No production authentication bypass or database migration is needed for these changes.

## Supported Platforms and acceptance limits

The 0.1.1 candidate admits capture only on persisted ChatGPT `/c/...` and `/g/.../c/...` conversations, and Claude `/chat/...` conversations. Sign in, enable the master switch, then explicitly turn sharing on in each conversation. Existing installations must opt in to each conversation again; legacy queues without a provable account and consent are discarded rather than uploaded.

Other legacy site selectors remain in the source, but **cannot acquire collection consent in this candidate**. They are not supported collection paths. Attachments, virtualized/offscreen history, and full fidelity across all third-party UI changes are not verified. During SPA navigation, retained old message nodes block capture rather than risk attributing the previous conversation to a new URL.

`npm test` covers synthetic DOM/storage/network fixtures plus local HTTP and SQLite tests. Real unpacked installation and unsigned public-page injection are separate checks; neither proves authenticated Google login, live conversational capture, or production ingestion. Follow the PR acceptance report for the exact installed artifact and outstanding live checks. No Store upload or production deployment is implied by this candidate.

## Privacy & Ethics

- **Pseudonymous identifiers**: The backend verifies a Google access token and hashes the verified email for the stored user ID. Google authentication and administrator authorization still process account identity.
- **Granular consent**: Students control data sharing at the conversation level
- **Full transparency**: Students can view all collected data and delete it at any time
- **Data collected**: Consented conversation text, assistant responses, platform, conversation URL/ID, message hash and capture timestamps. Conversation URLs and content can themselves contain identifying information.
- **Research readiness**: Installation and software tests do not establish study consent, IRB approval, anonymization, or comprehensive platform support.

## Research

PrompTutor was designed as a research tool for studying student-AI interactions in educational settings. If you use PrompTutor in your research, please cite:

```
PrompTutor: A Browser Extension for Data Collection and Real-Time
Intervention in Student-Chatbot Interactions.
L@S 2026 Work-in-Progress.
```

## License

MIT
