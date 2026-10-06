# Magaalo — Mogadishu navigation (Expo)

A city map. A simpler way there.

Magaalo is a map-first mobile app for getting around Mogadishu, built with Expo from the
[Magaalo Mobile Figma design](https://www.figma.com/design/E7vZ3UmRtPabqO23aQP15I/Magaalo-Mobile-%25E2%2580%2594-Explore--Navigate---Contribute?node-id=7-424).
It uses the same map data and Supabase project as the
[Magaalo Atlas website](https://magaalo-mogadishu-atlas.amiinrealz.chatgpt.site) ([source](https://github.com/amiinreal/magaalo-mogadishu-atlas)).

The app is for everyday users. Moderator, operator and map-editing tools stay on the website.

## How it fits with the Magaalo Atlas website

The website is the app's **data and routing service** — the app uses the same map and the same features:

| | Source |
| --- | --- |
| Base maps | Same as the website: **Esri World Imagery** (default) and **OpenStreetMap** street tiles |
| Roads, buildings, road names | The website's vector tiles (Supabase storage, `/data/tiles` fallback), drawn with the website's renderer |
| Businesses & places | `/data/atlas.json` place records (2,820) and `/data/search-index.json` (3,063 names), plus the website's `/api/search` (Nominatim) |
| Districts | `/data/districts.geojson` with the website's colours and opacity |
| Directions | `/api/route` — **OSRM** for driving, walking and cycling; community-confirmed closures avoided |
| Road access points | `/data/network/*` from the road-network model (computed on the device until the website is republished) |
| Contributions | `/api/suggestions` (street name, missing building outline, business, bus/taxi stop, road problem) → the website's moderation queue; `/api/me/suggestions` |
| Community alerts | `/api/alerts`, `/api/reports`, `/api/reviews`, `/api/rating` (+ Supabase Realtime for live updates) |
| Approved community details, transport | `/api/suggestions` (approved), `/api/transport` |

Signed-in requests send the Supabase access token as `Authorization: Bearer …`, as described in the website's `docs/mobile.md`. If a newer website endpoint isn't deployed yet, the app falls back to the same Supabase tables / OSRM servers so it keeps working.

## What it does

- **Map** — the website's map: satellite or street, road network and names, building footprints from zoom 15, business/place dots with names, reviewed community details, live transport, districts, community alerts. Tap any road, building or place for details (address, phone, website, opening hours, source).
- **Search** — offline-cached index, Somali ↔ English synonyms (*suuq* → markets, *isbitaal* → hospitals), category chips, Discover cards, long-press to drop a pin.
- **Directions** — OSRM routes for driving, walking and cycling with alternatives; the route ends at the place's **access point on the road network** and a dashed line walks the last metres to the door.
- **Turn-by-turn** — GPS following, spoken prompts (Somali or English), rerouting, keep-awake, closure-ahead detours, and a developer **navigation simulator**.
- **Report** — road closed / open again, place or building, traffic, flooding, other; buildings: *exists* / *doesn't exist*. Combined into public alerts by the consensus model.
- **Improve the map** — the website's moderated suggestions with drawing tools: draw a street, outline a missing building, drop a business or stop, mark a missing road connection. Track them in *My suggestions*.
- **Review after arrival** — stars, issues, comment; *road was closed* and *place missing* also feed the alert model.
- **English first, Somali second**, saved places, sources & coverage (including the road-network analysis), privacy, developer tools.

## Road connections and the network model

The atlas repo's `scripts/build-network.mjs` rebuilds the road graph from the same tiles, finds that 99.7% of road length is connected, recognises 438 likely missing connections with a self-supervised machine-learning model (reviewed by moderators before anything is published), and links all 470,220 buildings and 2,815 places to their nearest point on the connected road network. The app routes to those access points. Details are in the [atlas README](https://github.com/amiinreal/magaalo-mogadishu-atlas#road-network-community-alerts-and-the-mobile-app).

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

Confirmed closures are avoided by the website's `/api/route` (an OSRM alternative that misses them, else a Valhalla detour). The guard trigger limits each user to 20 reports per hour and blocks duplicates within 40 m and 15 minutes. pg_cron re-runs the model every 10 minutes so old alerts fade.

## Language corpus

`corpus/en-so.tsv` is a parallel English → Somali corpus with **597 pairs**. Its columns are `english, somali, type, domain, source`. It is built from:

- every UI string (`src/i18n/en.json` ↔ `so.json`, 330 strings),
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
corpus/               English → Somali corpus
```

## Data and credits

Roads, buildings and names: © OpenStreetMap contributors (ODbL), prepared by the Atlas project. Places: OpenStreetMap and Overture Maps. Districts: OCHA / HDX (CC BY-IGO). Base maps: Esri World Imagery and OpenStreetMap tiles. Routing: OSRM (project demo and FOSSGIS car/foot/bike servers) through the Magaalo website; Valhalla only for closure detours.

The public routing servers have fair-use limits; self-host OSRM before heavy production use. Database migrations live in the atlas repo (`supabase/migrations`). Map data can be incomplete or out of date.
