// Rahu–Ketu karmic-axis reading, by the sign each node occupies. Source: the
// "Rahu Ketu Workshop" (Astro Vaibhav Gupta). This is interpretive/karmic
// material — kept separate from BNN's numbered rules, exactly like the
// Nakshatra and Parashari sections. Pure lookup: no ephemeris math here.
 
const fs = require('fs');
const path = require('path');
 
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'rahu_ketu_axis.json'), 'utf8'));
 
/**
 * @param {object} reading - uses reading.planets.Rahu / Ketu ({sign, house, degree, retrograde}).
 *   `house` is the BNN house counted from Jupiter's sign (Jeeva Lagna).
 * @returns {object|null} { source, general, rahu, ketu } or null if a node's sign isn't in the table.
 */
function buildNodalAxis(reading) {
  const r = reading && reading.planets && reading.planets.Rahu;
  const k = reading && reading.planets && reading.planets.Ketu;
  if (!r || !k) return null;
  const rEntry = data.signs[r.sign];
  const kEntry = data.signs[k.sign];
  if (!rEntry || !kEntry) return null;
  return {
    source: data.general.source,
    general: { rahu: data.general.rahu, ketu: data.general.ketu, axis: data.general.axis, gene: data.general.gene },
    rahu: { sign: r.sign, house: r.house, degree: r.degree, text: rEntry.rahu.text, solutions: rEntry.rahu.solutions },
    ketu: { sign: k.sign, house: k.house, degree: k.degree, text: kEntry.ketu.text, solutions: kEntry.ketu.solutions }
  };
}
 
module.exports = { buildNodalAxis };
 
