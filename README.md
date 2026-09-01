# BNN_ASTRO_AI

A working prototype for **Bhrigu Nandi Nadi (BNN)** chart analysis: a genuine
**Swiss Ephemeris**-powered sidereal (Lahiri) planetary engine with automatic
place/timezone resolution, and a deterministic interpretation engine built
directly from the BNN bootcamp training notes (Jeeva Lagna, trine/aspect
combinations, the 70-combination catalogue, and the 12-house signification
matrix) — deployed as a stateless app with no accounts and nothing stored
server-side: a static frontend on **Firebase Hosting** and a standalone
**Express backend running in Docker on Render**.

## v10 update (this pass): backend moved off Cloud Functions, onto Render (Docker) — matching this account's existing gemstones_ai deployment

The v8 rebuild put the backend on Firebase Cloud Functions 2nd gen. That
requires a **Blaze (billing-enabled)** Firebase plan — and this account's
Firebase project (`angshuman-ai-corp`) is on the free **Spark** plan, so that
build would never actually have deployed. Checking this account's existing
`gemstones-ai` GitHub repo (same account, already live in production) showed
the real, working pattern for this account: frontend on Firebase Hosting,
backend as its own standalone Docker service on **Render**, connected via
Render's GitHub auto-deploy (push to `main` → Render rebuilds and redeploys
automatically, no manual step after the first setup). This pass moves BNN
onto that exact same pattern, so it deploys the same way `gemstones_ai`
already does.

**What changed:**
- `functions/` renamed to `backend/`; `functions/index.js`'s
  `exports.bnnAstroApi = onRequest(...)` wrapper replaced with a plain
  `app.listen(process.env.PORT || 8080, ...)` — a normal standalone Express
  server, no Firebase Functions dependency at all anymore.
- New root-level `Dockerfile` (multi-stage `node:20-slim`, `EXPOSE 8080`) and
  `.dockerignore`, built and verified against a real local Docker container
  in this session: `/api/health`, `/api/chart/compute`, `/api/chart/navtara-live`,
  and `/api/report/pdf` (a genuine 5-page PDF with the embedded chart image)
  all confirmed working end-to-end inside the container.
- `firebase.json` simplified — the `functions` rewrite block and codebase
  config are gone; Hosting now just serves `public/` with a plain SPA
  catch-all rewrite. Firebase Hosting no longer knows or cares that a backend
  exists; it's a separate service on a separate origin now.
- `public/app.js`'s API base changed from a same-origin/subpath-relative path
  to a hardcoded absolute Render URL (`const API = 'https://bnn-astro-ai.onrender.com';`,
  right at the top of the file) — replace that constant with your own
  service's actual Render URL once you've created it (see "Deploying" below).
  `app.use(cors())` was already present in the backend, so the cross-origin
  calls this now requires already work with no further change.
- Nothing about the BNN rule engine, the Anthropic-key session model, or the
  stateless request/response contract changed — every route, every library
  (`bnnEngine.js`, `aiExplain.js`, `chartImage.js`, `reportGenerator.js`,
  etc.) is byte-for-byte the same logic as v8/v9, just running in a plain
  Node process instead of a Cloud Functions wrapper.

**Why this is a better fit here, not just a workaround:** Render's Docker
runtime is a real, always-running Node process (not a request-scoped Cloud
Function), so `sweph`'s and `sharp`'s native bindings only need to resolve
once at container build time — which this session verified directly, instead
of the "should work, flagged as unverified" caveat v8's README carried for
Cloud Functions' build environment.

## v9: subpath-hosting frontend support (superseded below, folded into v10)

*(The subpath-aware `app.js` logic from this pass — deriving the API base
from `location.pathname` — was replaced in v10 by a hardcoded absolute Render
URL, since frontend and backend are now on two different origins and a
same-origin-relative path no longer makes sense. Frontend subpath hosting
itself — placing `public/`'s contents under
`www.yourdomain.com/BNN-Astro-ai/` — still works exactly as before; it's now
just a plain static-file placement with no API-path logic attached to it. See
"Deploying" below.)*

## v8: stateless rebuild for Firebase — no accounts, no stored data, no stored keys

You were explicit about how this should actually work day-to-day: an
astrologer opens the app, enters their own Anthropic API key once to start a
working session, then for each client who comes in enters that client's
birth date/time/location, generates the reading and report, downloads it, and
moves to the next client. Nothing about any client or any key should ever
touch a disk or a database — closing the browser tab should leave no trace.
That's a different shape than v1–v7's multi-user-accounts app, so this pass
is a full architectural rebuild, not an incremental feature.

**What was removed entirely:** the JWT/bcrypt auth system, the `/api/auth/*`
and `/api/profiles*` routes, the JSON-file datastore (`server/lib/db.js`,
`db.json`), the encrypted-at-rest Anthropic-key storage from v7
(`server/lib/crypto.js`, the Settings modal) — none of that fits "nothing
stored," so all of it is gone, not just unused.

**What replaced it:**
- **Session gate, browser-only.** On load, the app asks for an Anthropic API
  key (`sk-ant-...`) and holds it in `sessionStorage` — never `localStorage`,
  never sent anywhere except the one endpoint that needs it per request, and
  gone the instant the tab closes. There is no server-side concept of a
  logged-in user at all; the "login" is entirely a client-side gate.
- **Stateless compute-and-return API.** Every endpoint now takes exactly the
  data it needs in the request and returns a result — nothing is saved, so
  there is no chart id, no profile id, no history. `POST /api/chart/compute`
  takes birth details and returns the full reading; `POST /api/chart/ai-explain`
  takes that reading plus the astrologer's key (for that one call only) and
  returns explanation text; `POST /api/report/docx` / `/api/report/pdf` take
  whatever reading the browser currently holds (with or without AI text
  attached) and stream back the file. The browser tab is now the only place
  any of this data ever lives, and only for the duration of that tab.
- **Firebase Hosting for the frontend, no database.** *(v10 update: the
  backend described here as Cloud Functions was later moved to a standalone
  Render/Docker service — see the "v10 update" section above. This bullet is
  kept for history; "Architecture" and "Deploying" below reflect the current,
  actual layout.)*
- **Frontend flow:** gate screen → birth-details form → full reading (same
  cards as before: Kundli chart, Panchanga, Graha Info, Dasha, BNN
  combinations/houses, Nakshatra Profile, Parashari Cross-Reference, live
  Navtara transits, Recommendations, AI Explanations) → Download .docx/.pdf →
  **New Client** (clears the form, keeps the session's key) or **End Session**
  (clears everything, back to the gate screen).

**Verified:** booted the Firebase emulator suite (functions + hosting) and
curl-tested every new endpoint through the real Hosting→Functions rewrite
path (chart compute, live transits recomputed from resent birth details, the
ai-explain error paths with a missing/invalid key, and both report formats
with a manually-injected AI section) — all correct, and `pdfSafe()` still
prevents the pdfkit mojibake bug from recurring. Walked the full UI with
Playwright against the emulator: gate → key entry → generate a report → full
reading renders → **New Client** clears the form but keeps the key → **End
Session** returns to the gate. Grepped the whole codebase afterward for any
leftover `jsonwebtoken`, `bcrypt`, `db.json`, `Authorization: Bearer`, or
`localStorage` reference — none found.

**One residual risk, flagged honestly:** `sweph` and `sharp` both have native
bindings. They installed cleanly with prebuilt binaries (no from-source
compile) in this sandbox's Linux x64 environment, which is a reasonable but
not guaranteed proxy for Cloud Functions' actual build environment. Watch the
build log on your *first* `firebase deploy` for either package failing to
resolve a prebuilt binary — see "Deploying" below for what to do if that
happens.

## v7: per-user Anthropic API key + AI explanations + chart image in reports

*(Superseded by v8's stateless rebuild above — the Anthropic-key gate and AI
explanations feature this introduced are still here, just no longer stored
anywhere. Kept for history.)*

Added a Settings-panel-stored (later removed in v8), per-user Anthropic API
key, AES-256-GCM encrypted at rest; AI-Generated Explanations
(`server/lib/aiExplain.js`, now `functions/lib/aiExplain.js`) calling the
Anthropic Messages API (model `claude-sonnet-5`) with the deterministic
reading data, producing four labeled prose sections (Summary, Notable
Combinations Explained, House-by-House Highlights, Remedies & Suggestions
Explained), explicitly instructed not to invent new astrology beyond the
engine's own output, closing with a disclaimer; and a rasterized natal-chart
PNG (`server/lib/chartImage.js`, now `functions/lib/chartImage.js`, via
`sharp`) embedded at the top of both downloadable report formats, with the AI
explanations following the Recommendations & Suggestions section.

## v6: 7th-house combination fix

The user supplied a 44-page BNN primer ("BNN Guide" by Vaibhav Gupta) that
states the combination rule explicitly: a BNN combination forms when planets
share a trine, sit in adjacent houses ("next-house"), **or occupy mutual 7th
houses (aspect)** — "in all these cases we will call it a combination" — with
one carve-out: *Rahu and Ketu never form a 7th-house combination*.

`bnnEngine.js` already detected trine and next-house combinations and fed
them into the 70-combination catalogue lookup (`combosFound`), and it already
computed 7th-house aspect pairs — but only for Rule 8 planet-strength
scoring, never for combination predictions. That meant every reading was
silently missing an entire category of valid combinations (the guide's own
worked examples — Jupiter+Sun, Saturn+Moon, Mercury+Saturn, Venus+Moon, etc.
— all use 7th-house pairing as one of three valid formation routes).

Fixed: `aspect-7th` relationships are now looked up against the combination
catalogue (both directions, since a mutual-aspect pair has no inherent
ahead/behind order the way a trine or next-house pair does) and pushed into
`combosFound` exactly like trine/next-house combos, with a `NO_SEVENTH` guard
that skips any pair where either planet is Rahu or Ketu. Verified against
five independent test charts: 7th-house combos now surface correctly (e.g.
`Jupiter-Moon`, `Saturn-Moon`, `Jupiter-Venus`), and zero violations across
all runs where Rahu/Ketu were part of a 7th-house pair.

## v5: Nakshatra Nadi module + live transits + Parashari cross-reference

Built from a second batch of uploaded course material (Nakshatra Bootcamp
Classes 1, 2, 4, 5, 6, 7, Day-3 notes, House Lords in All Houses, Planets in
Houses) — all standard Vedic Jyotish reference material, kept clearly
separated from BNN's own methodology in the UI and reports, exactly like the
Panchanga/Dasha section.

- **Nakshatra Profile** (`nakshatraDetail.js`, `nakshatra_profiles.json`,
  `nakshatra_pada_navamsha.json`) — full profile of the natal Moon's
  nakshatra: rashi span, symbol, deity, personality/health predictions, an
  auspicious-activity action plan, and remedies. Also resolves the exact Pada
  (1-4) and its Navamsha (D9) sign.
- **Parashari Cross-Reference** (`parasharicRef.js`, `house_lords_in_houses.json`,
  `graha_phala.json`) — the standard Ascendant-based house-lord-in-house grid
  (144 combinations) and planet-in-house grid (108 combinations), explicitly
  labeled as a separate system from BNN's Jeeva-Lagna-based houses.
- **Live Navtara Transit Reading** (`navtaraEngine.js`, `navtara_chakra.json`)
  — today's planetary positions scored against the natal Moon nakshatra using
  the 9-star Navtara Chakra (Janma/Sampat/Vipat/Kshema/Pratyari/Sadhaka/
  Vadha/Mitra/Ati-Mitra), the Bhrigu Chakra Paddhati material this project
  was scoped around.

## v4: downloadable reports + Recommendations & Suggestions

- **Recommendations & Suggestions** (`recommendations.js`) — remedies
  (elemental/deity remedies for unsupported planets, remedy clauses parsed
  from matched combinations, the Saturn+Venus Vastu note), notable yogas
  (every named yoga/dosha in a matched combination), career & education
  (Saturn-sign→profession, Mercury-sign→education, 12th-house environment,
  trine-mate flavor, foreign-education flag), and focus areas (BNN Rule-8
  isolated/challenged planets).
- **Downloadable report**: `.docx` (via `docx`) or `.pdf` (via `pdfkit`),
  covering birth details, Vedic Kundli summary, Pañchāṅga, Graha Info, BNN
  houses/combinations/house-by-house, Recommendations, Vimshottari Dasha, and
  a disclaimer.
- **Bug found and fixed:** pdfkit's built-in fonts can't render
  Devanagari-style diacritics or the "→" glyph — mojibake. Added `pdfSafe()`
  (Unicode NFKD-fold + arrow replacement), PDF path only.

## v3: Deva.guru-style Kundli page

North Indian diamond (D1) SVG chart, sidereal Ascendant via Swiss Ephemeris
(`sweph.houses_ex`, Whole Sign — the first place the app needed the birth
place beyond timezone), Pañchāṅga, Graha Info table, Vimshottari Mahadasha
timeline — all computed locally, no third-party Kundli API. This conventional
Ascendant-based view sits alongside BNN's own Jeeva-Lagna analysis on the
same page, clearly labeled as the cross-reference chart.

## v2: precision & place lookup

Replaced the planetary engine with the official Swiss Ephemeris (`sweph`,
Moshier model, ~1 arcsecond accuracy, true lunar node for Rahu) — fixing a
real bug in the v1 prototype, which used `astronomy-engine`'s **heliocentric**
`EclipticLongitude()` for Mercury/Venus/Mars/Saturn/Moon instead of a
geocentric longitude (caught via Mercury's impossible 85° solar elongation).
Added automatic place→lat/lon (OpenStreetMap Nominatim) and historical
timezone resolution (`geo-tz` + `moment-timezone`). Saffron/marigold-gold/
deep-maroon theme on a light ivory ground.

## What this is (and isn't)

This is a **working prototype**, not a finished production product. It is
fully functional end-to-end — enter your Anthropic key, search a birth place,
get a real Swiss-Ephemeris-computed BNN reading, download a report — but a
few things are intentionally scoped down:

- **Nothing is stored, anywhere, by design.** No database, no accounts, no
  chart history. This is the whole point of the v8 rebuild, not a limitation
  — but it does mean there's no way to "come back tomorrow and see a client's
  chart again" unless you keep the downloaded report yourself. If a future
  version needs that, it would mean deliberately adding storage back (e.g.
  Firestore), which the user has explicitly not asked for.
- **Charts are computed locally**, not fetched from Navtara Tool / Deva.guru /
  aaps.space — those are linked as cross-reference tools, not data sources.
- **Deterministic rule coverage:** BNN Rules 1, 2 (including the v6 7th-house
  fix), 3/4, 5, 8, the full 70-combination lookup, and the 12-house matrix.
  Marriage/affair, childbirth/health, BNN's own transit/progression system,
  and Section 10.8's specific multi-planet profession combinations are
  extracted in the knowledge base and browsable in-app, but not yet wired
  into the automatic report.
- **Licensing note:** `sweph` bundles the Swiss Ephemeris library under
  AGPL-3.0-or-later (or a paid Astrodienst commercial license). Worth a
  deliberate read of https://www.astro.com/swisseph/ before treating this as
  a commercial hosted product.
- **Geocoding etiquette:** place search uses the free OpenStreetMap Nominatim
  API — fine for personal/small-scale use; self-host or switch to a paid
  geocoder for real production volume.
- **Anthropic usage/cost is the astrologer's own** — each AI-explanation call
  is billed to whichever key was entered that session. There's no usage
  tracking or budget cap in this app; that lives entirely in the astrologer's
  own Anthropic account/console.

## Architecture

```
bnn-astro-ai/
  Dockerfile             multi-stage node:20-slim build for the backend/ service — this is what Render builds and runs
  .dockerignore           keeps public/, .git, node_modules etc. out of the Docker build context
  firebase.json           Hosting only (public: "public") + a plain SPA catch-all rewrite (** -> /index.html) — no functions block
  .firebaserc              {"projects": {"default": "angshuman-ai-corp"}}
  package.json              minimal root placeholder
  backend/
    package.json             backend deps: express, cors, sweph, sharp, pdfkit, docx, geo-tz, moment-timezone (engines.node = 20) — no firebase-functions
    index.js                  Express app + app.listen(process.env.PORT || 8080, ...) — all /api routes, no auth middleware, cors() enabled
    lib/
      ephemeris.js          Swiss Ephemeris engine: planets, Ascendant, sunrise/sunset (sweph + Lahiri ayanamsa)
      geocode.js              place search (Nominatim) + historical timezone resolution
      panchanga.js             Tithi/Nakshatra/Yoga/Karana/Vara + nakshatra-pada helper
      dasha.js                  Vimshottari Mahadasha
      bnnEngine.js               BNN rule engine + Vedic/Panchanga/Dasha/Recommendations assembly
      recommendations.js          Recommendations & Suggestions (KB-derived)
      nakshatraDetail.js            natal Moon nakshatra profile + pada/navamsha
      parasharicRef.js                house-lord/planet-in-house cross-reference
      navtaraEngine.js                  live Navtara Chakra transit scoring
      aiExplain.js                       Anthropic Messages API call (per-request key, never stored)
      chartImage.js                       North Indian chart SVG -> PNG (sharp) for report embedding
      reportGenerator.js                   builds the downloadable .docx / .pdf
    data/                 combinations.json, houses.json, significators.json, nakshatras.json,
                          nakshatra_profiles.json, nakshatra_pada_navamsha.json, navtara_chakra.json,
                          profession_by_sign.json, profession_combos.json,
                          house_lords_in_houses.json, graha_phala.json
    knowledge/
      bnn_knowledge_base.md   full extracted BNN methodology (all 14 source PDFs)
    ephe/                 (Swiss Ephemeris data path placeholder; Moshier model needs no files here)
  public/
    index.html, app.js, style.css     single-page frontend (vanilla JS, no build step, sessionStorage-only key, hardcoded absolute Render API URL at top of app.js)
```

## Running it (local development)

Frontend and backend are two separate processes now, matching how they run
in production (two different origins).

```bash
# Backend — plain Node process, no emulator needed
cd backend && npm install && node index.js
# listens on http://localhost:8080

# Frontend — any static file server works; from the repo root:
npx firebase-tools emulators:start --only hosting
# open http://localhost:5000
```

For local testing, temporarily point `public/app.js`'s `API` constant at
`http://localhost:8080` instead of the production Render URL, then change it
back before deploying (or keep two values and comment/uncomment — this repo
doesn't add an env-based build step, in keeping with "no build step" for the
frontend).

No environment variables or `.env` file are needed for the backend — there is
nothing to configure, because there is nothing to authenticate against or
persist. Each astrologer using the app supplies their own Anthropic key at
the gate screen, in their own browser, every session.

### Deploying

This repo is meant to be deployed exactly the way this account's
`gemstones_ai` app already is: backend pushed to GitHub and auto-deployed by
Render as a Docker service, frontend's static files placed into this
account's existing Firebase Hosting site.

**1. Backend, on Render (one-time setup, then automatic):**
```bash
git init   # if this isn't already a git repo
git add .
git commit -m "BNN_ASTRO_AI backend for Render"
git remote add origin <your-new-github-repo-url>
git push -u origin main
```
Then in the Render dashboard: **New → Web Service → connect this GitHub
repo**. Render auto-detects the root `Dockerfile`. Leave the build/start
commands blank (the Dockerfile's own `CMD` handles it) and deploy. Render
gives you a stable URL like `https://bnn-astro-ai.onrender.com` once the
first deploy finishes. Every subsequent `git push` to `main` redeploys
automatically — no manual Render step after this first one.

**2. Point the frontend at that URL:**
Edit `public/app.js` — replace the placeholder in
`const API = 'https://bnn-astro-ai.onrender.com';` with your actual Render
service URL from step 1 (if you used the same service name, this is already
correct).

**3. Frontend, onto your existing Firebase Hosting site:**
Since `www.angshumanaicorp.com` already hosts many other app folders under
one Hosting `public/` directory, this app doesn't get its own
`firebase deploy` — you place its static files alongside the others, the
same way `gemstones_ai`'s frontend is placed. See the subpath section below
for the exact placement and note on `firebase.json`.

**Watch Render's build log on the first deploy for `sharp` or `sweph`
failing to resolve a prebuilt native binary** — this session verified both
install and run cleanly inside a real `node:20-slim` Docker container (the
same base image Render's Docker runtime uses), so this is a low-risk,
already-checked concern, not an open one the way it was for Cloud Functions'
unverified build environment in v8.

### Placing the frontend under your existing Firebase Hosting site

Your site already serves ~80 other app folders from one shared `public/`
directory (confirmed from the `gemstones_ai` precedent — same pattern
applies here). This repo's own `firebase.json`/`.firebaserc` are for running
this repo **standalone**; since that's not how this account's site works,
you don't deploy them as-is. Instead:

1. **Files:** copy this repo's `public/` contents into the `BNN-Astro-ai/`
   (or `bnn-astro-ai/`) subfolder of your existing site's public directory —
   i.e. `<your-existing-public-dir>/BNN-Astro-ai/index.html`,
   `.../BNN-Astro-ai/app.js`, `.../BNN-Astro-ai/style.css`. That's the folder
   your OneDrive-synced `Production\public\BNN-Astro-ai` already is.
2. **No backend merge needed anymore.** Unlike the old Cloud-Functions plan
   (v9 and earlier), there is no `functions/` code to merge into your
   existing Functions codebase, and no rewrite rule to add to your existing
   `firebase.json` — the backend lives entirely on Render, on its own
   origin, and the frontend just calls its absolute URL directly (that's
   what step 2 in "Deploying" above set up). Your existing Hosting
   `firebase.json` doesn't need to know BNN_ASTRO_AI exists at all, exactly
   like it doesn't need to know about `gemstones_ai`'s Orchestrator backend.
3. **Deploy** with whatever command you already use to publish your shared
   Hosting site (e.g. `firebase deploy --only hosting` from wherever your
   production `firebase.json` lives) — this picks up the new
   `BNN-Astro-ai/` folder along with everything else already in `public/`.

That matches exactly what you described for `gemstones_ai`: push the backend
to GitHub once, let Render auto-deploy it from then on, and the only ongoing
manual step on your end is adding the new folder under
`www.angshumanaicorp.com`.

## API summary

All routes are stateless — no auth, no ids, no persistence. Every response is
computed fresh from exactly what's in the request. The backend now runs on
its own Render origin (cross-origin from the frontend's Firebase Hosting
origin — `cors()` is enabled), not behind a Hosting `/api/**` rewrite.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/geo/search?q=` | place-name search → `[{displayName, lat, lon}]` (Nominatim) |
| POST | `/api/geo/timezone` | `{lat, lon, dob, tob}` → resolved IANA tz name + historical UTC offset |
| GET | `/api/knowledge/raw` | full knowledge-base markdown (used by the in-app viewer) |
| POST | `/api/chart/compute` | `{name, gender, dob, tob, place, tzOffsetMinutes, lat, lon}` → full BNN reading (nothing saved) |
| POST | `/api/chart/navtara-live` | same birth-details body → today's live Navtara Chakra transit reading, recomputed fresh each call |
| POST | `/api/chart/ai-explain` | `{reading, apiKey}` → `{text, generatedAt, model}` — `apiKey` used for this one call only, never stored, never logged |
| POST | `/api/report/docx` | `{reading}` (optionally with `aiExplanation` attached) → downloadable Word file |
| POST | `/api/report/pdf` | `{reading}` (optionally with `aiExplanation` attached) → downloadable PDF file |

## Suggested next steps

1. Wire Marriage/Affair and Childbirth/Health rules into the automatic
   report (currently reference-only in the knowledge base viewer). Section
   10.8's specific multi-planet profession combinations (e.g. Sa+Su+Me+Ke =
   astrologer) also not yet matched. Already structured in
   `functions/knowledge/bnn_knowledge_base.md` sections 8–10.
2. BNN's own transit/progression system specifically (bootcamp 8 & 9 — the
   12-year Jupiter "rounds" and the "string" timing technique) is a distinct
   method from the Navtara Chakra already built, and still reference-only.
3. Complete your first real Render deploy and confirm it matches this
   session's local Docker verification (it should — Render's Docker runtime
   and the `node:20-slim` image tested here are the same environment shape).
4. Broader production hardening if this ever serves real client traffic at
   scale: rate limiting on the compute/ai-explain endpoints (cheap to add
   even without accounts — e.g. Firebase App Check or a simple per-IP
   limiter), and a deliberate decision on the `sweph` AGPL-3.0-or-later
   licensing obligation for a hosted public service.
5. Have a BNN practitioner validate a batch of known charts (with known,
   verified birth data) against the engine's output before treating it as
   production-accurate — standard practice for any rule-encoded astrology
   system, not yet done here.
6. If highest possible ephemeris precision is ever needed (sub-arcsecond,
   eclipse/occultation-grade work), download the official Swiss Ephemeris
   `.se1` data files from astro.com and point `set_ephe_path` at them with
   `SEFLG_SWIEPH` instead of `SEFLG_MOSEPH` — the Moshier model used here is
   already far more than sufficient for natal/BNN chart work.
