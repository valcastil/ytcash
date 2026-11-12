import { MAP_ATTRIBUTION, MAP_TILE_URL } from '@/constants/map-html';
import { BitcoinColors } from '@/constants/theme';

/**
 * Map of the receiver and nearby cash partners.
 *
 * Uses Google Maps when EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is set (Maps JavaScript
 * API). Without a key, or if Google rejects it, the same pins are drawn on the
 * OpenStreetMap map used elsewhere in the app, so the screen always works.
 *
 * The key ships inside the app, so restrict it in Google Cloud to the Maps
 * JavaScript API and to the referrer https://ytcash.local/* (the address this
 * page is loaded under in the app).
 */
export const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';

export interface MapPoint {
  lat: number;
  lng: number;
}

export interface MapPartner extends MapPoint {
  id: string;
  name: string;
}

export type PartnerMapMessage = {
  type: 'data';
  receiver: (MapPoint & { label: string }) | null;
  partners: MapPartner[];
  selectedId: string | null;
};

export function buildPartnerMapHtml(): string {
  const c = BitcoinColors;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>
  html, body, #map { height: 100%; margin: 0; background: ${c.darkBg}; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  .leaflet-tile-pane { filter: invert(1) hue-rotate(185deg) brightness(0.92) contrast(0.88) saturate(0.55); }
  .leaflet-container { background: ${c.darkBg}; }
  .leaflet-control-attribution { background: rgba(11,14,20,0.75) !important; color: ${c.textMuted} !important; font-size: 9px; }
  .leaflet-control-attribution a { color: ${c.textSecondary} !important; }
  .leaflet-bar a { background: ${c.cardBg}; color: #fff; border-bottom-color: ${c.border}; }
  .leaflet-bar { border: 1px solid ${c.border} !important; }
  .pin {
    width: 28px; height: 28px; border-radius: 50%; box-sizing: border-box;
    display: flex; align-items: center; justify-content: center;
    font-size: 13px; font-weight: 800; color: #fff;
    background: #475569; border: 2px solid #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.5);
  }
  .pin.selected { background: ${c.orange}; color: ${c.void}; transform: scale(1.2); }
  .pin.receiver { background: ${c.green}; color: ${c.void}; border-radius: 8px; }
  #fallback {
    display: none; position: absolute; inset: 0; align-items: center; justify-content: center;
    padding: 24px; text-align: center; color: ${c.textSecondary}; font-size: 14px; line-height: 1.5;
  }
</style>
</head>
<body>
<div id="map"></div>
<div id="fallback">The map could not load.<br />You can still choose a partner from the list.</div>
<script>
(function () {
  var KEY = ${JSON.stringify(GOOGLE_MAPS_API_KEY)};
  var DEFAULT_CENTER = { lat: 12.5, lng: 122.0 };
  var backend = null;
  var lastData = null;

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

  function render() {
    if (!backend || !lastData) return;
    backend.clear();
    var points = [];
    if (lastData.receiver) { backend.addReceiver(lastData.receiver); points.push(lastData.receiver); }
    (lastData.partners || []).forEach(function (p, i) {
      backend.addPartner(p, i + 1, p.id === lastData.selectedId);
      points.push(p);
    });
    backend.fit(points);
  }

  // ── Google Maps ──
  function startGoogle() {
    var el = document.getElementById('map');
    var map = new google.maps.Map(el, {
      center: DEFAULT_CENTER, zoom: 5, disableDefaultUI: true, zoomControl: true,
      gestureHandling: 'greedy', clickableIcons: false, maxZoom: 15,
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
    function symbol(color, scale) {
      return { path: google.maps.SymbolPath.CIRCLE, scale: scale, fillColor: color, fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 2 };
    }
    backend = {
      clear: function () { markers.forEach(function (m) { m.setMap(null); }); markers = []; },
      addReceiver: function (r) {
        markers.push(new google.maps.Marker({
          position: r, map: map, title: r.label, zIndex: 5,
          icon: symbol(${JSON.stringify(c.green)}, 12), label: { text: '★', color: ${JSON.stringify(c.void)}, fontWeight: '800', fontSize: '12px' }
        }));
      },
      addPartner: function (p, n, selected) {
        var m = new google.maps.Marker({
          position: p, map: map, title: p.name, zIndex: selected ? 10 : 6,
          icon: symbol(selected ? ${JSON.stringify(c.orange)} : '#475569', selected ? 15 : 12),
          label: { text: String(n), color: selected ? ${JSON.stringify(c.void)} : '#ffffff', fontWeight: '800', fontSize: '12px' }
        });
        m.addListener('click', function () { send({ type: 'select', id: p.id }); });
        markers.push(m);
      },
      fit: function (points) {
        if (!points.length) return;
        if (points.length === 1) { map.setCenter(points[0]); map.setZoom(13); return; }
        var b = new google.maps.LatLngBounds();
        points.forEach(function (pt) { b.extend(pt); });
        map.fitBounds(b, 48);
      }
    };
    send({ type: 'ready', provider: 'google' });
    render();
  }

  // ── OpenStreetMap (Leaflet) ──
  var leafletStarted = false;
  function startLeaflet() {
    if (leafletStarted) return;
    leafletStarted = true;
    backend = null;
    var css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    css.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY='; css.crossOrigin = '';
    document.head.appendChild(css);
    loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=', function () {
      var holder = document.getElementById('map');
      holder.innerHTML = ''; holder.className = '';
      var map = L.map(holder, { zoomControl: true, worldCopyJump: true }).setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], 5);
      L.tileLayer(${JSON.stringify(MAP_TILE_URL)}, { maxZoom: 15, minZoom: 2, attribution: ${JSON.stringify(MAP_ATTRIBUTION)} }).addTo(map);
      var layer = L.layerGroup().addTo(map);
      function icon(cls, text) {
        var el = document.createElement('div');
        el.className = 'pin ' + cls; el.textContent = text;
        return L.divIcon({ html: el.outerHTML, className: '', iconSize: [28, 28], iconAnchor: [14, 14] });
      }
      backend = {
        clear: function () { layer.clearLayers(); },
        addReceiver: function (r) { L.marker([r.lat, r.lng], { icon: icon('receiver', '★'), zIndexOffset: 500 }).addTo(layer); },
        addPartner: function (p, n, selected) {
          L.marker([p.lat, p.lng], { icon: icon(selected ? 'selected' : '', String(n)), zIndexOffset: selected ? 1000 : 600 })
            .on('click', function () { send({ type: 'select', id: p.id }); })
            .addTo(layer);
        },
        fit: function (points) {
          if (!points.length) return;
          if (points.length === 1) { map.setView([points[0].lat, points[0].lng], 13); return; }
          map.fitBounds(L.latLngBounds(points.map(function (pt) { return [pt.lat, pt.lng]; })).pad(0.25), { maxZoom: 14 });
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
    if (!msg || typeof msg !== 'object' || msg.type !== 'data') return;
    lastData = msg;
    render();
  }
  window.YTMap = { handle: handle };
  window.addEventListener('message', function (event) {
    if (window.ReactNativeWebView || event.source !== window.parent) return;
    try { handle(typeof event.data === 'string' ? JSON.parse(event.data) : event.data); } catch (e) {}
  });

  if (KEY) {
    window.__ytGoogleReady = startGoogle;
    // Google calls this when the key is missing, wrong or not allowed here.
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
