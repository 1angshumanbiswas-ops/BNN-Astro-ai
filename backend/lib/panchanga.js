// Panchanga (five limbs of the Hindu calendar) + nakshatra/pada helpers,
// all computed from Swiss Ephemeris sidereal Sun/Moon longitudes - the same
// standard method used by Kundli sites like deva.guru.

const fs = require('fs');
const path = require('path');
const nakshatras = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'nakshatras.json'), 'utf8'));

const NAK_SPAN = 360 / 27; // 13°20'
const TITHI_NAMES = [
  'Pratipada', 'Dwitiya', 'Tritiya', 'Chaturthi', 'Panchami', 'Shashthi', 'Saptami', 'Ashtami',
  'Navami', 'Dashami', 'Ekadashi', 'Dwadashi', 'Trayodashi', 'Chaturdashi', 'Purnima/Amavasya'
];
const YOGA_NAMES = [
  'Vishkambha', 'Priti', 'Ayushman', 'Saubhagya', 'Shobhana', 'Atiganda', 'Sukarma', 'Dhriti',
  'Shula', 'Ganda', 'Vriddhi', 'Dhruva', 'Vyaghata', 'Harshana', 'Vajra', 'Siddhi', 'Vyatipata',
  'Variyana', 'Parigha', 'Shiva', 'Siddha', 'Sadhya', 'Shubha', 'Shukla', 'Brahma', 'Indra', 'Vaidhriti'
];
const KARANA_MOVABLE = ['Bava', 'Balava', 'Kaulava', 'Taitila', 'Gara', 'Vanija', 'Vishti'];
const VARA_NAMES = ['Ravivara (Sunday)', 'Somvara (Monday)', 'Mangalvara (Tuesday)', 'Budhvara (Wednesday)',
  'Guruvara (Thursday)', 'Shukravara (Friday)', 'Shanivara (Saturday)'];
const VARA_LORD = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn'];

function norm360(x) { x = x % 360; if (x < 0) x += 360; return x; }

function nakshatraOf(longitude) {
  const lon = norm360(longitude);
  const idx = Math.floor(lon / NAK_SPAN);
  const posInNak = lon - idx * NAK_SPAN;
  const pada = Math.floor(posInNak / (NAK_SPAN / 4)) + 1;
  return { index: idx, name: nakshatras[idx].name, lord: nakshatras[idx].lord, pada };
}

function toDMS(deg) {
  const d = Math.floor(deg);
  const mFull = (deg - d) * 60;
  const m = Math.floor(mFull);
  const s = Math.round((mFull - m) * 60);
  return { d, m, s };
}

/**
 * @param {number} sunLon sidereal Sun longitude (deg)
 * @param {number} moonLon sidereal Moon longitude (deg)
 * @param {Date} localDateForVara - a Date whose local calendar day determines the Vara (weekday); pass the birth instant.
 * @param {number} tzOffsetMinutes - offset used to read the correct local weekday
 */
function computePanchanga(sunLon, moonLon, birthUtc, tzOffsetMinutes) {
  const diff = norm360(moonLon - sunLon);

  // Tithi: each 12 degrees of Moon-Sun separation = 1 tithi (30 total, 15 per paksha)
  const tithiIndex = Math.floor(diff / 12); // 0-29
  const paksha = tithiIndex < 15 ? 'Shukla Paksha (waxing)' : 'Krishna Paksha (waning)';
  const tithiInPaksha = tithiIndex % 15;
  const tithiName = tithiInPaksha === 14
    ? (tithiIndex < 15 ? 'Purnima (Full Moon)' : 'Amavasya (New Moon)')
    : TITHI_NAMES[tithiInPaksha];
  const tithiDegreesLeft = (tithiIndex + 1) * 12 - diff;

  // Nakshatra of the Moon (the standard Panchanga nakshatra)
  const moonNak = nakshatraOf(moonLon);

  // Yoga: (Sun + Moon) / 13°20'
  const yogaSum = norm360(sunLon + moonLon);
  const yogaIndex = Math.floor(yogaSum / NAK_SPAN);
  const yogaName = YOGA_NAMES[yogaIndex];

  // Karana: half-tithi (6 degrees)
  const halfTithi = Math.floor(diff / 6); // 0-59
  let karanaName;
  if (halfTithi === 0) karanaName = 'Kimstughna';
  else if (halfTithi === 57) karanaName = 'Shakuni';
  else if (halfTithi === 58) karanaName = 'Chatushpada';
  else if (halfTithi === 59) karanaName = 'Naga';
  else karanaName = KARANA_MOVABLE[(halfTithi - 1) % 7];

  // Vara (weekday) - by local civil date at birth
  const localMillis = birthUtc.getTime() + tzOffsetMinutes * 60000;
  const localDate = new Date(localMillis);
  const weekday = localDate.getUTCDay(); // 0=Sunday since we shifted to "local" via offset
  const vara = { name: VARA_NAMES[weekday], lord: VARA_LORD[weekday] };

  return {
    tithi: { name: tithiName, paksha, index: tithiIndex + 1, degreesRemaining: +tithiDegreesLeft.toFixed(2) },
    nakshatra: moonNak,
    yoga: { name: yogaName, index: yogaIndex + 1 },
    karana: { name: karanaName, index: halfTithi + 1 },
    vara
  };
}

module.exports = { computePanchanga, nakshatraOf, toDMS, norm360 };
