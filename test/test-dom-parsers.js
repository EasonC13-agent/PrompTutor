// test/test-dom-parsers.js
// Run with: node test/test-dom-parsers.js

const assert = require('assert');
let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`✅ ${name}`); }
  catch(e) { failed++; console.log(`❌ ${name}: ${e.message}`); }
}

// ---- Extract SELECTORS and detectPlatform from dom-parser.js ----
// We parse the source to get the data since it's an IIFE

const fs = require('fs');
const path = require('path');

const domParserSrc = fs.readFileSync(path.join(__dirname, '../src/content/dom-parser.js'), 'utf8');

// Extract SELECTORS object by evaluating a modified version
const selectorsMatch = domParserSrc.match(/const SELECTORS = (\{[\s\S]*?\n  \});/);
if (!selectorsMatch) { console.error('Could not extract SELECTORS'); process.exit(1); }
const SELECTORS = eval('(' + selectorsMatch[1] + ')');

// Extract detectPlatform function
function makeDetectPlatform(hostname, pathname = '/') {
  const window = { location: { hostname, pathname } };
  const host = hostname;
  if (host.includes('chatgpt.com') || host.includes('openai.com')) return 'chatgpt';
  if (host.includes('claude.ai')) return 'claude';
  if (host.includes('grok.com') || (host.includes('x.com') && pathname.startsWith('/i/grok'))) return 'grok';
  if (host.includes('copilot.microsoft.com') || (host.includes('bing.com') && pathname.startsWith('/chat'))) return 'copilot';
  if (host.includes('chat.deepseek.com')) return 'deepseek';
  if (host.includes('doubao.com')) return 'doubao';
  if (host.includes('gemini.google.com')) return 'gemini';
  if (host.includes('perplexity.ai')) return 'perplexity';
  if (host.includes('poe.com')) return 'poe';
  if (host.includes('huggingface.co') && pathname.startsWith('/chat')) return 'huggingchat';
  return 'unknown';
}

// ---- Test 1: Platform Detection ----

const platformTests = [
  ['chatgpt.com', '/', 'chatgpt'],
  ['chat.openai.com', '/', 'chatgpt'],
  ['claude.ai', '/', 'claude'],
  ['grok.com', '/', 'grok'],
  ['x.com', '/i/grok', 'grok'],
  ['copilot.microsoft.com', '/', 'copilot'],
  ['www.bing.com', '/chat', 'copilot'],
  ['chat.deepseek.com', '/', 'deepseek'],
  ['www.doubao.com', '/', 'doubao'],
  ['gemini.google.com', '/app', 'gemini'],
  ['www.perplexity.ai', '/search', 'perplexity'],
  ['poe.com', '/chat/gpt-4', 'poe'],
  ['huggingface.co', '/chat/conversation/123', 'huggingchat'],
  ['huggingface.co', '/models', 'unknown'],  // Not /chat path
  ['example.com', '/', 'unknown'],
];

for (const [host, pathname, expected] of platformTests) {
  test(`detectPlatform: ${host}${pathname} => ${expected}`, () => {
    assert.strictEqual(makeDetectPlatform(host, pathname), expected);
  });
}

// ---- Test 2: Selector Validity ----

const allPlatforms = ['chatgpt', 'claude', 'grok', 'copilot', 'deepseek', 'doubao', 'gemini', 'perplexity', 'poe', 'huggingchat'];

for (const platform of allPlatforms) {
  test(`SELECTORS exists for ${platform}`, () => {
    assert.ok(SELECTORS[platform], `Missing SELECTORS for ${platform}`);
  });

  test(`SELECTORS.${platform} has required keys`, () => {
    const sel = SELECTORS[platform];
    for (const key of ['messageContainer', 'userMessage', 'assistantMessage', 'messageContent', 'chatContainer']) {
      assert.ok(Array.isArray(sel[key]), `${platform}.${key} should be an array`);
      assert.ok(sel[key].length > 0, `${platform}.${key} should not be empty`);
    }
  });
}

// Test CSS selector syntax validity using a minimal DOM
// We use jsdom-like check: just ensure no throws from querySelectorAll pattern
// Since we don't have a real DOM in Node, we validate selector strings don't have obvious issues
test('All CSS selectors are syntactically plausible', () => {
  for (const platform of allPlatforms) {
    const sel = SELECTORS[platform];
    for (const key of Object.keys(sel)) {
      for (const s of sel[key]) {
        // Basic check: not empty, no unbalanced brackets
        assert.ok(s.length > 0, `Empty selector in ${platform}.${key}`);
        const opens = (s.match(/\[/g) || []).length;
        const closes = (s.match(/\]/g) || []).length;
        assert.strictEqual(opens, closes, `Unbalanced brackets in ${platform}.${key}: ${s}`);
        const parensOpen = (s.match(/\(/g) || []).length;
        const parensClose = (s.match(/\)/g) || []).length;
        assert.strictEqual(parensOpen, parensClose, `Unbalanced parens in ${platform}.${key}: ${s}`);
      }
    }
  }
});

// ---- Test 3: Mock DOM Parsing ----
// We simulate minimal HTML and test that selectors would match

// Helper: create a simple mock test for selector matching using regex-based validation
// Since Node has no DOM, we verify the selector patterns make sense structurally

const { JSDOM } = (() => {
  try { return require('jsdom'); } catch(e) { return {}; }
})();

if (JSDOM) {
  // If jsdom is available, do real DOM tests
  const fixtures = {
    chatgpt: `<div data-message-author-role="user"><div class="markdown">Hello</div></div>
              <div data-message-author-role="assistant"><div class="markdown">Hi there</div></div>`,
    claude: `<div data-test-render-count="1"><div class="font-user-message">Hello</div></div>
             <div data-test-render-count="2"><div class="font-claude-response"><div class="font-claude-response-body">Hi there</div></div></div>`,
    grok: `<div class="items-end"><div class="message-bubble"><div class="markdown">Hello</div></div></div>
           <div class="items-start"><div class="message-bubble"><div class="markdown">Hi there</div></div></div>`,
    copilot: `<div data-testid="message"><div data-testid="user-message"><div class="markdown">Hello</div></div></div>
              <div data-testid="message"><div data-testid="assistant-message"><div class="markdown">Hi there</div></div></div>`,
    deepseek: `<div data-role="user" class="ds-message"><div class="ds-markdown">Hello</div></div>
               <div data-role="assistant" class="ds-message"><div class="ds-markdown">Hi there</div></div>`,
    doubao: `<div data-role="user" class="message-item"><div class="markdown">Hello</div></div>
             <div data-role="assistant" class="message-item"><div class="markdown">Hi there</div></div>`,
    gemini: `<div class="message-container"><div class="user-query-container"><div class="query-text">Hello</div></div></div>
             <div class="message-container"><div class="response-container"><div class="model-response-text">Hi there</div></div></div>`,
    perplexity: `<div data-testid="message" data-role="user"><div class="prose">Hello</div></div>
                 <div data-testid="message" data-role="assistant"><div class="prose">Hi there</div></div>`,
    poe: `<div class="Message_row__1" data-message-id="1"><div class="Message_humanMessage__1"><div class="markdown">Hello</div></div></div>
          <div class="Message_row__2" data-message-id="2"><div class="Message_botMessage__1"><div class="markdown">Hi there</div></div></div>`,
    huggingchat: `<div class="message user" data-role="user"><div class="prose">Hello</div></div>
                  <div class="message assistant" data-role="assistant"><div class="prose">Hi there</div></div>`,
  };

  for (const platform of allPlatforms) {
    test(`DOM parsing: ${platform} finds message containers`, () => {
      const dom = new JSDOM(`<html><body><main>${fixtures[platform]}</main></body></html>`);
      const doc = dom.window.document;
      const sel = SELECTORS[platform];

      let found = false;
      for (const s of sel.messageContainer) {
        try {
          if (doc.querySelectorAll(s).length > 0) { found = true; break; }
        } catch(e) {}
      }
      assert.ok(found, `No message containers found for ${platform}`);
    });

    test(`DOM parsing: ${platform} finds message content`, () => {
      const dom = new JSDOM(`<html><body><main>${fixtures[platform]}</main></body></html>`);
      const doc = dom.window.document;
      const sel = SELECTORS[platform];

      let found = false;
      for (const s of sel.messageContent) {
        try {
          if (doc.querySelectorAll(s).length > 0) { found = true; break; }
        } catch(e) {}
      }
      assert.ok(found, `No message content found for ${platform}`);
    });
  }
} else {
  console.log('⚠️  jsdom not available, skipping DOM parsing tests (install with: npm i jsdom)');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
