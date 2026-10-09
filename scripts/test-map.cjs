const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file) {
  const filename = path.resolve(__dirname, '..', file);
  const module = { exports: {} };
  const requireLocal = name => {
    if (name.endsWith('/vendor/leaflet')) return { LEAFLET_JS: '', LEAFLET_CSS: '' };
    return load(path.relative(path.resolve(__dirname, '..'), path.resolve(path.dirname(filename), name + '.ts')));
  };
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(js, { module, exports: module.exports, require: requireLocal, process, URLSearchParams, fetch() { throw Error('Unexpected network request'); } });
  return module.exports;
}

function mapHarness() {
  const messages = [], events = {}, input = {}, tileOptions = [];
  let options, viewChanges = 0, zoom = 14;
  const container = { style: {} };
  const layer = () => ({ addTo() { return this; }, on() { return this; }, clearLayers() {}, setLatLng() {}, setIcon() {}, setRadius() {} });
  const map = {
    setView(_, z) { zoom = z; viewChanges++; return this; },
    attributionControl: { setPrefix() {}, addAttribution() {} },
    createPane() {}, getPane() { return { style: {} }; }, getContainer() { return container; },
    on(name, callback) { events[name] = callback; }, stop() {},
    getCenter() { return { lat: 9.56, lng: 44.06 }; }, getZoom() { return zoom; },
    project() { return { add() { return this; } }; }, unproject() { return [2, 45]; },
  };
  const L = {
    map(_, opts) { options = opts; return map; },
    control: { scale: layer }, tileLayer: layer, featureGroup: layer,
    GridLayer: { extend() { return class { constructor(opts) { tileOptions.push(opts); } }; } },
    DomEvent: { on(_, names, callback) { names.split(' ').forEach(name => { input[name] = callback; }); } },
    circle: layer, marker: layer, divIcon: value => value,
  };
  const html = load('src/components/mapHtml.ts').buildMapHtml();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const context = vm.createContext({ L, window: { ReactNativeWebView: { postMessage: raw => messages.push(JSON.parse(raw)) }, addEventListener() {} },
    document: { addEventListener() {} }, fetch: () => new Promise(() => {}) });
  scripts.forEach(script => vm.runInContext(script, context));
  return { context, options, tileOptions, input, events, messages, viewChanges: () => viewChanges };
}

test('Somalia can be browsed without the Mogadishu camera fence', () => {
  const h = mapHarness();
  assert.equal(h.options.minZoom, 4);
  assert.equal(h.options.maxBounds, undefined);
  h.events.moveend();
  assert.equal(h.messages.at(-1).lat, 9.56);
});

test('touch/pinch, mouse wheel and dragging release follow before later GPS updates', () => {
  for (const gesture of ['touchstart', 'wheel', 'dragstart']) {
    const h = mapHarness();
    h.context.handle({ type: 'user', user: { lat: 2.04, lng: 45.32 } });
    h.context.handle({ type: 'follow', on: true, zoom: 17 });
    (h.input[gesture] || h.events[gesture])();
    const before = h.viewChanges();
    h.context.handle({ type: 'user', user: { lat: 2.05, lng: 45.33 } });
    assert.equal(h.viewChanges(), before);
    assert.ok(h.messages.some(m => m.type === 'unfollow'));
    h.context.handle({ type: 'follow', on: true, zoom: 17 });
    assert.equal(h.viewChanges(), before + 1);
  }
});

test('city detail tiles remain bounded and defer work until gestures finish', () => {
  const h = mapHarness();
  for (const options of h.tileOptions) {
    assert.equal(options.bounds[0][0], 1.93);
    assert.equal(options.bounds[1][1], 45.49);
    assert.equal(options.updateWhenIdle, true);
    assert.equal(options.updateWhenZooming, false);
  }
});

test('outside-city taps allow browsing, but long-press contributions remain restricted', () => {
  const h = mapHarness(), event = { latlng: { lat: 9.56, lng: 44.06 } };
  h.events.click(event);
  assert.equal(h.messages.at(-1).type, 'press');
  h.events.contextmenu(event);
  assert.equal(h.messages.at(-1).type, 'outside');
});

test('routing rejects either endpoint outside Mogadishu before calling a provider', async () => {
  const { planRoute } = load('src/lib/routing.ts');
  const city = { lat: 2.04, lng: 45.32 }, outside = { lat: 9.56, lng: 44.06 };
  for (const [from, to] of [[city, outside], [outside, city]]) {
    await assert.rejects(planRoute(from, to, 'driving', []), { code: 'OUTSIDE_SERVICE_AREA' });
  }
});
