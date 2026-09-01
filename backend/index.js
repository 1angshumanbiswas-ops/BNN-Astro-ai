// BNN_ASTRO_AI backend — standalone Express service, deployed as a Docker
// container on Render (see repo-root Dockerfile). Fully stateless.
//
// This runs on Render rather than Firebase Cloud Functions because the
// Firebase project this app's frontend is hosted under (angshuman-ai-corp)
// is on the Spark (free) plan, and Cloud Functions 2nd gen requires a Blaze
// (billing-enabled) plan — the same reason this account's other app,
// gemstones_ai, also runs its backend on Render instead of Cloud Functions.
// This file matches that exact working pattern.
//
// No auth, no accounts, no database, no persisted client data. Every request
// is self-contained: the astrologer's Anthropic API key travels only in the
// one request that needs it (ai-explain) and is never written to disk, a
// log line, or any datastore. Birth details for a client are never saved
// server-side either — the client (browser) holds the in-memory reading and
// resends whatever it needs (birth details for a navtara-live refresh, the
// full reading object for a report download).

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { buildReading } = require('./lib/bnnEngine');
const { searchPlace, resolveTimezone } = require('./lib/geocode');
const { buildDocx, buildPdf } = require('./lib/reportGenerator');
const { computeLiveNavtaraTransits } = require('./lib/navtaraEngine');
const { generateExplanations } = require('./lib/aiExplain');

const app = express();

app.use(cors());
app.use(express.json({ limit: '5mb' })); // a full reading + AI explanation can be a sizeable JSON body

// ---------- Place & timezone resolution (unchanged, no auth needed) ----------
app.get('/api/geo/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    const results = await searchPlace(q);
    res.json({ results });
  } catch (e) {
    res.status(502).json({ error: 'Place lookup failed: ' + e.message });
  }
});

app.post('/api/geo/timezone', (req, res) => {
  try {
    const { lat, lon, dob, tob } = req.body || {};
    if (lat === undefined || lon === undefined || !dob || !tob) {
      return res.status(400).json({ error: 'lat, lon, dob, tob are required' });
    }
    const tz = resolveTimezone(Number(lat), Number(lon), dob, tob);
    if (!tz) return res.status(404).json({ error: 'Could not resolve a timezone for this location' });
    res.json(tz);
  } catch (e) {
    res.status(500).json({ error: 'Timezone resolution failed: ' + e.message });
  }
});

// ---------- Knowledge base browsing (reference material) ----------
app.get('/api/knowledge/raw', (req, res) => {
  const kbPath = path.join(__dirname, 'knowledge', 'bnn_knowledge_base.md');
  res.type('text/markdown').send(fs.readFileSync(kbPath, 'utf8'));
});

// ---------- Chart computation (stateless: birth details in, reading out) ----------
function detailsToUtcDate(d) {
  // dob: YYYY-MM-DD, tob: HH:MM (local time), tzOffsetMinutes: minutes EAST of UTC (e.g. IST = 330)
  const [y, m, day] = d.dob.split('-').map(Number);
  const [hh, mm] = d.tob.split(':').map(Number);
  const utcMillis = Date.UTC(y, m - 1, day, hh, mm) - d.tzOffsetMinutes * 60000;
  return new Date(utcMillis);
}

function validateBirthDetails(body) {
  const { name, dob, tob, tzOffsetMinutes } = body || {};
  if (!name || !dob || !tob || tzOffsetMinutes === undefined) {
    return 'name, dob (YYYY-MM-DD), tob (HH:MM), tzOffsetMinutes are required';
  }
  return null;
}

app.post('/api/chart/compute', (req, res) => {
  try {
    const details = req.body || {};
    const err = validateBirthDetails(details);
    if (err) return res.status(400).json({ error: err });

    const birthUtc = detailsToUtcDate(details);
    const reading = buildReading(birthUtc, {
      name: details.name, gender: details.gender, place: details.place,
      tzOffsetMinutes: details.tzOffsetMinutes,
      lat: details.lat !== undefined ? Number(details.lat) : null,
      lon: details.lon !== undefined ? Number(details.lon) : null
    });
    res.json({ reading });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to compute chart: ' + e.message });
  }
});

// Live Navtara Chakra transits: recompute enough of the natal chart (from
// the birth details resent by the client - there is no stored chart to
// reference) to get the Moon's natal nakshatra, then score today's sky
// against it. No chartId anywhere - this is deliberately independent state.
app.post('/api/chart/navtara-live', (req, res) => {
  try {
    const details = req.body || {};
    const err = validateBirthDetails(details);
    if (err) return res.status(400).json({ error: err });

    const birthUtc = detailsToUtcDate(details);
    const reading = buildReading(birthUtc, {
      name: details.name, gender: details.gender, place: details.place,
      tzOffsetMinutes: details.tzOffsetMinutes,
      lat: details.lat !== undefined ? Number(details.lat) : null,
      lon: details.lon !== undefined ? Number(details.lon) : null
    });
    const navtara = computeLiveNavtaraTransits(reading);
    res.json({ navtara });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to compute live Navtara transits: ' + e.message });
  }
});

// ---------- AI-Generated Explanations (astrologer's own key, used once, discarded) ----------
app.post('/api/chart/ai-explain', async (req, res) => {
  try {
    const { reading, apiKey } = req.body || {};
    if (!reading) return res.status(400).json({ error: 'reading is required' });
    if (typeof apiKey !== 'string' || !apiKey.trim() || !apiKey.startsWith('sk-ant-')) {
      return res.status(400).json({ error: 'Provide your Anthropic API key (it should start with "sk-ant-").' });
    }

    let text;
    try {
      text = await generateExplanations(reading, apiKey.trim());
    } catch (e) {
      // aiExplain.js's error messages are already safe (never include key material)
      return res.status(502).json({ error: e.message });
    }

    res.json({ text, generatedAt: new Date().toISOString(), model: 'claude-sonnet-5' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to generate AI explanations: ' + e.message });
  }
});

// ---------- Downloadable report (.docx / .pdf) — whole reading arrives in the body ----------
function safeFileName(name) {
  return (name || 'chart').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'chart';
}

app.post('/api/report/docx', async (req, res) => {
  try {
    const { reading } = req.body || {};
    if (!reading) return res.status(400).json({ error: 'reading is required' });
    const buffer = await buildDocx(reading);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="BNN_${safeFileName(reading.meta && reading.meta.name)}.docx"`);
    res.send(buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to generate Word report: ' + e.message });
  }
});

app.post('/api/report/pdf', async (req, res) => {
  try {
    const { reading } = req.body || {};
    if (!reading) return res.status(400).json({ error: 'reading is required' });
    const buffer = await buildPdf(reading);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="BNN_${safeFileName(reading.meta && reading.meta.name)}.pdf"`);
    res.send(buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to generate PDF report: ' + e.message });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'BNN_ASTRO_AI', mode: 'stateless' }));

// Render sets PORT itself and expects the container to listen on it.
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`BNN_ASTRO_AI backend listening on port ${PORT} (stateless, no accounts, nothing persisted)`);
});
