/* global L */
// Runs inside the WebView. Keep it ES2017 and dependency-free (besides Leaflet):
// it is inlined into the HTML by scripts/build-map-html.mjs.
(function () {
  'use strict';

  function post(type, payload) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, payload: payload }));
    }
  }

  window.onerror = function (msg, src, line) {
    post('log', { level: 'error', message: String(msg) + ' @' + line });
  };

  // ---------------------------------------------------------------------------
  // Base layers. Yandex tiles use EPSG:3395 (ellipsoidal Mercator); everything
  // else uses EPSG:3857. Switching between them changes the map CRS in place.
  // ---------------------------------------------------------------------------
  var YA_SAT = 'https://core-sat.maps.yandex.net/tiles?l=sat&x={x}&y={y}&z={z}&scale=1&lang=ru_RU';
  var YA_SKL = 'https://core-renderer-tiles.maps.yandex.net/tiles?l=skl&x={x}&y={y}&z={z}&scale=1&lang=ru_RU';
  var YA_MAP = 'https://core-renderer-tiles.maps.yandex.net/tiles?l=map&x={x}&y={y}&z={z}&scale=1&lang=ru_RU';
  var YA_ATTR = '© Яндекс';

  var BASE_LAYERS = {
    'yandex-sat': { crs: L.CRS.EPSG3395, maxZoom: 19, tiles: [[YA_SAT, YA_ATTR]] },
    'yandex-hybrid': { crs: L.CRS.EPSG3395, maxZoom: 19, tiles: [[YA_SAT, YA_ATTR], [YA_SKL, '']] },
    'yandex-map': { crs: L.CRS.EPSG3395, maxZoom: 19, tiles: [[YA_MAP, YA_ATTR]] },
    'esri-sat': {
      crs: L.CRS.EPSG3857,
      maxZoom: 19,
      tiles: [['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', '© Esri']],
    },
    osm: {
      crs: L.CRS.EPSG3857,
      maxZoom: 19,
      tiles: [['https://tile.openstreetmap.org/{z}/{x}/{y}.png', '© OpenStreetMap']],
    },
    topo: {
      crs: L.CRS.EPSG3857,
      maxZoom: 17,
      tiles: [['https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', '© OpenTopoMap, © OpenStreetMap']],
    },
  };

  var map = L.map('map', {
    crs: L.CRS.EPSG3395,
    zoomControl: false,
    attributionControl: true,
    maxZoom: 21,
    tapHold: false,
  }).setView([55.751, 37.618], 10);
  map.attributionControl.setPrefix(false);
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

  var baseGroup = L.layerGroup().addTo(map);
  var currentBase = null;

  function setBaseLayer(id) {
    var def = BASE_LAYERS[id] || BASE_LAYERS['yandex-sat'];
    if (currentBase === id) return;
    currentBase = id;
    baseGroup.clearLayers();
    if (map.options.crs !== def.crs) {
      var center = map.getCenter();
      var zoom = map.getZoom();
      map.options.crs = def.crs;
      // Forces every layer to re-project on 'viewreset'.
      map.setView(center, zoom, { reset: true });
    }
    def.tiles.forEach(function (t) {
      L.tileLayer(t[0], {
        attribution: t[1],
        maxNativeZoom: def.maxZoom,
        maxZoom: 21,
        subdomains: 'abc',
        crossOrigin: false,
      }).addTo(baseGroup);
    });
  }

  // ---------------------------------------------------------------------------
  // Own position
  // ---------------------------------------------------------------------------
  var selfLayer = L.layerGroup().addTo(map);
  var selfMarker = null;
  var selfAccuracy = null;
  var follow = false;

  function selfIcon(heading) {
    var cone =
      heading == null
        ? ''
        : '<div class="self-cone" style="transform: rotate(' + heading + 'deg)"></div>';
    return L.divIcon({
      className: 'self-icon',
      html: cone + '<div class="self-pulse"></div><div class="self-dot"></div>',
      iconSize: [80, 80],
      iconAnchor: [40, 40],
    });
  }

  function setSelf(p) {
    if (!p) {
      selfLayer.clearLayers();
      selfMarker = selfAccuracy = null;
      return;
    }
    var ll = [p.lat, p.lng];
    if (!selfMarker) {
      selfAccuracy = L.circle(ll, {
        radius: p.accuracy || 0,
        interactive: false,
        color: '#38BDF8',
        weight: 1,
        opacity: 0.5,
        fillOpacity: 0.08,
      }).addTo(selfLayer);
      selfMarker = L.marker(ll, { icon: selfIcon(p.heading), interactive: false, zIndexOffset: 1000 }).addTo(
        selfLayer
      );
    } else {
      selfMarker.setLatLng(ll);
      selfMarker.setIcon(selfIcon(p.heading));
      selfAccuracy.setLatLng(ll);
      selfAccuracy.setRadius(p.accuracy || 0);
    }
    if (follow) map.panTo(ll, { animate: true });
  }

  function centerOnSelf(zoom) {
    if (!selfMarker) return;
    map.setView(selfMarker.getLatLng(), Math.max(map.getZoom(), zoom || 16));
  }

  map.on('dragstart', function () {
    if (follow) {
      follow = false;
      post('followChanged', { follow: false });
    }
  });

  // ---------------------------------------------------------------------------
  // Team members and tactical markers: keyed by id, diffed on every update.
  // ---------------------------------------------------------------------------
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function syncKeyed(store, layer, items, build, update) {
    var seen = {};
    items.forEach(function (it) {
      seen[it.id] = true;
      var existing = store[it.id];
      if (existing) update(existing, it);
      else store[it.id] = build(it).addTo(layer);
    });
    Object.keys(store).forEach(function (id) {
      if (!seen[id]) {
        layer.removeLayer(store[id]);
        delete store[id];
      }
    });
  }

  var membersLayer = L.layerGroup().addTo(map);
  var memberMarkers = {};

  var NAV_PATH = 'M12,2L4.5,20.29L5.21,21L12,18L18.79,21L19.5,20.29L12,2Z';

  function memberIcon(m) {
    var c = escapeHtml(m.color);
    var body =
      m.heading == null
        ? '<div class="member-dot" style="background:' + c + '"></div>'
        : '<svg class="member-arrow" viewBox="0 0 24 24" style="transform: rotate(' + m.heading + 'deg)">' +
          '<path d="' + NAV_PATH + '" fill="' + c + '" stroke="#0B0F0C" stroke-width="1.2" stroke-linejoin="round"/></svg>';
    return L.divIcon({
      className: 'member-icon' + (m.stale ? ' stale' : ''),
      html:
        (m.stale ? '' : '<div class="member-halo" style="background:' + c + '"></div>') +
        body +
        '<div class="chip"><span class="chip-dot" style="background:' + c + '"></span>' + escapeHtml(m.callsign) + '</div>',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
  }

  function setMembers(list) {
    syncKeyed(
      memberMarkers,
      membersLayer,
      list,
      function (m) {
        var mk = L.marker([m.lat, m.lng], { icon: memberIcon(m), zIndexOffset: 500 });
        mk.on('click', function () {
          post('memberTap', { id: mk._tacId });
        });
        mk._tacId = m.id;
        mk._tacKey = JSON.stringify([m.callsign, m.color, m.stale, m.heading]);
        return mk;
      },
      function (mk, m) {
        mk.setLatLng([m.lat, m.lng]);
        var key = JSON.stringify([m.callsign, m.color, m.stale, m.heading]);
        if (key !== mk._tacKey) {
          mk._tacKey = key;
          mk.setIcon(memberIcon(m));
        }
      }
    );
  }

  var markersLayer = L.layerGroup().addTo(map);
  var tacMarkers = {};

  function tacIcon(m) {
    var c = escapeHtml(m.color);
    var label = m.label ? '<div class="chip tac-chip">' + escapeHtml(m.label) + '</div>' : '';
    return L.divIcon({
      className: 'tac-icon',
      html:
        '<div class="tac-pin" style="border-color:' + c + ';box-shadow:0 0 0 4px ' + c + '33, 0 4px 14px rgba(0,0,0,.6)">' +
        '<svg viewBox="0 0 24 24"><path d="' + escapeHtml(m.path) + '" fill="' + c + '"/></svg></div>' +
        label,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });
  }

  function setMarkers(list) {
    syncKeyed(
      tacMarkers,
      markersLayer,
      list,
      function (m) {
        var mk = L.marker([m.lat, m.lng], { icon: tacIcon(m) });
        mk._tacId = m.id;
        mk._tacKey = JSON.stringify([m.path, m.color, m.label]);
        mk.on('click', function () {
          post('markerTap', { id: mk._tacId });
        });
        return mk;
      },
      function (mk, m) {
        mk.setLatLng([m.lat, m.lng]);
        var key = JSON.stringify([m.path, m.color, m.label]);
        if (key !== mk._tacKey) {
          mk._tacKey = key;
          mk.setIcon(tacIcon(m));
        }
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Imported maps: KML / KMZ (GroundOverlay + Placemarks), GPX, GeoJSON.
  // ---------------------------------------------------------------------------
  var overlays = {};

  // GroundOverlay with KML <rotation> support (counter-clockwise degrees).
  var RotatedImageOverlay = L.ImageOverlay.extend({
    _applyRotation: function () {
      var r = this.options.rotation;
      if (!r || !this._image) return;
      var img = this._image;
      var w = img.offsetWidth || parseFloat(img.style.width) || 0;
      var h = img.offsetHeight || parseFloat(img.style.height) || 0;
      img.style.transformOrigin = '0 0';
      img.style.transform +=
        ' translate(' + w / 2 + 'px,' + h / 2 + 'px) rotate(' + -r + 'deg) translate(' + -w / 2 + 'px,' + -h / 2 + 'px)';
    },
    _reset: function () {
      L.ImageOverlay.prototype._reset.call(this);
      this._applyRotation();
    },
    _animateZoom: function (e) {
      L.ImageOverlay.prototype._animateZoom.call(this, e);
      this._applyRotation();
    },
  });

  function kmlColor(s, fallback) {
    // KML colors are aabbggrr.
    if (!s) return fallback;
    s = s.trim();
    if (s.length !== 8) return fallback;
    var a = parseInt(s.substr(0, 2), 16) / 255;
    return { color: '#' + s.substr(6, 2) + s.substr(4, 2) + s.substr(2, 2), opacity: a };
  }

  function childText(el, name) {
    if (!el) return null;
    var n = el.getElementsByTagName(name)[0];
    return n ? n.textContent.trim() : null;
  }

  function directChildren(el, name) {
    var out = [];
    for (var i = 0; i < el.childNodes.length; i++) {
      var c = el.childNodes[i];
      if (c.nodeType === 1 && (c.localName === name || c.nodeName === name)) out.push(c);
    }
    return out;
  }

  function parseCoords(text) {
    if (!text) return [];
    return text
      .trim()
      .split(/\s+/)
      .map(function (t) {
        var p = t.split(',');
        return [parseFloat(p[1]), parseFloat(p[0])];
      })
      .filter(function (p) {
        return !isNaN(p[0]) && !isNaN(p[1]);
      });
  }

  function resolveAsset(assets, href) {
    if (!href) return null;
    if (/^(https?:|data:)/i.test(href)) return href;
    var clean = href.replace(/^\.\//, '');
    var candidates = [clean];
    try {
      candidates.push(decodeURIComponent(clean));
    } catch (e) {}
    for (var i = 0; i < candidates.length; i++) {
      if (assets[candidates[i]]) return assets[candidates[i]];
    }
    var base = clean.split('/').pop().toLowerCase();
    var keys = Object.keys(assets);
    for (var j = 0; j < keys.length; j++) {
      if (keys[j].split('/').pop().toLowerCase() === base) return assets[keys[j]];
    }
    return null;
  }

  function parseKml(text, assets) {
    var doc = new DOMParser().parseFromString(text, 'text/xml');
    var group = L.featureGroup();
    var styles = {};

    Array.prototype.forEach.call(doc.getElementsByTagName('Style'), function (st) {
      var id = st.getAttribute('id');
      if (!id) return;
      var line = st.getElementsByTagName('LineStyle')[0];
      var poly = st.getElementsByTagName('PolyStyle')[0];
      var icon = st.getElementsByTagName('IconStyle')[0];
      styles['#' + id] = {
        line: kmlColor(childText(line, 'color'), null),
        width: parseFloat(childText(line, 'width')) || null,
        poly: kmlColor(childText(poly, 'color'), null),
        fill: childText(poly, 'fill') !== '0',
        outline: childText(poly, 'outline') !== '0',
        icon: icon ? childText(icon, 'href') : null,
      };
    });
    Array.prototype.forEach.call(doc.getElementsByTagName('StyleMap'), function (sm) {
      var id = sm.getAttribute('id');
      var pairs = sm.getElementsByTagName('Pair');
      for (var i = 0; i < pairs.length; i++) {
        if (childText(pairs[i], 'key') === 'normal') {
          var url = childText(pairs[i], 'styleUrl');
          if (url && styles[url]) styles['#' + id] = styles[url];
        }
      }
    });

    function styleFor(pm) {
      var url = childText(pm, 'styleUrl');
      var st = (url && styles[url.replace(/^.*#/, '#')]) || {};
      var inline = pm.getElementsByTagName('Style')[0];
      if (inline) {
        var line = inline.getElementsByTagName('LineStyle')[0];
        var poly = inline.getElementsByTagName('PolyStyle')[0];
        st = {
          line: kmlColor(childText(line, 'color'), st.line),
          width: parseFloat(childText(line, 'width')) || st.width,
          poly: kmlColor(childText(poly, 'color'), st.poly),
          fill: poly ? childText(poly, 'fill') !== '0' : st.fill !== false,
          outline: poly ? childText(poly, 'outline') !== '0' : st.outline !== false,
        };
      }
      var line2 = st.line || { color: '#FFC83D', opacity: 1 };
      var poly2 = st.poly || { color: line2.color, opacity: 0.2 };
      return {
        color: line2.color,
        opacity: st.outline === false ? 0 : line2.opacity,
        weight: st.width || 2,
        fillColor: poly2.color,
        fillOpacity: st.fill === false ? 0 : poly2.opacity,
      };
    }

    function addGeometry(geom, pm, name) {
      var tag = geom.localName || geom.nodeName;
      var style = styleFor(pm);
      var layer = null;
      if (tag === 'Point') {
        var c = parseCoords(childText(geom, 'coordinates'))[0];
        if (!c) return;
        layer = L.marker(c, {
          icon: L.divIcon({
            className: 'kml-point',
            html: '<div class="kml-dot" style="background:' + escapeHtml(style.color) + '"></div>' +
              (name ? '<div class="chip kml-chip">' + escapeHtml(name) + '</div>' : ''),
            iconSize: [12, 12],
            iconAnchor: [6, 6],
          }),
          interactive: false,
        });
      } else if (tag === 'LineString' || tag === 'LinearRing') {
        layer = L.polyline(parseCoords(childText(geom, 'coordinates')), style);
      } else if (tag === 'Polygon') {
        var rings = [];
        var outer = geom.getElementsByTagName('outerBoundaryIs')[0];
        if (outer) rings.push(parseCoords(childText(outer, 'coordinates')));
        Array.prototype.forEach.call(geom.getElementsByTagName('innerBoundaryIs'), function (inner) {
          rings.push(parseCoords(childText(inner, 'coordinates')));
        });
        layer = L.polygon(rings, style);
      } else if (tag === 'MultiGeometry') {
        for (var i = 0; i < geom.childNodes.length; i++) {
          if (geom.childNodes[i].nodeType === 1) addGeometry(geom.childNodes[i], pm, name);
        }
        return;
      }
      if (layer) {
        layer.options.interactive = false;
        layer.addTo(group);
      }
    }

    var GEOM_TAGS = ['Point', 'LineString', 'LinearRing', 'Polygon', 'MultiGeometry'];
    Array.prototype.forEach.call(doc.getElementsByTagName('Placemark'), function (pm) {
      var name = childText(pm, 'name');
      for (var i = 0; i < pm.childNodes.length; i++) {
        var c = pm.childNodes[i];
        if (c.nodeType === 1 && GEOM_TAGS.indexOf(c.localName || c.nodeName) >= 0) addGeometry(c, pm, name);
      }
    });

    var images = [];
    Array.prototype.forEach.call(doc.getElementsByTagName('GroundOverlay'), function (go) {
      var icon = go.getElementsByTagName('Icon')[0];
      var src = resolveAsset(assets, childText(icon, 'href'));
      if (!src) {
        post('log', { level: 'warn', message: 'GroundOverlay image not found: ' + childText(icon, 'href') });
        return;
      }
      var opacity = kmlColor(childText(go, 'color'), { opacity: 1 }).opacity;
      var box = go.getElementsByTagName('LatLonBox')[0];
      var bounds;
      var rotation = 0;
      if (box) {
        bounds = L.latLngBounds(
          [parseFloat(childText(box, 'south')), parseFloat(childText(box, 'west'))],
          [parseFloat(childText(box, 'north')), parseFloat(childText(box, 'east'))]
        );
        rotation = parseFloat(childText(box, 'rotation')) || 0;
      } else {
        // gx:LatLonQuad — approximated by its bounding box.
        var quad = go.getElementsByTagName('gx:LatLonQuad')[0] || go.getElementsByTagName('LatLonQuad')[0];
        var pts = quad ? parseCoords(childText(quad, 'coordinates')) : [];
        if (pts.length < 3) return;
        bounds = L.latLngBounds(pts);
      }
      var drawOrder = parseInt(childText(go, 'drawOrder'), 10) || 0;
      images.push({ src: src, bounds: bounds, rotation: rotation, opacity: opacity, drawOrder: drawOrder });
    });
    images
      .sort(function (a, b) {
        return a.drawOrder - b.drawOrder;
      })
      .forEach(function (im) {
        new RotatedImageOverlay(im.src, im.bounds, {
          rotation: im.rotation,
          opacity: im.opacity,
          interactive: false,
        }).addTo(group);
      });

    return group;
  }

  function parseGpx(text) {
    var doc = new DOMParser().parseFromString(text, 'text/xml');
    var group = L.featureGroup();
    function pt(el) {
      return [parseFloat(el.getAttribute('lat')), parseFloat(el.getAttribute('lon'))];
    }
    Array.prototype.forEach.call(doc.getElementsByTagName('trkseg'), function (seg) {
      L.polyline(Array.prototype.map.call(seg.getElementsByTagName('trkpt'), pt), {
        color: '#FF8A3D',
        weight: 3,
        interactive: false,
      }).addTo(group);
    });
    Array.prototype.forEach.call(doc.getElementsByTagName('rte'), function (rte) {
      L.polyline(Array.prototype.map.call(rte.getElementsByTagName('rtept'), pt), {
        color: '#B79CFF',
        weight: 3,
        dashArray: '6 4',
        interactive: false,
      }).addTo(group);
    });
    Array.prototype.forEach.call(doc.getElementsByTagName('wpt'), function (w) {
      var name = childText(w, 'name');
      L.marker(pt(w), {
        interactive: false,
        icon: L.divIcon({
          className: 'kml-point',
          html: '<div class="kml-dot" style="background:#FFC83D"></div>' +
            (name ? '<div class="chip kml-chip">' + escapeHtml(name) + '</div>' : ''),
          iconSize: [12, 12],
          iconAnchor: [6, 6],
        }),
      }).addTo(group);
    });
    return group;
  }

  function addOverlay(o) {
    removeOverlay({ id: o.id });
    var layer;
    try {
      if (o.format === 'kml') layer = parseKml(o.data, o.assets || {});
      else if (o.format === 'gpx') layer = parseGpx(o.data);
      else if (o.format === 'geojson')
        layer = L.geoJSON(JSON.parse(o.data), {
          style: { color: '#FFC83D', weight: 2, fillOpacity: 0.12 },
          interactive: false,
        });
      else throw new Error('Unknown format ' + o.format);
    } catch (e) {
      post('overlayError', { id: o.id, message: String(e && e.message ? e.message : e) });
      return;
    }
    overlays[o.id] = layer;
    if (o.visible !== false) layer.addTo(map);
    layer.eachLayer(function (l) {
      if (l.bringToBack && l instanceof L.ImageOverlay) l.bringToBack();
    });
    var bounds = layer.getBounds && layer.getBounds();
    post('overlayLoaded', {
      id: o.id,
      bounds: bounds && bounds.isValid()
        ? [bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()]
        : null,
    });
    if (o.fit) fitOverlay({ id: o.id });
  }

  function removeOverlay(o) {
    var layer = overlays[o.id];
    if (layer) {
      map.removeLayer(layer);
      delete overlays[o.id];
    }
  }

  function setOverlayVisible(o) {
    var layer = overlays[o.id];
    if (!layer) return;
    if (o.visible) layer.addTo(map);
    else map.removeLayer(layer);
  }

  function fitOverlay(o) {
    var layer = overlays[o.id];
    if (!layer || !layer.getBounds) return;
    var b = layer.getBounds();
    if (b.isValid()) map.fitBounds(b, { padding: [24, 24] });
  }

  // ---------------------------------------------------------------------------
  // Long press → "add marker here". Implemented by hand because iOS WKWebView
  // does not emit contextmenu on long press.
  // ---------------------------------------------------------------------------
  var LONG_PRESS_MS = 550;
  var pressTimer = null;
  var pressStart = null;
  var lastTouch = 0;
  var container = map.getContainer();

  function cancelPress() {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
    pressStart = null;
  }

  container.addEventListener(
    'touchstart',
    function (e) {
      lastTouch = Date.now();
      cancelPress();
      if (e.touches.length !== 1) return;
      var t = e.touches[0];
      pressStart = { x: t.clientX, y: t.clientY };
      pressTimer = setTimeout(function () {
        var ll = map.mouseEventToLatLng({ clientX: pressStart.x, clientY: pressStart.y });
        cancelPress();
        post('longPress', { lat: ll.lat, lng: ll.lng });
      }, LONG_PRESS_MS);
    },
    { passive: true }
  );
  container.addEventListener(
    'touchmove',
    function (e) {
      if (!pressStart) return;
      var t = e.touches[0];
      if (Math.abs(t.clientX - pressStart.x) > 10 || Math.abs(t.clientY - pressStart.y) > 10) cancelPress();
    },
    { passive: true }
  );
  container.addEventListener('touchend', cancelPress, { passive: true });
  container.addEventListener('touchcancel', cancelPress, { passive: true });
  map.on('contextmenu', function (e) {
    // Desktop / web preview only; touch devices are handled above.
    if (Date.now() - lastTouch < 1500) return;
    post('longPress', { lat: e.latlng.lat, lng: e.latlng.lng });
  });

  map.on('moveend', function () {
    var c = map.getCenter();
    post('viewChanged', { lat: c.lat, lng: c.lng, zoom: map.getZoom() });
  });

  // ---------------------------------------------------------------------------
  // Bridge
  // ---------------------------------------------------------------------------
  var handlers = {
    setBaseLayer: function (p) {
      setBaseLayer(p.id);
    },
    setSelf: setSelf,
    setFollow: function (p) {
      follow = !!p.follow;
      if (follow) centerOnSelf();
    },
    centerOnSelf: function () {
      centerOnSelf();
    },
    setView: function (p) {
      map.setView([p.lat, p.lng], p.zoom || map.getZoom());
    },
    setMembers: setMembers,
    setMarkers: setMarkers,
    addOverlay: addOverlay,
    removeOverlay: removeOverlay,
    setOverlayVisible: setOverlayVisible,
    fitOverlay: fitOverlay,
  };

  window.__tacmap = function (msg) {
    var h = handlers[msg.type];
    if (!h) return post('log', { level: 'warn', message: 'unknown message ' + msg.type });
    try {
      h(msg.payload);
    } catch (e) {
      post('log', { level: 'error', message: msg.type + ': ' + (e && e.message ? e.message : e) });
    }
  };

  setBaseLayer('yandex-sat');
  post('ready', {});
})();
