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
    // Downloaded regions (vector, OpenStreetMap via Protomaps): works with no network.
    'offline-scheme': { crs: L.CRS.EPSG3857, maxZoom: 15, vector: true, tiles: [] },
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
    // leaflet-rotate: two-finger twist and Shift+wheel turn the map; no tilt.
    rotate: true,
    bearing: 0,
    touchRotate: true,
    shiftKeyRotate: true,
    rotateControl: false,
    pitchDrag: false,
  }).setView([55.751, 37.618], 10);
  map.attributionControl.setPrefix(false);

  // leaflet-rotate turns the map with any change of angle between the fingers, so a
  // pinch zoom kept twisting it. Turn only after a deliberate twist (TWIST_DEG), and
  // never in a pinch that has already zoomed noticeably first.
  var TWIST_DEG = 18;
  (function () {
    var tg = map.touchGestures;
    if (!tg) return;
    // The touchstart listener was bound when the handler was enabled: re-bind it.
    var wasOn = tg.enabled();
    if (wasOn) tg.disable();
    var start = tg._onTouchStart;
    var move = tg._onTouchMove;
    function angle(e) {
      var a = e.touches[0];
      var b = e.touches[1];
      return (Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX) * 180) / Math.PI;
    }
    function spread(e) {
      var a = e.touches[0];
      var b = e.touches[1];
      return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
    }
    tg._onTouchStart = function (e) {
      start.call(this, e);
      if (!this._gesture) return;
      this._twist = this._rotating ? 'pending' : 'off';
      this._twistAngle = angle(e);
      this._twistSpread = spread(e) || 1;
    };
    tg._onTouchMove = function (e) {
      if (this._gesture && e.touches && e.touches.length === 2 && this._twist === 'pending') {
        var d = angle(e) - this._twistAngle;
        d = ((d + 540) % 360) - 180;
        if (Math.abs(d) >= TWIST_DEG) {
          this._twist = 'on';
          // Start turning from here, without a jump.
          var v = L.point(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
          );
          this._startTheta = Math.atan(v.x / v.y);
          this._startBearing = map.getBearing() + (v.y < 0 ? 180 : 0);
        } else if (Math.abs(Math.log(spread(e) / this._twistSpread)) > 0.12) {
          this._twist = 'off';
        }
      }
      var rotating = this._rotating;
      if (this._twist !== 'on') this._rotating = false;
      move.call(this, e);
      if (this._gesture && this._gesture !== 'pitch') this._rotating = rotating;
    };
    if (wasOn) tg.enable();
  })();
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
    if (def.vector) {
      drawVector();
      return;
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

  // ---------------------------------------------------------------------------
  // Offline schematic map: one vector layer per downloaded region (PMTiles files on the
  // phone). The page can't read byte ranges of local files, so it asks the app for them.
  // ---------------------------------------------------------------------------
  var vectorRegions = [];
  var pmPending = {};
  var pmSeq = 0;

  function BridgeSource(id) {
    this.id = id;
  }
  BridgeSource.prototype.getKey = function () {
    return this.id;
  };
  BridgeSource.prototype.getBytes = function (offset, length) {
    var id = this.id;
    return new Promise(function (resolve, reject) {
      var k = ++pmSeq;
      pmPending[k] = { resolve: resolve, reject: reject };
      post('pmRead', { k: k, id: id, offset: offset, length: length });
    });
  };

  function pmData(p) {
    var q = pmPending[p.k];
    if (!q) return;
    delete pmPending[p.k];
    if (p.error) return q.reject(new Error(p.error));
    var bin = atob(p.b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    q.resolve({ data: bytes.buffer });
  }

  function drawVector() {
    if (!window.protomapsL || !window.pmtiles) return;
    vectorRegions.forEach(function (r) {
      var b = r.bbox; // [west, south, east, north]
      protomapsL
        .leafletLayer({
          url: new pmtiles.PMTiles(new BridgeSource(r.id)),
          flavor: 'light',
          lang: 'ru',
          maxDataZoom: r.maxzoom || 15,
          maxZoom: 21,
          // Each region draws only over its own area, so regions sit side by side.
          bounds: [
            [b[1], b[0]],
            [b[3], b[2]],
          ],
          attribution: '© OpenStreetMap, Protomaps',
        })
        .addTo(baseGroup);
    });
  }

  function setVectorRegions(list) {
    vectorRegions = list || [];
    var def = BASE_LAYERS[currentBase];
    if (def && def.vector) drawBase(def, currentBase);
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
        '<div class="self-pin' + (look.tech ? ' tech' : '') + '" style="background:' + c + '">' +
        (look.tech ? '<div class="tech-core"></div>' : '') +
        (look.rolePath ? '<svg viewBox="4 4 16 16"><path d="' + escapeHtml(look.rolePath) + '" fill="#04100A"/></svg>' : '') +
        '</div>',
      iconSize: [80, 80],
      iconAnchor: [40, 40],
    });
  }
  var selfLook = null;
  var coneAngle = null;
  var selfHeading = null;

  // Icons stay upright when the map turns, so a compass heading points at
  // heading + bearing on screen.
  function bearing() {
    return map.getBearing ? map.getBearing() : 0;
  }

  function setHeading(heading) {
    selfHeading = heading;
    var el = selfMarker && selfMarker.getElement();
    var cone = el && el.querySelector('.self-cone');
    if (!cone) return;
    if (heading == null) {
      cone.style.display = 'none';
      return;
    }
    var onScreen = heading + bearing();
    // Unwrap so 359° → 1° turns 2° forward instead of spinning all the way back.
    coneAngle = coneAngle == null ? onScreen : coneAngle + ((((onScreen - coneAngle) % 360) + 540) % 360) - 180;
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
      selfLook = JSON.stringify([p.rolePath, p.color, p.tech]);
      selfMarker = L.marker(ll, { icon: selfIcon(p), interactive: false, zIndexOffset: 1000 }).addTo(selfLayer);
    } else {
      var look = JSON.stringify([p.rolePath, p.color, p.tech]);
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
    drawNav();
    if (headingUp && p.heading != null) turnMap(360 - p.heading);
    if (follow) map.panTo(ll, { animate: true });
  }

  // Own trail (breadcrumbs): where I walked in the last minutes.
  var trailLine = null;
  function setTrail(p) {
    var pts = (p && p.points) || [];
    if (pts.length < 2) {
      if (trailLine) map.removeLayer(trailLine);
      trailLine = null;
      return;
    }
    if (zooming) return;
    if (trailLine) trailLine.setLatLngs(pts);
    else {
      trailLine = L.polyline(pts, {
        color: '#8EF07A',
        weight: 3,
        opacity: 0.75,
        dashArray: '1 7',
        lineCap: 'round',
        interactive: false,
      }).addTo(map);
    }
  }

  // "Lead me there": a dashed line from me to the target and a ring around it.
  var navLayer = L.layerGroup().addTo(map);
  var navTarget = null;
  var navLines = null;

  function drawNav() {
    if (!navTarget || !selfMarker) {
      navLayer.clearLayers();
      navLines = null;
      return;
    }
    if (zooming) return;
    var line = [selfMarker.getLatLng(), navTarget];
    if (!navLines) {
      navLines = [
        L.polyline(line, { color: '#0B0F0C', weight: 6, opacity: 0.5, interactive: false }).addTo(navLayer),
        L.polyline(line, { color: '#4ADE80', weight: 3, dashArray: '10 8', interactive: false }).addTo(navLayer),
      ];
      L.circleMarker(navTarget, { radius: 14, color: '#4ADE80', weight: 3, fill: false, interactive: false }).addTo(navLayer);
      return;
    }
    navLines.forEach(function (l) {
      l.setLatLngs(line);
    });
  }

  function setNav(p) {
    navTarget = p && isFinite(p.lat) && isFinite(p.lng) ? L.latLng(p.lat, p.lng) : null;
    navLayer.clearLayers();
    navLines = null;
    drawNav();
  }

  // Map bearing: north-up, turned by hand (two fingers), or following the compass
  // ("heading up": what's ahead of you is at the top of the screen).
  var headingUp = false;
  var turningByCode = false;

  function turnMap(b) {
    turningByCode = true;
    try {
      map.setBearing(b);
    } finally {
      turningByCode = false;
    }
  }

  var bearingPostAt = 0;
  map.on('rotate', function () {
    if (!turningByCode && headingUp) {
      // Turned by hand: stop following the compass.
      headingUp = false;
      post('headingUpChanged', { on: false });
    }
    setHeading(selfHeading);
    var dirs = map.getContainer().querySelectorAll('.tac-dir');
    for (var i = 0; i < dirs.length; i++) {
      dirs[i].style.transform = 'rotate(' + (Number(dirs[i].getAttribute('data-dir')) + bearing()) + 'deg)';
    }
    Object.keys(memberMarkers).forEach(function (id) {
      var mk = memberMarkers[id];
      applyMemberHeading(mk, mk._heading);
    });
    // At most a few updates a second to the app, and always the final one.
    var now = Date.now();
    clearTimeout(bearingTail);
    if (now - bearingPostAt > 150) {
      bearingPostAt = now;
      post('bearingChanged', { bearing: bearing() });
    } else {
      bearingTail = setTimeout(function () {
        post('bearingChanged', { bearing: bearing() });
      }, 200);
    }
  });
  var bearingTail = null;

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
      className: 'member-icon' + (m.tech ? ' tech' : '') + (m.stale ? ' stale' : '') + (status ? ' ' + status : ''),
      html:
        (m.stale || status ? '' : '<div class="member-halo" style="background:' + c + '"></div>') +
        '<div class="member-dir"><div class="member-dir-tip" style="border-bottom-color:' + c + '"></div></div>' +
        '<div class="member-pin" style="background:' + c + '">' +
        (m.tech
          ? '<div class="tech-core"></div>'
          : '<svg viewBox="4 4 16 16"><path d="' + escapeHtml(m.rolePath) + '" fill="#04100A"/></svg>') +
        '</div>' +
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
    dir.style.transform = 'rotate(' + (heading + bearing()) + 'deg)';
  }

  function memberKey(m) {
    return JSON.stringify([m.callsign, m.color, m.stale, m.rolePath, m.roleTitle, m.commander, m.status, m.tech]);
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

  // ---------------------------------------------------------------------------
  // Control zone + moving hot zone (src/lib/hotzone.ts has the same math; the
  // hz:begin..hz:end block is checked against it by test/hotzone.test.ts).
  // ---------------------------------------------------------------------------
  // hz:begin
  function hzRand(seed, k, i) {
    var h = (seed ^ Math.imul(k + 1, 0x9e3779b1) ^ Math.imul(i + 1, 0x85ebca77)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;
  }
  function hzPoint(lat, lng, z, k) {
    var room = Math.max(0, z.r - z.hot);
    var d = Math.sqrt(hzRand(z.seed, k, 0)) * room;
    var a = hzRand(z.seed, k, 1) * 2 * Math.PI;
    return {
      lat: lat + (d * Math.cos(a)) / 111320,
      lng: lng + (d * Math.sin(a)) / (111320 * Math.cos((lat * Math.PI) / 180)),
    };
  }
  function hzState(lat, lng, z, now) {
    var t = Math.max(0, now - z.start);
    var k = Math.floor(t / z.every);
    var base = z.start + k * z.every;
    var ph = t - k * z.every;
    var move = Math.min(90000, Math.max(30000, z.every * 0.2));
    var warn = Math.min(180000, Math.max(60000, z.every * 0.3));
    var moveAt = z.every - move;
    var warnAt = moveAt - warn;
    var a = hzPoint(lat, lng, z, k);
    if (ph < warnAt) return { lat: a.lat, lng: a.lng, next: null, phase: 'hold', at: base + warnAt, k: k };
    var b = hzPoint(lat, lng, z, k + 1);
    if (ph < moveAt) return { lat: a.lat, lng: a.lng, next: b, phase: 'warn', at: base + moveAt, k: k };
    var f = (ph - moveAt) / move;
    return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f, next: b, phase: 'move', at: base + z.every, k: k };
  }
  // hz:end

  var zonesLayer = L.layerGroup().addTo(map);
  var zoneShapes = {};

  function clockText(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function zoneBadge(st, now) {
    var t = clockText(st.at - (now || Date.now()));
    return st.phase === 'move' ? 'ХОТЗОНА · едет ' + t : st.phase === 'warn' ? 'ХОТЗОНА · сдвиг ' + t : 'ХОТЗОНА';
  }

  // Redrawing a vector layer in the middle of a zoom animation draws it at the wrong
  // place (the renderer is still CSS-scaled), so the hot zone jumped while zooming.
  var zooming = false;
  map.on('zoomstart', function () {
    zooming = true;
  });
  map.on('zoomend', settle);
  // A pinch that only panned or turned may end without a zoomend.
  map.on('moveend', function () {
    if (zooming && !map._animatingZoom) settle();
  });
  function settle() {
    if (!zooming) return;
    zooming = false;
    flushDeferred();
    renderMortar();
    drawNav();
    var now = Date.now();
    Object.keys(zoneShapes).forEach(function (id) {
      drawZone(zoneShapes[id], now, true);
    });
  }

  // Messages that redraw vector layers wait for the zoom to finish (latest one per type).
  var DEFER_WHILE_ZOOMING = { setSelf: 1, setMarkers: 1, setMortar: 1, setNav: 1, setTrail: 1, setAnalysis: 1 };
  var deferred = {};
  var deferredOrder = [];
  function flushDeferred() {
    var order = deferredOrder;
    var msgs = deferred;
    deferred = {};
    deferredOrder = [];
    order.forEach(function (type) {
      window.__tacmap({ type: type, payload: msgs[type] });
    });
  }

  function drawZone(g, now, force) {
    var m = g._zoneMarker;
    var st = hzState(m.lat, m.lng, m.zone, now);
    // Only move the circle when it actually moved (it holds still most of the time).
    var at = st.lat.toFixed(7) + ',' + st.lng.toFixed(7);
    if (force || at !== g._at) {
      g._at = at;
      g._hot.setLatLng([st.lat, st.lng]);
      g._label.setLatLng([st.lat, st.lng]);
    }
    var key = st.phase + ':' + st.k;
    if (key !== g._phaseKey) {
      g._phaseKey = key;
      g._hot.setStyle({ dashArray: st.phase === 'move' ? '10 8' : null });
      if (st.next) {
        g._next.setLatLng([st.next.lat, st.next.lng]);
        g._path.setLatLngs([[st.lat, st.lng], [st.next.lat, st.next.lng]]);
        g._next.addTo(g);
        g._path.addTo(g);
      } else {
        g.removeLayer(g._next);
        g.removeLayer(g._path);
      }
    }
    if (st.next && st.phase === 'move' && !zooming) g._path.setLatLngs([[st.lat, st.lng], [st.next.lat, st.next.lng]]);
    var el = g._label.getElement();
    if (el) {
      el.classList.toggle('hz-warn', st.phase === 'warn');
      el.classList.toggle('hz-move', st.phase === 'move');
      el.querySelector('span').textContent = zoneBadge(st, now);
    }
  }

  function buildZone(m) {
    var g = L.layerGroup();
    g._zoneMarker = m;
    g._area = L.circle([m.lat, m.lng], {
      radius: m.zone.r,
      color: '#FFC83D',
      weight: 2,
      opacity: 0.9,
      dashArray: '12 8',
      fillColor: '#FFC83D',
      fillOpacity: 0.05,
      interactive: false,
    }).addTo(g);
    g._hot = L.circle([m.lat, m.lng], {
      radius: m.zone.hot,
      color: '#FF5A1F',
      weight: 3,
      fillColor: '#FF5A1F',
      fillOpacity: 0.35,
      interactive: false,
      className: 'hz-hot',
    }).addTo(g);
    g._next = L.circle([m.lat, m.lng], {
      radius: m.zone.hot,
      color: '#FFFFFF',
      weight: 2,
      opacity: 0.85,
      dashArray: '4 6',
      fill: false,
      interactive: false,
    });
    g._path = L.polyline([], { color: '#FFFFFF', weight: 2, opacity: 0.7, dashArray: '2 8', interactive: false });
    g._label = L.marker([m.lat, m.lng], {
      keyboard: false,
      icon: L.divIcon({ className: 'hz-label', html: '<span>ХОТЗОНА</span>', iconSize: [0, 0] }),
    }).addTo(g);
    g._label.on('click', function () {
      post('markerTap', { id: g._zoneMarker.id });
    });
    g._key = JSON.stringify(m.zone);
    g._phaseKey = null;
    drawZone(g, Date.now(), true);
    return g;
  }

  function setZones(list) {
    syncKeyed(zoneShapes, zonesLayer, list, buildZone, function (g, m) {
      var key = JSON.stringify(m.zone);
      g._zoneMarker = m;
      var c = g._area.getLatLng();
      if (c.lat !== m.lat || c.lng !== m.lng) g._area.setLatLng([m.lat, m.lng]);
      if (key !== g._key) {
        g._key = key;
        g._area.setRadius(m.zone.r);
        g._hot.setRadius(m.zone.hot);
        g._next.setRadius(m.zone.hot);
        g._phaseKey = null;
      }
      if (!zooming) drawZone(g, Date.now(), true);
    });
  }

  setInterval(function () {
    if (zooming) return;
    var now = Date.now();
    Object.keys(zoneShapes).forEach(function (id) {
      drawZone(zoneShapes[id], now);
    });
  }, 1000);

  // ---------------------------------------------------------------------------
  // Mortar: range circles around mortar crews and, in calculator mode, the line of
  // fire from the firing position to the crosshair (map center), following it live.
  // ---------------------------------------------------------------------------
  var mortarLayer = L.layerGroup().addTo(map);
  var mortarState = null;
  var aimLine = null;
  var aimLabel = null;

  function renderMortar() {
    mortarLayer.clearLayers();
    aimLine = aimLabel = null;
    var p = mortarState;
    if (!p) return;
    (p.guns || []).forEach(function (g) {
      L.circle([g.lat, g.lng], {
        radius: g.r,
        color: g.color,
        weight: 2,
        opacity: 0.9,
        dashArray: '3 7',
        fillColor: g.color,
        fillOpacity: 0.06,
        interactive: false,
      }).addTo(mortarLayer);
    });
    if (p.aim) {
      aimLine = L.polyline([], { color: '#FFFFFF', weight: 2, dashArray: '8 6', interactive: false }).addTo(mortarLayer);
      L.circleMarker([p.aim.lat, p.aim.lng], {
        radius: 6,
        color: '#0B0F0C',
        weight: 2,
        fillColor: '#FFC83D',
        fillOpacity: 1,
        interactive: false,
      }).addTo(mortarLayer);
      aimLabel = L.marker([p.aim.lat, p.aim.lng], {
        keyboard: false,
        interactive: false,
        icon: L.divIcon({ className: 'aim-label', html: '<span></span>', iconSize: [0, 0] }),
      }).addTo(mortarLayer);
      updateAim();
    }
  }

  function updateAim() {
    if (!aimLine || !mortarState || !mortarState.aim) return;
    var a = mortarState.aim;
    var c = map.getCenter();
    var d = map.distance([a.lat, a.lng], c);
    var far = d > a.r;
    aimLine.setLatLngs([[a.lat, a.lng], c]);
    aimLine.setStyle({ color: far ? '#FF4D4D' : '#FFFFFF' });
    aimLabel.setLatLng(c);
    var el = aimLabel.getElement();
    if (el) {
      el.classList.toggle('far', far);
      el.querySelector('span').textContent = Math.round(d) + ' м';
    }
  }

  function setMortar(p) {
    mortarState = p;
    if (!zooming) renderMortar();
  }

  map.on('move', function () {
    if (!zooming) updateAim();
  });

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
        // Photo markers: a wedge toward where the camera looked.
        (m.dir != null
          ? '<div class="tac-dir" data-dir="' + Number(m.dir) + '" style="transform:rotate(' + (Number(m.dir) + bearing()) + 'deg)">' +
            '<div class="tac-dir-tip" style="border-bottom-color:' + c + '"></div></div>'
          : '') +
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

  // Football: the side's arrow, its ball where it has rolled to and the push zone around it.
  function buildBall(m) {
    var g = buildArrow(m);
    var b = m.ball;
    var c = escapeHtml(m.color);
    L.circle([b.lat, b.lng], {
      radius: b.r,
      color: m.color,
      weight: 2,
      opacity: 0.9,
      dashArray: '5 5',
      fillColor: m.color,
      fillOpacity: 0.14,
      interactive: false,
    }).addTo(g);
    var state = b.goal ? 'ГОЛ' : b.push > 0 ? '▶' : b.push < 0 ? '◀' : '';
    L.marker([b.lat, b.lng], {
      keyboard: false,
      zIndexOffset: 500,
      icon: L.divIcon({
        className: 'ball-icon' + (b.goal ? ' goal' : ''),
        html:
          '<div class="ball-pin" style="border-color:' + c + '">' +
          '<svg viewBox="0 0 24 24"><path d="' + escapeHtml(m.path) + '" fill="#0B0F0C"/></svg></div>' +
          '<div class="chip">' + escapeHtml(m.title) + (state ? ' ' + state : '') + '</div>',
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      }),
    }).addTo(g);
    return g;
  }

  // Zones (dead zone, enemy zone, field boundary): filled outlines with their title.
  function buildArea(m, opts) {
    var pts = m.points.map(function (p) { return [p.lat, p.lng]; });
    var g = L.featureGroup();
    var bound = m.kind === 'area-bound';
    var draft = opts && opts.draft;
    if (pts.length < 3) {
      // Still being drawn: the outline so far.
      L.polyline(pts, { color: m.color, weight: 3, dashArray: '6 6', interactive: false }).addTo(g);
      pts.forEach(function (p) {
        L.circleMarker(p, { radius: 4, color: '#0B0F0C', weight: 2, fillColor: m.color, fillOpacity: 1, interactive: false }).addTo(g);
      });
      return g;
    }
    L.polygon(pts, {
      color: m.color,
      weight: bound ? 4 : 2.5,
      opacity: 0.95,
      dashArray: bound || draft ? '12 8' : null,
      fillColor: m.color,
      fillOpacity: bound ? 0 : 0.16,
      // A bare outline would only take taps on its thin line; the label takes them.
      interactive: false,
    }).addTo(g);
    if (!draft) {
      var c = pts.reduce(function (s, p) { return [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length]; }, [0, 0]);
      L.marker(c, {
        keyboard: false,
        icon: L.divIcon({
          className: 'area-label',
          html: '<span style="border-color:' + escapeHtml(m.color) + ';color:' + escapeHtml(m.color) + '">' + escapeHtml(m.title) + '</span>',
          iconSize: [0, 0],
        }),
      }).addTo(g);
    }
    return g;
  }

  function setArrows(list) {
    var seen = {};
    list.forEach(function (m) {
      seen[m.id] = true;
      var key = JSON.stringify([m.points, m.color, m.personal, m.area, m.title, m.ball]);
      var cur = arrowShapes[m.id];
      if (cur && cur._tacKey === key) return;
      if (cur) arrowsLayer.removeLayer(cur);
      var g = m.ball ? buildBall(m) : m.area ? buildArea(m) : buildArrow(m);
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
      if (drawing.area) {
        buildArea({ points: drawing.points, color: drawing.color, kind: drawing.area }, { draft: true }).addTo(draftLayer);
      } else {
        buildArrow({ points: drawing.points, color: drawing.color }, { draft: true }).addTo(draftLayer);
      }
    }
  }

  function setDraw(p) {
    drawing = p && p.on ? { color: p.color, points: p.points || [], area: p.area || null } : null;
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
        if (!seg.length) return;
        if (seg.length === 1) {
          // A lone fix between long gaps: a dot, so the player still shows up.
          if (a.showTracks) {
            L.circleMarker(seg[0], { radius: 4, color: '#0B0F0C', weight: 2, fillColor: t.color, fillOpacity: 1, interactive: false }).addTo(analysisLayer);
          }
          bounds.extend(seg[0]);
          return;
        }
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
    setZones(all.filter(function (m) { return m.zone; }));
    var list = all.filter(function (m) { return !m.points; });
    syncKeyed(
      tacMarkers,
      markersLayer,
      list,
      function (m) {
        var mk = L.marker([m.lat, m.lng], { icon: tacIcon(m) });
        mk._tacId = m.id;
        mk._tacKey = JSON.stringify([m.path, m.color, m.label, m.order, m.personal, m.time, m.movable, m.wave, m.dir]);
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
        var key = JSON.stringify([m.path, m.color, m.label, m.order, m.personal, m.time, m.movable, m.wave, m.dir]);
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

  function postView() {
    var c = map.getCenter();
    var b = map.getBounds();
    post('viewChanged', {
      lat: c.lat,
      lng: c.lng,
      zoom: map.getZoom(),
      bounds: { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() },
      snail: snailText(c),
    });
  }
  map.on('moveend', postView);

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
  // 'off' | 'utm' | 'snail'
  var gridMode = 'off';
  // Snail grid: NW corner of square А1 (shared by the squad), or null for the default.
  var snailOrigin = null;
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

  // snail:begin
  // «Улитка»: 500 m squares named by letter (columns, west to east) and number (rows,
  // north to south) from the NW corner of А1; each square splits into 3×3 numbered in a
  // spiral from the top-left corner with 9 in the middle, and each ninth again.
  var SNAIL = [[1, 2, 3], [8, 9, 4], [7, 6, 5]];
  var SNAIL_LETTERS = 'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЩЭЮЯ';
  var SNAIL_SIZE = 500;
  // Without a squad origin, squares are counted from the NW corner of each 5 km block.
  var SNAIL_BLOCK = 5000;

  function snailOriginFor(e, n, origin) {
    if (origin) return origin;
    return { e: Math.floor(e / SNAIL_BLOCK) * SNAIL_BLOCK, n: Math.ceil(n / SNAIL_BLOCK) * SNAIL_BLOCK };
  }

  function snailName(col, row) {
    var k = SNAIL_LETTERS.length;
    return SNAIL_LETTERS.charAt(((col % k) + k) % k) + String(row >= 0 ? row + 1 : row);
  }

  // Square and snail numbers of a UTM point: { col, row, name, s1, s2 }.
  function snailCell(e, n, origin) {
    var o = snailOriginFor(e, n, origin);
    var x = (e - o.e) / SNAIL_SIZE;
    var y = (o.n - n) / SNAIL_SIZE;
    var col = Math.floor(x);
    var row = Math.floor(y);
    var fx = (x - col) * 3;
    var fy = (y - row) * 3;
    var i1 = Math.min(2, Math.floor(fx));
    var j1 = Math.min(2, Math.floor(fy));
    var i2 = Math.min(2, Math.floor((fx - i1) * 3));
    var j2 = Math.min(2, Math.floor((fy - j1) * 3));
    return { col: col, row: row, name: snailName(col, row), s1: SNAIL[j1][i1], s2: SNAIL[j2][i2] };
  }
  // snail:end

  function utmZoneAt(ll) {
    return Math.floor((ll.lng + 180) / 6) + 1;
  }

  // Snail origin in UTM of the zone on screen.
  function snailUtmOrigin(zone) {
    if (!snailOrigin) return null;
    var u = toUtm(snailOrigin.lat, snailOrigin.lng, zone);
    return { e: u.e, n: u.n };
  }

  // "Б3-7-4" for a point, when the snail grid is on.
  function snailText(ll) {
    if (gridMode !== 'snail') return null;
    var zone = utmZoneAt(map.getCenter());
    var u = toUtm(ll.lat, ll.lng, zone);
    var c = snailCell(u.e, u.n, snailUtmOrigin(zone));
    return c.name + '-' + c.s1 + '-' + c.s2;
  }

  // Where a grid line leaves the screen through the top (or left) edge, for its label.
  // Works at any map bearing: everything is done in screen pixels.
  function edgePoint(a, b, preferTop) {
    var size = map.getSize();
    var pa = map.latLngToContainerPoint(a);
    var pb = map.latLngToContainerPoint(b);
    var topY = gridTopInset + 6;
    var bottomY = size.y - gridBottomInset - 8;
    var atTop = function () {
      if ((pa.y - topY) * (pb.y - topY) > 0 || pa.y === pb.y) return null;
      var x = pa.x + ((topY - pa.y) / (pb.y - pa.y)) * (pb.x - pa.x);
      return x >= 4 && x <= size.x - 30 ? L.point(x, topY) : null;
    };
    var atLeft = function () {
      var X = 6;
      if ((pa.x - X) * (pb.x - X) > 0 || pa.x === pb.x) return null;
      var y = pa.y + ((X - pa.x) / (pb.x - pa.x)) * (pb.y - pa.y);
      return y >= topY + 18 && y <= bottomY ? L.point(X, y) : null;
    };
    var p = preferTop ? atTop() || atLeft() : atLeft() || atTop();
    return p ? map.containerPointToLatLng(p) : null;
  }

  function gridFrame() {
    var b = map.getBounds();
    var c = map.getCenter();
    var zone = utmZoneAt(c);
    var size = map.getSize();
    var metersPerPx =
      map.distance(map.containerPointToLatLng([0, size.y / 2]), map.containerPointToLatLng([size.x, size.y / 2])) / size.x;
    var corners = [b.getSouthWest(), b.getNorthWest(), b.getNorthEast(), b.getSouthEast()].map(function (p) {
      return toUtm(p.lat, p.lng, zone);
    });
    return {
      zone: zone,
      south: c.lat < 0,
      metersPerPx: metersPerPx,
      minE: Math.min.apply(null, corners.map(function (p) { return p.e; })),
      maxE: Math.max.apply(null, corners.map(function (p) { return p.e; })),
      minN: Math.min.apply(null, corners.map(function (p) { return p.n; })),
      maxN: Math.max.apply(null, corners.map(function (p) { return p.n; })),
    };
  }

  function gridMarker(ll, cls, text) {
    L.marker(ll, {
      interactive: false,
      keyboard: false,
      icon: L.divIcon({ className: cls, html: '<span>' + text + '</span>', iconSize: [0, 0] }),
    }).addTo(gridLayer);
  }

  function drawUtm(f) {
    var step = GRID_STEPS[GRID_STEPS.length - 1];
    for (var i = 0; i < GRID_STEPS.length; i++) {
      if (GRID_STEPS[i] / f.metersPerPx >= 90) {
        step = GRID_STEPS[i];
        break;
      }
    }
    var style = { color: '#8EF07A', weight: 1, opacity: 0.55, interactive: false };
    for (var e = Math.floor(f.minE / step) * step; e <= f.maxE + step; e += step) {
      var line = [fromUtm(e, f.minN - step, f.zone, f.south), fromUtm(e, f.maxN + step, f.zone, f.south)];
      L.polyline(line, style).addTo(gridLayer);
      var at = edgePoint(line[0], line[1], true);
      if (at) gridMarker(at, 'grid-label grid-top', gridLabel(e, step));
    }
    for (var n = Math.floor(f.minN / step) * step; n <= f.maxN + step; n += step) {
      var row = [fromUtm(f.minE - step, n, f.zone, f.south), fromUtm(f.maxE + step, n, f.zone, f.south)];
      L.polyline(row, style).addTo(gridLayer);
      var at2 = edgePoint(row[0], row[1], false);
      if (at2) gridMarker(at2, 'grid-label grid-left', gridLabel(n, step));
    }
  }

  function drawSnail(f) {
    var px = SNAIL_SIZE / f.metersPerPx;
    // Zoomed far out the squares would be a solid mesh.
    if (px < 14) return;
    var origin = snailUtmOrigin(f.zone);
    var o = origin || { e: 0, n: 0 };
    var levels = [{ size: SNAIL_SIZE, style: { color: '#FFC83D', weight: 2, opacity: 0.85, interactive: false } }];
    if (px / 3 >= 40) levels.push({ size: SNAIL_SIZE / 3, style: { color: '#FFC83D', weight: 1, opacity: 0.5, interactive: false } });
    if (px / 9 >= 34) {
      levels.push({ size: SNAIL_SIZE / 9, style: { color: '#FFFFFF', weight: 1, opacity: 0.3, dashArray: '3 5', interactive: false } });
    }
    // Lines: coarse last so they sit on top.
    for (var li = levels.length - 1; li >= 0; li--) {
      var st = levels[li].size;
      var e0 = o.e + Math.floor((f.minE - o.e) / st) * st;
      var n0 = o.n + Math.floor((f.minN - o.n) / st) * st;
      for (var e = e0; e <= f.maxE + st; e += st) {
        L.polyline([fromUtm(e, f.minN - st, f.zone, f.south), fromUtm(e, f.maxN + st, f.zone, f.south)], levels[li].style).addTo(gridLayer);
      }
      for (var n = n0; n <= f.maxN + st; n += st) {
        L.polyline([fromUtm(f.minE - st, n, f.zone, f.south), fromUtm(f.maxE + st, n, f.zone, f.south)], levels[li].style).addTo(gridLayer);
      }
    }
    // Square names in each square's NW corner; snail numbers in cell middles.
    var finest = levels[levels.length - 1].size;
    var cells = 0;
    var e1 = o.e + Math.floor((f.minE - o.e) / finest) * finest;
    var n1 = o.n + Math.floor((f.minN - o.n) / finest) * finest;
    for (var ce = e1; ce <= f.maxE; ce += finest) {
      for (var cn = n1; cn <= f.maxN + finest; cn += finest) {
        if (++cells > 2500) return;
        var mid = snailCell(ce + finest / 2, cn - finest / 2, origin);
        var center = fromUtm(ce + finest / 2, cn - finest / 2, f.zone, f.south);
        if (levels.length === 3) gridMarker(center, 'snail-num snail-num2', mid.s1 + '-' + mid.s2);
        else if (levels.length === 2) gridMarker(center, 'snail-num', String(mid.s1));
        // The NW corner of a big square gets its name. Default origins are multiples
        // of the square size, so { 0, 0 } lines up with them.
        var k = Math.round(SNAIL_SIZE / finest);
        var ix = Math.round((ce - o.e) / finest);
        var iy = Math.round((o.n - cn) / finest);
        if (px >= 40 && ((ix % k) + k) % k === 0 && ((iy % k) + k) % k === 0) {
          gridMarker(fromUtm(ce, cn, f.zone, f.south), 'snail-label', mid.name);
        }
      }
    }
  }

  function drawGrid() {
    gridLayer.clearLayers();
    if (gridMode === 'off') return;
    var f = gridFrame();
    if (gridMode === 'snail') drawSnail(f);
    else drawUtm(f);
  }

  function setGrid(p) {
    gridMode = p && (p.mode === 'utm' || p.mode === 'snail') ? p.mode : p && p.on ? 'utm' : 'off';
    snailOrigin = p && p.origin && isFinite(p.origin.lat) && isFinite(p.origin.lng) ? p.origin : null;
    if (gridMode !== 'off') gridLayer.addTo(map);
    else map.removeLayer(gridLayer);
    drawGrid();
    postView();
  }
  map.on('moveend zoomend resize rotate', drawGridSoon);
  // Rotating fires many events; redraw once per frame at most.
  var gridFrameReq = null;
  function drawGridSoon() {
    // Mid-zoom the renderer is CSS-scaled: redraw once the zoom settles.
    if (gridFrameReq || zooming) return;
    gridFrameReq = requestAnimationFrame(function () {
      gridFrameReq = null;
      drawGrid();
    });
  }
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
    // Back to north-up (animated), or a given bearing.
    setBearing: function (p) {
      headingUp = false;
      turningByCode = true;
      try {
        map.setBearing((p && p.bearing) || 0);
      } finally {
        turningByCode = false;
      }
    },
    // Night mode: the whole map in dim reds (the app adds its own red filter on top).
    setNav: setNav,
    setTrail: setTrail,
    setNight: function (p) {
      map.getContainer().classList.toggle('night', !!(p && p.on));
    },
    setHeadingUp: function (p) {
      headingUp = !!(p && p.on);
      if (headingUp && selfHeading != null) turnMap(360 - selfHeading);
    },
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
    setVectorRegions: setVectorRegions,
    pmData: pmData,
    setMembers: setMembers,
    setMarkers: setMarkers,
    setMortar: setMortar,
    addOverlay: addOverlay,
    removeOverlay: removeOverlay,
    setOverlayVisible: setOverlayVisible,
    fitOverlay: fitOverlay,
  };

  window.__tacmap = function (msg) {
    if (zooming && DEFER_WHILE_ZOOMING[msg.type]) {
      if (!(msg.type in deferred)) deferredOrder.push(msg.type);
      deferred[msg.type] = msg.payload;
      return;
    }
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
  // The crosshair readout and the "+" button need a view before the first pan.
  postView();
})();
