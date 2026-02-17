// test/test-interceptor.js
// Run with: node test/test-interceptor.js

const assert = require('assert');
let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`✅ ${name}`); }
  catch(e) { failed++; console.log(`❌ ${name}: ${e.message}`); }
}

// ---- Extract INCLUDE/EXCLUDE arrays and detectPlatform from interceptor.js ----

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../src/content/interceptor.js'), 'utf8');

// Parse all *_INCLUDE and *_EXCLUDE arrays
function extractArray(name) {
  const re = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`);
  const m = src.match(re);
  if (!m) return [];
  return m[1].match(/'([^']+)'/g)?.map(s => s.replace(/'/g, '')) || [];
}

const patterns = {
  chatgpt: { include: extractArray('CHATGPT_INCLUDE'), exclude: extractArray('CHATGPT_EXCLUDE') },
  claude: { include: extractArray('CLAUDE_INCLUDE'), exclude: extractArray('CLAUDE_EXCLUDE') },
  grok: { include: extractArray('GROK_INCLUDE'), exclude: extractArray('GROK_EXCLUDE') },
  copilot: { include: extractArray('COPILOT_INCLUDE'), exclude: extractArray('COPILOT_EXCLUDE') },
  deepseek: { include: extractArray('DEEPSEEK_INCLUDE'), exclude: extractArray('DEEPSEEK_EXCLUDE') },
  doubao: { include: extractArray('DOUBAO_INCLUDE'), exclude: extractArray('DOUBAO_EXCLUDE') },
  gemini: { include: extractArray('GEMINI_INCLUDE'), exclude: extractArray('GEMINI_EXCLUDE') },
  perplexity: { include: extractArray('PERPLEXITY_INCLUDE'), exclude: extractArray('PERPLEXITY_EXCLUDE') },
  poe: { include: extractArray('POE_INCLUDE'), exclude: extractArray('POE_EXCLUDE') },
  huggingchat: { include: extractArray('HUGGINGCHAT_INCLUDE'), exclude: extractArray('HUGGINGCHAT_EXCLUDE') },
};

// detectPlatform from interceptor
function detectPlatform(url) {
  if (url.includes('openai.com') || url.includes('chatgpt.com')) return 'chatgpt';
  if (url.includes('claude.ai')) return 'claude';
  if (url.includes('grok.com') || url.includes('x.com/i/grok')) return 'grok';
  if (url.includes('copilot.microsoft.com') || url.includes('bing.com/chat') || url.includes('bing.com/turing')) return 'copilot';
  if (url.includes('chat.deepseek.com')) return 'deepseek';
  if (url.includes('doubao.com')) return 'doubao';
  if (url.includes('gemini.google.com')) return 'gemini';
  if (url.includes('perplexity.ai')) return 'perplexity';
  if (url.includes('poe.com')) return 'poe';
  if (url.includes('huggingface.co/chat')) return 'huggingchat';
  return 'unknown';
}

function isRelevant(url, platform) {
  const p = patterns[platform];
  if (!p) return false;
  return p.include.some(pat => url.includes(pat)) && !p.exclude.some(pat => url.includes(pat));
}

// ---- Test 1: All platforms have INCLUDE/EXCLUDE arrays ----

const allPlatforms = Object.keys(patterns);

for (const platform of allPlatforms) {
  test(`${platform} has INCLUDE patterns`, () => {
    assert.ok(patterns[platform].include.length > 0, `No INCLUDE patterns for ${platform}`);
  });
  test(`${platform} has EXCLUDE patterns`, () => {
    assert.ok(patterns[platform].exclude.length > 0, `No EXCLUDE patterns for ${platform}`);
  });
}

// ---- Test 2: URL pattern matching ----

const urlTests = [
  // [url, platform, shouldMatch]
  ['https://chatgpt.com/backend-api/conversation/abc123', 'chatgpt', true],
  ['https://chatgpt.com/backend-api/sentinel/check', 'chatgpt', false],
  ['https://chatgpt.com/backend-api/conversations', 'chatgpt', false],
  ['https://claude.ai/api/chat_conversations/123', 'claude', true],
  ['https://claude.ai/api/organizations/org1', 'claude', false],
  ['https://grok.com/api/rpc', 'grok', true],
  ['https://grok.com/settings', 'grok', false],
  ['https://copilot.microsoft.com/turing/conversation/msg', 'copilot', true],
  ['https://copilot.microsoft.com/turing/conversation/create', 'copilot', false],
  ['https://chat.deepseek.com/api/v0/chat/completion', 'deepseek', true],
  ['https://chat.deepseek.com/api/v0/chat/list', 'deepseek', false],
  ['https://www.doubao.com/api/chat/send', 'doubao', true],
  ['https://www.doubao.com/api/chat/list', 'doubao', false],
  ['https://gemini.google.com/_/BardChatUi/data', 'gemini', true],
  ['https://gemini.google.com/settings', 'gemini', false],
  ['https://www.perplexity.ai/api/query', 'perplexity', true],
  ['https://www.perplexity.ai/api/auth/session', 'perplexity', false],
  ['https://poe.com/api/gql_POST', 'poe', true],
  ['https://poe.com/api/settings', 'poe', false],
  ['https://huggingface.co/chat/conversation/123', 'huggingchat', true],
  ['https://huggingface.co/chat/api/conversations', 'huggingchat', false],
];

for (const [url, platform, shouldMatch] of urlTests) {
  test(`URL match: ${url} => ${platform} ${shouldMatch ? 'MATCH' : 'NO MATCH'}`, () => {
    assert.strictEqual(isRelevant(url, platform), shouldMatch);
  });
}

// ---- Test 3: Platform detection from URLs ----

const detectTests = [
  ['https://chatgpt.com/backend-api/conversation/123', 'chatgpt'],
  ['https://chat.openai.com/api/something', 'chatgpt'],
  ['https://claude.ai/api/chat', 'claude'],
  ['https://grok.com/api/rpc', 'grok'],
  ['https://x.com/i/grok/api', 'grok'],
  ['https://copilot.microsoft.com/turing/conversation/msg', 'copilot'],
  ['https://www.bing.com/chat/api', 'copilot'],
  ['https://www.bing.com/turing/conversation', 'copilot'],
  ['https://chat.deepseek.com/api/v0/chat', 'deepseek'],
  ['https://www.doubao.com/api/chat', 'doubao'],
  ['https://gemini.google.com/_/BardChatUi/data', 'gemini'],
  ['https://www.perplexity.ai/api/query', 'perplexity'],
  ['https://poe.com/api/gql_POST', 'poe'],
  ['https://huggingface.co/chat/conversation/123', 'huggingchat'],
  ['https://example.com/api', 'unknown'],
];

for (const [url, expected] of detectTests) {
  test(`detectPlatform: ${url} => ${expected}`, () => {
    assert.strictEqual(detectPlatform(url), expected);
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
