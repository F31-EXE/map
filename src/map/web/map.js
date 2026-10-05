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
    // Smooth zoom: pinch stops at any level instead of snapping to whole steps;
    // buttons and double tap still go half a level at a time.
    zoomSnap: 0,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 120,
  }).setView([55.751, 37.618], 10);
  map.attributionControl.setPrefix(false);
  // Exposed for automated layout tests.
  window.__tacmapMap = map;
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

  var baseGroup = L.layerGroup().addTo(map);
  var currentBase = null;

  // Offline areas downloaded by the app (see src/services/offlineMaps.ts): tiles live
  // as files next to this page. A tile inside an area loads from disk first and falls
  // back to the network if the file isn't there.
  var offline = { root: '', areas: [] };

  function tileExt(url) {
    return /\.png|l=skl|l=map/.test(url) ? 'png' : 'jpg';
  }

  var OfflineTileLayer = L.TileLayer.extend({
    _offlineSrc: function (coords) {
      if (!offline.root || !offline.areas.length) return null;
      var size = this.getTileSize();
      var center = this._map.unproject(coords.scaleBy(size).add(size.divideBy(2)), coords.z);
      for (var i = 0; i < offline.areas.length; i++) {
        var a = offline.areas[i];
        if (a.layer !== this.options.baseId || coords.z < a.minZoom || coords.z > a.maxZoom) continue;
        if (center.lat < a.south || center.lat > a.north || center.lng < a.west || center.lng > a.east) continue;
        return (
          offline.root + a.id + '/' + this.options.urlIndex + '/' + coords.z + '/' + coords.x + '/' + coords.y + '.' +
          tileExt(this._url)
        );
      }
      return null;
    },
    createTile: function (coords, done) {
      var tile = document.createElement('img');
      tile.alt = '';
      tile.setAttribute('role', 'presentation');
      var online = this.getTileUrl(coords);
      var local = this._offlineSrc(coords);
      tile.onload = function () {
        done(null, tile);
      };
      tile.onerror = function (e) {
        if (local && !tile._triedOnline) {
          tile._triedOnline = true;
          tile.src = online;
          return;
        }
        done(e, tile);
      };
      tile.src = local || online;
      return tile;
    },
  });

  function setBaseLayer(id) {
    var def = BASE_LAYERS[id] || BASE_LAYERS['yandex-sat'];
    if (currentBase === id) return;
    currentBase = id;
    drawBase(def, id);
  }

  function drawBase(def, id) {
    baseGroup.clearLayers();
    if (map.options.crs !== def.crs) {
      var center = map.getCenter();
      var zoom = map.getZoom();
      map.options.crs = def.crs;
      // Forces every layer to re-project on 'viewreset'.
      map.setView(center, zoom, { reset: true });
    }
    def.tiles.forEach(function (t, i) {
      new OfflineTileLayer(t[0], {
        attribution: t[1],
        maxNativeZoom: def.maxZoom,
        maxZoom: 21,
        subdomains: 'abc',
        crossOrigin: false,
        baseId: id,
        urlIndex: i,
      }).addTo(baseGroup);
    });
  }

  function setOffline(p) {
    offline = { root: (p && p.root) || '', areas: (p && p.areas) || [] };
    // Redraw so visible tiles pick up (or drop) the local copies.
    if (currentBase) drawBase(BASE_LAYERS[currentBase] || BASE_LAYERS['yandex-sat'], currentBase);
  }

  // ---------------------------------------------------------------------------
  // Own position
  // ---------------------------------------------------------------------------
  var selfLayer = L.layerGroup().addTo(map);
  var selfMarker = null;
  var selfAccuracy = null;
  var follow = false;

  // Rebuilt only when role or color changes; heading updates just rotate the cone so
  // the pulse animation isn't restarted and the marker doesn't flicker.
  function selfIcon(look) {
    var c = escapeHtml(look.color || '#8EF07A');
    return L.divIcon({
      className: 'self-icon',
      html:
        '<div class="self-cone"></div>' +
        '<div class="self-pulse" style="background:' + c + '"></div>' +
        '<div class="self-pin" style="background:' + c + '">' +
        (look.rolePath ? '<svg viewBox="4 4 16 16"><path d="' + escapeHtml(look.rolePath) + '" fill="#04100A"/></svg>' : '') +
        '</div>',
      iconSize: [80, 80],
      iconAnchor: [40, 40],
    });
  }
  var selfLook = null;
  var coneAngle = null;

  function setHeading(heading) {
    var el = selfMarker && selfMarker.getElement();
    var cone = el && el.querySelector('.self-cone');
    if (!cone) return;
    if (heading == null) {
      cone.style.display = 'none';
      return;
    }
    // Unwrap so 359° → 1° turns 2° forward instead of spinning all the way back.
    coneAngle = coneAngle == null ? heading : coneAngle + ((((heading - coneAngle) % 360) + 540) % 360) - 180;
    cone.style.display = '';
    cone.style.transform = 'rotate(' + coneAngle + 'deg)';
  }

  function setSelf(p) {
    if (!p) {
      selfLayer.clearLayers();
      selfMarker = selfAccuracy = null;
      selfLook = null;
      coneAngle = null;
      return;
    }
    var ll = [p.lat, p.lng];
    if (!selfMarker) {
      selfAccuracy = L.circle(ll, {
        radius: p.accuracy || 0,
        interactive: false,
        color: '#8EF07A',
        weight: 1,
        opacity: 0.5,
        fillOpacity: 0.08,
      }).addTo(selfLayer);
      selfLook = JSON.stringify([p.rolePath, p.color]);
      selfMarker = L.marker(ll, { icon: selfIcon(p), interactive: false, zIndexOffset: 1000 }).addTo(selfLayer);
    } else {
      var look = JSON.stringify([p.rolePath, p.color]);
      if (look !== selfLook) {
        selfLook = look;
        selfMarker.setIcon(selfIcon(p));
        coneAngle = null;
      }
      selfMarker.setLatLng(ll);
      selfAccuracy.setLatLng(ll);
      selfAccuracy.setRadius(p.accuracy || 0);
    }
    setHeading(p.heading);
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

  var STAR_PATH = 'M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z';
  var SKULL_PATH =
    'M12,2A9,9 0 0,0 3,11C3,14.03 4.53,16.82 7,18.47V22H9V19H11V22H13V19H15V22H17V18.46C19.47,16.81 21,14 21,11A9,9 0 0,0 12,2' +
    'M8,11A2,2 0 0,1 10,13A2,2 0 0,1 8,15A2,2 0 0,1 6,13A2,2 0 0,1 8,11M16,11A2,2 0 0,1 18,13A2,2 0 0,1 16,15A2,2 0 0,1 14,13' +
    'A2,2 0 0,1 16,11M12,14L13.5,17H10.5L12,14Z';
  var SLEEP_PATH =
    'M23,12H17V10L20.39,6H17V4H23V6L19.62,10H23V12M15,16H9V14L12.39,10H9V8H15V10L11.62,14H15V16M7,20H1V18L4.39,14H1V12H7V14' +
    'L3.62,18H7V20Z';

  // Teammate: team-colored disc with the role glyph, a heading tip outside the disc,
  // and a star badge for anyone allowed to issue orders.
  function memberIcon(m) {
    var c = escapeHtml(m.color);
    var status = m.status === 'dead' || m.status === 'afk' ? m.status : '';
    return L.divIcon({
      className: 'member-icon' + (m.stale ? ' stale' : '') + (status ? ' ' + status : ''),
      html:
        (m.stale || status ? '' : '<div class="member-halo" style="background:' + c + '"></div>') +
        '<div class="member-dir"><div class="member-dir-tip" style="border-bottom-color:' + c + '"></div></div>' +
        '<div class="member-pin" style="background:' + c + '">' +
        '<svg viewBox="4 4 16 16"><path d="' + escapeHtml(m.rolePath) + '" fill="#04100A"/></svg></div>' +
        (status
          ? '<div class="member-status"><svg viewBox="0 0 24 24"><path d="' +
            (status === 'dead' ? SKULL_PATH : SLEEP_PATH) + '" fill="#fff"/></svg></div>'
          : '') +
        (m.commander
          ? '<div class="member-badge"><svg viewBox="0 0 24 24"><path d="' + STAR_PATH + '" fill="#0B0F0C"/></svg></div>'
          : '') +
        '<div class="chip">' + escapeHtml(m.callsign) +
        (m.roleTitle ? '<span class="chip-role"> · ' + escapeHtml(m.roleTitle) + '</span>' : '') +
        '</div>',
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
  }

  // Heading changes often; rotate in place instead of rebuilding the icon.
  function applyMemberHeading(mk, heading) {
    var el = mk.getElement && mk.getElement();
    var dir = el && el.querySelector('.member-dir');
    if (!dir) return;
    if (heading == null) {
      dir.style.display = 'none';
      return;
    }
    dir.style.display = '';
    dir.style.transform = 'rotate(' + heading + 'deg)';
  }

  function memberKey(m) {
    return JSON.stringify([m.callsign, m.color, m.stale, m.rolePath, m.roleTitle, m.commander, m.status]);
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
        mk.on('add', function () {
          applyMemberHeading(mk, mk._heading);
        });
        mk._tacId = m.id;
        mk._tacKey = memberKey(m);
        mk._heading = m.heading;
        return mk;
      },
      function (mk, m) {
        mk.setLatLng([m.lat, m.lng]);
        var key = memberKey(m);
        if (key !== mk._tacKey) {
          mk._tacKey = key;
          mk.setIcon(memberIcon(m));
        }
        mk._heading = m.heading;
        applyMemberHeading(mk, m.heading);
      }
    );
  }

  // Respawn countdown on respawn markers (see src/lib/waves.ts for the same math).
  function waveText(every, start, now) {
    var at = now <= start ? start : start + Math.ceil((now - start) / every) * every;
    var s = Math.max(0, Math.ceil((at - now) / 1000));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = String(s % 60).padStart(2, '0');
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + sec;
  }
  setInterval(function () {
    var now = Date.now();
    var els = document.querySelectorAll('.wave-badge');
    for (var i = 0; i < els.length; i++) {
      var every = Number(els[i].getAttribute('data-every'));
      var start = Number(els[i].getAttribute('data-start'));
      els[i].textContent = waveText(every, start, now);
      var at = now <= start ? start : start + Math.ceil((now - start) / every) * every;
      els[i].classList.toggle('soon', at - now <= 60000);
    }
  }, 1000);

  var markersLayer = L.layerGroup().addTo(map);
  var tacMarkers = {};
  // Marker being moved by long press + drag (see the long-press section).
  var dragged = null;
  var suppressTapUntil = 0;

  function tacIcon(m) {
    var c = escapeHtml(m.color);
    // Label plus the time it was placed ("Пулемёт · 14:05"); time alone when unlabeled.
    var time = m.time ? '<span class="chip-role">' + (m.label ? ' · ' : '') + escapeHtml(m.time) + '</span>' : '';
    var label = m.label || m.time ? '<div class="chip tac-chip">' + escapeHtml(m.label || '') + time + '</div>' : '';
    return L.divIcon({
      className: 'tac-icon' + (m.order ? ' order' : '') + (m.admin ? ' admin' : '') + (m.personal ? ' personal' : '') + (m.movable ? ' movable' : ''),
      html:
        '<div class="tac-pin" style="--c:' + c + ';border-color:' + c + ';box-shadow:0 0 0 4px ' + c + '33, 0 4px 14px rgba(0,0,0,.6)">' +
        '<svg viewBox="0 0 24 24"><path d="' + escapeHtml(m.path) + '" fill="' + c + '"/></svg></div>' +
        (m.order ? '<div class="order-ring" style="border-color:' + c + '"></div>' : '') +
        (m.wave
          ? '<div class="wave-badge" data-every="' + Number(m.wave.every) + '" data-start="' + Number(m.wave.start) + '">' +
            waveText(m.wave.every, m.wave.start, Date.now()) + '</div>'
          : '') +
        label,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });
  }

  // ---------------------------------------------------------------------------
  // Arrows: drawn paths with a head at the last point.
  // ---------------------------------------------------------------------------
  var arrowsLayer = L.layerGroup().addTo(map);
  var arrowShapes = {};

  // Mercator is conformal, so the on-screen angle of the last segment doesn't change
  // with zoom: compute it once from projected points.
  function headAngle(points) {
    var a = map.project(points[points.length - 2], 18);
    var b = map.project(points[points.length - 1], 18);
    return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 90;
  }

  function buildArrow(m, opts) {
    var pts = m.points.map(function (p) { return [p.lat, p.lng]; });
    var g = L.featureGroup();
    var dashed = m.personal || (opts && opts.draft);
    L.polyline(pts, { color: '#0B0F0C', weight: 8, opacity: 0.55, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(g);
    L.polyline(pts, {
      color: m.color,
      weight: 4.5,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round',
      dashArray: dashed ? '10 8' : null,
      interactive: false,
    }).addTo(g);
    // A thin line is hard to hit with a finger: a wide invisible stroke takes the taps.
    if (!(opts && opts.draft)) {
      L.polyline(pts, { color: m.color, weight: 28, opacity: 0.001, lineCap: 'round', lineJoin: 'round' }).addTo(g);
    }
    if (pts.length >= 2) {
      L.marker(pts[pts.length - 1], {
        interactive: false,
        icon: L.divIcon({
          className: 'arrow-head',
          html:
            '<svg viewBox="0 0 24 24" style="transform: rotate(' + headAngle(pts) + 'deg)">' +
            '<path d="M12 2 L22 21 L12 16 L2 21 Z" fill="' + escapeHtml(m.color) + '" stroke="#0B0F0C" stroke-width="1.5" stroke-linejoin="round"/></svg>',
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
      }).addTo(g);
    } else {
      L.circleMarker(pts[0], { radius: 5, color: '#0B0F0C', weight: 2, fillColor: m.color, fillOpacity: 1, interactive: false }).addTo(g);
    }
    return g;
  }

  function setArrows(list) {
    var seen = {};
    list.forEach(function (m) {
      seen[m.id] = true;
      var key = JSON.stringify([m.points, m.color, m.personal]);
      var cur = arrowShapes[m.id];
      if (cur && cur._tacKey === key) return;
      if (cur) arrowsLayer.removeLayer(cur);
      var g = buildArrow(m);
      g._tacKey = key;
      g.on('click', function () {
        post('markerTap', { id: m.id });
      });
      arrowShapes[m.id] = g.addTo(arrowsLayer);
    });
    Object.keys(arrowShapes).forEach(function (id) {
      if (!seen[id]) {
        arrowsLayer.removeLayer(arrowShapes[id]);
        delete arrowShapes[id];
      }
    });
  }

  // Drawing: while on, taps add points to a draft arrow and are reported to RN.
  var drawing = null;
  var draftLayer = L.layerGroup().addTo(map);

  function renderDraft() {
    draftLayer.clearLayers();
    if (drawing && drawing.points.length) {
      buildArrow({ points: drawing.points, color: drawing.color }, { draft: true }).addTo(draftLayer);
    }
  }

  function setDraw(p) {
    drawing = p && p.on ? { color: p.color, points: p.points || [] } : null;
    map.getContainer().classList.toggle('drawing', !!drawing);
    renderDraft();
  }

  map.on('click', function (e) {
    if (!drawing) return;
    drawing.points.push({ lat: e.latlng.lat, lng: e.latlng.lng });
    renderDraft();
    post('drawChanged', { points: drawing.points });
  });

  // ---------------------------------------------------------------------------
  // Game analysis: recorded tracks and a time-weighted heatmap.
  // ---------------------------------------------------------------------------
  var analysisLayer = L.layerGroup().addTo(map);
  var analysisFitted = false;

  function setAnalysis(a) {
    analysisLayer.clearLayers();
    if (!a) {
      analysisFitted = false;
      return;
    }
    var bounds = L.latLngBounds([]);
    if (a.showHeat && a.heat && a.heat.length && L.heatLayer) {
      L.heatLayer(a.heat, {
        radius: 24,
        blur: 20,
        maxZoom: 17,
        minOpacity: 0.3,
        gradient: { 0.2: '#1e3a8a', 0.4: '#22d3ee', 0.6: '#a3e635', 0.8: '#facc15', 1: '#ef4444' },
      }).addTo(analysisLayer);
    }
    (a.tracks || []).forEach(function (t) {
      t.segments.forEach(function (seg) {
        if (seg.length < 2) return;
        if (a.showTracks) {
          L.polyline(seg, { color: '#0B0F0C', weight: 5, opacity: 0.5, interactive: false }).addTo(analysisLayer);
          L.polyline(seg, { color: t.color, weight: 2.5, opacity: 0.95, interactive: false }).addTo(analysisLayer);
        }
        seg.forEach(function (p) { bounds.extend(p); });
      });
    });
    (a.heat || []).forEach(function (p) { bounds.extend(p); });
    if (!analysisFitted && bounds.isValid()) {
      analysisFitted = true;
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
    }
  }

  function setMarkers(all) {
    setArrows(all.filter(function (m) { return m.points; }));
    var list = all.filter(function (m) { return !m.points; });
    syncKeyed(
      tacMarkers,
      markersLayer,
      list,
      function (m) {
        var mk = L.marker([m.lat, m.lng], { icon: tacIcon(m) });
        mk._tacId = m.id;
        mk._tacKey = JSON.stringify([m.path, m.color, m.label, m.order, m.personal, m.time, m.movable, m.wave]);
        mk.on('click', function () {
          // The release after dragging a marker is not a tap.
          if (Date.now() < suppressTapUntil) return;
          post('markerTap', { id: mk._tacId });
        });
        mk.on('add', function () {
          mk.getElement()._tacMarker = mk;
        });
        return mk;
      },
      function (mk, m) {
        if (mk !== dragged) mk.setLatLng([m.lat, m.lng]);
        var key = JSON.stringify([m.path, m.color, m.label, m.order, m.personal, m.time, m.movable, m.wave]);
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

  // Long press on one of your own markers picks it up instead: it follows the finger
  // until release, then RN saves the new position.
  function movableAt(target) {
    var el = target && target.closest ? target.closest('.tac-icon.movable') : null;
    return el && el._tacMarker ? el._tacMarker : null;
  }

  function startDrag(mk) {
    dragged = mk;
    map.dragging.disable();
    var el = mk.getElement();
    if (el) el.classList.add('dragging');
    post('markerDragStart', { id: mk._tacId });
  }

  function moveDrag(x, y) {
    if (dragged) dragged.setLatLng(map.mouseEventToLatLng({ clientX: x, clientY: y }));
  }

  function endDrag() {
    if (!dragged) return;
    var mk = dragged;
    dragged = null;
    map.dragging.enable();
    var el = mk.getElement();
    if (el) el.classList.remove('dragging');
    suppressTapUntil = Date.now() + 500;
    var ll = mk.getLatLng();
    post('markerMoved', { id: mk._tacId, lat: ll.lat, lng: ll.lng });
  }

  container.addEventListener(
    'touchstart',
    function (e) {
      lastTouch = Date.now();
      cancelPress();
      if (e.touches.length !== 1) return;
      var t = e.touches[0];
      var mk = drawing ? null : movableAt(e.target);
      pressStart = { x: t.clientX, y: t.clientY };
      pressTimer = setTimeout(function () {
        var at = pressStart;
        cancelPress();
        if (drawing) return;
        if (mk) {
          startDrag(mk);
          moveDrag(at.x, at.y);
          return;
        }
        var ll = map.mouseEventToLatLng({ clientX: at.x, clientY: at.y });
        post('longPress', { lat: ll.lat, lng: ll.lng });
      }, LONG_PRESS_MS);
    },
    { passive: true }
  );
  container.addEventListener(
    'touchmove',
    function (e) {
      var t = e.touches[0];
      if (dragged) {
        moveDrag(t.clientX, t.clientY);
        return;
      }
      if (!pressStart) return;
      if (Math.abs(t.clientX - pressStart.x) > 10 || Math.abs(t.clientY - pressStart.y) > 10) cancelPress();
    },
    { passive: true }
  );
  container.addEventListener(
    'touchend',
    function () {
      cancelPress();
      endDrag();
    },
    { passive: true }
  );
  container.addEventListener(
    'touchcancel',
    function () {
      cancelPress();
      endDrag();
    },
    { passive: true }
  );

  // Same with a mouse (web version): hold the button on your marker, then drag.
  container.addEventListener('mousedown', function (e) {
    if (e.button !== 0 || Date.now() - lastTouch < 1500) return;
    var mk = drawing ? null : movableAt(e.target);
    if (!mk) return;
    cancelPress();
    pressStart = { x: e.clientX, y: e.clientY };
    pressTimer = setTimeout(function () {
      var at = pressStart;
      cancelPress();
      startDrag(mk);
      moveDrag(at.x, at.y);
    }, LONG_PRESS_MS);
  });
  document.addEventListener('mousemove', function (e) {
    if (dragged) return moveDrag(e.clientX, e.clientY);
    if (pressStart && (Math.abs(e.clientX - pressStart.x) > 6 || Math.abs(e.clientY - pressStart.y) > 6)) cancelPress();
  });
  document.addEventListener('mouseup', function () {
    if (Date.now() - lastTouch < 1500) return;
    cancelPress();
    endDrag();
  });
  map.on('contextmenu', function (e) {
    // Desktop / web preview only; touch devices are handled above.
    if (Date.now() - lastTouch < 1500) return;
    post('longPress', { lat: e.latlng.lat, lng: e.latlng.lng });
  });

  // Level of detail. Icons have a fixed pixel size, so zoomed out they would bury the
  // map: far away everything collapses to colored dots, closer in the glyphs come
  // back, and labels only show up close.
  var LOD_ICONS_FROM = 15; // ~1 km across a phone screen
  var LOD_LABELS_FROM = 16; // ~500 m
  function updateLod() {
    var z = map.getZoom();
    var c = map.getContainer();
    c.classList.toggle('lod-dot', z < LOD_ICONS_FROM);
    c.classList.toggle('lod-mid', z >= LOD_ICONS_FROM && z < LOD_LABELS_FROM);
  }
  map.on('zoomend', updateLod);
  updateLod();

  map.on('moveend', function () {
    var c = map.getCenter();
    var b = map.getBounds();
    post('viewChanged', {
      lat: c.lat,
      lng: c.lng,
      zoom: map.getZoom(),
      bounds: { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() },
    });
  });

  // ---------------------------------------------------------------------------
  // Bridge
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Coordinate grid: UTM kilometre-style squares, like a military map. Lines are
  // straight between computed corners, fine at the scale of a playing field.
  // ---------------------------------------------------------------------------
  var UTM_K0 = 0.9996;
  var UTM_A = 6378137;
  var UTM_E2 = 0.00669438;
  var UTM_EP2 = UTM_E2 / (1 - UTM_E2);

  function toUtm(lat, lng, zone) {
    var phi = (lat * Math.PI) / 180;
    var lam0 = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180;
    var lam = (lng * Math.PI) / 180;
    var n = UTM_A / Math.sqrt(1 - UTM_E2 * Math.sin(phi) * Math.sin(phi));
    var t = Math.tan(phi) * Math.tan(phi);
    var c = UTM_EP2 * Math.cos(phi) * Math.cos(phi);
    var a = Math.cos(phi) * (lam - lam0);
    var e4 = UTM_E2 * UTM_E2;
    var e6 = e4 * UTM_E2;
    var m =
      UTM_A *
      ((1 - UTM_E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi -
        ((3 * UTM_E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi) +
        ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi) -
        ((35 * e6) / 3072) * Math.sin(6 * phi));
    var x =
      UTM_K0 * n * (a + ((1 - t + c) * a * a * a) / 6 + ((5 - 18 * t + t * t + 72 * c - 58 * UTM_EP2) * Math.pow(a, 5)) / 120) +
      500000;
    var y =
      UTM_K0 *
      (m +
        n *
          Math.tan(phi) *
          ((a * a) / 2 +
            ((5 - t + 9 * c + 4 * c * c) * Math.pow(a, 4)) / 24 +
            ((61 - 58 * t + t * t + 600 * c - 330 * UTM_EP2) * Math.pow(a, 6)) / 720));
    if (lat < 0) y += 10000000;
    return { e: x, n: y };
  }

  function fromUtm(e, nn, zone, south) {
    var x = e - 500000;
    var y = south ? nn - 10000000 : nn;
    var m = y / UTM_K0;
    var e4 = UTM_E2 * UTM_E2;
    var e6 = e4 * UTM_E2;
    var mu = m / (UTM_A * (1 - UTM_E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256));
    var e1 = (1 - Math.sqrt(1 - UTM_E2)) / (1 + Math.sqrt(1 - UTM_E2));
    var phi1 =
      mu +
      ((3 * e1) / 2 - (27 * Math.pow(e1, 3)) / 32) * Math.sin(2 * mu) +
      ((21 * e1 * e1) / 16 - (55 * Math.pow(e1, 4)) / 32) * Math.sin(4 * mu) +
      ((151 * Math.pow(e1, 3)) / 96) * Math.sin(6 * mu);
    var n1 = UTM_A / Math.sqrt(1 - UTM_E2 * Math.sin(phi1) * Math.sin(phi1));
    var t1 = Math.tan(phi1) * Math.tan(phi1);
    var c1 = UTM_EP2 * Math.cos(phi1) * Math.cos(phi1);
    var r1 = (UTM_A * (1 - UTM_E2)) / Math.pow(1 - UTM_E2 * Math.sin(phi1) * Math.sin(phi1), 1.5);
    var d = x / (n1 * UTM_K0);
    var lat =
      phi1 -
      ((n1 * Math.tan(phi1)) / r1) *
        ((d * d) / 2 -
          ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * UTM_EP2) * Math.pow(d, 4)) / 24 +
          ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * UTM_EP2 - 3 * c1 * c1) * Math.pow(d, 6)) / 720);
    var lng =
      (d - ((1 + 2 * t1 + c1) * Math.pow(d, 3)) / 6 +
        ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * UTM_EP2 + 24 * t1 * t1) * Math.pow(d, 5)) / 120) /
      Math.cos(phi1);
    var lam0 = ((zone - 1) * 6 - 180 + 3);
    return [(lat * 180) / Math.PI, lam0 + (lng * 180) / Math.PI];
  }

  var gridLayer = L.layerGroup();
  var gridOn = false;
  // Screen area covered by native panels at the top; labels go just below it.
  var gridTopInset = 0;
  var gridBottomInset = 0;
  var GRID_STEPS = [100, 200, 500, 1000, 2000, 5000, 10000];

  function gridLabel(v, step) {
    // Last digits that change, like the numbers in a map's margin: 37 for 437000 at 1 km.
    var km = Math.floor(v / 1000);
    if (step >= 1000) return String(km % 100).padStart(2, '0');
    return String(km % 100).padStart(2, '0') + '.' + String(Math.round((v % 1000) / 100) % 10);
  }

  function drawGrid() {
    gridLayer.clearLayers();
    if (!gridOn) return;
    var b = map.getBounds();
    var c = map.getCenter();
    var zone = Math.floor((c.lng + 180) / 6) + 1;
    var south = c.lat < 0;
    var size = map.getSize();
    var metersPerPx = map.distance(map.containerPointToLatLng([0, size.y / 2]), map.containerPointToLatLng([size.x, size.y / 2])) / size.x;
    var step = GRID_STEPS[GRID_STEPS.length - 1];
    for (var i = 0; i < GRID_STEPS.length; i++) {
      if (GRID_STEPS[i] / metersPerPx >= 90) {
        step = GRID_STEPS[i];
        break;
      }
    }
    var corners = [b.getSouthWest(), b.getNorthWest(), b.getNorthEast(), b.getSouthEast()].map(function (p) {
      return toUtm(p.lat, p.lng, zone);
    });
    var minE = Math.min.apply(null, corners.map(function (p) { return p.e; }));
    var maxE = Math.max.apply(null, corners.map(function (p) { return p.e; }));
    var minN = Math.min.apply(null, corners.map(function (p) { return p.n; }));
    var maxN = Math.max.apply(null, corners.map(function (p) { return p.n; }));
    var style = { color: '#8EF07A', weight: 1, opacity: 0.55, interactive: false };
    var labelAt = function (ll, text, cls) {
      L.marker(ll, {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({ className: 'grid-label ' + cls, html: '<span>' + text + '</span>', iconSize: [0, 0] }),
      }).addTo(gridLayer);
    };
    var e0 = Math.floor(minE / step) * step;
    var n0 = Math.floor(minN / step) * step;
    var top = map.containerPointToLatLng([0, gridTopInset + 6]).lat;
    var left = map.containerPointToLatLng([6, 0]).lng;
    for (var e = e0; e <= maxE + step; e += step) {
      var line = [fromUtm(e, minN - step, zone, south), fromUtm(e, maxN + step, zone, south)];
      L.polyline(line, style).addTo(gridLayer);
      // Where this easting line crosses the top edge of the screen.
      var f = (top - line[0][0]) / (line[1][0] - line[0][0]);
      labelAt([top, line[0][1] + f * (line[1][1] - line[0][1])], gridLabel(e, step), 'grid-top');
    }
    for (var n = n0; n <= maxN + step; n += step) {
      var row = [fromUtm(minE - step, n, zone, south), fromUtm(maxE + step, n, zone, south)];
      L.polyline(row, style).addTo(gridLayer);
      var g = (left - row[0][1]) / (row[1][1] - row[0][1]);
      var at = [row[0][0] + g * (row[1][0] - row[0][0]), left];
      // Skip labels hidden under the native panels.
      var py = map.latLngToContainerPoint(at).y;
      if (py > gridTopInset + 24 && py < size.y - gridBottomInset - 8) labelAt(at, gridLabel(n, step), 'grid-left');
    }
  }

  function setGrid(p) {
    gridOn = !!(p && p.on);
    if (gridOn) gridLayer.addTo(map);
    else map.removeLayer(gridLayer);
    drawGrid();
  }
  map.on('moveend zoomend resize', drawGrid);
  // Exposed for tests.
  window.__tacmapUtm = { toUtm: toUtm, fromUtm: fromUtm };

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
    // Zoom to show every given point (e.g. all squads), but never closer than street level.
    fitPoints: function (pts) {
      if (!pts || !pts.length) return;
      var b = L.latLngBounds(pts.map(function (p) { return [p.lat, p.lng]; }));
      if (selfMarker) b.extend(selfMarker.getLatLng());
      follow = false;
      post('followChanged', { follow: false });
      map.fitBounds(b, { padding: [70, 70], maxZoom: 17 });
    },
    setDraw: setDraw,
    // Keeps the scale bar and attribution above the native bottom panel.
    setInsets: function (p) {
      var b = Math.max(0, Math.round(p.bottom || 0)) + 'px';
      var corners = map.getContainer().querySelectorAll('.leaflet-bottom');
      for (var i = 0; i < corners.length; i++) corners[i].style.marginBottom = b;
      var top = Math.round(p.top || 0);
      var bottom = Math.max(0, Math.round(p.bottom || 0));
      if (top !== gridTopInset || bottom !== gridBottomInset) {
        gridTopInset = top;
        gridBottomInset = bottom;
        drawGrid();
      }
    },
    setAnalysis: setAnalysis,
    setGrid: setGrid,
    setOffline: setOffline,
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
