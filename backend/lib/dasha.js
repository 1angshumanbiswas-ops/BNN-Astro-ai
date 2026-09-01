// Vimshottari Dasha (Mahadasha) calculator - the standard 120-year, 9-planet
// timing system used by essentially all Vedic Kundli tools (including
// deva.guru), based purely on the Moon's nakshatra at birth. This is a
// distinct system from BNN's own planet-combination methodology (which
// deliberately does not use dashas) - it's provided here as the conventional
// cross-reference view, matching what a site like deva.guru shows.

const { nakshatraOf, norm360 } = require('./panchanga');

const NAK_SPAN = 360 / 27;

// Fixed order and total-years for each dasha lord (sums to 120)
const DASHA_SEQUENCE = [
  { lord: 'Ketu', years: 7 },
  { lord: 'Venus', years: 20 },
  { lord: 'Sun', years: 6 },
  { lord: 'Moon', years: 10 },
  { lord: 'Mars', years: 7 },
  { lord: 'Rahu', years: 18 },
  { lord: 'Jupiter', years: 16 },
  { lord: 'Saturn', years: 19 },
  { lord: 'Mercury', years: 17 }
];
const TOTAL_YEARS = DASHA_SEQUENCE.reduce((s, d) => s + d.years, 0); // 120

const YEAR_MS = 365.2425 * 86400000; // Gregorian mean year, standard for dasha date math

function addYears(date, years) {
  return new Date(date.getTime() + years * YEAR_MS);
}

/**
 * @param {number} moonLon sidereal Moon longitude at birth (degrees)
 * @param {Date} birthUtc
 * @param {number} levels how many Mahadasha entries to return (default: all 9, i.e. one full cycle from birth)
 */
function computeVimshottariMahadasha(moonLon, birthUtc, cycles = 1) {
  const lon = norm360(moonLon);
  const nak = nakshatraOf(lon);
  const posInNak = lon - nak.index * NAK_SPAN; // degrees traversed into this nakshatra
  const fractionElapsed = posInNak / NAK_SPAN; // 0..1

  const startLordIdx = DASHA_SEQUENCE.findIndex(d => d.lord === nak.lord);

  // Balance of the first (birth) dasha = unelapsed fraction of that lord's full period
  const firstLord = DASHA_SEQUENCE[startLordIdx];
  const balanceYears = firstLord.years * (1 - fractionElapsed);

  const entries = [];
  let cursor = birthUtc;
  let firstEnd = addYears(cursor, balanceYears);
  entries.push({ lord: firstLord.lord, start: cursor.toISOString(), end: firstEnd.toISOString(), years: +balanceYears.toFixed(3), isBirthDasha: true });
  cursor = firstEnd;

  const totalEntries = DASHA_SEQUENCE.length * cycles;
  for (let i = 1; i < totalEntries; i++) {
    const d = DASHA_SEQUENCE[(startLordIdx + i) % DASHA_SEQUENCE.length];
    const end = addYears(cursor, d.years);
    entries.push({ lord: d.lord, start: cursor.toISOString(), end: end.toISOString(), years: d.years, isBirthDasha: false });
    cursor = end;
  }

  return { birthNakshatra: nak, startingLord: firstLord.lord, balanceYears: +balanceYears.toFixed(3), mahadashas: entries };
}

module.exports = { computeVimshottariMahadasha, DASHA_SEQUENCE, TOTAL_YEARS };
