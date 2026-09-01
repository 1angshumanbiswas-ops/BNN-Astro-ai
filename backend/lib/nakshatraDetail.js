// Natal Moon Nakshatra profile + Pada/Navamsha lookup. Standard Vedic
// Nakshatra reference material (Nakshatra Bootcamp notes) — kept separate
// from BNN's own methodology, exactly like the Panchanga/Dasha sections.
// Reuses panchanga.js's nakshatraOf() so the nakshatra-from-longitude logic
// never diverges between features.

const fs = require('fs');
const path = require('path');
const { nakshatraOf, norm360 } = require('./panchanga');

const profiles = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'nakshatra_profiles.json'), 'utf8'));
const padaNavamsha = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'nakshatra_pada_navamsha.json'), 'utf8'));

const NAK_SPAN = 360 / 27; // 13d20'
const PADA_SPAN = NAK_SPAN / 4; // 3d20'

/**
 * @param {object} reading - the in-progress BNN reading; uses
 *   reading.planets.Moon.longitude.
 * @returns {object} { moonNakshatra: {...profile, pada, navamshaSign} }
 */
function buildNakshatraDetail(reading) {
  const moonLon = norm360(reading.planets.Moon.longitude);
  const nak = nakshatraOf(moonLon);

  const profile = profiles.nakshatras.find(n => n.name === nak.name) || null;

  const posInNak = moonLon - nak.index * NAK_SPAN;
  const padaNum = Math.min(4, Math.floor(posInNak / PADA_SPAN) + 1); // 1-4, guard against float edge at exactly 13d20'

  const padaEntry = padaNavamsha.nakshatras.find(n => n.name === nak.name) || null;
  const navamshaSign = padaEntry ? padaEntry.padaSigns[padaNum - 1] : null;

  return {
    moonNakshatra: {
      ...(profile || { name: nak.name, lord: nak.lord }),
      pada: padaNum,
      navamshaSign
    }
  };
}

module.exports = { buildNakshatraDetail };
