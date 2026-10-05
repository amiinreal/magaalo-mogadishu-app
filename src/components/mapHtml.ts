import { CITY_CENTER, DISTRICTS, MAP_STORAGE } from '../config';
import { LEAFLET_CSS, LEAFLET_JS } from '../vendor/leaflet';

// Runs inside the WebView. Kept as plain ES5-ish JS (no template literals) so it can live in String.raw.
const PAGE_SCRIPT = String.raw`
var post = function (msg) { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(msg)); };
var CFG = window.MAGAALO;
var state = { basemap: 'street', districts: false, buildings: true, roadNames: true, reports: true, debug: false, padBottom: 260, padTop: 120 };
var map = L.map('map', { zoomControl: false, attributionControl: true, maxBounds: [[1.80, 45.00], [2.36, 45.62]], minZoom: 11, maxZoom: 19 })
  .setView([CFG.center.lat, CFG.center.lng], 13);
map.attributionControl.setPrefix('');
['roads', 'buildings', 'districts', 'alternatives', 'route', 'alerts', 'markers', 'user', 'transport'].forEach(function (name, i) {
  map.createPane(name); map.getPane(name).style.zIndex = 400 + i * 10;
});

// Keyless light base (land/water); roads, buildings and names come from the Atlas vector tiles on top.
var street = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19, maxNativeZoom: 16, attribution: 'Roads & buildings © OpenStreetMap contributors · Base © Esri' });
var satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19, attribution: 'Imagery © Esri' });

// ---- Atlas vector tiles (same tiles as the Magaalo Atlas website) ----
var tileCache = {}, tileOrder = [];
function sourceCoords(c, group) {
  var z = group === 'buildings' ? (c.z <= 15 ? 15 : 16) : (c.z <= 13 ? 12 : c.z <= 15 ? 14 : 16);
  var scale = Math.pow(2, c.z - z);
  if (scale < 1) return null;
  return { z: z, x: Math.floor(c.x / scale), y: Math.floor(c.y / scale), scale: scale, dx: (c.x % scale) * 256, dy: (c.y % scale) * 256 };
}
function loadTile(group, src) {
  var key = group + '/' + src.z + '/' + src.x + '/' + src.y;
  if (!tileCache[key]) {
    tileCache[key] = fetch(CFG.storage + '/tiles/' + key + '.json').then(function (r) {
      return r.ok ? r.json() : { e: 4096, f: [] };
    }).catch(function () { delete tileCache[key]; return { e: 4096, f: [] }; });
    tileOrder.push(key);
    if (tileOrder.length > 160) delete tileCache[tileOrder.shift()];
  }
  return tileCache[key];
}
function rings(type, c) { return type === 'LineString' ? [c] : type === 'MultiLineString' || type === 'Polygon' ? c : type === 'MultiPolygon' ? [].concat.apply([], c) : []; }
var MAJOR = { motorway: 1, trunk: 1, primary: 1, secondary: 1, tertiary: 1 };

function VectorLayer(group) {
  var layer = L.GridLayer.extend({
    createTile: function (coords, done) {
      var canvas = document.createElement('canvas'), ratio = window.devicePixelRatio || 1;
      canvas.width = 256 * ratio; canvas.height = 256 * ratio;
      var src = sourceCoords(coords, group);
      if (!src || (group === 'buildings' && coords.z < 15) || (group === 'roads' && coords.z < 12)) { setTimeout(function () { done(null, canvas); }); return canvas; }
      loadTile(group, src).then(function (data) {
        var ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio);
        draw(ctx, data, src, group, coords.z);
        if (state.debug) { ctx.strokeStyle = 'rgba(210,59,59,.6)'; ctx.strokeRect(0, 0, 256, 256); ctx.fillStyle = '#d23b3b'; ctx.font = '10px sans-serif'; ctx.fillText(group + ' ' + coords.z + '/' + coords.x + '/' + coords.y, 4, 12); }
        done(null, canvas);
      });
      return canvas;
    }
  });
  return new layer({ pane: group, maxZoom: 19, updateWhenZooming: false, keepBuffer: 2 });
}

function draw(ctx, data, src, group, zoom) {
  var scale = 256 / data.e * src.scale;
  var xy = function (p) { return [p[0] * scale - src.dx, p[1] * scale - src.dy]; };
  var sat = state.basemap === 'satellite', labels = [];
  if (group === 'roads') {
    // two passes: casing then fill
    [0, 1].forEach(function (pass) {
      data.f.forEach(function (f) {
        var major = MAJOR[f[3].highway], paths = rings(f[1], f[2]);
        ctx.beginPath();
        paths.forEach(function (line) { line.forEach(function (v, i) { var p = xy(v); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }); });
        var w = (major ? 5 : 3) * Math.max(0.6, (zoom - 11) / 4);
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        if (pass === 0) { ctx.strokeStyle = sat ? 'rgba(0,0,0,.35)' : '#d9dfdc'; ctx.lineWidth = w + 2; }
        else { ctx.strokeStyle = sat ? (major ? 'rgba(255,214,140,.95)' : 'rgba(255,240,210,.75)') : (major ? '#fff6e0' : '#ffffff'); ctx.lineWidth = w; }
        ctx.stroke();
        if (pass === 1 && zoom >= 15 && state.roadNames) labels.push([f, paths]);
      });
    });
    var seen = {};
    labels.forEach(function (item) {
      var p = item[0][3], name = p['name:en'] || p['name:so'] || p.name;
      if (!name) return;
      name = String(name).replace(/[؀-ۿ]+/g, '').replace(/[\s\/]+$/, '').trim() || String(p.name);
      if (seen[name]) return;
      var best = null, length = 0;
      item[1].forEach(function (line) { for (var i = 1; i < line.length; i++) { var a = xy(line[i - 1]), b = xy(line[i]), len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len > length) { length = len; best = [a, b]; } } });
      ctx.font = '600 10px -apple-system, Roboto, sans-serif';
      if (!best || length < ctx.measureText(name).width + 8) return;
      seen[name] = 1;
      var a = best[0], b = best[1], angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
      if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
      ctx.save(); ctx.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); ctx.rotate(angle);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3; ctx.strokeStyle = sat ? 'rgba(0,0,0,.7)' : 'rgba(255,255,255,.95)'; ctx.strokeText(name, 0, 0);
      ctx.fillStyle = sat ? '#fff' : '#5b6b67'; ctx.fillText(name, 0, 0); ctx.restore();
    });
  } else {
    data.f.forEach(function (f) {
      ctx.beginPath();
      rings(f[1], f[2]).forEach(function (line) { line.forEach(function (v, i) { var p = xy(v); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }); ctx.closePath(); });
      ctx.fillStyle = sat ? 'rgba(239,194,119,.18)' : '#e9e6df'; ctx.fill('evenodd');
      ctx.strokeStyle = sat ? 'rgba(250,208,144,.8)' : '#d8d3c8'; ctx.lineWidth = 0.7; ctx.stroke();
    });
  }
}

var roads = VectorLayer('roads'), buildings = VectorLayer('buildings');

// Hit-testing a tap against loaded building/road tiles lets people suggest changes to a specific building.
function pointInRing(pt, ring) {
  var inside = false;
  for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function featureAt(latlng) {
  var z = map.getZoom();
  var groups = [];
  if (state.buildings && z >= 15) groups.push('buildings');
  if (z >= 14) groups.push('roads');
  var tries = groups.map(function (group) {
    // Both groups have their most detailed tiles at z16.
    var p = map.project(latlng, 16), tx = Math.floor(p.x / 256), ty = Math.floor(p.y / 256);
    return loadTile(group, { z: 16, x: tx, y: ty }).then(function (data) {
      var local = [(p.x - tx * 256) * data.e / 256, (p.y - ty * 256) * data.e / 256], best = null, bestD = (group === 'roads' ? 14 : 0) * data.e / 256;
      data.f.forEach(function (f) {
        var paths = rings(f[1], f[2]);
        if (group === 'buildings') { if (paths.length && pointInRing(local, paths[0])) best = f; return; }
        paths.forEach(function (line) { for (var i = 1; i < line.length; i++) {
          var a = line[i - 1], b = line[i], dx = b[0] - a[0], dy = b[1] - a[1];
          var t = Math.max(0, Math.min(1, ((local[0] - a[0]) * dx + (local[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
          var d = Math.hypot(local[0] - a[0] - t * dx, local[1] - a[1] - t * dy);
          if (d < bestD) { bestD = d; best = f; }
        } });
      });
      return best ? { group: group, f: best } : null;
    });
  });
  return Promise.all(tries).then(function (r) { return r[0] || r[1] || null; });
}

// ---- Districts ----
var districtLayer = L.featureGroup(), districtData = null;
var ALIASES = { cabdulasis: 'Abdiaziz', bondhere: 'Bondhere', daynile: 'Daynile', dharkenley: 'Dharkenley', hamarjabjab: 'Hamar Jajab',
  hamarweyne: 'Hamar Weyne', hawlwadaag: 'Howl Wadaag', heliwa: 'Heliwaa', hodan: 'Hodan', kahda: 'Kaxda', karaan: 'Kaaraan',
  shangaani: 'Shangaani', shibis: 'Shibis', waaberi: 'Waaberi', wadajirmedina: 'Wadajir', wardhigley: 'Warta Nabada', yaaqshid: 'Yaaqshiid' };
function districtName(f) { var raw = String(f.properties.adm2_name || ''); return ALIASES[raw.toLowerCase().replace(/[^a-z]/g, '')] || raw; }
function loadDistricts() {
  if (districtData) return Promise.resolve(districtData);
  return fetch(CFG.storage + '/districts.geojson').then(function (r) { return r.json(); }).then(function (data) {
    districtData = data;
    data.features.forEach(function (f) {
      var name = districtName(f), color = CFG.districtColors[name] || '#9cae83';
      var layer = L.geoJSON(f, { pane: 'districts', style: { color: color, weight: 1.4, fillColor: color, fillOpacity: 0.16, dashArray: '5 4' } });
      layer.on('click', function (e) { L.DomEvent.stopPropagation(e); post({ type: 'district', name: name }); });
      districtLayer.addLayer(layer);
      districtLayer.addLayer(L.marker([f.properties.center_lat, f.properties.center_lon], { pane: 'districts', interactive: false,
        icon: L.divIcon({ className: 'district-label', html: name, iconSize: [140, 14], iconAnchor: [70, 7] }) }));
    });
    return data;
  }).catch(function () { return null; });
}

// ---- Dynamic layers ----
var routeLayer = L.featureGroup(), altLayer = L.featureGroup(), alertLayer = L.featureGroup(), markerLayer = L.featureGroup(), userLayer = L.featureGroup(), transportLayer = L.featureGroup();
[routeLayer, altLayer, alertLayer, markerLayer, userLayer, transportLayer].forEach(function (l) { l.addTo(map); });
var routeBounds = null, follow = false, followZoom = 17, userMarker = null, userHalo = null, lastUser = null;

var ALERT_STYLE = {
  road_closure: { color: '#d23b3b', glyph: '<div class="bar"></div>' },
  flooding: { color: '#2b7bd6', glyph: '≈' },
  traffic: { color: '#e8862a', glyph: '≡' },
  hazard: { color: '#e8aa49', glyph: '!' },
  building: { color: '#2f7d5b', glyph: '⌂' },
  buildingGone: { color: '#7a7a7a', glyph: '×' }
};

function setAlerts(alerts) {
  alertLayer.clearLayers();
  if (!state.reports) return;
  alerts.forEach(function (a) {
    var style = a.topic === 'building' && !a.stance ? ALERT_STYLE.buildingGone : (ALERT_STYLE[a.topic] || ALERT_STYLE.hazard);
    var suspected = a.status !== 'confirmed';
    L.circle([a.latitude, a.longitude], { pane: 'alerts', radius: a.radius_m, color: style.color, weight: 1, fillOpacity: suspected ? 0.06 : 0.14, dashArray: suspected ? '4 4' : null, interactive: false }).addTo(alertLayer);
    var html = '<div class="alert' + (suspected ? ' suspected' : '') + '" style="background:' + style.color + '">' + style.glyph + '</div>';
    var m = L.marker([a.latitude, a.longitude], { pane: 'alerts', icon: L.divIcon({ className: '', html: html, iconSize: [28, 28], iconAnchor: [14, 14] }) });
    m.on('click', function (e) { L.DomEvent.stopPropagation(e); post({ type: 'alert', id: a.id }); });
    m.addTo(alertLayer);
  });
}

function setRoute(msg) {
  routeLayer.clearLayers(); altLayer.clearLayers(); routeBounds = null;
  (msg.alternatives || []).forEach(function (coords, i) {
    var latlngs = coords.map(function (c) { return [c[1], c[0]]; });
    L.polyline(latlngs, { pane: 'alternatives', color: '#ffffff', weight: 9, opacity: 0.9 }).addTo(altLayer);
    var line = L.polyline(latlngs, { pane: 'alternatives', color: '#9db5e8', weight: 6 }).addTo(altLayer);
    line.on('click', function (e) { L.DomEvent.stopPropagation(e); post({ type: 'alternative', index: i }); });
  });
  if (!msg.coords) return;
  var latlngs = msg.coords.map(function (c) { return [c[1], c[0]]; });
  L.polyline(latlngs, { pane: 'route', color: '#ffffff', weight: 10, opacity: 0.95, interactive: false }).addTo(routeLayer);
  var main = L.polyline(latlngs, { pane: 'route', color: '#2f6fe8', weight: 6, interactive: false }).addTo(routeLayer);
  routeBounds = main.getBounds();
  (msg.alternatives || []).forEach(function (coords) { coords.forEach(function (c) { routeBounds.extend([c[1], c[0]]); }); });
  if (msg.fit) fitRoute();
}
function fitRoute() { if (routeBounds) map.fitBounds(routeBounds, { paddingTopLeft: [40, state.padTop], paddingBottomRight: [40, state.padBottom], maxZoom: 17 }); }

function setMarkers(markers) {
  markerLayer.clearLayers();
  markers.forEach(function (m) {
    var html = m.kind === 'start' ? '<div class="start"></div>' : '<div class="pin"><div></div></div>';
    L.marker([m.lat, m.lng], { pane: 'markers', interactive: false, icon: L.divIcon({ className: '', html: html, iconSize: m.kind === 'start' ? [18, 18] : [30, 40], iconAnchor: m.kind === 'start' ? [9, 9] : [15, 38] }) }).addTo(markerLayer);
  });
}

function setUser(u) {
  lastUser = u;
  if (!u) { userLayer.clearLayers(); userMarker = userHalo = null; return; }
  var ll = [u.lat, u.lng];
  var rotate = u.heading != null && u.heading >= 0 ? '<div class="cone" style="transform:rotate(' + u.heading + 'deg)"></div>' : '';
  var icon = L.divIcon({ className: '', html: '<div class="user">' + rotate + '<div class="dot"></div></div>', iconSize: [44, 44], iconAnchor: [22, 22] });
  if (!userMarker) {
    userHalo = L.circle(ll, { pane: 'user', radius: Math.min(u.accuracy || 20, 200), color: '#2f6fe8', weight: 0, fillOpacity: 0.12, interactive: false }).addTo(userLayer);
    userMarker = L.marker(ll, { pane: 'user', icon: icon, interactive: false }).addTo(userLayer);
  } else { userMarker.setLatLng(ll); userMarker.setIcon(icon); userHalo.setLatLng(ll); userHalo.setRadius(Math.min(u.accuracy || 20, 200)); }
  if (follow) followUser(true);
}
function followUser(animate) {
  if (!lastUser) return;
  // Keep the user dot in the lower third so the road ahead is visible above the bottom card.
  var z = followZoom, target = map.project([lastUser.lat, lastUser.lng], z).add([0, (state.padBottom - state.padTop) / 2]);
  map.setView(map.unproject(target, z), z, { animate: !!animate, duration: 0.6 });
}

function setTransport(routes) {
  transportLayer.clearLayers();
  routes.forEach(function (r) {
    L.geoJSON(r.geometry, { pane: 'transport', style: { color: '#7b4fd6', weight: 4, opacity: 0.8 } }).addTo(transportLayer);
    (r.stops || []).forEach(function (s) { L.circleMarker([s.latitude, s.longitude], { pane: 'transport', radius: 5, color: '#fff', weight: 2, fillColor: '#7b4fd6', fillOpacity: 1 }).bindTooltip(s.name).addTo(transportLayer); });
  });
}

function applyConfig(cfg) {
  var changedBase = cfg.basemap !== state.basemap, changedDebug = cfg.debug !== state.debug, changedNames = cfg.roadNames !== state.roadNames;
  for (var k in cfg) state[k] = cfg[k];
  var base = state.basemap === 'satellite' ? satellite : street, other = base === satellite ? street : satellite;
  if (map.hasLayer(other)) map.removeLayer(other);
  if (!map.hasLayer(base)) base.addTo(map);
  if (!map.hasLayer(roads)) roads.addTo(map);
  if (state.buildings) { if (!map.hasLayer(buildings)) buildings.addTo(map); } else if (map.hasLayer(buildings)) map.removeLayer(buildings);
  if (changedBase || changedDebug || changedNames) { roads.redraw(); buildings.redraw(); }
  if (state.districts) loadDistricts().then(function () { districtLayer.addTo(map); }); else map.removeLayer(districtLayer);
  document.getElementById('debug').style.display = state.debug ? 'block' : 'none';
}

function handle(msg) {
  switch (msg.type) {
    case 'config': applyConfig(msg.config); break;
    case 'padding': state.padBottom = msg.bottom; state.padTop = msg.top; break;
    case 'alerts': lastAlerts = msg.alerts; setAlerts(msg.alerts); break;
    case 'route': setRoute(msg); break;
    case 'fitRoute': fitRoute(); break;
    case 'markers': setMarkers(msg.markers); break;
    case 'user': setUser(msg.user); break;
    case 'follow': follow = msg.on; if (msg.zoom) followZoom = msg.zoom; if (follow) followUser(true); break;
    case 'flyTo': map.flyTo([msg.lat, msg.lng], msg.zoom || 16, { duration: 0.8 }); break;
    case 'transport': setTransport(msg.routes); break;
    case 'fitDistrict':
      loadDistricts().then(function (data) {
        if (!data) return;
        var f = data.features.filter(function (x) { return districtName(x) === msg.name; })[0];
        if (f) map.fitBounds(L.geoJSON(f).getBounds(), { paddingTopLeft: [30, state.padTop], paddingBottomRight: [30, state.padBottom] });
      });
      break;
  }
}
var lastAlerts = [];
window.magaaloReceive = function (raw) { try { handle(JSON.parse(raw)); } catch (e) { post({ type: 'error', message: String(e) }); } };
document.addEventListener('message', function (e) { window.magaaloReceive(e.data); });
window.addEventListener('message', function (e) { window.magaaloReceive(e.data); });

var userGesture = false;
map.on('dragstart', function () { userGesture = true; if (follow) { follow = false; post({ type: 'unfollow' }); } });
map.on('moveend', function () {
  var c = map.getCenter();
  post({ type: 'center', lat: c.lat, lng: c.lng, zoom: map.getZoom(), user: userGesture });
  userGesture = false;
  if (state.debug) document.getElementById('debug').textContent = c.lat.toFixed(5) + ', ' + c.lng.toFixed(5) + ' · z' + map.getZoom();
});
map.on('click', function (e) {
  featureAt(e.latlng).then(function (hit) {
    if (!hit) { post({ type: 'press', lat: e.latlng.lat, lng: e.latlng.lng }); return; }
    var p = hit.f[3] || {};
    post({ type: 'feature', group: hit.group, id: hit.f[0], name: p['name:en'] || p['name:so'] || p.name || '', props: p, lat: e.latlng.lat, lng: e.latlng.lng });
  });
});
map.on('contextmenu', function (e) { post({ type: 'longpress', lat: e.latlng.lat, lng: e.latlng.lng }); });
post({ type: 'ready' });
`;

const PAGE_CSS = `
html,body,#map{margin:0;padding:0;height:100%;width:100%;background:#eef1ed;-webkit-tap-highlight-color:transparent}
.leaflet-control-attribution{font-size:9px;background:rgba(255,255,255,.7)!important;margin-bottom:var(--attr-bottom,0)}
.district-label{font:700 11px -apple-system,Roboto,sans-serif;color:#41524e;text-align:center;letter-spacing:.06em;text-transform:uppercase;text-shadow:0 0 3px #fff,0 0 3px #fff;white-space:nowrap}
.alert{width:28px;height:28px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);color:#fff;font:700 16px sans-serif;display:flex;align-items:center;justify-content:center;box-sizing:border-box}
.alert.suspected{opacity:.7;border-style:dashed}
.alert .bar{width:12px;height:3px;background:#fff;border-radius:2px}
.user{position:relative;width:44px;height:44px}
.user .dot{position:absolute;left:13px;top:13px;width:18px;height:18px;border-radius:50%;background:#2f6fe8;border:3px solid #fff;box-sizing:border-box;box-shadow:0 1px 5px rgba(0,0,0,.35)}
.user .cone{position:absolute;left:0;top:0;width:44px;height:44px;background:conic-gradient(from -30deg at 50% 50%,rgba(47,111,232,.35) 0deg,rgba(47,111,232,.35) 60deg,transparent 60deg);border-radius:50%}
.start{width:18px;height:18px;border-radius:50%;background:#fff;border:5px solid #2f6fe8;box-sizing:border-box;box-shadow:0 1px 4px rgba(0,0,0,.3)}
.pin{width:30px;height:30px;border-radius:50% 50% 50% 0;background:#d23b3b;transform:rotate(-45deg);box-shadow:0 2px 6px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center}
.pin div{width:10px;height:10px;border-radius:50%;background:#fff}
#debug{display:none;position:absolute;left:8px;top:50%;z-index:1000;background:rgba(0,0,0,.6);color:#fff;font:11px monospace;padding:4px 6px;border-radius:4px}
`;

export function buildMapHtml() {
  const config = {
    center: CITY_CENTER,
    storage: MAP_STORAGE,
    districtColors: Object.fromEntries(DISTRICTS),
  };
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>${LEAFLET_CSS}${PAGE_CSS}</style></head>
<body><div id="map"></div><div id="debug"></div>
<script>${LEAFLET_JS}</script>
<script>window.MAGAALO=${JSON.stringify(config)};</script>
<script>${PAGE_SCRIPT}</script></body></html>`;
}
