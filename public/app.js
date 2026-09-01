// This frontend is static content served by Firebase Hosting; the backend
// is a separate standalone service deployed to Render (see repo-root
// Dockerfile and README) — Firebase Hosting on the Spark/free plan can't
// run Cloud Functions Gen 2, which needs a Blaze billing account, so the
// two halves of this app live on two different origins, same pattern as
// this account's gemstones_ai app. Replace API with your own Render service
// URL after your first `render` deploy (Render gives you a stable
// https://<service-name>.onrender.com URL once the service exists).
const API = 'https://bnn-astro-ai.onrender.com';
const KEY_STORAGE = 'bnn_anthropic_key';

let state = {
  apiKey: sessionStorage.getItem(KEY_STORAGE) || null,
  currentDetails: null,   // the birth-details form values used for the currently displayed reading
  currentReading: null
};

const TZ_OPTIONS = [
  ['-720', 'UTC-12:00'], ['-660', 'UTC-11:00'], ['-600', 'UTC-10:00'], ['-570', 'UTC-09:30'],
  ['-540', 'UTC-09:00'], ['-480', 'UTC-08:00'], ['-420', 'UTC-07:00'], ['-360', 'UTC-06:00'],
  ['-300', 'UTC-05:00'], ['-270', 'UTC-04:30'], ['-240', 'UTC-04:00'], ['-210', 'UTC-03:30'],
  ['-180', 'UTC-03:00'], ['-120', 'UTC-02:00'], ['-60', 'UTC-01:00'], ['0', 'UTC+00:00'],
  ['60', 'UTC+01:00'], ['120', 'UTC+02:00'], ['180', 'UTC+03:00'], ['210', 'UTC+03:30'],
  ['240', 'UTC+04:00'], ['270', 'UTC+04:30'], ['300', 'UTC+05:00'], ['330', 'UTC+05:30 (India/Sri Lanka)'],
  ['345', 'UTC+05:45'], ['360', 'UTC+06:00'], ['390', 'UTC+06:30'], ['420', 'UTC+07:00'],
  ['480', 'UTC+08:00'], ['540', 'UTC+09:00'], ['570', 'UTC+09:30'], ['600', 'UTC+10:00'],
  ['660', 'UTC+11:00'], ['720', 'UTC+12:00']
];

const EXTERNAL_TOOLS = [
  { name: 'Navtara Tool', url: 'https://vageesh22.github.io/Navtara-Tool/', desc: 'Nakshatra Tara / auspicious-timing calculator' },
  { name: 'Deva.guru Kundli', url: 'https://deva.guru/', desc: 'Cross-check Vedic birth chart (Kundli) generation' },
  { name: 'aaps.space Transit Book', url: 'https://aaps.space/transits/of/', desc: '500-year planetary transit dates almanac' },
  { name: 'Age Calculator', url: 'https://www.calculator.net/age-calculator.html', desc: 'Precise age / elapsed-time calculator' },
  { name: 'Bhrigu Chakra Paddhati (video)', url: 'https://youtu.be/RQgsmGhhNgY?si=DLaKrq6b56U8h295', desc: 'Reference technique walkthrough' }
];

function api(path, opts = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  // No Authorization header anywhere in this app — there is no auth. The
  // Anthropic key is sent only in the body of the one request that needs it
  // (see generateAiExplain), never as a header, never on any other call.
  return fetch(API + path, Object.assign({}, opts, { headers }))
    .then(async r => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Request failed');
      return data;
    });
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function val(id) { return document.getElementById(id).value.trim(); }

// ---------------- Session gate (Anthropic key entry) ----------------
function setApiKey(key) {
  state.apiKey = key;
  sessionStorage.setItem(KEY_STORAGE, key);
}

function endSession() {
  sessionStorage.removeItem(KEY_STORAGE);
  state.apiKey = null;
  state.currentDetails = null;
  state.currentReading = null;
  render();
}

function newClient() {
  // Clears the birth-details form and any displayed reading, WITHOUT
  // touching the Anthropic key in sessionStorage.
  state.currentDetails = null;
  state.currentReading = null;
  render();
}

function gateView() {
  return `
  <div class="auth-wrap card">
    <h2 style="margin-top:0;">Enter your Anthropic API key to begin</h2>
    <p style="color:var(--muted); font-size:13px;">
      This is your own key, used only for the AI-Generated Explanations feature. It stays in this
      browser tab only — it is never stored on any server, never written to a file or database, and
      disappears the moment you close this tab or click "End Session".
    </p>
    <label>Anthropic API key</label>
    <input type="password" id="gateKeyInput" placeholder="sk-ant-..." autocomplete="off" />
    <div class="error-msg hidden" id="gateError"></div>
    <div style="margin-top:16px;"><button id="gateContinueBtn" style="width:100%">Continue</button></div>
  </div>`;
}

function bindGateView() {
  const input = document.getElementById('gateKeyInput');
  const errEl = document.getElementById('gateError');
  const go = () => {
    errEl.classList.add('hidden');
    const keyVal = input.value.trim();
    if (!keyVal || !keyVal.startsWith('sk-ant-')) {
      errEl.textContent = 'Enter a valid Anthropic API key (it should start with "sk-ant-").';
      errEl.classList.remove('hidden');
      return;
    }
    setApiKey(keyVal);
    render();
  };
  document.getElementById('gateContinueBtn').onclick = go;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  input.focus();
}

// ---------------- Rendering ----------------
function render() {
  renderHeader();
  const main = document.getElementById('main');
  if (!state.apiKey) {
    main.innerHTML = gateView();
    bindGateView();
  } else if (state.currentReading) {
    main.innerHTML = readingView(state.currentReading);
    bindReadingView();
  } else {
    main.innerHTML = mainToolView();
    bindMainToolView();
  }
}

function renderHeader() {
  const box = document.getElementById('userBox');
  if (state.apiKey) {
    box.innerHTML = `
      ${state.currentReading ? '<button class="secondary" id="newClientBtn">New Client</button>' : ''}
      <button class="danger" id="endSessionBtn">End Session</button>`;
    const nc = document.getElementById('newClientBtn');
    if (nc) nc.onclick = newClient;
    document.getElementById('endSessionBtn').onclick = () => {
      if (confirm('End this session? Your Anthropic API key will be cleared and you will need to re-enter it.')) endSession();
    };
  } else {
    box.innerHTML = '';
  }
}

// ---------------- Main tool view: birth-details form for the current client ----------------
function mainToolView() {
  return `
  <div class="note-banner">
    This app computes real sidereal (Lahiri) planetary positions itself and applies the BNN rule set
    (Jeeva Lagna from Jupiter, trine/aspect combinations, the 70-combination catalogue, house significations)
    extracted from the bootcamp notes. Nothing about this client is saved anywhere — enter their details,
    generate the reading, download the report, then "New Client" for the next appointment.
  </div>
  <div class="card">
    <h2>Client birth details</h2>
    <div class="grid cols-2">
      <div><label>Name</label><input id="pfName" placeholder="Client's name" /></div>
      <div><label>Gender</label>
        <select id="pfGender"><option value="unspecified">Unspecified</option><option value="male">Male</option><option value="female">Female</option></select>
      </div>
      <div><label>Date of birth</label><input id="pfDob" type="date" /></div>
      <div><label>Time of birth (24h, local)</label><input id="pfTob" type="time" /></div>
      <div class="place-autocomplete">
        <label>Place of birth <span style="color:var(--muted); font-weight:400;">(type to search — lat/lon &amp; timezone resolve automatically)</span></label>
        <input id="pfPlace" placeholder="e.g. Jaipur, Rajasthan, India" autocomplete="off" />
        <div class="place-results hidden" id="placeResults"></div>
        <div class="tz-resolved hidden" id="tzResolved"></div>
      </div>
      <div>
        <label>Birth timezone <span style="color:var(--muted); font-weight:400;">(auto-filled from place; override if needed)</span></label>
        <select id="pfTz">${TZ_OPTIONS.map(([v, l]) => `<option value="${v}" ${v === '330' ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div>
    </div>
    <div class="error-msg hidden" id="pfError"></div>
    <div style="margin-top:16px; display:flex; gap:10px;">
      <button id="generateBtn">Generate Report</button>
    </div>
  </div>
  <div class="card">
    <h2>External cross-reference tools</h2>
    <div class="tool-links">
      ${EXTERNAL_TOOLS.map(t => `<a href="${t.url}" target="_blank" rel="noopener">${t.name}<small>${t.desc}</small></a>`).join('')}
    </div>
  </div>
  <div class="card">
    <h2>BNN knowledge base reference</h2>
    <p style="color:var(--muted); font-size:13.5px;">Full extracted bootcamp notes (methodology, all 70 combinations, houses, transits, progression, marriage, childbirth/health, profession).</p>
    <button class="secondary" id="viewKbBtn">Browse knowledge base</button>
    <div class="kb-viewer hidden" id="kbViewer"></div>
  </div>`;
}

let selectedPlace = null; // {displayName, lat, lon}
let placeSearchDebounce = null;

function bindMainToolView() {
  document.getElementById('generateBtn').onclick = onGenerateReport;
  bindPlaceAutocomplete();
  document.getElementById('viewKbBtn').onclick = async () => {
    const viewer = document.getElementById('kbViewer');
    if (viewer.classList.contains('hidden')) {
      if (!viewer.dataset.loaded) {
        const text = await fetch(API + '/api/knowledge/raw').then(r => r.text());
        viewer.textContent = text;
        viewer.dataset.loaded = '1';
      }
      viewer.classList.remove('hidden');
    } else viewer.classList.add('hidden');
  };
}

function bindPlaceAutocomplete() {
  const input = document.getElementById('pfPlace');
  const resultsBox = document.getElementById('placeResults');
  const tzBox = document.getElementById('tzResolved');
  selectedPlace = null;

  input.addEventListener('input', () => {
    selectedPlace = null;
    tzBox.classList.add('hidden');
    const q = input.value.trim();
    clearTimeout(placeSearchDebounce);
    if (q.length < 3) { resultsBox.classList.add('hidden'); resultsBox.innerHTML = ''; return; }
    placeSearchDebounce = setTimeout(async () => {
      try {
        const { results } = await api('/api/geo/search?q=' + encodeURIComponent(q));
        if (!results.length) { resultsBox.classList.add('hidden'); return; }
        resultsBox.innerHTML = results.map((r, i) => `<div data-i="${i}">${escapeHtml(r.displayName)}</div>`).join('');
        resultsBox.classList.remove('hidden');
        resultsBox.querySelectorAll('div').forEach(div => {
          div.onclick = async () => {
            const r = results[Number(div.dataset.i)];
            selectedPlace = r;
            input.value = r.displayName;
            resultsBox.classList.add('hidden');
            await tryResolveTimezone();
          };
        });
      } catch (e) { /* silent - geocoding is best-effort */ }
    }, 400);
  });

  document.addEventListener('click', (e) => {
    if (!resultsBox.contains(e.target) && e.target !== input) resultsBox.classList.add('hidden');
  });

  document.getElementById('pfDob').addEventListener('change', tryResolveTimezone);
  document.getElementById('pfTob').addEventListener('change', tryResolveTimezone);
}

async function tryResolveTimezone() {
  const tzBox = document.getElementById('tzResolved');
  const dob = val('pfDob'), tob = val('pfTob');
  if (!selectedPlace || !dob || !tob) return;
  try {
    const tz = await api('/api/geo/timezone', {
      method: 'POST',
      body: JSON.stringify({ lat: selectedPlace.lat, lon: selectedPlace.lon, dob, tob })
    });
    const select = document.getElementById('pfTz');
    const nearest = TZ_OPTIONS.reduce((best, [v]) => Math.abs(Number(v) - tz.offsetMinutes) < Math.abs(Number(best) - tz.offsetMinutes) ? v : best, TZ_OPTIONS[0][0]);
    select.value = nearest;
    tzBox.textContent = `Resolved: ${tz.tzName} — UTC${tz.offsetMinutes >= 0 ? '+' : ''}${(tz.offsetMinutes / 60).toFixed(2)} (${tz.abbreviation}) on this date, via IANA time zone database`;
    tzBox.classList.remove('hidden');
  } catch (e) {
    tzBox.textContent = 'Could not auto-resolve timezone — please check/set it manually.';
    tzBox.classList.remove('hidden');
  }
}

async function onGenerateReport() {
  const errEl = document.getElementById('pfError');
  errEl.classList.add('hidden');
  const details = {
    name: val('pfName'), gender: val('pfGender'), dob: val('pfDob'), tob: val('pfTob'),
    place: val('pfPlace'), tzOffsetMinutes: Number(document.getElementById('pfTz').value),
    lat: selectedPlace ? selectedPlace.lat : undefined,
    lon: selectedPlace ? selectedPlace.lon : undefined
  };
  if (!details.name || !details.dob || !details.tob) {
    errEl.textContent = 'Name, date of birth and time of birth are required.';
    errEl.classList.remove('hidden');
    return;
  }
  const btn = document.getElementById('generateBtn');
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = 'Generating…';
  try {
    const { reading } = await api('/api/chart/compute', { method: 'POST', body: JSON.stringify(details) });
    state.currentDetails = details;
    state.currentReading = reading;
    render();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = original;
  }
}

// ---------------- North Indian diamond (D1) chart ----------------
const PLANET_ABBR = { Sun: 'Su', Moon: 'Mo', Mars: 'Ma', Mercury: 'Me', Jupiter: 'Ju', Venus: 'Ve', Saturn: 'Sa', Rahu: 'Ra', Ketu: 'Ke' };
const SIGN_NUM = { Aries: 1, Taurus: 2, Gemini: 3, Cancer: 4, Leo: 5, Virgo: 6, Libra: 7, Scorpio: 8, Sagittarius: 9, Capricorn: 10, Aquarius: 11, Pisces: 12 };

// Fixed North Indian chart geometry: 12 house cells (house 1 = top kite,
// numbered clockwise), each as an SVG polygon + a label anchor point.
const NI_HOUSE_CELLS = [
  { house: 1, points: '150,0 75,75 150,150 225,75', label: [150, 20] },
  { house: 2, points: '150,0 300,0 225,75', label: [220, 30] },
  { house: 3, points: '300,0 300,150 225,75', label: [270, 60] },
  { house: 4, points: '300,150 225,75 150,150 225,225', label: [225, 150] },
  { house: 5, points: '300,150 300,300 225,225', label: [270, 240] },
  { house: 6, points: '300,300 150,300 225,225', label: [220, 270] },
  { house: 7, points: '150,300 225,225 150,150 75,225', label: [150, 280] },
  { house: 8, points: '150,300 0,300 75,225', label: [80, 270] },
  { house: 9, points: '0,300 0,150 75,225', label: [30, 240] },
  { house: 10, points: '0,150 75,225 150,150 75,75', label: [75, 150] },
  { house: 11, points: '0,150 0,0 75,75', label: [30, 60] },
  { house: 12, points: '0,0 150,0 75,75', label: [80, 30] }
];

function renderNorthIndianChart(vedicChart) {
  if (!vedicChart) return '<p style="color:var(--muted); font-size:13px;">Place coordinates are needed to plot the standard Ascendant-based chart — search a resolvable place of birth to see it.</p>';
  const ascSignNum = SIGN_NUM[vedicChart.ascendant.sign];
  const byHouse = {};
  for (let h = 1; h <= 12; h++) byHouse[h] = [];
  for (const [name, p] of Object.entries(vedicChart.planets)) byHouse[p.house].push({ name, ...p });

  const cells = NI_HOUSE_CELLS.map(cell => {
    const rashiNum = ((ascSignNum - 1 + (cell.house - 1)) % 12) + 1;
    const occupants = byHouse[cell.house];
    const planetLines = occupants.map((p, i) => {
      const abbr = PLANET_ABBR[p.name] + (p.retrograde ? 'ᴿ' : '');
      return `<tspan x="${cell.label[0]}" dy="${i === 0 ? 0 : 12}">${abbr}</tspan>`;
    }).join('');
    return `
      <polygon points="${cell.points}" class="ni-cell ${cell.house === 1 ? 'ni-lagna' : ''}" />
      <text x="${cell.label[0]}" y="${cell.label[1] - (occupants.length ? 10 : 0)}" class="ni-rashi">${rashiNum}</text>
      ${occupants.length ? `<text x="${cell.label[0]}" y="${cell.label[1] + 6}" class="ni-planets" text-anchor="middle">${planetLines}</text>` : ''}
    `;
  }).join('');

  return `
    <svg viewBox="0 0 300 300" class="ni-chart" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="298" height="298" class="ni-border" />
      ${cells}
    </svg>`;
}

// ---------------- Panchanga / Graha Info / Dasha ----------------
function fmtDMS(dms) { return `${dms.d}&deg;${String(dms.m).padStart(2, '0')}'${String(dms.s).padStart(2, '0')}"`; }
function fmtDate(iso) { return new Date(iso).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' }); }

function panchangaCard(p) {
  if (!p) return '';
  return `
  <div class="card">
    <h2>Pañchāṅga</h2>
    <div class="grid cols-3">
      <div><label style="margin-top:0;">Tithi</label>${p.tithi.name} <span style="color:var(--muted)">(${p.tithi.paksha})</span></div>
      <div><label style="margin-top:0;">Nakshatra (Moon)</label>${p.nakshatra.name} <span style="color:var(--muted)">pada ${p.nakshatra.pada}</span></div>
      <div><label style="margin-top:0;">Yoga</label>${p.yoga.name}</div>
      <div><label style="margin-top:0;">Karana</label>${p.karana.name}</div>
      <div><label style="margin-top:0;">Vāra</label>${p.vara.name}</div>
      <div><label style="margin-top:0;">Ayanamsa</label>${p.ayanamsa}&deg; (Lahiri)</div>
      <div><label style="margin-top:0;">Sunrise</label>${p.sunrise ? new Date(p.sunrise).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}</div>
      <div><label style="margin-top:0;">Sunset</label>${p.sunset ? new Date(p.sunset).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}</div>
    </div>
  </div>`;
}

function grahaInfoCard(planets) {
  const rows = Object.entries(planets).map(([name, p]) => `
    <tr>
      <td><b>${name}</b></td>
      <td>${SIGN_GLYPH[p.sign] || ''} ${p.sign}</td>
      <td>${fmtDMS(p.dms)}</td>
      <td>${p.nakshatra.name} (${p.nakshatra.lord})</td>
      <td>${p.nakshatra.pada}</td>
      <td>${p.retrograde ? '<span class="tag retro">R</span>' : ''}</td>
    </tr>`).join('');
  return `
  <div class="card">
    <h2>Graha Info</h2>
    <table>
      <thead><tr><th>Planet</th><th>Sign</th><th>Degree</th><th>Nakshatra (Lord)</th><th>Pada</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function recommendationsCard(rec) {
  if (!rec) return '';
  const yogas = rec.notableYogas.length ? `
    <h3>Notable yogas &amp; combinations</h3>
    ${rec.notableYogas.map(y => `<div class="combo-item"><div class="combo-title">${escapeHtml(y.name)}</div><p>From combination #${y.fromCombo} (${y.planets}) — ${escapeHtml(y.context.replace(/\*\*/g, ''))}</p></div>`).join('')}
  ` : '';

  const remedies = rec.remedies.length ? `
    <h3>Remedies</h3>
    <ul style="margin:6px 0 0; padding-left:20px; font-size:13.5px; line-height:1.6;">
      ${rec.remedies.map(r => `<li><b>${escapeHtml(r.title)}:</b> ${escapeHtml(r.text)}</li>`).join('')}
    </ul>
  ` : '<p style="color:var(--muted); font-size:13px;">No specific remedies flagged for this chart — all planets show adequate BNN Rule 8 support.</p>';

  const c = rec.career;
  const envLine = (env) => {
    const words = { favorable: 'favorable', difficult: 'difficult', mixed: 'mixed (both support and friction)', neutral: 'neutral (no strong signal)' };
    return `${words[env.verdict]}${env.by.length ? ' — ' + env.by.join(', ') : ''}`;
  };
  const career = `
    <h3>Career &amp; education (BNN Sections 10.2&ndash;10.10)</h3>
    <p style="font-size:13.5px;"><b>Profession</b> (Saturn in ${c.saturnSign}): ${escapeHtml(c.profession)}<br/>
    Work environment (${c.workEnvironment.houseNote}): ${envLine(c.workEnvironment)}</p>
    <p style="font-size:13.5px;"><b>Education / business</b> (Mercury in ${c.mercurySign}): ${escapeHtml(c.education)}<br/>
    Study environment (${c.studyEnvironment.houseNote}): ${envLine(c.studyEnvironment)}</p>
    ${c.combinedNotes.length ? `<p style="font-size:13.5px;"><b>Additional flavor from connected planets:</b></p><ul style="margin:4px 0 0; padding-left:20px; font-size:13.5px; line-height:1.6;">${c.combinedNotes.map(n => `<li>${n.significator} + ${n.with}${n.keyword ? ' (' + n.keyword + ')' : ''}: ${escapeHtml(n.text)}</li>`).join('')}</ul>` : ''}
    ${c.foreignEducation.likely ? `<p style="font-size:13.5px; color:var(--saffron-deep, var(--saffron));"><b>Foreign education/connection indicated:</b> ${escapeHtml(c.foreignEducation.reasons.join('; '))}</p>` : ''}
  `;

  const focus = rec.focusAreas.length ? `
    <h3>Focus areas (Rule 8 — unsupported or friction-supported planets)</h3>
    <ul style="margin:6px 0 0; padding-left:20px; font-size:13.5px; line-height:1.6;">
      ${rec.focusAreas.map(f => `<li><b>${f.planet}</b> (${f.level}): ${escapeHtml(f.text)}</li>`).join('')}
    </ul>
  ` : '';

  return `
  <div class="card">
    <h2>Recommendations &amp; Suggestions</h2>
    <p style="color:var(--muted); font-size:12.5px;">Assembled from BNN's own remedy, career and strength rules (Sections 1.9, 7.4, 7.5, 10) applied to this chart — nothing generic or invented.</p>
    ${yogas}
    ${remedies}
    ${career}
    ${focus}
  </div>`;
}

function dashaCard(d) {
  if (!d) return '';
  const rows = d.mahadashas.map(e => `
    <tr>
      <td><b>${e.lord}</b>${e.isBirthDasha ? ' <span style="color:var(--muted); font-size:11px;">(running at birth)</span>' : ''}</td>
      <td>${fmtDate(e.start)}</td>
      <td>${fmtDate(e.end)}</td>
      <td>${e.years.toFixed(2)} yrs</td>
    </tr>`).join('');
  return `
  <div class="card">
    <h2>Vimshottari Mahadasha</h2>
    <p style="color:var(--muted); font-size:12.5px;">Standard 120-year dasha cycle from the Moon's birth nakshatra (${d.birthNakshatra.name}, lord ${d.birthNakshatra.lord}) — a conventional timing reference, separate from BNN's own combination-based method above.</p>
    <table>
      <thead><tr><th>Lord</th><th>Start</th><th>End</th><th>Duration</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

// ---------------- Nakshatra Profile / Parashari Cross-Ref / Live Navtara ----------------
function nakshatraDetailCard(detail) {
  if (!detail || !detail.moonNakshatra) return '';
  const n = detail.moonNakshatra;
  return `
  <div class="card">
    <h2>Nakshatra Profile (Moon)</h2>
    <p style="color:var(--muted); font-size:12.5px;">Standard Vedic Nakshatra reference for the natal Moon's nakshatra — separate from BNN's own methodology.</p>
    <div class="grid cols-3">
      <div><label style="margin-top:0;">Nakshatra</label>${escapeHtml(n.name)} <span style="color:var(--muted)">(lord ${escapeHtml(n.lord || '')})</span></div>
      <div><label style="margin-top:0;">Pada</label>${n.pada}</div>
      <div><label style="margin-top:0;">Navamsha sign</label>${escapeHtml(n.navamshaSign || '—')}</div>
      ${n.symbol ? `<div><label style="margin-top:0;">Symbol</label>${escapeHtml(n.symbol)}</div>` : ''}
      ${n.deity ? `<div><label style="margin-top:0;">Deity</label>${escapeHtml(n.deity)}</div>` : ''}
      ${n.rashi ? `<div><label style="margin-top:0;">Span</label>${escapeHtml(n.rashi)}</div>` : ''}
    </div>
    ${n.tagline ? `<p style="font-style:italic; margin-top:10px;">${escapeHtml(n.tagline)}</p>` : ''}
    ${n.predictions ? `<h3>Predictions</h3><p style="font-size:13.5px;">${escapeHtml(n.predictions)}</p>` : ''}
    ${n.thingsToDo ? `<h3>Things to do</h3><p style="font-size:13.5px;">${escapeHtml(n.thingsToDo)}</p>` : ''}
    ${n.remedies ? `<h3>Remedies</h3><p style="font-size:13.5px;">${escapeHtml(n.remedies)}</p>` : ''}
  </div>`;
}

function parasharicCrossRefCard(crossRef) {
  if (!crossRef) return '';
  const houseLordRows = crossRef.houseLords.map(h => `
    <tr>
      <td><b>${h.house}</b></td>
      <td>${escapeHtml(h.sign)}</td>
      <td>${escapeHtml(h.lordName)}</td>
      <td>${h.lordPlacedInHouse || '—'}</td>
      <td style="font-size:12.5px;">${escapeHtml(h.interpretation || '—')}</td>
    </tr>`).join('');
  const planetRows = crossRef.planetsInHouses.map(p => `
    <tr>
      <td><b>${escapeHtml(p.planet)}</b></td>
      <td>${p.house}</td>
      <td style="font-size:12.5px;">${escapeHtml(p.interpretation || '—')}</td>
    </tr>`).join('');
  return `
  <div class="card">
    <h2>Parashari Cross-Reference</h2>
    <p style="color:var(--muted); font-size:12.5px;">Standard Ascendant-based Parashari Jyotish (House Lords in Houses, Graha Phala) — conventional cross-reference, not BNN's own methodology.</p>
    <h3>House Lords</h3>
    <table>
      <thead><tr><th>House</th><th>Sign</th><th>Lord</th><th>Lord placed in house</th><th>Interpretation</th></tr></thead>
      <tbody>${houseLordRows}</tbody>
    </table>
    <h3 style="margin-top:16px;">Planets in Houses</h3>
    <table>
      <thead><tr><th>Planet</th><th>House</th><th>Interpretation</th></tr></thead>
      <tbody>${planetRows}</tbody>
    </table>
  </div>`;
}

function navtaraLiveCard(navtara) {
  if (!navtara) return '';
  const rows = navtara.transits.map(t => `
    <tr>
      <td><b>${escapeHtml(t.planet)}</b></td>
      <td>${escapeHtml(t.currentNakshatra)}</td>
      <td>${SIGN_GLYPH[t.currentSign] || ''} ${escapeHtml(t.currentSign)}</td>
      <td>${t.taraNumber} — ${escapeHtml(t.taraName || '')}</td>
      <td style="font-size:12.5px;">${escapeHtml(t.auspiciousness || '—')}</td>
      <td style="font-size:12.5px;">${escapeHtml(t.karakatva || '—')}</td>
    </tr>`).join('');
  return `
  <div class="card" id="navtaraLiveCard">
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
      <h2 style="margin:0;">Live Transit Reading (Navtara Chakra)</h2>
      <button class="secondary" id="navtaraRefreshBtn">&#8635; Refresh</button>
    </div>
    <p style="color:var(--muted); font-size:12.5px;">
      <span class="live-dot"></span>
      As of <span id="navtaraAsOf">${new Date(navtara.asOf).toLocaleString('en-IN')}</span> —
      reflects the sky at the moment of viewing, not the birth chart itself. Natal Moon Nakshatra (Janma): <b>${escapeHtml(navtara.natalMoonNakshatra)}</b>.
    </p>
    <table>
      <thead><tr><th>Planet</th><th>Current Nakshatra</th><th>Sign</th><th>Tara</th><th>Auspiciousness</th><th>Karakatva</th></tr></thead>
      <tbody id="navtaraTransitBody">${rows}</tbody>
    </table>
  </div>`;
}

// Stateless refresh: resend the birth details already held in memory
// (state.currentDetails) — there is no stored chart/chartId to reference.
async function refreshNavtaraLive(btn) {
  const original = btn ? btn.innerHTML : null;
  if (btn) { btn.disabled = true; btn.innerHTML = 'Refreshing…'; }
  try {
    const data = await api('/api/chart/navtara-live', { method: 'POST', body: JSON.stringify(state.currentDetails) });
    state.currentReading.navtaraLive = data.navtara;
    const card = document.getElementById('navtaraLiveCard');
    if (card) card.outerHTML = navtaraLiveCard(data.navtara);
    const newBtn = document.getElementById('navtaraRefreshBtn');
    if (newBtn) newBtn.onclick = () => refreshNavtaraLive(newBtn);
  } catch (e) {
    alert(e.message);
    if (btn) { btn.disabled = false; btn.innerHTML = original; }
  }
}

// ---------------- AI-Generated Explanations ----------------
const AI_SECTION_HEADINGS = ['Summary', 'Notable Combinations Explained', 'House-by-House Highlights', 'Remedies & Suggestions Explained'];

function parseAiSectionsClient(text) {
  const lines = String(text).split('\n');
  const found = [];
  let current = null;
  for (const line of lines) {
    const trimmed = line.trim().replace(/^#+\s*/, '').replace(/\*\*/g, '').replace(/:$/, '');
    const matchHeading = AI_SECTION_HEADINGS.find(h => h.toLowerCase() === trimmed.toLowerCase());
    if (matchHeading) { current = { heading: matchHeading, body: '' }; found.push(current); }
    else if (current) current.body += (current.body ? '\n' : '') + line;
  }
  if (found.length < 2) return null;
  found.forEach(s => { s.body = s.body.trim(); });
  return found;
}

function aiExplanationBodyHtml(aiExplanation) {
  const sections = parseAiSectionsClient(aiExplanation.text);
  const genLine = `<p style="color:var(--muted); font-size:12px;">Generated via your own Anthropic API key on ${new Date(aiExplanation.generatedAt).toLocaleString('en-IN')} (model: ${escapeHtml(aiExplanation.model || 'claude-sonnet-5')}).</p>`;
  if (sections) {
    return genLine + sections.map(s => `<h3>${escapeHtml(s.heading)}</h3><p style="font-size:13.5px; white-space:pre-wrap;">${escapeHtml(s.body)}</p>`).join('');
  }
  return genLine + `<p style="font-size:13.5px; white-space:pre-wrap;">${escapeHtml(aiExplanation.text)}</p>`;
}

function aiExplainCard() {
  const existing = state.currentReading.aiExplanation;
  if (existing) {
    return `
    <div class="card" id="aiExplainCard">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
        <h2 style="margin:0;">AI-Generated Explanations</h2>
        <button class="secondary" id="aiExplainRegenBtn">Regenerate</button>
      </div>
      <div id="aiExplainBody">${aiExplanationBodyHtml(existing)}</div>
    </div>`;
  }
  return `
  <div class="card" id="aiExplainCard">
    <h2>AI-Generated Explanations</h2>
    <p style="color:var(--muted); font-size:13px;">Turn this deterministic BNN reading into warm, plain-language prose using your own Anthropic API key (already entered this session). Nothing beyond this reading's data is sent.</p>
    <button id="aiExplainGenBtn">Generate AI Explanations</button>
    <div id="aiExplainBody"></div>
  </div>`;
}

function bindAiExplainCard() {
  const genBtn = document.getElementById('aiExplainGenBtn');
  if (genBtn) genBtn.onclick = (e) => generateAiExplain(e.target);
  const regenBtn = document.getElementById('aiExplainRegenBtn');
  if (regenBtn) regenBtn.onclick = (e) => generateAiExplain(e.target);
}

async function generateAiExplain(btn) {
  // Defensive check — should be impossible given the gate screen, but never
  // send an empty/missing key.
  if (!state.apiKey) { endSession(); return; }

  const original = btn.textContent;
  btn.disabled = true; btn.textContent = 'Generating…';
  const bodyEl = document.getElementById('aiExplainBody');
  if (bodyEl) bodyEl.innerHTML = '<p style="color:var(--muted); font-size:13px;">Contacting Claude — this can take a few seconds…</p>';
  try {
    const data = await api('/api/chart/ai-explain', {
      method: 'POST',
      body: JSON.stringify({ reading: state.currentReading, apiKey: state.apiKey })
    });
    state.currentReading.aiExplanation = { text: data.text, generatedAt: data.generatedAt, model: data.model };
    const card = document.getElementById('aiExplainCard');
    if (card) { card.outerHTML = aiExplainCard(); bindAiExplainCard(); }
  } catch (e) {
    if (bodyEl) bodyEl.innerHTML = `<p class="error-msg">${escapeHtml(e.message)}</p>`;
    btn.disabled = false; btn.textContent = original;
  }
}

// ---------------- Reading view ----------------
const SIGN_GLYPH = { Aries:'♈', Taurus:'♉', Gemini:'♊', Cancer:'♋', Leo:'♌', Virgo:'♍', Libra:'♎', Scorpio:'♏', Sagittarius:'♐', Capricorn:'♑', Aquarius:'♒', Pisces:'♓' };

function readingView(r) {
  const planetsRows = Object.entries(r.planets).map(([name, p]) => `
    <tr>
      <td><b>${name}</b></td>
      <td>${SIGN_GLYPH[p.sign] || ''} ${p.sign}</td>
      <td>${p.degree}&deg;</td>
      <td>House ${p.house}</td>
      <td>${p.retrograde ? '<span class="tag retro">Retrograde</span>' : ''}</td>
      <td>${strengthTag(r.strength[name])}</td>
    </tr>`).join('');

  const trineBoxes = [1, 2, 3, 4].map(g => {
    const items = r.trines[g] || [];
    const houseLabel = { 1: '1 · 5 · 9 (Fire)', 2: '2 · 6 · 10 (Earth)', 3: '3 · 7 · 11 (Air)', 4: '4 · 8 · 12 (Water)' }[g];
    return `<div class="trine-box"><h4>Houses ${houseLabel}</h4>${items.length ? items.map(p => `<div class="p">${p.name} — ${p.sign} ${p.degreeInSign.toFixed(1)}&deg; (H${p.house})</div>`).join('') : '<div class="p" style="color:var(--muted)">empty</div>'}</div>`;
  }).join('');

  const combos = r.combosFound.slice().sort((a, b) => a.num - b.num).map(c => `
    <div class="combo-item">
      <div class="combo-title">#${c.num} &nbsp;${c.behind} → ${c.ahead} <span style="color:var(--muted); font-weight:400;">(${c.relType === 'trine' ? 'trine combination' : 'next-house combination'})</span></div>
      <p>${escapeHtml(c.text)}</p>
    </div>`).join('') || '<p style="color:var(--muted)">No cataloged pair-combinations detected in this chart\'s trine/next-house relationships.</p>';

  const houses = r.houseReadings.map(h => `
    <div class="house-card" data-house="${h.house}">
      <div class="house-head">
        <h4>House ${h.house}${h.title ? ' — ' + escapeHtml(h.title) : ''}</h4>
        <span class="house-occupants">${h.occupants.length ? h.occupants.map(o => o.name).join(', ') : 'empty'}</span>
      </div>
      <div class="house-body">
        ${h.lines.map(l => `<p class="planet-line"><b>${l.planet}${l.retrograde ? ' (R)' : ''}:</b> ${escapeHtml(l.text)}</p>`).join('')}
        ${h.emptyNote ? `<p style="color:var(--muted)">${escapeHtml(h.emptyNote)}</p>` : ''}
        ${h.generalNotes && h.generalNotes.length && !h.lines.length ? h.generalNotes.map(n => `<p>${escapeHtml(n)}</p>`).join('') : ''}
      </div>
    </div>`).join('');

  return `
  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 16px; flex-wrap:wrap; gap:10px;">
    <div>
      <h2 style="margin:0;">${escapeHtml(r.meta.name || 'Chart')}</h2>
      <div style="color:var(--muted); font-size:13px;">${escapeHtml(r.meta.place || '')} &middot; Jeeva Lagna: <b style="color:var(--accent)">${r.jeevaLagna.sign}</b> &middot; Ayanamsa ${r.ayanamsa}&deg;</div>
    </div>
    <div style="display:flex; gap:8px;">
      <button class="secondary" id="downloadDocxBtn">Download .docx</button>
      <button class="secondary" id="downloadPdfBtn">Download .pdf</button>
    </div>
  </div>

  <div class="card">
    <h2>Vedic Kundli (D1, North Indian style)</h2>
    <div class="grid cols-2" style="align-items:start;">
      <div>${renderNorthIndianChart(r.vedicChart)}</div>
      <div>
        ${r.vedicChart ? `<p style="font-size:13.5px;">Lagna (Ascendant): <b style="color:var(--saffron)">${r.vedicChart.ascendant.sign} ${r.vedicChart.ascendant.degree}&deg;</b><br/>Lagna Nakshatra: ${r.vedicChart.ascendant.nakshatra.name}, pada ${r.vedicChart.ascendant.nakshatra.pada}</p>
        <p style="color:var(--muted); font-size:12.5px;">This is the conventional Ascendant-based chart (as shown by Kundli sites like Deva.guru) for cross-reference. BNN's own analysis below does not use the Ascendant — it anchors houses on Jupiter (the Jeeva Lagna) instead.</p>` : ''}
      </div>
    </div>
  </div>

  ${panchangaCard(r.panchanga)}
  ${grahaInfoCard(r.planets)}
  ${dashaCard(r.vimshottariDasha)}

  <div class="card">
    <h2>BNN planetary positions &amp; houses (from Jeeva Lagna / Jupiter)</h2>
    <table>
      <thead><tr><th>Planet</th><th>Sign</th><th>Degree</th><th>House (from Jeeva Lagna)</th><th></th><th>Rule 8 strength</th></tr></thead>
      <tbody>${planetsRows}</tbody>
    </table>
  </div>

  <div class="card">
    <h2>Trine groups (Rule 2 — planets in trine are treated as conjunct)</h2>
    <div class="trine-groups">${trineBoxes}</div>
  </div>

  <div class="card">
    <h2>Matched planetary combinations</h2>
    ${combos}
  </div>

  <div class="card">
    <h2>House-by-house reading</h2>
    <p style="color:var(--muted); font-size:13px;">Click a house to expand.</p>
    ${houses}
  </div>

  ${recommendationsCard(r.recommendations)}

  ${nakshatraDetailCard(r.nakshatraDetail)}
  ${parasharicCrossRefCard(r.parasharicCrossRef)}
  <div id="navtaraLiveContainer">${r.navtaraLive ? navtaraLiveCard(r.navtaraLive) : '<div class="card" id="navtaraLiveCard"><h2>Live Transit Reading (Navtara Chakra)</h2><p style="color:var(--muted); font-size:13px;">Loading live transits…</p></div>'}</div>

  ${aiExplainCard()}

  <div class="card">
    <h2>Cross-reference this chart externally</h2>
    <div class="tool-links">
      ${EXTERNAL_TOOLS.map(t => `<a href="${t.url}" target="_blank" rel="noopener">${t.name}<small>${t.desc}</small></a>`).join('')}
    </div>
  </div>
  `;
}

function strengthTag(s) {
  if (!s) return '';
  const label = { strong: 'Strong', challenged: 'Challenged', isolated: 'Isolated' }[s.level] || s.level;
  return `<span class="tag ${s.level}">${label}</span>`;
}

async function downloadReport(format, btn) {
  const original = btn.textContent;
  btn.textContent = 'Preparing…';
  btn.disabled = true;
  try {
    const res = await fetch(`${API}/api/report/${format}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reading: state.currentReading })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Download failed');
    }
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : `chart.${format}`;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert(e.message);
  } finally {
    btn.textContent = original;
    btn.disabled = false;
  }
}

function bindReadingView() {
  document.querySelectorAll('.house-card').forEach(card => {
    card.querySelector('.house-head').onclick = () => card.classList.toggle('open');
  });
  const docxBtn = document.getElementById('downloadDocxBtn');
  const pdfBtn = document.getElementById('downloadPdfBtn');
  if (docxBtn) docxBtn.onclick = () => downloadReport('docx', docxBtn);
  if (pdfBtn) pdfBtn.onclick = () => downloadReport('pdf', pdfBtn);

  const navtaraBtn = document.getElementById('navtaraRefreshBtn');
  if (navtaraBtn) navtaraBtn.onclick = () => refreshNavtaraLive(navtaraBtn);
  if (!state.currentReading.navtaraLive) {
    // First view of this reading: fetch the live transit snapshot automatically.
    refreshNavtaraLive(null);
  }

  bindAiExplainCard();
}

// ---------------- init ----------------
render();
