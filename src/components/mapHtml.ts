import { ATLAS_WEBSITE, BOUNDS, CITY_CENTER, DISTRICTS } from '../config';
import { LEAFLET_CSS, LEAFLET_JS } from '../vendor/leaflet';

// Runs inside the WebView, whose origin is the Magaalo Atlas website, so '/data/…' and '/api/…' are the
// website's own endpoints. The map, tiles, renderer and layers mirror the website (dist/client/app.js,
// vector-map.js, community.js). Plain ES5-style JS so it can live in String.raw.
const PAGE_SCRIPT = String.raw`
var post = function (msg) { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(msg)); };
var CFG = window.MAGAALO, BOUNDS = CFG.bounds;
var inside = function (lng, lat) { return lng >= BOUNDS.west && lng <= BOUNDS.east && lat >= BOUNDS.south && lat <= BOUNDS.north; };
var state = { basemap: 'satellite', roads: true, buildings: true, places: true, community: true, transport: false, districts: false,
  alerts: true, debug: false, districtOpacity: 24, padBottom: 260, padTop: 120 };

var map = L.map('map', { zoomControl: false, minZoom: 12, maxZoom: 20, preferCanvas: true,
  maxBounds: [[BOUNDS.south, BOUNDS.west], [BOUNDS.north, BOUNDS.east]], maxBoundsViscosity: 1 }).setView([CFG.center.lat, CFG.center.lng], 14);
map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
map.attributionControl.addAttribution('Districts: OCHA / HDX · Features: OSM / Overture Maps');
L.control.scale({ imperial: false, maxWidth: 100, position: 'bottomleft' }).addTo(map);
[['districtPane', 405], ['buildingPane', 410], ['roadPane', 415], ['placePane', 420], ['communityPane', 425], ['transportPane', 430],
 ['altPane', 440], ['routePane', 450], ['alertPane', 460], ['markerPane2', 470], ['userPane', 480], ['drawPane', 490]].forEach(function (p) {
  map.createPane(p[0]); map.getPane(p[0]).style.zIndex = p[1];
});

// Same base layers as the website.
var satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 20, maxNativeZoom: 19, attribution: 'Imagery © <a href="https://www.esri.com/">Esri</a>, Vantor, Earthstar Geographics' });
var street = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 20, maxNativeZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' });

// ---------------- Atlas data (website /data/atlas.json) ----------------
var atlas = null, atlasPromise = null;
function loadAtlas() {
  atlasPromise = atlasPromise || fetch('/data/atlas.json').then(function (r) { if (!r.ok) throw new Error('atlas'); return r.json(); })
    .then(function (a) {
      atlas = a;
      a._keys = {}; Object.keys(a.tile_keys || {}).forEach(function (g) { a._keys[g] = {}; a.tile_keys[g].forEach(function (k) { a._keys[g][k] = 1; }); });
      post({ type: 'atlas', counts: a.counts, osm_timestamp: a.osm_timestamp, prepared_at: a.prepared_at });
      return a;
    }).catch(function (e) { atlasPromise = null; post({ type: 'status', message: 'atlas-unavailable' }); throw e; });
  return atlasPromise;
}

// ---------------- Vector tiles: identical scheme and drawing to vector-map.js ----------------
var tileCache = {}, tileOrder = [];
function sourceCoords(coords, group) {
  var z = group === 'buildings' ? (coords.z <= 15 ? 15 : 16) : coords.z <= 13 ? 12 : coords.z <= 15 ? 14 : 16;
  var scale = Math.pow(2, coords.z - z);
  return { z: z, x: Math.floor(coords.x / scale), y: Math.floor(coords.y / scale), scale: scale, dx: (coords.x % scale) * 256, dy: (coords.y % scale) * 256 };
}
function dataTile(group, src) {
  var key = group + '/' + src.z + '/' + src.x + '/' + src.y;
  if (atlas._keys[group] && !atlas._keys[group][src.z + '/' + src.x + '/' + src.y]) return Promise.resolve({ e: 4096, f: [] });
  if (!tileCache[key]) {
    var path = 'tiles/' + key + '.json', version = atlas.input_sha256.slice(0, 12);
    tileCache[key] = (atlas.storage_base ? fetch(atlas.storage_base + '/' + path + '?v=' + version).catch(function () { return null; }) : Promise.resolve(null))
      .then(function (r) { return r && r.ok ? r : fetch('/data/' + path + '?v=' + version); })
      .then(function (r) { if (r.status === 404) return { e: 4096, f: [] }; if (!r.ok) throw new Error('tile'); return r.json(); })
      .catch(function (e) { delete tileCache[key]; throw e; });
    tileOrder.push(key); if (tileOrder.length > 160) delete tileCache[tileOrder.shift()];
  }
  return tileCache[key];
}
function lines(type, c) { return type === 'LineString' ? [c] : type === 'MultiLineString' ? c : type === 'Polygon' ? c : type === 'MultiPolygon' ? [].concat.apply([], c) : []; }
var MAJOR = { motorway: 1, trunk: 1, primary: 1, secondary: 1, tertiary: 1 };
function draw(ctx, data, src, group, zoom) {
  var basemap = state.basemap, scale = 256 / data.e * src.scale;
  var toXY = function (p) { return [p[0] * scale - src.dx, p[1] * scale - src.dy]; };
  var labels = [], dedup = {};
  data.f.forEach(function (f) {
    var type = f[1], c = f[2], p = f[3] || {};
    ctx.beginPath(); var paths = lines(type, c);
    paths.forEach(function (line) { line.forEach(function (v, i) { var xy = toXY(v); i ? ctx.lineTo(xy[0], xy[1]) : ctx.moveTo(xy[0], xy[1]); }); if (group === 'buildings') ctx.closePath(); });
    if (group === 'buildings') {
      ctx.fillStyle = basemap === 'satellite' ? 'rgba(239,194,119,.18)' : 'rgba(226,163,76,.16)'; ctx.fill('evenodd');
      ctx.strokeStyle = basemap === 'satellite' ? 'rgba(250,208,144,.85)' : 'rgba(174,115,40,.7)'; ctx.lineWidth = .8; ctx.stroke();
    } else {
      ctx.strokeStyle = basemap === 'satellite' ? 'rgba(247,204,130,.85)' : 'rgba(163,112,48,.5)'; ctx.lineWidth = MAJOR[p.highway] ? 2 : 1; ctx.stroke();
      var name = p.name || p['name:en'];
      if (name && zoom >= 14 && !dedup[name]) {
        var best = null, length = 0;
        paths.forEach(function (line) { for (var i = 1; i < line.length; i++) { var a = toXY(line[i - 1]), b = toXY(line[i]), len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len > length) { length = len; best = [a, b]; } } });
        if (best && length > 40) { var x = (best[0][0] + best[1][0]) / 2, y = (best[0][1] + best[1][1]) / 2;
          if (x > 10 && x < 246 && y > 10 && y < 246) { labels.push({ name: name, x: x, y: y, angle: Math.atan2(best[1][1] - best[0][1], best[1][0] - best[0][0]) }); dedup[name] = 1; } }
      }
    }
  });
  var occupied = []; ctx.font = '600 11px system-ui, -apple-system, Roboto, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  labels.forEach(function (l) {
    var width = ctx.measureText(l.name).width;
    if (occupied.some(function (b) { return Math.abs(b[0] - l.x) < (width + b[2]) / 2 + 8 && Math.abs(b[1] - l.y) < 23; })) return;
    occupied.push([l.x, l.y, width]); ctx.save(); ctx.translate(l.x, l.y);
    var angle = l.angle; if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI; ctx.rotate(angle);
    ctx.lineWidth = 3; ctx.strokeStyle = basemap === 'satellite' ? 'rgba(15,36,28,.9)' : 'rgba(255,255,255,.95)'; ctx.strokeText(l.name, 0, 0);
    ctx.fillStyle = basemap === 'satellite' ? '#fff6e5' : '#284e43'; ctx.fillText(l.name, 0, 0); ctx.restore();
  });
}
function cityTileLayer(group) {
  var Layer = L.GridLayer.extend({
    createTile: function (coords, done) {
      var tile = document.createElement('canvas'), ratio = Math.min(window.devicePixelRatio || 1, 2);
      tile.width = tile.height = 256 * ratio; tile.style.width = tile.style.height = '256px';
      var src = sourceCoords(coords, group);
      loadAtlas().then(function () { return dataTile(group, src); }).then(function (data) {
        var ctx = tile.getContext('2d'); ctx.scale(ratio, ratio); draw(ctx, data, src, group, coords.z);
        if (state.debug) { ctx.strokeStyle = 'rgba(210,59,59,.6)'; ctx.strokeRect(0, 0, 256, 256); ctx.fillStyle = '#d23b3b'; ctx.font = '10px monospace'; ctx.textAlign = 'left'; ctx.fillText(group + ' ' + coords.z + '/' + coords.x + '/' + coords.y, 4, 12); }
        tile._data = data; tile._source = src; done(null, tile);
      }).catch(function (e) { done(e, tile); });
      return tile;
    }
  });
  return new Layer({ tileSize: 256, minZoom: group === 'buildings' ? 15 : 12, maxNativeZoom: 16, maxZoom: 20, keepBuffer: 1, updateInterval: 160, pane: group === 'buildings' ? 'buildingPane' : 'roadPane' });
}
var roadLayer = cityTileLayer('roads'), buildingLayer = cityTileLayer('buildings');

// Feature hit-test, identical to the website's tileFeatureAt/toFeature.
function pointInRing(x, y, ring) { var r = false; for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) { var a = ring[i], b = ring[j]; if (((a[1] > y) !== (b[1] > y)) && (x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0])) r = !r; } return r; }
function distanceToLine(x, y, line) { var best = Infinity; for (var i = 1; i < line.length; i++) { var a = line[i - 1], b = line[i], dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1))); best = Math.min(best, Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy)); } return best; }
function toFeature(f, src, extent) {
  var transform = function (c) { if (typeof c[0] === 'number') { var ll = map.unproject(L.point(src.x * 256 + c[0] * 256 / extent, src.y * 256 + c[1] * 256 / extent), src.z); return [Math.max(BOUNDS.west, Math.min(BOUNDS.east, ll.lng)), Math.max(BOUNDS.south, Math.min(BOUNDS.north, ll.lat))]; } return c.map(transform); };
  return { type: 'Feature', id: f[0], geometry: { type: f[1], coordinates: transform(f[2]) }, properties: f[3] || {} };
}
function tileFeatureAt(layer, latlng) {
  var tiles = layer._tiles || {};
  for (var k in tiles) {
    var entry = tiles[k]; if (!entry.current || !entry.el._data) continue;
    var src = entry.el._source, data = entry.el._data, point = map.project(latlng, src.z);
    var x = (point.x - src.x * 256) * data.e / 256, y = (point.y - src.y * 256) * data.e / 256;
    if (x < 0 || y < 0 || x > data.e || y > data.e) continue;
    var best = null, distance = 10 * data.e / 256 / Math.pow(2, map.getZoom() - src.z);
    for (var i = 0; i < data.f.length; i++) {
      var f = data.f[i], type = f[1], c = f[2];
      if (type.indexOf('Polygon') >= 0) { var polys = type === 'Polygon' ? [c] : c; for (var j = 0; j < polys.length; j++) if (pointInRing(x, y, polys[j][0]) && !polys[j].slice(1).some(function (r) { return pointInRing(x, y, r); })) return toFeature(f, src, data.e); }
      else lines(type, c).forEach(function (line) { var d = distanceToLine(x, y, line); if (d < distance) { best = f; distance = d; } });
    }
    if (best) return toFeature(best, src, data.e);
  }
  return null;
}

// ---------------- Road access point: where a building/place meets the road network ----------------
// Uses the network pipeline's precomputed access tiles when published (/data/network/access), otherwise
// computes it on the device from the z16 road tiles: nearest drivable road segment within 150 m.
var NON_DRIVABLE = { footway: 1, path: 1, steps: 1, cycleway: 1, pedestrian: 1, bridleway: 1, construction: 1, proposed: 1 };
var accessTiles = {}, placesAccess = null;
function z15Key(lng, lat) { var n = 32768, r = lat * Math.PI / 180; return Math.floor((lng + 180) / 360 * n) + '_' + Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n); }
function precomputedAccess(lng, lat, id, kind) {
  if (!id) return Promise.resolve(null);
  if (kind === 'place') {
    placesAccess = placesAccess || fetch('/data/network/places-access.json').then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; });
    return placesAccess.then(function (list) { var hit = list.filter(function (p) { return p.id === id; })[0]; return hit ? { lng: hit.access[0], lat: hit.access[1], street: hit.street, distance: hit.distance, source: 'network' } : null; });
  }
  var key = z15Key(lng, lat);
  accessTiles[key] = accessTiles[key] || fetch('/data/network/access/' + key + '.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  return accessTiles[key].then(function (t) { var b = t && t.b[id]; return b ? { lng: b[0], lat: b[1], street: b[2] >= 0 ? t.names[b[2]] : null, distance: b[3], source: 'network' } : null; });
}
function computedAccess(lng, lat) {
  return loadAtlas().then(function () {
    var p = map.project([lat, lng], 16), tx = Math.floor(p.x / 256), ty = Math.floor(p.y / 256), jobs = [];
    for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) (function (x, y) { jobs.push(dataTile('roads', { z: 16, x: x, y: y }).then(function (d) { return { x: x, y: y, d: d }; }).catch(function () { return null; })); })(tx + dx, ty + dy);
    return Promise.all(jobs);
  }).then(function (tiles) {
    var p = map.project([lat, lng], 16), best = null, named = null;
    tiles.forEach(function (t) {
      if (!t) return;
      t.d.f.forEach(function (f) {
        var props = f[3] || {}; if (!props.highway || NON_DRIVABLE[props.highway]) return;
        lines(f[1], f[2]).forEach(function (line) {
          for (var i = 1; i < line.length; i++) {
            var s = t.d.e / 256, a = [t.x * 256 + line[i - 1][0] / s, t.y * 256 + line[i - 1][1] / s], b = [t.x * 256 + line[i][0] / s, t.y * 256 + line[i][1] / s];
            var vx = b[0] - a[0], vy = b[1] - a[1], u = Math.max(0, Math.min(1, ((p.x - a[0]) * vx + (p.y - a[1]) * vy) / (vx * vx + vy * vy || 1)));
            var q = [a[0] + u * vx, a[1] + u * vy], d = Math.hypot(p.x - q[0], p.y - q[1]);
            if (!best || d < best.d) best = { d: d, q: q, props: props };
            var nm = props['name:en'] || props.name; if (nm && (!named || d < named.d)) named = { d: d, name: nm };
          }
        });
      });
    });
    if (!best) return null;
    var metersPerPx = 156543.03 * Math.cos(lat * Math.PI / 180) / 65536, ll = map.unproject(L.point(best.q[0], best.q[1]), 16);
    var street = best.props['name:en'] || best.props.name || (named && named.d * metersPerPx < 120 ? named.name : null);
    if (best.d * metersPerPx > 150) return null;
    return { lng: ll.lng, lat: ll.lat, street: street ? String(street).replace(/[؀-ۿ]+/g, '').replace(/[\s\/]+$/, '').trim() || String(street) : null, distance: Math.round(best.d * metersPerPx), source: 'device' };
  });
}
function accessFor(msg) {
  return precomputedAccess(msg.lng, msg.lat, msg.featureId, msg.kind).then(function (a) { return a || computedAccess(msg.lng, msg.lat); })
    .then(function (a) { post({ type: 'access', requestId: msg.requestId, access: a }); })
    .catch(function () { post({ type: 'access', requestId: msg.requestId, access: null }); });
}

// ---------------- Places (atlas.place_features), as on the website ----------------
var placeLayer = L.featureGroup();
function drawPlaces() {
  placeLayer.clearLayers();
  if (!atlas || !state.places) return;
  var bounds = map.getBounds(), zoom = map.getZoom(), occupied = [];
  (atlas.place_features || []).forEach(function (feature) {
    var c = feature.geometry.coordinates, lat = c[1], lng = c[0], p = feature.properties || {}, name = p.name || p['name:en'];
    if (!bounds.contains([lat, lng]) || (zoom < 15 && !name)) return;
    var business = p.shop || p.office || p.craft || p.category || p.basic_category;
    var marker = L.circleMarker([lat, lng], { pane: 'placePane', radius: business ? 6 : 5, color: 'white', weight: 1.5, fillColor: business ? '#ae793a' : '#477e71', fillOpacity: 1 });
    marker.on('click', function (e) { L.DomEvent.stopPropagation(e); post({ type: 'place', feature: feature }); });
    if (name && zoom >= 16) { var pt = map.latLngToContainerPoint([lat, lng]);
      if (!occupied.some(function (o) { return Math.abs(o.x - pt.x) < 130 && Math.abs(o.y - pt.y) < 28; })) { occupied.push(pt);
        marker.bindTooltip(String(p['name:en'] || name), { permanent: true, direction: 'top', className: 'place-name-label', offset: [0, -3] }); } }
    marker.addTo(placeLayer);
  });
}

// ---------------- Community details: approved suggestions (/api/suggestions) ----------------
var communityLayer = L.featureGroup(), communityLoaded = false;
function loadCommunity() {
  if (communityLoaded) return;
  communityLoaded = true;
  fetch('/api/suggestions').then(function (r) { return r.json(); }).then(function (result) {
    communityLayer.clearLayers();
    (result.suggestions || []).forEach(function (s) {
      L.geoJSON({ type: 'Feature', geometry: s.geometry, properties: { name: s.name } }, {
        pane: 'communityPane', style: { color: '#237b75', weight: 3, fillOpacity: .16 },
        pointToLayer: function (f, ll) { return L.circleMarker(ll, { pane: 'communityPane', radius: 6, fillColor: '#237b75', fillOpacity: 1, color: 'white', weight: 2 }); },
        onEachFeature: function (f, l) {
          l.bindTooltip(s.name, { permanent: true, direction: 'top', className: 'place-name-label' });
          l.on('click', function (e) { L.DomEvent.stopPropagation(e); post({ type: 'community', suggestion: { id: s.id, kind: s.kind, name: s.name, notes: s.notes, geometry: s.geometry } }); });
        }
      }).addTo(communityLayer);
    });
  }).catch(function () { communityLoaded = false; });
}

// ---------------- City transport (/api/transport), refreshed like the website ----------------
var transportLayer = L.featureGroup(), transportTimer = null;
function loadTransport() {
  fetch('/api/transport').then(function (r) { return r.json(); }).then(function (d) {
    transportLayer.clearLayers();
    (d.routes || []).forEach(function (r) { L.geoJSON(r.geometry, { pane: 'transportPane', style: { color: '#7b4fd6', weight: 4, opacity: .85 } }).addTo(transportLayer); });
    (d.stops || []).forEach(function (s) { L.circleMarker([s.latitude, s.longitude], { pane: 'transportPane', radius: 5, color: '#fff', weight: 2, fillColor: '#7b4fd6', fillOpacity: 1 }).bindTooltip(s.name).addTo(transportLayer); });
    var vehicles = {}; (d.vehicles || []).forEach(function (v) { vehicles[v.id] = v; });
    (d.positions || []).forEach(function (p) { var v = vehicles[p.vehicle_id];
      L.circleMarker([p.latitude, p.longitude], { pane: 'transportPane', radius: 8, color: '#fff', weight: 3, fillColor: '#e8aa49', fillOpacity: 1 }).bindTooltip(v ? v.label : 'Vehicle').addTo(transportLayer); });
    post({ type: 'transport', routes: (d.routes || []).length, stops: (d.stops || []).length, vehicles: (d.positions || []).length });
  }).catch(function () {});
}

// ---------------- Districts (website districts.geojson + colours + opacity) ----------------
var districtLayer = L.featureGroup(), districtData = null, selectedDistrict = null;
var ALIASES = { cabdulasis: 'Abdiaziz', bondhere: 'Bondhere', daynile: 'Daynile', dharkenley: 'Dharkenley', hamarjabjab: 'Hamar Jajab',
  hamarweyne: 'Hamar Weyne', hawlwadaag: 'Howl Wadaag', heliwa: 'Heliwaa', hodan: 'Hodan', kahda: 'Kaxda', karaan: 'Kaaraan',
  shangaani: 'Shangaani', shibis: 'Shibis', waaberi: 'Waaberi', wadajirmedina: 'Wadajir', wardhigley: 'Warta Nabada', yaaqshid: 'Yaaqshiid' };
function districtName(f) { var raw = String(f.properties.adm2_name || f.properties._atlasName || ''); return ALIASES[raw.toLowerCase().replace(/[^a-z]/g, '')] || raw; }
function loadDistricts() {
  if (districtData) return Promise.resolve(districtData);
  return fetch('/data/districts.geojson').then(function (r) { return r.json(); }).then(function (d) { districtData = d; return d; }).catch(function () { return null; });
}
function drawDistricts() {
  districtLayer.clearLayers();
  if (!districtData) return;
  districtData.features.forEach(function (f) {
    var name = districtName(f), color = CFG.districtColors[name] || '#9cae83', sel = selectedDistrict === name;
    var layer = L.geoJSON(f, { pane: 'districtPane', style: { color: color, weight: sel ? 3 : 1.3, fillColor: color, fillOpacity: state.districtOpacity / 100, dashArray: sel ? null : '5 4' } });
    layer.on('click', function (e) { if (drawMode) return; L.DomEvent.stopPropagation(e); selectedDistrict = name; drawDistricts(); post({ type: 'district', name: name }); });
    districtLayer.addLayer(layer);
    districtLayer.addLayer(L.marker(layer.getBounds().getCenter(), { pane: 'districtPane', interactive: false, icon: L.divIcon({ className: 'district-label', html: name, iconSize: [170, 15], iconAnchor: [85, 7] }) }));
  });
}

// ---------------- Dynamic overlays from the app ----------------
var routeLayer = L.featureGroup().addTo(map), altLayer = L.featureGroup().addTo(map), alertLayer = L.featureGroup(), markerLayer = L.featureGroup().addTo(map), userLayer = L.featureGroup().addTo(map), drawLayer = L.featureGroup().addTo(map);
var routeBounds = null, follow = false, followZoom = 17, userMarker = null, userHalo = null, lastUser = null, lastAlerts = [];
var ALERT_STYLE = { road_closure: ['#d23b3b', '<div class="bar"></div>'], flooding: ['#2b7bd6', '≈'], traffic: ['#e8862a', '≡'], hazard: ['#e8aa49', '!'], building: ['#2f7d5b', '⌂'], buildingGone: ['#7a7a7a', '×'] };
function setAlerts(alerts) {
  lastAlerts = alerts; alertLayer.clearLayers();
  alerts.forEach(function (a) {
    var s = a.topic === 'building' && !a.stance ? ALERT_STYLE.buildingGone : (ALERT_STYLE[a.topic] || ALERT_STYLE.hazard), suspected = a.status !== 'confirmed';
    L.circle([a.latitude, a.longitude], { pane: 'alertPane', radius: a.radius_m, color: s[0], weight: 1, fillOpacity: suspected ? .06 : .14, dashArray: suspected ? '4 4' : null, interactive: false }).addTo(alertLayer);
    var m = L.marker([a.latitude, a.longitude], { pane: 'alertPane', icon: L.divIcon({ className: '', html: '<div class="alert' + (suspected ? ' suspected' : '') + '" style="background:' + s[0] + '">' + s[1] + '</div>', iconSize: [28, 28], iconAnchor: [14, 14] }) });
    m.on('click', function (e) { L.DomEvent.stopPropagation(e); post({ type: 'alert', id: a.id }); });
    m.addTo(alertLayer);
  });
}
function setRoute(msg) {
  routeLayer.clearLayers(); altLayer.clearLayers(); routeBounds = null;
  (msg.alternatives || []).forEach(function (coords, i) {
    var ll = coords.map(function (c) { return [c[1], c[0]]; });
    L.polyline(ll, { pane: 'altPane', color: '#ffffff', weight: 9, opacity: .9 }).addTo(altLayer);
    var line = L.polyline(ll, { pane: 'altPane', color: '#9db5e8', weight: 6 }).addTo(altLayer);
    line.on('click', function (e) { L.DomEvent.stopPropagation(e); post({ type: 'alternative', index: i }); });
  });
  if (!msg.coords) return;
  var ll = msg.coords.map(function (c) { return [c[1], c[0]]; });
  L.polyline(ll, { pane: 'routePane', color: '#fff', weight: 10, opacity: .95, interactive: false }).addTo(routeLayer);
  var main = L.polyline(ll, { pane: 'routePane', color: '#2f6fe8', weight: 6, interactive: false }).addTo(routeLayer);
  // Last metres from the road access point to the building entrance.
  if (msg.walkTo) L.polyline([ll[ll.length - 1], [msg.walkTo[1], msg.walkTo[0]]], { pane: 'routePane', color: '#2f6fe8', weight: 4, dashArray: '2 8', lineCap: 'round', interactive: false }).addTo(routeLayer);
  routeBounds = main.getBounds();
  (msg.alternatives || []).forEach(function (coords) { coords.forEach(function (c) { routeBounds.extend([c[1], c[0]]); }); });
  if (msg.fit) fitRoute();
}
function fitRoute() { if (routeBounds) map.fitBounds(routeBounds, { paddingTopLeft: [40, state.padTop], paddingBottomRight: [40, state.padBottom], maxZoom: 17 }); }
function setMarkers(markers) {
  markerLayer.clearLayers();
  markers.forEach(function (m) {
    var start = m.kind === 'start', html = start ? '<div class="start"></div>' : m.kind === 'access' ? '<div class="access"></div>' : '<div class="pin"><div></div></div>';
    L.marker([m.lat, m.lng], { pane: 'markerPane2', interactive: false, icon: L.divIcon({ className: '', html: html, iconSize: start || m.kind === 'access' ? [16, 16] : [30, 40], iconAnchor: start || m.kind === 'access' ? [8, 8] : [15, 38] }) }).addTo(markerLayer);
  });
}
function setUser(u) {
  lastUser = u;
  if (!u) { userLayer.clearLayers(); userMarker = userHalo = null; return; }
  var ll = [u.lat, u.lng], cone = u.heading != null && u.heading >= 0 ? '<div class="cone" style="transform:rotate(' + u.heading + 'deg)"></div>' : '';
  var icon = L.divIcon({ className: '', html: '<div class="user">' + cone + '<div class="dot"></div></div>', iconSize: [44, 44], iconAnchor: [22, 22] });
  if (!userMarker) {
    userHalo = L.circle(ll, { pane: 'userPane', radius: Math.min(u.accuracy || 20, 200), color: '#2f6fe8', weight: 0, fillOpacity: .12, interactive: false }).addTo(userLayer);
    userMarker = L.marker(ll, { pane: 'userPane', icon: icon, interactive: false }).addTo(userLayer);
  } else { userMarker.setLatLng(ll); userMarker.setIcon(icon); userHalo.setLatLng(ll); userHalo.setRadius(Math.min(u.accuracy || 20, 200)); }
  if (follow) followUser(true);
}
function followUser(animate) {
  if (!lastUser) return;
  var target = map.project([lastUser.lat, lastUser.lng], followZoom).add([0, (state.padBottom - state.padTop) / 2]);
  map.setView(map.unproject(target, followZoom), followZoom, { animate: !!animate, duration: .6 });
}

// ---------------- Drawing (suggestions: street line, building outline, point) ----------------
var drawMode = null, drawPoints = [];
function refreshDrawing() {
  drawLayer.clearLayers();
  drawPoints.forEach(function (p) { L.circleMarker(p, { pane: 'drawPane', radius: 5, color: '#fff', weight: 2, fillColor: '#e8aa49', fillOpacity: 1 }).addTo(drawLayer); });
  if (drawPoints.length > 1) (drawMode === 'Polygon' ? L.polygon(drawPoints, { pane: 'drawPane', color: '#e8aa49', weight: 3, fillOpacity: .2 }) : L.polyline(drawPoints, { pane: 'drawPane', color: '#e8aa49', weight: 3 })).addTo(drawLayer);
  post({ type: 'drawPoints', count: drawPoints.length });
}
function finishDrawing() {
  var pts = drawPoints.map(function (ll) { return [+ll.lng.toFixed(7), +ll.lat.toFixed(7)]; }), geometry = null;
  if (drawMode === 'Point' && pts.length) geometry = { type: 'Point', coordinates: pts[0] };
  if (drawMode === 'LineString' && pts.length >= 2) geometry = { type: 'LineString', coordinates: pts };
  if (drawMode === 'Polygon' && pts.length >= 3) geometry = { type: 'Polygon', coordinates: [pts.concat([pts[0]])] };
  post({ type: 'drawn', geometry: geometry });
  if (geometry) { drawMode = null; drawPoints = []; }
}

// ---------------- Layer configuration ----------------
function toggle(layer, on) { if (on) { if (!map.hasLayer(layer)) layer.addTo(map); } else if (map.hasLayer(layer)) map.removeLayer(layer); }
function applyConfig(cfg) {
  var redraw = cfg.basemap !== state.basemap || cfg.debug !== state.debug, opacity = cfg.districtOpacity !== state.districtOpacity;
  for (var k in cfg) state[k] = cfg[k];
  toggle(state.basemap === 'satellite' ? street : satellite, false); toggle(state.basemap === 'satellite' ? satellite : street, true);
  toggle(roadLayer, state.roads); toggle(buildingLayer, state.buildings);
  if (redraw) { roadLayer.redraw(); buildingLayer.redraw(); }
  toggle(placeLayer, state.places); drawPlaces();
  toggle(communityLayer, state.community); if (state.community) loadCommunity();
  toggle(transportLayer, state.transport); clearInterval(transportTimer);
  if (state.transport) { loadTransport(); transportTimer = setInterval(loadTransport, 15000); }
  toggle(alertLayer, state.alerts);
  if (state.districts) loadDistricts().then(function () { drawDistricts(); toggle(districtLayer, true); }); else toggle(districtLayer, false);
  if (opacity && state.districts) drawDistricts();
  document.getElementById('debug').style.display = state.debug ? 'block' : 'none';
}

function handle(msg) {
  switch (msg.type) {
    case 'config': applyConfig(msg.config); break;
    case 'padding': state.padBottom = msg.bottom; state.padTop = msg.top; break;
    case 'alerts': setAlerts(msg.alerts); break;
    case 'route': setRoute(msg); break;
    case 'fitRoute': fitRoute(); break;
    case 'markers': setMarkers(msg.markers); break;
    case 'user': setUser(msg.user); break;
    case 'follow': follow = msg.on; if (msg.zoom) followZoom = msg.zoom; if (follow) followUser(true); break;
    case 'flyTo': map.flyTo([msg.lat, msg.lng], msg.zoom || 17, { duration: .8 }); break;
    case 'fitBounds': map.fitBounds([[BOUNDS.south, BOUNDS.west], [BOUNDS.north, BOUNDS.east]], { padding: [20, 20] }); break;
    case 'access': accessFor(msg); break;
    case 'refresh': communityLoaded = false; if (state.community) loadCommunity(); if (state.transport) loadTransport(); roadLayer.redraw(); buildingLayer.redraw(); break;
    case 'draw': drawMode = msg.mode; drawPoints = []; refreshDrawing(); map.getContainer().style.cursor = drawMode ? 'crosshair' : ''; if (drawMode) map.doubleClickZoom.disable(); else map.doubleClickZoom.enable(); break;
    case 'drawUndo': drawPoints.pop(); refreshDrawing(); break;
    case 'drawFinish': finishDrawing(); break;
    case 'fitDistrict':
      loadDistricts().then(function (d) {
        if (!d) return; var f = d.features.filter(function (x) { return districtName(x) === msg.name; })[0];
        selectedDistrict = msg.name; drawDistricts();
        if (f) map.fitBounds(L.geoJSON(f).getBounds(), { paddingTopLeft: [30, state.padTop], paddingBottomRight: [30, state.padBottom] });
      });
      break;
  }
}
window.magaaloReceive = function (raw) { try { handle(JSON.parse(raw)); } catch (e) { post({ type: 'error', message: String(e) }); } };
document.addEventListener('message', function (e) { window.magaaloReceive(e.data); });
window.addEventListener('message', function (e) { window.magaaloReceive(e.data); });

var userGesture = false;
map.on('dragstart', function () { userGesture = true; if (follow) { follow = false; post({ type: 'unfollow' }); } });
map.on('moveend', function () {
  var c = map.getCenter(); drawPlaces();
  post({ type: 'center', lat: c.lat, lng: c.lng, zoom: map.getZoom(), user: userGesture }); userGesture = false;
  if (state.debug) document.getElementById('debug').textContent = c.lat.toFixed(5) + ', ' + c.lng.toFixed(5) + ' · z' + map.getZoom();
});
map.on('click', function (e) {
  var lat = e.latlng.lat, lng = e.latlng.lng;
  if (!inside(lng, lat)) { post({ type: 'outside' }); return; }
  if (drawMode) { drawPoints.push(e.latlng); refreshDrawing(); if (drawMode === 'Point') finishDrawing(); return; }
  var f = (state.buildings ? tileFeatureAt(buildingLayer, e.latlng) : null) || (state.roads ? tileFeatureAt(roadLayer, e.latlng) : null);
  if (f) post({ type: 'feature', feature: f, lat: lat, lng: lng });
  else post({ type: 'press', lat: lat, lng: lng });
});
map.on('contextmenu', function (e) { if (!drawMode) post({ type: 'longpress', lat: e.latlng.lat, lng: e.latlng.lng }); });
satellite.on('tileerror', (function () { var n = 0; return function () { if (++n === 6) post({ type: 'status', message: 'satellite-failed' }); }; })());
loadAtlas().then(drawPlaces).catch(function () {});
post({ type: 'ready' });
`;

const PAGE_CSS = `
html,body,#map{margin:0;padding:0;height:100%;width:100%;background:#1d2a26;-webkit-tap-highlight-color:transparent}
.leaflet-control-attribution{font-size:9px;background:rgba(255,255,255,.75)!important}
.leaflet-bottom.leaflet-left{margin-bottom:var(--bottom,0)}
.place-name-label{background:rgba(255,255,255,.92);border:0;border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,.25);font:600 11px -apple-system,Roboto,sans-serif;color:#183b38;padding:2px 6px}
.place-name-label:before{display:none}
.district-label{font:700 11px -apple-system,Roboto,sans-serif;color:#fff;text-align:center;letter-spacing:.06em;text-transform:uppercase;text-shadow:0 0 3px #000,0 0 2px #000;white-space:nowrap}
.alert{width:28px;height:28px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);color:#fff;font:700 16px sans-serif;display:flex;align-items:center;justify-content:center;box-sizing:border-box}
.alert.suspected{opacity:.7;border-style:dashed}
.alert .bar{width:12px;height:3px;background:#fff;border-radius:2px}
.user{position:relative;width:44px;height:44px}
.user .dot{position:absolute;left:13px;top:13px;width:18px;height:18px;border-radius:50%;background:#2f6fe8;border:3px solid #fff;box-sizing:border-box;box-shadow:0 1px 5px rgba(0,0,0,.35)}
.user .cone{position:absolute;left:0;top:0;width:44px;height:44px;background:conic-gradient(from -30deg at 50% 50%,rgba(47,111,232,.35) 0deg,rgba(47,111,232,.35) 60deg,transparent 60deg);border-radius:50%}
.start{width:16px;height:16px;border-radius:50%;background:#fff;border:5px solid #2f6fe8;box-sizing:border-box;box-shadow:0 1px 4px rgba(0,0,0,.3)}
.access{width:16px;height:16px;border-radius:4px;background:#2f6fe8;border:3px solid #fff;box-sizing:border-box;box-shadow:0 1px 4px rgba(0,0,0,.3)}
.pin{width:30px;height:30px;border-radius:50% 50% 50% 0;background:#d23b3b;transform:rotate(-45deg);box-shadow:0 2px 6px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center}
.pin div{width:10px;height:10px;border-radius:50%;background:#fff}
#debug{display:none;position:absolute;left:8px;top:50%;z-index:1000;background:rgba(0,0,0,.6);color:#fff;font:11px monospace;padding:4px 6px;border-radius:4px}
`;

export function buildMapHtml() {
  const config = { center: CITY_CENTER, bounds: BOUNDS, districtColors: Object.fromEntries(DISTRICTS) };
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>${LEAFLET_CSS}${PAGE_CSS}</style></head>
<body><div id="map"></div><div id="debug"></div>
<script>${LEAFLET_JS}</script>
<script>window.MAGAALO=${JSON.stringify(config)};</script>
<script>${PAGE_SCRIPT}</script></body></html>`;
}

/** The WebView document lives on the website's origin so '/data' and '/api' resolve to the Atlas website. */
export const MAP_BASE_URL = `${ATLAS_WEBSITE}/`;
