# Chat Collector for Research

A browser extension that allows students to optionally share their AI chatbot conversations with researchers for educational research.

## Supported Platforms

- ✅ ChatGPT (chat.openai.com, chatgpt.com)
- ✅ Claude (claude.ai)
- 🔜 Gemini
- 🔜 Perplexity

## Features

- **Opt-in consent**: Users explicitly enable data sharing
- **API interception**: Captures clean JSON data directly from API responses
- **DOM fallback**: Falls back to DOM parsing if API interception fails
- **Offline-first**: Stores data locally and syncs when backend is available
- **Privacy-focused**: No data is collected unless user enables it

## Development

### Load Extension (Chrome)

1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `chat-collector` folder

### Project Structure

```
chat-collector/
├── manifest.json           # Extension manifest (v3)
├── src/
│   ├── background/         # Service worker
│   │   └── index.js
│   ├── content/            # Content scripts
│   │   ├── inject.js       # Injector (runs in isolated world)
│   │   └── interceptor.js  # API interceptor (runs in page context)
│   ├── popup/              # Extension popup UI
│   │   ├── index.html
│   │   └── popup.js
│   └── adapters/           # Platform-specific adapters
│       ├── chatgpt/
│       └── claude/
└── icons/                  # Extension icons
```

## Data Format

Captured data is stored as JSON:

```json
{
  "id": "uuid",
  "capturedAt": "2024-01-15T12:00:00Z",
  "platform": "chatgpt",
  "url": "/backend-api/conversation",
  "data": {
    // Platform-specific response data
  }
}
```

## Backend API

The extension sends data to a configurable backend endpoint:

```
POST /api/chats
Content-Type: application/json

{
  "logs": [...]
}
```

## Privacy & Consent

- Data collection is **disabled by default**
- Users must explicitly enable sharing via the extension popup
- All data is anonymized before transmission
- Data is used solely for educational research purposes

## License

MIT
