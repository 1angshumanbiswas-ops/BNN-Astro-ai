// Core BNN (Bhrigu Nandi Nadi) interpretation engine.
// Implements the deterministic rules extracted from the bootcamp knowledge
// base (server/knowledge/bnn_knowledge_base.md, Section 1) on top of the
// sidereal planetary positions produced by ephemeris.js.
//
// Implements: Rule 1 (Jeeva Lagna from Jupiter), Rule 2 (trine = conjunct),
// Rules 3/4 (ahead/behind => plan/history), Rule 5 (7th aspect, friend/enemy),
// Rule 8 (planet strength via 2nd/12th/7th support), plus the 70-combination
// lookup and the 12-house signification matrix.

const fs = require('fs');
const path = require('path');
const { computeChart, computeAscendant, computeSunTimes } = require('./ephemeris');
const { computePanchanga, nakshatraOf, toDMS } = require('./panchanga');
const { computeVimshottariMahadasha } = require('./dasha');
const { buildRecommendations } = require('./recommendations');
const { buildParasharicCrossRef } = require('./parasharicRef');
const { buildNakshatraDetail } = require('./nakshatraDetail');

const combinations = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'combinations.json'), 'utf8'));
const houses = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'houses.json'), 'utf8'));
const significators = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'significators.json'), 'utf8'));

const SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];

const PLANET_ORDER = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn', 'Rahu', 'Ketu'];

const DEV_GRAH = new Set(['Sun', 'Moon', 'Mars', 'Jupiter', 'Ketu']);
const DANAV_GRAH = new Set(['Saturn', 'Venus', 'Mercury', 'Rahu']);
const CROSS_FRIENDS = [['Sun', 'Mercury'], ['Jupiter', 'Saturn'], ['Jupiter', 'Mercury']];

const DESTINY_MAKERS = new Set(['Sun', 'Venus', 'Mercury', 'Jupiter']);
const DESTINY_BREAKERS = new Set(['Saturn', 'Rahu', 'Ketu']);
const DESTINY_MODIFIERS = new Set(['Moon', 'Mars']);

function isFriendly(a, b) {
  if (a === b) return true;
  if (DEV_GRAH.has(a) && DEV_GRAH.has(b)) return true;
  if (DANAV_GRAH.has(a) && DANAV_GRAH.has(b)) return true;
  return CROSS_FRIENDS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

function findCombo(behind, ahead) {
  return combinations.find(c => c.behind === behind && c.ahead === ahead) || null;
}

/**
 * Build the full BNN reading for a computed chart.
 * @param {Date} birthUtc
 * @param {object} meta - { name, gender, place, tzOffsetMinutes, lat, lon }
 */
function buildReading(birthUtc, meta = {}) {
  const { ayanamsa, planets } = computeChart(birthUtc);

  // Nakshatra/pada + DMS degree for every graha (used by the Graha Info table)
  const grahaInfo = {};
  for (const [name, p] of Object.entries(planets)) {
    grahaInfo[name] = { nakshatra: nakshatraOf(p.longitude), dms: toDMS(p.degreeInSign) };
  }

  // Standard Vedic Rashi (D1) chart: sidereal Ascendant (Lagna) + Whole Sign
  // houses counted from the Ascendant's sign. This is the conventional
  // cross-reference chart (e.g. what deva.guru displays) - separate from
  // BNN's own Jupiter-anchored Jeeva Lagna used everywhere else in this
  // engine. Requires a birth place; omitted if lat/lon aren't available.
  let vedicChart = null;
  let panchanga = null;
  let vimshottariDasha = null;
  if (meta.lat !== undefined && meta.lat !== null && meta.lon !== undefined && meta.lon !== null) {
    const asc = computeAscendant(birthUtc, meta.lat, meta.lon);
    const vPlanets = {};
    for (const [name, p] of Object.entries(planets)) {
      const houseNum = ((p.signIndex - asc.signIndex + 12) % 12) + 1;
      vPlanets[name] = { sign: p.sign, house: houseNum, degree: +p.degreeInSign.toFixed(2), retrograde: p.retrograde };
    }
    vedicChart = {
      ascendant: { sign: asc.sign, degree: +asc.degreeInSign.toFixed(2), nakshatra: nakshatraOf(asc.longitude) },
      planets: vPlanets
    };

    const sunTimes = computeSunTimes(birthUtc, meta.lat, meta.lon);
    panchanga = {
      ...computePanchanga(planets.Sun.longitude, planets.Moon.longitude, birthUtc, meta.tzOffsetMinutes || 0),
      ...sunTimes,
      ayanamsa: +ayanamsa.toFixed(4)
    };

    vimshottariDasha = computeVimshottariMahadasha(planets.Moon.longitude, birthUtc, 1);
  }

  // Rule 1: Jeeva Lagna = Jupiter's sign = House 1
  const jupiterSignIndex = planets.Jupiter.signIndex;

  const withHouses = {};
  for (const [name, p] of Object.entries(planets)) {
    const houseNum = ((p.signIndex - jupiterSignIndex + 12) % 12) + 1;
    withHouses[name] = { ...p, house: houseNum };
  }

  // Group planets by house number, sorted by degreeInSign ascending within a house
  const byHouse = {};
  for (let h = 1; h <= 12; h++) byHouse[h] = [];
  for (const [name, p] of Object.entries(withHouses)) {
    byHouse[p.house].push({ name, ...p });
  }
  for (const h of Object.keys(byHouse)) {
    byHouse[h].sort((a, b) => a.degreeInSign - b.degreeInSign);
  }

  // Trine groups: houses {1,5,9}->1, {2,6,10}->2, {3,7,11}->3, {4,8,12}->0(=4)
  function trineGroup(h) { const g = h % 4; return g === 0 ? 4 : g; }
  const trines = { 1: [], 2: [], 3: [], 4: [] };
  for (let h = 1; h <= 12; h++) {
    trines[trineGroup(h)].push(...byHouse[h].map(p => ({ ...p })));
  }
  for (const g of Object.keys(trines)) {
    trines[g].sort((a, b) => a.degreeInSign - b.degreeInSign);
  }

  // --- Relationship detection ---
  // 1) Within-trine ahead/behind pairs (Rule 2/3/4)
  // 2) Next-house "ahead" pairs (planet in house+1 is always ahead of a planet in house h)
  // 3) 7th-house aspect pairs (Rule 5)
  const relationships = []; // { type, behind, ahead, comboBehindAhead, comboAheadBehind }

  for (const g of Object.keys(trines)) {
    const arr = trines[g];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        relationships.push({ type: 'trine', behind: arr[i].name, ahead: arr[j].name });
      }
    }
  }

  for (let h = 1; h <= 12; h++) {
    const nextH = (h % 12) + 1;
    if (byHouse[h].length && byHouse[nextH].length) {
      for (const p1 of byHouse[h]) {
        for (const p2 of byHouse[nextH]) {
          relationships.push({ type: 'next-house', behind: p1.name, ahead: p2.name });
        }
      }
    }
  }

  const seenAspect = new Set();
  for (let h = 1; h <= 12; h++) {
    const oppH = ((h + 5) % 12) + 1; // 7th from h
    const key = [h, oppH].sort().join('-');
    if (seenAspect.has(key)) continue;
    seenAspect.add(key);
    if (byHouse[h].length && byHouse[oppH].length) {
      for (const p1 of byHouse[h]) {
        for (const p2 of byHouse[oppH]) {
          relationships.push({ type: 'aspect-7th', a: p1.name, b: p2.name, friendly: isFriendly(p1.name, p2.name) });
        }
      }
    }
  }

  // Attach combination text (both directions matter per BNN methodology)
  const NO_SEVENTH = new Set(['Rahu', 'Ketu']); // BNN Guide rule: Rahu/Ketu do not form 7th-house combinations
  const combosFound = [];
  for (const rel of relationships) {
    if (rel.type === 'trine' || rel.type === 'next-house') {
      const c = findCombo(rel.behind, rel.ahead);
      if (c) combosFound.push({ relType: rel.type, behind: rel.behind, ahead: rel.ahead, num: c.num, text: c.text });
      const rc = findCombo(rel.ahead, rel.behind); // reverse reading, if catalogued distinctly, add as history-context
      if (rc && rc.num !== (c && c.num)) {
        // Only include reverse if it exists as its own catalogued row (rare) - avoid duplicate noise otherwise
      }
    } else if (rel.type === 'aspect-7th') {
      // BNN Guide (44-page primer, Rule 2 addendum): planets in mutual 7th houses
      // form a combination exactly like a trine or next-house pairing, EXCEPT
      // Rahu and Ketu never participate in a 7th-house combination.
      if (NO_SEVENTH.has(rel.a) || NO_SEVENTH.has(rel.b)) continue;
      const c1 = findCombo(rel.a, rel.b);
      const c2 = findCombo(rel.b, rel.a);
      const c = c1 || c2;
      if (c) {
        const behind = c1 ? rel.a : rel.b;
        const ahead = c1 ? rel.b : rel.a;
        combosFound.push({ relType: rel.type, behind, ahead, num: c.num, text: c.text });
      }
    }
  }

  // Rule 8: planet strength via 2nd/12th/7th support
  const strength = {};
  for (const name of PLANET_ORDER) {
    const h = withHouses[name].house;
    const second = byHouse[(h % 12) + 1] || [];
    const twelfth = byHouse[((h + 10) % 12) + 1] || [];
    const seventh = byHouse[((h + 5) % 12) + 1] || [];
    const supporters = [...second, ...twelfth, ...seventh].filter(p => p.name !== name);
    const friendlySupporters = supporters.filter(p => isFriendly(name, p.name));
    let level;
    if (supporters.length === 0) level = 'isolated';
    else if (friendlySupporters.length > 0) level = 'strong';
    else level = 'challenged';
    strength[name] = { level, supporters: supporters.map(s => s.name) };
  }

  // Empty-house fallback chain (Section 5.1)
  function emptyHouseNote(h) {
    const oppH = ((h + 5) % 12) + 1;
    if (byHouse[oppH].length) return `No planet directly here, but aspected from House ${oppH} (${byHouse[oppH].map(p => p.name).join(', ')}) - read via the 7th-aspect.`;
    const g = trineGroup(h);
    const trineOccupants = trines[g].filter(p => p.house !== h);
    if (trineOccupants.length) return `No planet here or in its 7th aspect; read via trine-mates: ${trineOccupants.map(p => p.name).join(', ')}.`;
    return `Empty house with no trine or 7th-aspect support - read using this house's general (karak tatwa) significations only.`;
  }

  // House-by-house narrative
  const houseReadings = [];
  for (let h = 1; h <= 12; h++) {
    const hdata = houses[h] || { title: '', planets: {}, notes: [] };
    const occupants = byHouse[h];
    const lines = [];
    for (const p of occupants) {
      const text = hdata.planets[p.name];
      if (text) lines.push({ planet: p.name, retrograde: p.retrograde, text });
    }
    houseReadings.push({
      house: h,
      title: hdata.title,
      occupants: occupants.map(p => ({ name: p.name, sign: p.sign, degree: +p.degreeInSign.toFixed(2), retrograde: p.retrograde })),
      lines,
      generalNotes: hdata.notes || [],
      emptyNote: occupants.length === 0 ? emptyHouseNote(h) : null
    });
  }

  const reading = {
    meta,
    birthUtc: birthUtc.toISOString(),
    ayanamsa: +ayanamsa.toFixed(4),
    jeevaLagna: { sign: SIGNS[jupiterSignIndex], signIndex: jupiterSignIndex },
    planets: Object.fromEntries(Object.entries(withHouses).map(([k, v]) => [k, {
      sign: v.sign, house: v.house, degree: +v.degreeInSign.toFixed(2), longitude: +v.longitude.toFixed(4), retrograde: v.retrograde,
      nakshatra: grahaInfo[k].nakshatra, dms: grahaInfo[k].dms
    }])),
    trines,
    combosFound,
    strength,
    houseReadings,
    destiny: {
      makers: PLANET_ORDER.filter(p => DESTINY_MAKERS.has(p) && true),
      breakers: PLANET_ORDER.filter(p => DESTINY_BREAKERS.has(p)),
      modifiers: PLANET_ORDER.filter(p => DESTINY_MODIFIERS.has(p))
    },
    significators,
    vedicChart,
    panchanga,
    vimshottariDasha
  };

  reading.recommendations = buildRecommendations(reading);
  reading.parasharicCrossRef = buildParasharicCrossRef(reading); // may be null if no lat/lon
  reading.nakshatraDetail = buildNakshatraDetail(reading);
  return reading;
}

module.exports = { buildReading, findCombo, isFriendly };
