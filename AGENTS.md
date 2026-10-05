This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## GrimMap project notes

- The map is Leaflet running inside `react-native-webview`. Its source is `src/map/web/map.js` + `map.css`; `npm run build:map` (also run on `postinstall`) inlines them with Leaflet into `src/map/mapHtml.generated.ts`. Rebuild after editing anything in `src/map/web/`.
- RN ↔ WebView protocol: RN calls `window.__tacmap({type, payload})`; the page answers via `ReactNativeWebView.postMessage`. Handlers are listed at the bottom of `map.js`, the RN side is `src/map/TacticalMap.tsx`; the host is `MapFrame.tsx` (WebView) / `MapFrame.web.tsx` (iframe).
- Yandex tiles are EPSG:3395, others EPSG:3857 — switching base layers switches the Leaflet CRS in place. Don't put Yandex tiles in a 3857 map (they'd be offset by hundreds of meters).
- Team sync is Firebase (anonymous auth + Firestore). Data model and access rules: `firestore.rules`. Without `.env` the app runs in solo mode.
- `npm test` runs node:test unit tests in `test/` (pure modules only — no RN imports there).
- `npx expo install` can't reach api.expo.dev from some sandboxes; pin versions from `node_modules/expo/bundledNativeModules.json` instead.
- UI tokens live in `src/ui/theme.ts` (colors `C`, fonts `F`: Exo 2 + JetBrains Mono, radii `R`); reuse `src/ui/components.tsx` (Glass, Sheet, Button, Avatar…) rather than ad-hoc styles. Icons: MaterialCommunityIcons in RN, the same glyphs as `@mdi/js` paths inside the map.
- Security rules tests: `npm run test:rules` (Firestore emulator, needs Java).
- Roles, team colors: `src/lib/roles.ts` (rifle and machine-gun glyphs are custom SVG paths; others are `@mdi/js`). Orders are marker kinds `order-*` (`src/lib/markerKinds.ts`); rules restrict them to the team creator and members with `canCommand`.
- Leaflet marker icons must stay `position: absolute` (Leaflet's own class). Never add `position: relative` to a divIcon className — icons then stack in document flow and drift on zoom.
- `scripts/make-order-sound.mjs` regenerates `assets/sounds/order.wav`.
- Marker level of detail is driven by `lod-dot` / `lod-mid` classes on the map container (`updateLod` in map.js): dots below zoom 15, icons without labels at 15, full detail from 16. Scale inner elements (`.tac-pin`, `.member-pin`), never the Leaflet icon element itself — its `transform` is Leaflet's positioning.
- App display name is GrimMap; `slug` and Android `package` stay `tacmap` on purpose so EAS builds keep the same project and signing key and install as updates.
- Sides (`src/state/side.tsx`, `src/services/sides.ts`): a squad joins a side when its leader writes `{ sideId, sideCode }` into the team doc. Side orders are copies in each targeted squad's `markers` with `audience: 'commanders'` and a shared `groupId`; plain fighters filter them out client-side (not a security boundary). Side-view member/marker ids are `teamId/uid` to stay unique across squads.
- Invite QR/links: `src/lib/invite.ts` (`grimmap://join?team=…|side=…`), scanner `src/app/scan.tsx`, deep-link route `src/app/join.tsx`.
- Marker votes (`staleVotes`/`doneVotes`, threshold in `voteThreshold`), arrows (`kind: 'arrow'` + `points` + `color`, drawn by `setDraw`/`drawChanged` in map.js), chat (`src/services/chat.ts`, client-generated ids so a future Bluetooth relay can dedupe), recordings (`src/services/recordings.ts`; heatmap via `leaflet.heat`, inlined by build-map-html; samples are resampled by time in `src/lib/tracks.ts`).
- `npm test` uses `scripts/ts-resolve.mjs` so tests can import app modules with extensionless imports.
- Marker deletion follows the chain of command (`src/lib/ranks.ts`, mirrored by `rank()` in firestore.rules): own markers or strictly lower rank.
- Use `KeyboardScroll` (components.tsx) for screens with text inputs; `Sheet` already keeps the focused input above the keyboard.
- Screens: tabs live in `src/app/(tabs)/` (index = map, chat, team = «Отряд», settings) with the custom `src/ui/TabBar.tsx` (bottom in portrait, left column in landscape — the map screen then ignores the bottom/left safe-area insets). Other screens are stack routes in `src/app/`.
- Role badges: `src/lib/roles.ts` builds glyphs with `xf()` (absolute M/L/C/Z paths only) and frames (`roleFrame`); `RoleIcon framed` draws the full badge, without `framed` only the glyph (viewBox `4 4 16 16`, also used for map pins and the self marker).
- Member `status` (`alive`/`dead`/`afk`, `src/lib/status.ts`): set by the fighter or by anyone ranked above them (rules: `rank()` comparison, keys `role`/`status` only). Team `pinned` chat message is written by commanders.
- Coordinate grid: UTM in map.js (`toUtm`/`fromUtm`, `setGrid`), labels kept clear of native panels via `setInsets({ top, bottom })`.
- Map zoom is continuous (`zoomSnap: 0`); never compare `getZoom()` for equality.
- Own point markers are `movable` (not arrows, not side-order copies): long press picks one up (`markerDragStart` → haptic), release posts `markerMoved`; rules let only the author change `lat`/`lng`.
- Side orders are deleted copy by copy (`deleteSideOrder`), never in one batch: each delete runs `rank()` lookups and a multi-squad batch exceeds Firestore's per-request document read limit.
- `Sheet` is a right-side panel in landscape and always has a close button. Inverted `FlatList`s flip their empty component, so render empty states outside the list.
- Offline mesh (Android): local Expo module `modules/grim-mesh` (Kotlin, Google Nearby Connections `P2P_CLUSTER`, autolinked from `./modules`; null on iOS/web/Expo Go). Pure store-and-forward logic in `src/lib/mesh.ts` (envelopes, dedupe, hop limit, latest position per fighter, packing under the 32 KB payload limit; tested in `test/mesh.test.ts`). `src/state/useMesh.ts` runs it inside `SessionProvider`: mesh positions merge into `session.members` (`mergeMeshMembers`), chat goes out over the mesh with the same id as in Firestore, and a phone with internet relays heard messages to the server (`relayedBy`, allowed by rules for squadmates). Markers travel as `mark` envelopes (latest state per marker id, `deleted` tombstones always win) and votes as `vote` envelopes; `mergeMeshMarkers` overlays them on the server list. Marker ids are made on the phone (`newMarkerId`) so both paths share them; heard markers are relayed to the server too (orders only if the author's `rank()` ≥ 2, never side orders). The native code can't be compiled in the cloud sandbox (no Google Maven) — EAS build logs are the compile check.
- Squad writes (markers, votes, profile, status) don't await the server (`background()` in session.tsx): offline the promise only settles on reconnect, which used to freeze dialogs. Refusals still show an Alert when they arrive.
