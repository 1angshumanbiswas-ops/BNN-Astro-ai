// Navtara Chakra live transit engine — the 9-star (Navtara) system taught in
// the bootcamp notes (server/data/navtara_chakra.json), scored fresh against
// "right now" (the server's current UTC time), not the birth chart. This is
// deliberately a live/point-in-time snapshot: call computeLiveNavtaraTransits
// again whenever a fresh view is needed, rather than caching it with the
// stored natal reading.

const fs = require('fs');
const path = require('path');
const { computeChart } = require('./ephemeris');
const { nakshatraOf, norm360 } = require('./panchanga');

const navtaraData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'navtara_chakra.json'), 'utf8'));

const NAK_ORDER = navtaraData.nakshatraOrder; // 27 names, Ashwini=0 ... Revati=26
const TARA_BY_NUM = Object.fromEntries(navtaraData.taras.map(t => [t.num, t]));
const DURATION_BY_PLANET = Object.fromEntries(navtaraData.planetTransitDurations.map(d => [d.planet, d]));

const GRAHA_ORDER = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn', 'Rahu', 'Ketu'];

/**
 * Tara number (1-9) of a transiting nakshatra relative to a natal (Janma)
 * nakshatra. Both indices are 0-26 (Ashwini=0 ... Revati=26).
 * Verified: Janma nakshatra itself (diff=1) -> Tara 1 (Janma); the 2nd
 * nakshatra away -> Tara 2 (Sampat); ... the 9th away -> Tara 9 (Ati Mitra);
 * the 10th away -> Tara 1 again. E.g. Ashwini(0) -> Krittika(2): diff=3 ->
 * Tara 3 (Vipat).
 */
function computeTaraOf(natalNakshatraIndex, transitingNakshatraIndex) {
  const diff = ((transitingNakshatraIndex - natalNakshatraIndex) % 27 + 27) % 27 + 1; // 1-indexed distance, 1..27
  const mod9 = diff % 9;
  return mod9 === 0 ? 9 : mod9;
}

/** Nakshatra index (0-26) for a sidereal longitude - reuses panchanga.js's
 * nakshatraOf() so this never diverges from the rest of the app. */
function computeNakshatraOf(longitude) {
  return nakshatraOf(longitude);
}

/**
 * @param {object} reading - the completed BNN reading; uses
 *   reading.panchanga.nakshatra (if present) or reading.planets.Moon for the
 *   natal Moon nakshatra, and nothing else from the natal chart.
 * @returns {object} { asOf, natalMoonNakshatra, transits: [...9] }
 */
function computeLiveNavtaraTransits(reading) {
  const now = new Date();

  const natalMoonNak = (reading.panchanga && reading.panchanga.nakshatra)
    ? reading.panchanga.nakshatra
    : nakshatraOf(norm360(reading.planets.Moon.longitude));

  const { planets: transitPlanets } = computeChart(now);

  const transits = GRAHA_ORDER.map(planet => {
    const p = transitPlanets[planet];
    const transitNak = computeNakshatraOf(p.longitude);
    const taraNumber = computeTaraOf(natalMoonNak.index, transitNak.index);
    const taraInfo = TARA_BY_NUM[taraNumber];
    const duration = DURATION_BY_PLANET[planet];

    return {
      planet,
      currentNakshatra: transitNak.name,
      currentSign: p.sign,
      taraNumber,
      taraName: taraInfo ? taraInfo.name : null,
      taraMeaning: taraInfo ? taraInfo.meaning : null,
      auspiciousness: taraInfo ? taraInfo.auspiciousness : null,
      karakatva: duration ? duration.karakatva : null,
      transitDuration: duration ? duration.duration : null
    };
  });

  return {
    asOf: now.toISOString(),
    natalMoonNakshatra: natalMoonNak.name,
    transits
  };
}

module.exports = { computeTaraOf, computeNakshatraOf, computeLiveNavtaraTransits, NAK_ORDER };
