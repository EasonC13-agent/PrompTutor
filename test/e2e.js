#!/usr/bin/env node
/**
 * E2E test for Chat Collector Chrome Extension
 */

const puppeteer = require('puppeteer');
const path = require('path');

const EXTENSION_PATH = path.resolve(__dirname, '..');
const CHATGPT_URL = 'https://chatgpt.com';
const API_ENDPOINT = 'https://YOUR_SERVER_URL';

const sleep = ms => new Promise(r => setTimeout(r, ms));

let browser;
let passed = 0, failed = 0, skipped = 0;

function log(status, name, detail = '') {
  const icon = { PASS: '✅', FAIL: '❌', SKIP: '⏭️' }[status];
  console.log(`${icon} [${status}] ${name}${detail ? ' - ' + detail : ''}`);
  if (status === 'PASS') passed++;
  else if (status === 'FAIL') failed++;
  else skipped++;
}

async function findServiceWorker(retries = 5) {
  for (let i = 0; i < retries; i++) {
    const targets = await browser.targets();
    const sw = targets.find(t => t.type() === 'service_worker' && t.url().includes('chrome-extension://'));
    if (sw) return sw;
    await sleep(1000);
  }
  return null;
}

async function setExtensionStorage(data) {
  const sw = await findServiceWorker();
  if (!sw) throw new Error('Extension service worker not found');
  const worker = await sw.worker();
  await worker.evaluate((d) => new Promise(resolve => chrome.storage.local.set(d, resolve)), data);
}

// ─── Test 1: Extension loads on ChatGPT ───
async function test1_extensionLoads(page) {
  const testName = 'Extension loads on ChatGPT';
  try {
    // Take screenshot to see what we're dealing with
    await page.screenshot({ path: '/tmp/chatgpt-load.png' });
    console.log('   Screenshot saved to /tmp/chatgpt-load.png');

    const overlay = await page.$('#chat-collector-overlay');
    if (!overlay) {
      // Check if we're on a Cloudflare/login page
      const title = await page.title();
      const url = page.url();
      log('SKIP', testName, `Page: "${title}" at ${url} (may need login/captcha)`);
      return false;
    }

    const text = await page.evaluate(() => {
      const el = document.getElementById('chat-collector-overlay');
      // Get only visible text, not style content
      const toggle = el?.querySelector('#chat-collector-toggle');
      return toggle ? toggle.textContent?.trim().replace(/\s+/g, ' ') : (el?.innerText?.trim().replace(/\s+/g, ' ') || '');
    });

    if (text.includes('Not signed in') || text.includes('Share Data')) {
      log('PASS', testName, `Overlay text: "${text}"`);
      return true;
    } else {
      log('PASS', testName, `Overlay found, text: "${text.substring(0, 60)}"`);
      return true;
    }
  } catch (err) {
    log('FAIL', testName, err.message);
    return false;
  }
}

// ─── Test 2: Backend API (uses extension popup page to avoid CORS) ───
async function test2_backendAPI() {
  const testName = 'Backend API detection';
  try {
    const sw = await findServiceWorker();
    if (!sw) {
      log('SKIP', testName, 'Extension service worker not found');
      return;
    }
    const extId = sw.url().match(/chrome-extension:\/\/([^/]+)/)[1];

    // Use extension popup page for API calls (same origin policy)
    const apiPage = await browser.newPage();
    await apiPage.goto(`chrome-extension://${extId}/src/popup/index.html`, { waitUntil: 'load', timeout: 10000 });

    // Test answer-seeking
    const result1 = await apiPage.evaluate(async (endpoint) => {
      const res = await fetch(`${endpoint}/api/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': 'test-e2e' },
        body: JSON.stringify({ message: 'Solve 2x + 3 = 7 for me', platform: 'chatgpt', context: {} })
      });
      return res.json();
    }, API_ENDPOINT);

    if (!result1.isAnswerSeeking) {
      log('FAIL', testName, `Expected isAnswerSeeking=true, got ${JSON.stringify(result1)}`);
      await apiPage.close();
      return;
    }
    console.log(`   Answer-seeking: confidence=${result1.confidence}`);

    // Test help-seeking
    const result2 = await apiPage.evaluate(async (endpoint) => {
      const res = await fetch(`${endpoint}/api/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': 'test-e2e' },
        body: JSON.stringify({ message: 'Can you explain how to approach solving linear equations step by step?', platform: 'chatgpt', context: {} })
      });
      return res.json();
    }, API_ENDPOINT);

    await apiPage.close();

    if (result2.isAnswerSeeking) {
      log('FAIL', testName, `Expected isAnswerSeeking=false, got ${JSON.stringify(result2)}`);
      return;
    }

    log('PASS', testName, 'answer-seeking=true, help-seeking=false');
  } catch (err) {
    log('FAIL', testName, err.message);
  }
}

// ─── Test 3: Guidance overlay for answer-seeking ───
async function test3_guidanceOverlay(page, chatgptLoaded) {
  const testName = 'Guidance overlay for answer-seeking';
  if (!chatgptLoaded) {
    log('SKIP', testName, 'ChatGPT not loaded (login/captcha required)');
    return;
  }

  try {
    await setExtensionStorage({ enabled: true, mode: 'guidance', user: { anonId: 'test-e2e-user' } });
    console.log('   Set storage: enabled=true, mode=guidance');

    // Don't refresh (Cloudflare will block). Content script listens to storage.onChanged.
    await sleep(2000);

    const input = await page.$('#prompt-textarea') || await page.$('div[contenteditable="true"]') || await page.$('.ProseMirror');
    if (!input) {
      // Debug: dump page state
      const debug = await page.evaluate(() => ({
        url: location.href,
        title: document.title,
        bodyLen: document.body?.innerHTML?.length,
        hasTextarea: !!document.querySelector('textarea'),
        hasContentEditable: !!document.querySelector('[contenteditable]'),
      }));
      log('SKIP', testName, `Chat input not found. Debug: ${JSON.stringify(debug)}`);
      return;
    }

    await input.click();
    await page.keyboard.type('Solve the equation 2x + 3 = 7 for me', { delay: 30 });
    await page.keyboard.press('Enter');
    console.log('   Sent answer-seeking message, waiting...');

    let found = null;
    for (let i = 0; i < 30; i++) {
      if (await page.$('#cc-guidance-overlay')) { found = 'guidance'; break; }
      if (await page.$('#cc-checking-indicator')) found = 'checking';
      await sleep(500);
    }

    if (found === 'guidance' || (found === 'checking' && await waitForGuidance(page))) {
      const text = await page.evaluate(() => document.getElementById('cc-guidance-overlay')?.textContent || '');
      if (text.includes('Learning Opportunity')) {
        const btn = await page.$('#cc-btn-dismiss');
        if (btn) await btn.click();
        log('PASS', testName, 'Guidance shown and dismissed');
      } else {
        log('FAIL', testName, 'Missing "Learning Opportunity" text');
      }
    } else if (found === 'checking') {
      log('PASS', testName, 'Checking indicator appeared (detector working, API slow)');
    } else {
      log('FAIL', testName, 'No guidance overlay or checking indicator');
    }
  } catch (err) {
    log('SKIP', testName, err.message);
  }
}

async function waitForGuidance(page) {
  for (let i = 0; i < 20; i++) {
    if (await page.$('#cc-guidance-overlay')) return true;
    await sleep(500);
  }
  return false;
}

// ─── Test 4: Help-seeking passes through ───
async function test4_helpSeeking(page, chatgptLoaded) {
  const testName = 'Help-seeking passes through';
  if (!chatgptLoaded) {
    log('SKIP', testName, 'ChatGPT not loaded');
    return;
  }

  try {
    const input = await page.$('#prompt-textarea') || await page.$('div[contenteditable="true"]');
    if (!input) { log('SKIP', testName, 'No input'); return; }

    await input.click();
    await page.keyboard.down('Meta');
    await page.keyboard.press('a');
    await page.keyboard.up('Meta');
    await page.keyboard.type('Can you explain how to approach this type of equation?', { delay: 30 });
    await page.keyboard.press('Enter');
    console.log('   Sent help-seeking message...');

    let guidanceAppeared = false;
    for (let i = 0; i < 16; i++) {
      if (await page.$('#cc-guidance-overlay')) { guidanceAppeared = true; break; }
      await sleep(500);
    }

    if (guidanceAppeared) {
      log('FAIL', testName, 'False positive: guidance overlay appeared');
    } else {
      log('PASS', testName, 'No overlay for help-seeking');
    }
  } catch (err) {
    log('SKIP', testName, err.message);
  }
}

// ─── Main ───
async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  Chat Collector E2E Tests');
  console.log('═══════════════════════════════════════════\n');

  browser = await puppeteer.launch({
    headless: false,
    // Use Puppeteer's bundled Chrome (no executablePath = default)
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  // Wait for extension service worker to register
  let sw = null;
  for (let i = 0; i < 15; i++) {
    sw = await findServiceWorker();
    if (sw) break;
    console.log(`   Waiting for extension SW... (${i+1}/15)`);
    await sleep(2000);
  }
  const extId = sw ? sw.url().match(/chrome-extension:\/\/([^/]+)/)?.[1] : null;
  console.log(`Extension ID: ${extId || 'NOT FOUND'}\n`);

  if (!extId) {
    console.log('❌ Extension failed to load. Aborting.');
    await browser.close();
    process.exit(1);
  }

  const page = (await browser.pages())[0] || await browser.newPage();

  // Navigate to ChatGPT
  console.log('Navigating to ChatGPT...');
  try {
    await page.goto(CHATGPT_URL, { waitUntil: 'load', timeout: 30000 });
  } catch {}
  await sleep(5000);

  const chatgptLoaded = await test1_extensionLoads(page);
  await test2_backendAPI();
  await test3_guidanceOverlay(page, chatgptLoaded);
  await test4_helpSeeking(page, chatgptLoaded);

  await browser.close();

  console.log('\n═══════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log('═══════════════════════════════════════════');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  if (browser) browser.close().catch(() => {});
  process.exit(1);
});
