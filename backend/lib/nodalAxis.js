const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'rahu_ketu_axis.json'), 'utf8'));
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
