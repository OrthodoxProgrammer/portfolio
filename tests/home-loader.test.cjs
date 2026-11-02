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
  const history = [0];
  const events = [];
  const saved = [];
  const timers = [];
  let frames = [];
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
  async function frame(milliseconds = 20) {
    advance(milliseconds);
    await flush();
    const pending = frames;
    frames = [];
    pending.forEach(callback => callback(now));
    history.push(percent.textContent);
    await flush();
  }
  async function runFor(milliseconds) {
    while (milliseconds > 0) {
      const step = Math.min(20, milliseconds);
      await frame(step);
      milliseconds -= step;
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
    performance: { now: () => now },
    requestAnimationFrame: callback => frames.push(callback),
    setTimeout: (callback, delay) => timers.push({ callback, due: now + delay, done: false }),
    sessionStorage: {
      getItem() { if (blockedStorage) throw new Error('Storage blocked'); return visited ? '1' : null; },
      setItem(key, value) { if (blockedStorage) throw new Error('Storage blocked'); saved.push([key, value]); }
    }
  });
  return { classes, listeners, percent, attributes, history, events, saved, timers, advance, frame, runFor, domReady: () => listeners.get('DOMContentLoaded')() };
}
function assertSmooth(history) {
  for (let i = 1; i < history.length; i++) {
    assert.ok(history[i] >= history[i - 1], 'progress cannot go backwards');
    assert.ok(history[i] - history[i - 1] <= 1, 'progress cannot skip an integer');
  }
}

test('fast content counts through every percentage over at least two seconds', async () => {
  const state = setup({ images: [image({ promise: Promise.resolve() })] });
  state.domReady();
  await flush();
  assert.equal(state.percent.textContent, 0);
  await state.runFor(1000);
  assert.equal(state.percent.textContent, 50);
  await state.runFor(980);
  assert.equal(state.percent.textContent, 99);
  assert.equal(state.attributes['aria-valuenow'], '99');
  assert.ok(state.classes.has('home-loading'));
  assert.equal(state.saved.length, 0);
  await state.runFor(20);
  assert.equal(state.percent.textContent, 100);
  assert.equal(state.attributes['aria-valuenow'], '100');
  assert.ok(state.classes.has('home-ready'));
  assert.ok(!state.classes.has('home-loading'));
  assert.deepEqual(state.events, ['home:ready']);
  assert.equal(state.saved.length, 1);
  assertSmooth(state.history);
});

test('slow images and fonts gate progress; completion is also animated', async () => {
  const belowFold = deferred(), fonts = deferred();
  const state = setup({ images: [image({ promise: Promise.resolve() }), image(belowFold)], fonts: fonts.promise });
  state.domReady();
  await state.runFor(3000);
  assert.equal(state.percent.textContent, 50);
  fonts.resolve();
  await state.frame();
  assert.equal(state.percent.textContent, 51);
  await state.runFor(1000);
  assert.equal(state.percent.textContent, 75);
  assert.ok(state.classes.has('home-loading'));
  assert.equal(state.saved.length, 0);
  belowFold.resolve();
  await state.frame();
  assert.equal(state.percent.textContent, 76);
  assert.ok(state.classes.has('home-loading'));
  await state.runFor(600);
  assert.equal(state.percent.textContent, 100);
  assert.deepEqual(state.events, ['home:ready']);
  assertSmooth(state.history);
});

test('returning visits do not schedule a loader or animation', () => {
  const state = setup({ visited: true, images: [image(deferred())] });
  assert.ok(state.classes.has('home-ready'));
  assert.ok(!state.classes.has('home-loading'));
  assert.equal(state.listeners.size, 0);
  assert.equal(state.timers.length, 0);
  assert.deepEqual(state.events, []);
});

test('resuming a background tab cannot skip straight to 100%', async () => {
  const state = setup();
  state.domReady();
  await state.runFor(500);
  assert.equal(state.percent.textContent, 25);
  await state.frame(10000);
  assert.equal(state.percent.textContent, 26);
  assert.ok(state.classes.has('home-loading'));
  await state.runFor(1600);
  assert.ok(state.classes.has('home-ready'));
  assertSmooth(state.history);
});

test('slow DOM parsing still leaves a smooth visible counter', async () => {
  const state = setup();
  state.advance(3000);
  state.domReady();
  await state.frame();
  assert.equal(state.percent.textContent, 1);
  await state.runFor(2000);
  assert.ok(state.classes.has('home-ready'));
  assertSmooth(state.history);
});

test('failed assets settle and do not lock the page', async () => {
  const broken = deferred(), fonts = deferred();
  const state = setup({ images: [image(broken)], fonts: fonts.promise });
  state.domReady();
  broken.reject(new Error('Image unavailable'));
  fonts.reject(new Error('Font unavailable'));
  await state.runFor(2000);
  assert.ok(state.classes.has('home-ready'));
});

test('blocked session storage and empty modal image do not break loading', async () => {
  const placeholder = { currentSrc: '', getAttribute: () => null, decode: () => { throw new Error('Empty image must be skipped'); } };
  const state = setup({ images: [placeholder], blockedStorage: true });
  state.domReady();
  await state.runFor(2000);
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
  await state.runFor(2000);
  assert.ok(state.classes.has('home-loading'));
  callbacks.get('error')();
  await state.runFor(1000);
  assert.ok(state.classes.has('home-ready'));
  assert.equal(callbacks.size, 0);
  assertSmooth(state.history);
});
