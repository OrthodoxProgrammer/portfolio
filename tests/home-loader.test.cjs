const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../js/home-loader.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function image(task) {
  return { currentSrc: '/image.png', decode: () => task.promise };
}
function setup({ images = [], fonts = Promise.resolve(), visited = false, blockedStorage = false } = {}) {
  const classes = new Set();
  const listeners = new Map();
  const attributes = {};
  const percent = { textContent: 0 };
  const events = [];
  const saved = [];
  const timers = [];
  let now = 0;
  function advance(milliseconds) {
    now += milliseconds;
    for (const timer of timers) {
      if (!timer.done && timer.due <= now) {
        timer.done = true;
        timer.callback();
      }
    }
  }
  const document = {
    documentElement: { classList: { add: value => classes.add(value), remove: value => classes.delete(value) } },
    readyState: 'loading', images, fonts: { ready: fonts },
    getElementById: id => id === 'pct' ? percent : { setAttribute: (key, value) => { attributes[key] = value; } },
    addEventListener: (name, handler) => listeners.set(name, handler),
    dispatchEvent: event => events.push(event.type)
  };
  vm.runInNewContext(source, {
    document, Event, Promise,
    setTimeout: (callback, delay) => timers.push({ callback, due: now + delay, done: false }),
    sessionStorage: {
      getItem() { if (blockedStorage) throw new Error('Storage blocked'); return visited ? '1' : null; },
      setItem(key, value) { if (blockedStorage) throw new Error('Storage blocked'); saved.push([key, value]); }
    }
  });
  return { classes, listeners, percent, attributes, events, saved, timers, advance, domReady: () => listeners.get('DOMContentLoaded')() };
}

test('waits for both decoded images and fonts, with real resource progress', async () => {
  const first = deferred(), belowFold = deferred(), fonts = deferred();
  const state = setup({ images: [image(first), image(belowFold)], fonts: fonts.promise });
  assert.ok(state.classes.has('home-loading'));
  assert.equal(state.saved.length, 0);
  state.domReady();
  await flush();
  assert.equal(state.percent.textContent, 25);
  first.resolve();
  await flush();
  assert.equal(state.percent.textContent, 50);
  fonts.resolve();
  await flush();
  assert.equal(state.percent.textContent, 75);
  state.advance(3000);
  await flush();
  assert.ok(state.classes.has('home-loading'));
  assert.equal(state.saved.length, 0);
  belowFold.resolve();
  await flush();
  assert.equal(state.percent.textContent, 100);
  assert.equal(state.attributes['aria-valuenow'], '100');
  assert.ok(!state.classes.has('home-loading'));
  assert.ok(state.classes.has('home-ready'));
  assert.deepEqual(state.events, ['home:ready']);
  assert.equal(state.saved.length, 1);
});

test('returning visit is ready before DOM parsing, without loader or entrance event', () => {
  const state = setup({ visited: true, images: [image(deferred())] });
  assert.ok(state.classes.has('home-ready'));
  assert.ok(!state.classes.has('home-loading'));
  assert.equal(state.listeners.size, 0);
  assert.equal(state.timers.length, 0);
  assert.deepEqual(state.events, []);
});

test('fast content stays at 99% until two seconds pass, then completes at 100%', async () => {
  const state = setup({ images: [image({ promise: Promise.resolve() })] });
  state.domReady();
  await flush();
  assert.equal(state.percent.textContent, 99);
  assert.equal(state.attributes['aria-valuenow'], '99');
  assert.ok(state.classes.has('home-loading'));
  state.advance(1999);
  await flush();
  assert.equal(state.percent.textContent, 99);
  assert.equal(state.attributes['aria-valuenow'], '99');
  assert.ok(state.classes.has('home-loading'));
  assert.equal(state.saved.length, 0);
  assert.deepEqual(state.events, []);
  state.advance(1);
  await flush();
  assert.equal(state.percent.textContent, 100);
  assert.equal(state.attributes['aria-valuenow'], '100');
  assert.ok(!state.classes.has('home-loading'));
  assert.ok(state.classes.has('home-ready'));
  assert.deepEqual(state.events, ['home:ready']);
});

test('time spent parsing the page counts toward the minimum', async () => {
  const state = setup();
  state.advance(2500);
  state.domReady();
  await flush();
  assert.ok(state.classes.has('home-ready'));
});

test('failed assets settle and do not lock the page', async () => {
  const broken = deferred(), fonts = deferred();
  const state = setup({ images: [image(broken)], fonts: fonts.promise });
  state.domReady();
  broken.reject(new Error('Image unavailable'));
  fonts.reject(new Error('Font unavailable'));
  state.advance(2000);
  await flush();
  assert.ok(state.classes.has('home-ready'));
});

test('blocked session storage and empty modal image do not break loading', async () => {
  const placeholder = { currentSrc: '', getAttribute: () => null, decode: () => { throw new Error('Empty image must be skipped'); } };
  const state = setup({ images: [placeholder], blockedStorage: true });
  state.domReady();
  state.advance(2000);
  await flush();
  assert.ok(state.classes.has('home-ready'));
});

test('fallback without decode waits for image load or error', async () => {
  const callbacks = new Map();
  const state = setup({ images: [{
    currentSrc: '/fallback.png', complete: false,
    addEventListener: (name, fn) => callbacks.set(name, fn),
    removeEventListener: name => callbacks.delete(name)
  }] });
  state.domReady();
  state.advance(2000);
  await flush();
  assert.ok(state.classes.has('home-loading'));
  callbacks.get('error')();
  await flush();
  assert.ok(state.classes.has('home-ready'));
  assert.equal(callbacks.size, 0);
});
