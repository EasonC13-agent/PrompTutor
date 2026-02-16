# PrompTutor

An open-source browser extension for **data collection** and **real-time intervention** in student-chatbot interactions. PrompTutor combines privacy-preserving conversation logging with scaffolding that detects answer-seeking behavior and nudges students toward help-seeking queries.

## Features

### 1. Privacy-Preserving Data Collection
- Captures student-AI conversations from **ChatGPT** and **Claude** via DOM parsing
- Client-side **SHA-256 email hashing** for anonymous identification
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
│  POST /api/chats         - Upload anonymized chat logs   │
│  POST /api/detect        - Answer-seeking classification │
│  POST /api/guidance-log  - Log guidance interactions     │
│  GET  /api/my-chats      - View own data                 │
│  DELETE /api/my-chats    - Delete own data (GDPR)        │
│  GET  /api/admin/*       - Admin dashboard endpoints     │
└────────────────────────────┬─────────────────────────────┘
                             │
                             ▼
                    PostgreSQL Database
```

## Project Structure

```
PrompTutor/
├── manifest.json               # Chrome Extension manifest (V3)
├── src/
│   ├── background/index.js     # Service worker (sync, alarms)
│   ├── content/
│   │   ├── dom-parser.js       # Conversation capture via MutationObserver
│   │   ├── bridge.js           # Isolated world communication
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
- Node.js 18+
- PostgreSQL 14+
- Google Cloud project (for OAuth)

### Backend Setup

```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your configuration
npm run db:init
npm start
```

### Environment Variables

```env
PORT=3456
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@localhost:5432/promptutor
GOOGLE_CLIENT_ID=your-google-oauth-client-id
ADMIN_EMAILS=admin@example.com
ANTHROPIC_API_KEY=your-key-for-detection
```

### Load Extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the project root folder

### Usage

1. Sign in via the extension popup (Google account)
2. Accept terms of service
3. Select mode:
   - **Data Collection Only** — passively collects conversation data
   - **Data Collection + Prompt Guidance** — also provides scaffolding intervention
4. Toggle data sharing on/off per conversation
5. Browse ChatGPT or Claude as usual

## Supported Platforms

| Platform | Data Collection | Prompt Guidance | Status |
|----------|----------------|-----------------|--------|
| ChatGPT  | ✅              | ✅               | Active |
| Claude   | ✅              | ✅               | Active |
| Gemini   | —              | —               | Planned |
| Copilot  | —              | —               | Planned |

## Privacy & Ethics

- **Client-side anonymization**: Email addresses are SHA-256 hashed before leaving the browser
- **Granular consent**: Students control data sharing at the conversation level
- **Full transparency**: Students can view all collected data and delete it at any time
- **Data minimization**: Only conversation content and timestamps are collected; no browser metadata
- **DELICATE-compliant**: Follows the DELICATE ethical framework for learning analytics

## Research

PrompTutor was designed as a research tool for studying student-AI interactions in educational settings. If you use PrompTutor in your research, please cite:

```
PrompTutor: A Browser Extension for Data Collection and Real-Time
Intervention in Student-Chatbot Interactions.
L@S 2026 Work-in-Progress.
```

## License

MIT
