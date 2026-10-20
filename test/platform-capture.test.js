// RECONSTRUCTED fixtures, NOT live captures. Gemini (<user-query>/<model-response> custom elements,
// .query-text, message-content .markdown) and Grok (.message-bubble under items-end/items-start,
// .response-content-markdown) anchors come from the repository's pre-existing selector tables and
// first-party UI conventions. No retained live DOM evidence exists for either platform yet.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./dom-fixture.js');
const OWNER = 'fixture@example.invalid';
const geminiUrl = 'https://gemini.google.com/app/a1b2c3d4e5f60718';
const grokUrl = 'https://grok.com/c/3f2b8c1e-5d4a-4e7b-9c10-2a6d8e9f0b1c';
const gUser = t => `<user-query><div class="query-text"><p class="query-text-line">${t}</p></div></user-query>`;
const gModel = t => `<model-response><div class="response-container"><button>Copy</button><message-content class="model-response-text"><div class="markdown"><p>${t}</p></div></message-content></div></model-response>`;
const gTurn = (q, a) => `<div class="conversation-container">${gUser(q)}${a === undefined ? '' : gModel(a)}</div>`;
const xUser = t => `<div class="flex flex-col items-end"><div class="message-bubble"><p>${t}</p></div></div>`;
const xModel = t => `<div class="flex flex-col items-start"><div class="message-bubble"><div class="response-content-markdown"><p>${t}</p></div><button>Copy</button></div></div>`;
const xTurn = (q, a) => xUser(q) + (a === undefined ? '' : xModel(a));
const platforms = [
  { name: 'gemini', url: geminiUrl, next: 'https://gemini.google.com/app/ffeeddccbbaa0011', turn: gTurn, host: 'gemini.google.com', add: 'main' },
  { name: 'grok', url: grokUrl, next: 'https://grok.com/c/00000000-1111-4222-8333-444444444444', turn: xTurn, host: 'grok.com', add: 'main' }
];
const roles = f => Array.from(f.sent.at(-1).payload.messages, m => [m.role, m.content]);
for (const p of platforms) {
  const make = (html, overrides) => fixture(p.host, html, overrides, p.url);
  test(`${p.name}: role-aware extraction, canonical url, no UI chrome`, async () => {
    const f = make(p.turn('Question one', 'Answer one')); await f.start(); await f.tick(); await f.tick();
    assert.ok(f.sent.length, 'must collect');
    assert.deepEqual(roles(f), [['user', 'Question one'], ['assistant', 'Answer one']]);
    assert.equal(f.sent.at(-1).payload.url, p.url);
    assert.equal(f.sent.at(-1).payload.platform, p.name);
  });
  test(`${p.name}: unknown-role elements are never guessed as assistant`, async () => {
    const f = make(p.name === 'gemini' ? '<div class="message-container"><p>Unlabelled</p></div>' : '<div class="message-bubble"><p>Unlabelled</p></div>');
    await f.start(); await f.tick(); await f.tick(); assert.equal(f.sent.length, 0);
  });
  test(`${p.name}: delayed reply and repeated prompts keep order and distinct turns`, async () => {
    const f = make(p.turn('Repeat')); await f.start(); await f.tick(); await f.tick();
    assert.deepEqual(roles(f), [['user', 'Repeat']]);
    const main = f.dom.window.document.querySelector('main');
    main.innerHTML = p.turn('Repeat', 'Same'); await f.tick(); await f.tick();
    assert.deepEqual(roles(f), [['user', 'Repeat'], ['assistant', 'Same']]);
    main.insertAdjacentHTML('beforeend', p.turn('Repeat', 'Same')); await f.tick(); await f.tick();
    assert.deepEqual(roles(f), [['user', 'Repeat'], ['assistant', 'Same'], ['user', 'Repeat'], ['assistant', 'Same']]);
  });
  test(`${p.name}: streaming is suppressed until the final text is stable`, async () => {
    const f = make(p.turn('Q', 'Partial')); await f.start(); await f.tick(); await f.tick();
    const doc = f.dom.window.document, count = f.sent.length;
    doc.querySelector('main').insertAdjacentHTML('beforeend', '<button aria-label="Stop response">Stop</button>');
    [...doc.querySelectorAll('p')].at(-1).textContent = 'Partial more';
    await f.tick(); await f.tick(); assert.equal(f.sent.length, count, 'stop button means streaming');
    doc.querySelector('button[aria-label="Stop response"]').remove();
    await f.tick(); await f.tick(); assert.equal(roles(f)[1][1], 'Partial more');
  });
  test(`${p.name}: SPA navigation rejects stale connected DOM then collects the new consented chat`, async () => {
    const f = make(p.turn('Old', 'Old answer')); await f.start(); await f.tick(); await f.tick();
    await f.change({ conversationConsents: { [p.url]: OWNER, [p.next]: OWNER } });
    const count = f.sent.length;
    f.dom.window.history.pushState({}, '', new URL(p.next).pathname);
    [...f.dom.window.document.querySelectorAll('p')][0].textContent = 'Old late mutation';
    await f.tick(); await f.tick(); assert.equal(f.sent.length, count);
    f.dom.window.document.querySelector('main').innerHTML = p.turn('New', 'New answer');
    await f.tick(); await f.tick();
    assert.equal(f.sent.at(-1).payload.url, p.next);
    assert.deepEqual(roles(f), [['user', 'New'], ['assistant', 'New answer']]);
  });
  test(`${p.name}: no consent, wrong owner, revoke and root/sibling navigation fail closed`, async () => {
    for (const overrides of [{ conversationConsents: {} }, { user: { email: 'other@example.invalid' } }, { accessToken: null }, { enabled: false }]) {
      const d = make(p.turn('Q', 'A'), overrides); await d.start(); await d.tick(); await d.tick(); assert.equal(d.sent.length, 0);
    }
    const f = make(p.turn('Q', 'A')); await f.start(); await f.tick(); await f.tick();
    const count = f.sent.length; assert.ok(count);
    await f.change({ conversationConsents: {} });
    [...f.dom.window.document.querySelectorAll('p')][0].textContent = 'Revoked edit';
    await f.tick(); await f.tick(); assert.equal(f.sent.length, count);
    for (const dest of ['/', new URL(p.url).pathname + '/settings', new URL(p.next).pathname]) {
      const g = make(p.turn('Q', 'A')); await g.start(); await g.tick(); await g.tick();
      const n = g.sent.length; g.dom.window.history.pushState({}, '', dest);
      g.dom.window.document.querySelector('main').innerHTML = p.turn('Other', 'Other answer');
      await g.tick(); await g.tick(); assert.equal(g.sent.length, n, dest);
    }
  });
}
// Follow-up: Grok direction must be an unambiguous, exact class-token match on the nearest side element.
test('grok: ambiguous or substring-collision direction is skipped, never defaulted to assistant', async () => {
  const bubble = '<div class="message-bubble"><p>probe text</p></div>';
  for (const cls of ['flex items-end items-start', 'flex not-items-start', 'flex items-end-extra', 'flex items-start-extra', 'flex prefix-items-end', 'flex']) {
    const f = fixture('grok.com', `<div class="${cls}">${bubble}</div>`, {}, 'https://grok.com/c/probe-ambiguous-role');
    await f.start(); await f.tick(); await f.tick();
    assert.equal(f.sent.length, 0, cls);
  }
  // Exact tokens still classify, and an ambiguous nearest ancestor is not rescued by an outer one.
  const ok = fixture('grok.com', `<div class="items-start"><div class="flex items-end">${bubble}</div></div>`, {}, 'https://grok.com/c/probe-ambiguous-role');
  await ok.start(); await ok.tick(); await ok.tick();
  assert.deepEqual(roles(ok), [['user', 'probe text']]);
  const amb = fixture('grok.com', `<div class="items-end"><div class="items-end items-start">${bubble}</div></div>`, {}, 'https://grok.com/c/probe-ambiguous-role');
  await amb.start(); await amb.tick(); await amb.tick();
  assert.equal(amb.sent.length, 0);
});
// ---- Follow-up 2: structure taken from REAL observed Gemini DOM (evidence-live/25-gemini-real-conversation.json,
// own harmless signed-in conversation /app/6db58449a78dd046). Angular attrs, comment nodes, icons and action
// toolbars are trimmed; every element/class/text relevant to extraction is verbatim from the observation.
const realUrl = 'https://gemini.google.com/app/6db58449a78dd046';
const realPrompt = 'Harmless extension acceptance test PROMPTUTOR_GEMINI_LIVE_20261020_1417. Reply with exactly: Test acknowledged.';
const realHidden = '<h5 class="cdk-visually-hidden screen-reader-user-query-label"><span>你說了</span> Harmless extension acceptance test PROMPTUTOR_GEMINI_LIVE_20261020_1417. Reply with exactly: Test ac… </h5>';
const realUserQuery = (lines, hidden = realHidden) => `<user-query class="ng-star-inserted"><span class="user-query-container"><user-query-content class="user-query-container"><div class="user-query-container"><div class="query-content ng-star-inserted" id="user-query-content-0"><div class="query-bubble-with-status"><span class="user-query-bubble-with-background"><span class="horizontal-container"><div class="query-text gds-body-l" dir="ltr">${hidden}${lines.map(l => `<p class="query-text-line ng-star-inserted"> ${l} </p>`).join('')}</div></span></span></div><div class="luminous-actions-container"><gem-icon-button data-test-id="prompt-copy-button"><button aria-label="複製提示詞"></button></gem-icon-button><gem-icon-button data-test-id="prompt-edit-button"><button aria-label="編輯"></button></gem-icon-button></div></div></div></user-query-content></span></user-query>`;
const realModelResponse = (text, busy = 'false', footer = 'response-footer gap complete') => `<model-response class="enable-lr26-response-chrome-updates ng-star-inserted"><div><response-container><div class="response-container response-container-with-gpi no-background"><div class="presented-response-container"><div class="response-container-content"><div class="response-content"><div class="model-response-label-announcer" aria-busy="${busy}" aria-live="polite"><h6 class="cdk-visually-hidden screen-reader-model-response-label ng-star-inserted">Gemini 說了</h6></div><model-response-content><structured-content-container class="model-response-text processing-state-visible"><div class="container"><message-content id="message-content-id-r_62d0e03be3eada40"><div class="markdown markdown-main-panel md-content" id="model-response-message-contentr_62d0e03be3eada40" aria-busy="${busy}" aria-live="polite" dir="ltr">${text}</div></message-content></div></structured-content-container></model-response-content><div class="${footer}"></div></div></div><div class="response-container-footer"><message-actions><button aria-label="答得好"></button><button aria-label="複製"></button></message-actions></div></div></div></response-container></div></model-response>`;
const realTurns = `<div class="conversation-container">${realUserQuery([realPrompt])}${realModelResponse('<p data-path-to-node="0">Test acknowledged.</p>')}</div>`;
const realFixture = (html, overrides) => fixture('gemini.google.com', html, overrides, realUrl);
test('real Gemini DOM: user text comes from query-text-line, not the hidden truncated duplicate label', async () => {
  const f = realFixture(realTurns); await f.start(); await f.tick(); await f.tick();
  assert.ok(f.sent.length);
  assert.deepEqual(roles(f), [['user', realPrompt], ['assistant', 'Test acknowledged.']]);
  const all = JSON.stringify(f.sent.map(m => m.payload.messages));
  assert.doesNotMatch(all, /你說了|Gemini 說了|Test ac…|複製|編輯/);
  assert.equal(f.sent.at(-1).payload.url, realUrl);
});
test('SYNTHETIC multiline variant of real Gemini DOM: lines kept in order, blank line preserved, hidden label dropped', async () => {
  const f = realFixture(`<div class="conversation-container">${realUserQuery(['First line', '<br>', 'Third  line'])}${realModelResponse('<p>Reply</p>')}</div>`);
  await f.start(); await f.tick(); await f.tick();
  assert.deepEqual(roles(f)[0], ['user', 'First line\n\nThird  line']);
});
test('SYNTHETIC variant: hidden label without query-text-line is stripped, never used as a whole-turn fallback', async () => {
  const noLines = `<user-query><div class="query-text">${realHidden}Plain text</div></user-query>`;
  const f = realFixture(`<div class="conversation-container">${noLines}${realModelResponse('<p>Reply</p>')}</div>`);
  await f.start(); await f.tick(); await f.tick();
  assert.deepEqual(roles(f)[0], ['user', 'Plain text']);
  const hiddenOnly = realFixture(`<div class="conversation-container"><user-query><div class="query-text">${realHidden}</div></user-query></div>`);
  await hiddenOnly.start(); await hiddenOnly.tick(); await hiddenOnly.tick();
  assert.equal(hiddenOnly.sent.length, 0);
  const noBody = realFixture(`<div class="conversation-container">${realUserQuery([realPrompt])}<model-response><h6 class="cdk-visually-hidden">Gemini 說了</h6></model-response></div>`);
  await noBody.start(); await noBody.tick(); await noBody.tick();
  assert.deepEqual(roles(noBody), [['user', realPrompt]]);
});
test('SYNTHETIC aria-busy variants (mid-stream marker NOT observed live): busy reply is suppressed until aria-busy=false', async () => {
  const f = realFixture(`<div class="conversation-container">${realUserQuery([realPrompt])}${realModelResponse('<p>Par</p>', 'true', 'response-footer gap')}</div>`);
  await f.start(); await f.tick(); await f.tick(); assert.equal(f.sent.length, 0);
  f.dom.window.document.querySelector('main').innerHTML = `<div class="conversation-container">${realUserQuery([realPrompt])}${realModelResponse('<p>Partial final</p>')}</div>`;
  await f.tick(); await f.tick();
  assert.deepEqual(roles(f), [['user', realPrompt], ['assistant', 'Partial final']]);
});
