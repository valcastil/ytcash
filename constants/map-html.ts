import { BitcoinColors } from '@/constants/theme';

/**
 * The map is a small Leaflet page rendered inside a WebView (native) or an
 * iframe (web). This keeps it key-free: no Google Maps API key is needed on
 * Android, and the same code runs on iOS, Android and web.
 *
 * Tiles default to OpenStreetMap, which is fine for development and light use.
 * For production traffic, point EXPO_PUBLIC_MAP_TILE_URL at a hosted provider
 * (MapTiler, Stadia, Mapbox, ...) and update MAP_ATTRIBUTION to match.
 */
export const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';
export const MAP_TILE_URL =
  process.env.EXPO_PUBLIC_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export const MAP_ATTRIBUTION =
  process.env.EXPO_PUBLIC_MAP_ATTRIBUTION || '&copy; OpenStreetMap contributors';

/** Opening view before anyone is on the map: the Philippines. */
const DEFAULT_CENTER = [12.5, 122.0];
const DEFAULT_ZOOM = 5;

export interface MapUser {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export type MapMessage =
  | { type: 'users'; users: MapUser[]; meId: string | null }
  | { type: 'fit' };

export function buildMapHtml(): string {
  const c = BitcoinColors;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
  integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="" />
<style>
  html, body, #map { height: 100%; margin: 0; background: ${c.darkBg}; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }

  /* Recolour the standard light tiles to sit inside the app's dark theme. */
  .leaflet-tile-pane { filter: invert(1) hue-rotate(185deg) brightness(0.92) contrast(0.88) saturate(0.55); }
  .leaflet-container { background: ${c.darkBg}; }
  .leaflet-control-attribution {
    background: rgba(11, 14, 20, 0.75) !important; color: ${c.textMuted} !important; font-size: 9px;
  }
  .leaflet-control-attribution a { color: ${c.textSecondary} !important; }
  .leaflet-bar a {
    background: ${c.cardBg}; color: #fff; border-bottom-color: ${c.border};
  }
  .leaflet-bar a:hover { background: ${c.cardElevated}; color: #fff; }
  .leaflet-bar a.leaflet-disabled { background: ${c.cardBg}; color: ${c.textMuted}; }
  .leaflet-bar { border: 1px solid ${c.border} !important; }

  .pin { position: relative; width: 26px; height: 26px; }
  .pin .pulse {
    position: absolute; inset: 0; border-radius: 50%;
    background: ${c.orange}; opacity: 0.35; animation: pulse 2.2s ease-out infinite;
  }
  .pin .dot {
    position: absolute; left: 6px; top: 6px; width: 14px; height: 14px; border-radius: 50%;
    background: ${c.orange}; border: 2px solid #fff; box-sizing: border-box;
    box-shadow: 0 0 10px rgba(247, 147, 26, 0.8);
  }
  .pin.me .pulse, .pin.me .dot { background: ${c.green}; }
  .pin.me .dot { box-shadow: 0 0 10px rgba(16, 185, 129, 0.8); }
  .pin .count {
    position: absolute; right: -8px; top: -8px; min-width: 18px; height: 18px; padding: 0 4px;
    border-radius: 9px; background: #fff; color: ${c.void};
    font-size: 11px; font-weight: 800; line-height: 18px; text-align: center; box-sizing: border-box;
  }
  @keyframes pulse { 0% { transform: scale(0.6); opacity: 0.5; } 100% { transform: scale(1.9); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .pin .pulse { animation: none; } }

  .leaflet-popup-content-wrapper, .leaflet-popup-tip {
    background: ${c.cardElevated}; color: #fff; border: 1px solid ${c.border};
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
  }
  .leaflet-popup-content { margin: 10px 14px; font-size: 13px; line-height: 1.5; }
  .leaflet-popup-content .title {
    font-size: 10px; font-weight: 800; letter-spacing: 0.8px; color: ${c.textSecondary};
    margin-bottom: 4px;
  }
  .leaflet-popup-content .name { font-weight: 700; }
  .leaflet-popup-content .you { color: ${c.green}; font-weight: 700; }
  .leaflet-container a.leaflet-popup-close-button { color: ${c.textSecondary}; }

  #fallback {
    display: none; position: absolute; inset: 0; align-items: center; justify-content: center;
    padding: 24px; text-align: center; color: ${c.textSecondary}; font-size: 14px; line-height: 1.5;
  }
</style>
</head>
<body>
<div id="map"></div>
<div id="fallback">The map could not load.<br />Check your internet connection and reopen this screen.</div>
<script>
(function () {
  var KEY = ${JSON.stringify(GOOGLE_MAPS_API_KEY)};
  var DEFAULT_CENTER = { lat: ${DEFAULT_CENTER[0]}, lng: ${DEFAULT_CENTER[1]} };
  var backend = null;
  var lastData = null;
  var fittedOnce = false;

  function send(msg) {
    var text = JSON.stringify(msg);
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(text);
    else if (window.parent && window.parent !== window) window.parent.postMessage(text, '*');
  }

  function loadScript(src, integrity, onload, onerror) {
    var s = document.createElement('script');
    s.src = src;
    if (integrity) { s.integrity = integrity; s.crossOrigin = ''; }
    s.onload = onload; s.onerror = onerror;
    document.head.appendChild(s);
  }

  function groupUsers(users) {
    var groups = {};
    (users || []).forEach(function (u) {
      if (typeof u.lat !== 'number' || typeof u.lng !== 'number') return;
      var key = u.lat + ',' + u.lng;
      (groups[key] = groups[key] || []).push(u);
    });
    return Object.keys(groups).map(function (k) { return groups[k]; });
  }

  // Names come from other users' devices, so they are only ever set as text.
  function popupFor(group, meId) {
    var root = document.createElement('div');
    var title = document.createElement('div');
    title.className = 'title';
    title.textContent = group.length === 1 ? 'ONLINE NOW' : group.length + ' ONLINE HERE';
    root.appendChild(title);
    group.slice(0, 8).forEach(function (u) {
      var row = document.createElement('div');
      row.className = 'name';
      row.textContent = u.name;
      if (u.id === meId) {
        var you = document.createElement('span');
        you.className = 'you';
        you.textContent = ' (you)';
        row.appendChild(you);
      }
      root.appendChild(row);
    });
    if (group.length > 8) {
      var more = document.createElement('div');
      more.textContent = '+' + (group.length - 8) + ' more';
      root.appendChild(more);
    }
    return root;
  }

  function render() {
    if (!backend || !lastData) return;
    backend.setUsers(lastData.users, lastData.meId);
  }

  // ── Google Maps ──
  function startGoogle() {
    var el = document.getElementById('map');
    var map = new google.maps.Map(el, {
      center: DEFAULT_CENTER, zoom: ${DEFAULT_ZOOM}, disableDefaultUI: true, zoomControl: true,
      gestureHandling: 'greedy', clickableIcons: false, maxZoom: 18,
      styles: [
        { elementType: 'geometry', stylers: [{ color: '#1a2233' }] },
        { elementType: 'labels.text.stroke', stylers: [{ color: '#0b0e14' }] },
        { elementType: 'labels.text.fill', stylers: [{ color: '#94a3b8' }] },
        { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2a3550' }] },
        { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0b1220' }] },
        { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', stylers: [{ visibility: 'off' }] }
      ]
    });
    var markers = [];
    var points = [];
    var infoWindow = new google.maps.InfoWindow();

    backend = {
      fit: function () {
        if (!points.length) { map.setCenter(DEFAULT_CENTER); map.setZoom(${DEFAULT_ZOOM}); return; }
        if (points.length === 1) { map.setCenter(points[0]); map.setZoom(16); return; }
        var b = new google.maps.LatLngBounds();
        points.forEach(function (pt) { b.extend(pt); });
        map.fitBounds(b, 48);
      },
      setUsers: function (users, meId) {
        markers.forEach(function (m) { m.setMap(null); });
        markers = [];
        points = [];
        var groups = groupUsers(users);
        groups.forEach(function (group) {
          var hasMe = group.some(function (u) { return u.id === meId; });
          var pos = { lat: group[0].lat, lng: group[0].lng };
          points.push(pos);
          var m = new google.maps.Marker({
            position: pos,
            map: map,
            zIndex: hasMe ? 10 : 5,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: hasMe ? 10 : 8,
              fillColor: hasMe ? ${JSON.stringify(c.green)} : ${JSON.stringify(c.orange)},
              fillOpacity: 1,
              strokeColor: '#ffffff',
              strokeWeight: 2.5
            },
            label: group.length > 1 ? { text: String(group.length), color: '#07090E', fontWeight: '800', fontSize: '11px' } : undefined
          });
          m.addListener('click', function () {
            infoWindow.setContent(popupFor(group, meId));
            infoWindow.open(map, m);
          });
          markers.push(m);
        });
        if (points.length && !fittedOnce) { fittedOnce = true; backend.fit(); }
      }
    };
    send({ type: 'ready', provider: 'google' });
    render();
  }

  // ── OpenStreetMap (Leaflet) fallback ──
  var leafletStarted = false;
  function startLeaflet() {
    if (leafletStarted) return;
    leafletStarted = true;
    backend = null;
    loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=', function () {
      var map = L.map('map', { zoomControl: true, attributionControl: true, worldCopyJump: true })
        .setView(${JSON.stringify(DEFAULT_CENTER)}, ${DEFAULT_ZOOM});
      L.tileLayer(${JSON.stringify(MAP_TILE_URL)}, {
        maxZoom: 18,
        minZoom: 2,
        attribution: ${JSON.stringify(MAP_ATTRIBUTION)}
      }).addTo(map);
      var layer = L.layerGroup().addTo(map);
      var bounds = null;

      backend = {
        fit: function () {
          if (!bounds) { map.setView(${JSON.stringify(DEFAULT_CENTER)}, ${DEFAULT_ZOOM}); return; }
          map.fitBounds(bounds.pad(0.3), { maxZoom: 16 });
        },
        setUsers: function (users, meId) {
          layer.clearLayers();
          bounds = null;
          var groups = groupUsers(users);
          groups.forEach(function (group) {
            var hasMe = group.some(function (u) { return u.id === meId; });
            var el = document.createElement('div');
            el.className = 'pin' + (hasMe ? ' me' : '');
            el.innerHTML = '<div class="pulse"></div><div class="dot"></div>';
            if (group.length > 1) {
              var count = document.createElement('div');
              count.className = 'count';
              count.textContent = String(group.length);
              el.appendChild(count);
            }
            var latlng = L.latLng(group[0].lat, group[0].lng);
            L.marker(latlng, {
              icon: L.divIcon({ html: el.outerHTML, className: '', iconSize: [26, 26], iconAnchor: [13, 13] })
            }).bindPopup(popupFor(group, meId), { closeButton: true, offset: [0, -6] }).addTo(layer);
            bounds = bounds ? bounds.extend(latlng) : L.latLngBounds(latlng, latlng);
          });
          if (bounds && !fittedOnce) { fittedOnce = true; backend.fit(); }
        }
      };
      send({ type: 'ready', provider: 'osm' });
      render();
    }, function () {
      document.getElementById('map').style.display = 'none';
      document.getElementById('fallback').style.display = 'flex';
      send({ type: 'error' });
    });
  }

  function handle(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'users') {
      lastData = { users: msg.users, meId: msg.meId };
      render();
    } else if (msg.type === 'fit' && backend) {
      backend.fit();
    }
  }

  window.YTMap = { handle: handle };
  window.addEventListener('message', function (event) {
    if (window.ReactNativeWebView || event.source !== window.parent) return;
    try { handle(typeof event.data === 'string' ? JSON.parse(event.data) : event.data); } catch (e) {}
  });

  if (KEY) {
    window.__ytGoogleReady = startGoogle;
    window.gm_authFailure = startLeaflet;
    loadScript('https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(KEY) + '&callback=__ytGoogleReady&v=weekly', null, null, startLeaflet);
  } else {
    startLeaflet();
  }
})();
</script>
</body>
</html>`;
}
