// Parashari / Ascendant-based cross-reference: standard Vedic sign-lord and
// planet-in-house lookups (House Lords in Houses, Graha Phala), applied to
// this chart's Ascendant-based Vedic (D1) chart — reading.vedicChart. This is
// conventional Parashari Jyotish, NOT BNN's own Jeeva-Lagna methodology; it
// is kept entirely separate, exactly like the existing Panchanga/Dasha
// cross-reference section. Requires a birth place (vedicChart); returns null
// when that isn't available.

const fs = require('fs');
const path = require('path');

const houseLordsData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'house_lords_in_houses.json'), 'utf8'));
const grahaPhalaData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'graha_phala.json'), 'utf8'));

const SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];

// Standard sign-lord table (Rahu/Ketu deliberately excluded - they are never
// sign lords in Parashari Jyotish, only planets that can be placed).
const SIGN_LORD = {
  Aries: 'Mars', Scorpio: 'Mars',
  Taurus: 'Venus', Libra: 'Venus',
  Gemini: 'Mercury', Virgo: 'Mercury',
  Cancer: 'Moon',
  Leo: 'Sun',
  Sagittarius: 'Jupiter', Pisces: 'Jupiter',
  Capricorn: 'Saturn', Aquarius: 'Saturn'
};

/**
 * @param {object} reading - the in-progress/complete BNN reading object;
 *   only reading.vedicChart is used.
 * @returns {object|null} { houseLords: [...12], planetsInHouses: [...9] }
 */
function buildParasharicCrossRef(reading) {
  const vedicChart = reading && reading.vedicChart;
  if (!vedicChart) return null;

  const ascSignIndex = SIGNS.indexOf(vedicChart.ascendant.sign);
  if (ascSignIndex < 0) return null;

  // Sign occupying each of the 12 houses (whole-sign, from the Ascendant).
  const signOfHouse = {};
  for (let h = 1; h <= 12; h++) {
    signOfHouse[h] = SIGNS[(ascSignIndex + h - 1) % 12];
  }

  // Which house each planet is placed in (from vedicChart.planets).
  const houseOfPlanet = {};
  for (const [name, p] of Object.entries(vedicChart.planets)) {
    houseOfPlanet[name] = p.house;
  }

  const houseLords = [];
  for (let house = 1; house <= 12; house++) {
    const sign = signOfHouse[house];
    const lordName = SIGN_LORD[sign];
    const lordPlacedInHouse = houseOfPlanet[lordName] || null;
    const interpretation = lordPlacedInHouse
      ? (houseLordsData.table[String(house)] && houseLordsData.table[String(house)][String(lordPlacedInHouse)]) || null
      : null;
    houseLords.push({ house, sign, lordName, lordPlacedInHouse, interpretation });
  }

  const planetsInHouses = [];
  for (const [planet, house] of Object.entries(houseOfPlanet)) {
    const interpretation = (grahaPhalaData.table[planet] && grahaPhalaData.table[planet][String(house)]) || null;
    planetsInHouses.push({ planet, house, interpretation });
  }

  return { houseLords, planetsInHouses };
}

module.exports = { buildParasharicCrossRef, SIGN_LORD };
