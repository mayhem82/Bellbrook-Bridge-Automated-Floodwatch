const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const workerSource = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');
const now = Date.now();
const row = (height = 0.8, hoursAgo = 0) => ({ station_id: '059122', height, datetime: new Date(now - hoursAgo * 3600000).toISOString() });
const response = results => ({ ok: true, json: async () => ({ results }) });
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };

function page({ fetcher = async () => response([row()]), saved = [], storageFails = false, canvasFails = false, serviceWorker } = {}) {
  const elements = new Map();
  for (const [, id] of html.matchAll(/id="([^"]+)"/g)) {
    const el = { textContent: '', hidden: false, disabled: false, style: {}, className: '', attributes: {}, events: {},
      addEventListener(name, fn) { this.events[name] = fn; },
      setAttribute(name, value) { this.attributes[name] = value; },
      getBoundingClientRect: () => ({ width: 360 }), parentElement: { clientWidth: 360 },
      getContext() { if (canvasFails) throw new Error('Canvas unavailable'); return new Proxy({}, { get: (o, k) => o[k] || (() => {}), set: (o, k, v) => (o[k] = v, true) }); },
      classList: { remove() {}, add() {} }
    };
    elements.set(id, el);
  }
  let history = JSON.stringify(saved), nextTimer = 0;
  const timers = new Map(), windowEvents = {}, navigations = [], calls = [];
  const sandbox = {
    URL, Date, AbortController, console: { error() {}, warn() {} },
    document: { getElementById: id => { assert.ok(elements.has(id), 'HTML contains ' + id); return elements.get(id); } },
    localStorage: {
      getItem() { if (storageFails) throw Error('blocked'); return history; },
      setItem(k, v) { if (storageFails) throw Error('blocked'); history = v; },
      removeItem() { history = '[]'; }
    },
    window: { devicePixelRatio: 1, addEventListener: (event, handler) => windowEvents[event] = handler,
      location: { href: 'https://example.test/Bellbrook-Bridge-Automated-Floodwatch/', replace: url => navigations.push(url) } },
    navigator: serviceWorker ? { serviceWorker } : {}, alert() {},
    setTimeout: (fn, ms) => { timers.set(++nextTimer, { fn, ms }); return nextTimer; },
    clearTimeout: id => timers.delete(id), setInterval() {},
    fetch: (...args) => { calls.push(args); return fetcher(...args); }
  };
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  return { el: id => elements.get(id), run: code => vm.runInContext(code, sandbox), calls, navigations, timers,
    history: () => JSON.parse(history), windowEvents,
    expire: async ms => { for (const [id, timer] of [...timers]) if (timer.ms <= ms) { timers.delete(id); timer.fn(); } await flush(); }
  };
}

test('both shipped scripts parse; HTML has no literal escaped-newline separators', () => {
  new vm.Script(script); new vm.Script(workerSource);
  assert.doesNotMatch(html, /\\n\s*(?:const|if|else|<)/);
});

test('startup rebuilds captured history before any on-device polling', async () => {
  const p = page({ fetcher: async url => response(url.includes('-historical/') ? [row(0.8), row(1.1, 6), row(1.2, 12), row(1.3, 13)] : [row(0.8)]) });
  await p.run('update()');
  assert.equal(p.el('water-level').textContent, '0.80 m');
  assert.equal(p.el('clearance').textContent, '2.00 m');
  assert.equal(p.history().length, 3);
  assert.equal(p.history()[0].height, 1.2);
  assert.match(p.el('trend-note').textContent, /3 captured observations over 12.0 hours/);
  assert.match(p.el('time').textContent, /AEST/);
  assert.equal(p.el('refresh-gauge').disabled, false);
  assert.equal(p.timers.size, 0);
  assert.equal(p.calls.length, 2, 'refreshes do not overlap');
});

test('hung fetch exits loading at 15 seconds, aborts both feeds and Retry recovers', async () => {
  let stalled = true;
  const p = page({ fetcher: async () => stalled ? new Promise(() => {}) : response([row(0.65)]) });
  await flush();
  await p.expire(14999);
  assert.equal(p.el('refresh-gauge').disabled, true);
  await p.expire(15000);
  assert.match(p.el('status-banner').textContent, /TIMED OUT/);
  assert.equal(p.el('retry-gauge').hidden, false);
  assert.equal(p.el('refresh-gauge').disabled, false);
  assert.ok(p.calls.every(([, options]) => options.signal.aborted));
  stalled = false;
  await p.el('retry-gauge').events.click();
  assert.equal(p.el('water-level').textContent, '0.65 m');
  assert.equal(p.el('retry-gauge').hidden, true);
});

test('deadline covers a stalled response body too', async () => {
  const p = page({ fetcher: async () => ({ ok: true, json: () => new Promise(() => {}) }) });
  await flush(); await p.expire(15000);
  assert.match(p.el('status-banner').textContent, /TIMED OUT/);
});

test('HTTP errors, bad JSON and empty/invalid observations leave retry enabled', async t => {
  for (const [name, fetcher] of [
    ['HTTP', async () => ({ ok: false, status: 503 })],
    ['JSON', async () => ({ ok: true, json: async () => { throw Error('invalid JSON'); } })],
    ['empty', async () => response([])],
    ['invalid', async () => response([row(null), row(''), row(false), { ...row(), datetime: 'bad' }, { ...row(), station_id: 'other' }])]
  ]) await t.test(name, async () => {
    const p = page({ fetcher }); await p.run('update()');
    assert.match(p.el('status-banner').textContent, /DATA UNAVAILABLE/);
    assert.equal(p.el('retry-gauge').hidden, false);
    assert.equal(p.el('refresh-gauge').disabled, false);
    assert.equal(p.timers.size, 0);
  });
});

test('failure restores saved reading with its original time and unavailable warning', async () => {
  const p = page({ saved: [{ height: 1.4, stamp: now - 3600000 }], fetcher: async () => { throw Error('offline'); } });
  await p.run('update()');
  assert.equal(p.el('water-level').textContent, '1.40 m');
  assert.match(p.el('status-banner').textContent, /LAST READING SHOWN/);
  assert.match(p.el('trend-note').textContent, /Saved observations only/);
  assert.equal(p.history()[0].stamp, now - 3600000);
});

test('stale source is labelled, and older responses never replace newer saved observations', async () => {
  const stale = page({ fetcher: async () => response([row(0.8, 3)]) }); await stale.run('update()');
  assert.match(stale.el('status-banner').textContent, /OVER 2 HOURS OLD/);
  const delayed = page({ saved: [{ height: 1.4, stamp: now }], fetcher: async () => response([row(0.8, 1)]) }); await delayed.run('update()');
  assert.equal(delayed.el('water-level').textContent, '1.40 m');
  assert.match(delayed.el('status-banner').textContent, /OLDER READING/);
});

test('history feed is a labelled fallback when current feed fails', async () => {
  const p = page({ fetcher: async url => { if (!url.includes('-historical/')) throw Error('offline'); return response([row(0.7), row(0.8, 9)]); } });
  await p.run('update()');
  assert.equal(p.el('water-level').textContent, '0.70 m');
  assert.match(p.el('last-checked').textContent, /current feed unavailable; captured observations shown/);
});

test('blocked storage or canvas does not prevent successful gauge loading', async () => {
  const p = page({ storageFails: true, canvasFails: true }); await p.run('update()');
  assert.equal(p.el('water-level').textContent, '0.80 m');
  assert.doesNotMatch(p.el('status-banner').textContent, /FAILED|UNAVAILABLE|LOADING/);
});

test('Update button works without service-worker support', async () => {
  const p = page(); await p.run('update()'); await p.el('update-app').events.click();
  assert.equal(p.navigations.length, 1);
  assert.ok(new URL(p.navigations[0]).searchParams.has('app-update'));
});

test('Update button activates a waiting worker then reloads once', async () => {
  const messages = [], events = {};
  const registration = { update: async () => {}, waiting: { postMessage: m => messages.push(m) } };
  const p = page({ serviceWorker: { register: async () => registration, addEventListener: (n, fn) => events[n] = fn } });
  await p.run('update()'); await p.el('update-app').events.click();
  assert.equal(messages[0].type, 'SKIP_WAITING');
  events.controllerchange(); await p.expire(2000);
  assert.equal(p.navigations.length, 1);
});

test('hung app update terminates with enabled retry, without reloading', async () => {
  const p = page({ serviceWorker: { register: () => new Promise(() => {}), addEventListener() {} } });
  await p.run('update()'); const action = p.el('update-app').events.click();
  await p.expire(15000); await action;
  assert.match(p.el('app-update-status').textContent, /timed out/);
  assert.equal(p.el('update-app').disabled, false);
  assert.equal(p.navigations.length, 0);
});

function worker({ fetcher = async () => new Response('network'), keys = [] } = {}) {
  const events = {}, timers = new Map(), deleted = [], writes = [];
  const stored = new Map(), cache = { put: async (k, v) => { stored.set(k, v); writes.push(k); }, match: async k => stored.get(k) };
  let timerId = 0;
  const scope = 'https://example.test/Bellbrook-Bridge-Automated-Floodwatch/';
  const context = vm.createContext({ URL, Response, AbortController, fetch: fetcher,
    self: { registration: { scope }, addEventListener: (n, fn) => events[n] = fn, skipWaiting: async () => {}, clients: { claim: async () => {} } },
    caches: { open: async () => cache, keys: async () => keys, delete: async k => deleted.push(k) },
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: id => timers.delete(id)
  });
  vm.runInContext(workerSource, context);
  return { events, deleted, writes, stored, scope, expire: async ms => { for (const [id, t] of [...timers]) if(t.ms <= ms) {timers.delete(id); t.fn();} await flush(); } };
}

test('service worker cleans only its own old caches and precaches a usable shell', async () => {
  const w = worker({ keys: ['bellbrook-floodwatch-v2', 'another-app-cache', 'bellbrook-floodwatch-v4-2026.09.21.1'] });
  let done; w.events.install({ waitUntil: p => done = p }); await done;
  assert.equal(w.writes.length, 6);
  w.events.activate({ waitUntil: p => done = p }); await done;
  assert.deepEqual(w.deleted, ['bellbrook-floodwatch-v2']);
});

test('service worker bounds a stalled navigation and restores cached shell for update URL', async () => {
  const w = worker({ fetcher: () => new Promise(() => {}) });
  w.stored.set(w.scope, new Response('cached app'));
  let output; w.events.fetch({ request: { url: w.scope + '?app-update=123', method: 'GET' }, respondWith: p => output = p });
  await w.expire(6000); assert.equal(await (await output).text(), 'cached app');
  let intercepted = false;
  w.events.fetch({ request: { url: 'https://australiademo.opendatasoft.com/data', method: 'GET' }, respondWith: () => intercepted = true });
  assert.equal(intercepted, false, 'never caches live gauge requests');
});
