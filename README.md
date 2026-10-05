# Magaalo — Mogadishu navigation (Expo)

A city map. A simpler way there.

Magaalo is a map-first mobile app for getting around Mogadishu, built with Expo from the
[Magaalo Mobile Figma design](https://www.figma.com/design/E7vZ3UmRtPabqO23aQP15I/Magaalo-Mobile-%25E2%2580%2594-Explore--Navigate---Contribute?node-id=7-424).
It uses the same map data and Supabase project as the
[Magaalo Atlas website](https://magaalo-mogadishu-atlas.amiinrealz.chatgpt.site) ([source](https://github.com/amiinreal/magaalo-mogadishu-atlas)).

The app is for everyday users. Moderator, operator and map-editing tools stay on the website.

## What it does

- **Explore:** the Atlas map shows 19,178 road segments, 470,236 building footprints and road names. You can use a street or satellite base, and add district, transport and community-report layers.
- **Search:** the 3,000+ place index is cached on the phone for offline use. Somali words find English categories, so *suuq* finds markets and *isbitaal* finds hospitals. There are category chips, recent searches, and you can drop a pin by long-pressing or choosing a spot on the map.
- **Directions:** routes for driving, walking and cycling, with alternatives and the arrival time. **Routes avoid road closures the community has confirmed.**
- **Turn-by-turn guidance:** GPS following, spoken prompts, automatic rerouting when you leave the route, and the screen stays on while you navigate. If a closure is confirmed while you are driving, you see a "Road closed ahead · Continue +N min" card with the detour already calculated.
- **Community reports:** one tap reports a road closed, a road open again, a place or building, heavy traffic, flooding or something else. While navigating, the report is sent at your current position. Otherwise you move a pin to the exact spot.
- **Suggest a change:** tap any building or place and report *this place exists*, *this place doesn't exist*, or *add a missing place*.
- **Review after arrival:** rate the directions with 1–5 stars, tick issues such as road closed, wrong turn or place missing, and add an optional comment.
- **English first, Somali second:** every screen and spoken instruction is in both languages. You switch in Settings → Language. If the phone has no Somali voice, spoken prompts fall back to English.
- **Saved places:** Home, Work and favourites, plus district explorer, city transport, offline banner, privacy, help and map credits.
- **Developer mode:** GPS diagnostics, map debugging, connection checks, and a **navigation simulator** that drives any route at 2× speed. It works on an emulator with no GPS.

## How the community model works (machine learning)

Reports go into `community_reports`. A model in Postgres (`refresh_map_alerts()`) turns them into public `map_alerts` that every user sees live through Supabase Realtime:

1. **Spatial clustering:** DBSCAN (`ST_ClusterDBSCAN`, in metres, UTM 38N) groups nearby reports by topic. The radius is 25–80 m depending on the topic.
2. **One vote per person:** only each user's latest report in a cluster counts.
3. **Weighting:** each vote is weighted by the **reporter's learned trust** × **time decay**. The half-life depends on the topic: 1 h for traffic, 12 h for closures and flooding, 90 days for buildings.
4. **Probability:** `p = sigmoid(−2 + 1.8 · Σ ±weight)`. "Road is open" votes subtract.
5. **Publishing:** an alert with p ≥ 0.2 appears as *suspected* (faded, and asks passers-by "Is it still there?"). It becomes *confirmed* at p ≥ 0.6 with at least 2 different people.
6. **Online learning:** once a cluster is decisive (p ≥ 0.8, at least 3 voters), each reporter's Beta(agreed + 2, disagreed + 2) reputation is updated. Reliable reporters then count for more, and people who disagree with the consensus count for less.

Tested against the live database inside a rolled-back transaction:

| Reports | Result |
| --- | --- |
| 1 user says closed | 25% · suspected |
| 2 users | 45% · suspected |
| **3 users** | **67% · confirmed for everyone** |
| 5 closed, 1 open | 83% · confirmed, and the 5 gain trust while the dissenter loses it |

Reviews feed the model too. If you tick *Road was closed*, closure reports are created where you left the route. If you tick *Place missing*, a "doesn't exist" report is created at the destination.

Confirmed closures become `exclude_polygons` for the Valhalla router. The guard trigger limits each user to 20 reports per hour and blocks duplicates within 40 m and 15 minutes. pg_cron re-runs the model every 10 minutes so old alerts fade.

## Language corpus

`corpus/en-so.tsv` is a parallel English → Somali corpus with **515 pairs**. Its columns are `english, somali, type, domain, source`. It is built from:

- every UI string (`src/i18n/en.json` ↔ `so.json`, 246 strings),
- the hand-written vocabulary and sentences in `corpus/vocabulary.tsv`, covering places, directions, conditions, questions and feedback,
- navigation templates expanded with real Mogadishu street names, distances, ordinals and compass directions.

```sh
npm run corpus   # rebuild corpus/en-so.tsv
npm run check    # typecheck + verify both languages have the same keys and {placeholders}
```

To add a string, add it to both JSON files and rebuild. The Somali translations should be reviewed by a native speaker before a store release.

## Run it

Node 22+.

```sh
npm ci
npx expo start
```

Scan the QR code with **Expo Go**. Every native module the app uses (WebView, Location, Speech, Keep Awake, Haptics, NetInfo) is part of Expo Go, so you don't need a custom build to try it.

Install builds with [EAS](https://docs.expo.dev/eas/):

```sh
npx eas-cli@latest build --profile preview --platform android   # installable APK
npx eas-cli@latest build --profile production --platform all
```

Copy `.env.example` to `.env` to point the app at a different Supabase project. Only use publishable keys there.

## Project layout

```
src/app/              Expo Router screens (map, settings, language, account, saved, districts, transport, developer, info)
src/components/       MapView (Leaflet in a WebView), sheets matching the Figma frames, shared UI
src/lib/              routing (Valhalla + OSRM fallback), guidance engine, search, community API, geo helpers
src/i18n/             en.json / so.json and the translation provider
src/vendor/leaflet.ts Leaflet inlined so the map shell works offline (npm run vendor:leaflet)
supabase/migrations/  community reports, consensus model, reviews (already applied to the hosted project)
corpus/               English → Somali corpus
```

## Data and credits

Roads, buildings and names: © OpenStreetMap contributors (ODbL), prepared by the Atlas project. Places: OpenStreetMap and Overture Maps. Districts: OCHA / HDX (CC BY-IGO). Base maps: Esri Light Gray Canvas and Esri World Imagery. Routing: Valhalla (FOSSGIS server) with an OSRM demo-server fallback.

The public routing servers have fair-use limits. Self-host Valhalla before heavy production use. Map data can be incomplete or out of date.
