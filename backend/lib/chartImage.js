// Server-side rasterized North Indian (D1) diamond chart, for embedding in
// downloadable reports. Ports the exact same fixed house-diamond geometry
// and placement logic as public/app.js's renderNorthIndianChart() (see
// NI_HOUSE_CELLS / PLANET_ABBR / SIGN_NUM there) into Node, then rasterizes
// the resulting SVG to a PNG buffer via `sharp`. Do not let this drift from
// the frontend's geometry - it exists so the printed report visually matches
// what the user sees in the app.

const sharp = require('sharp');

const PLANET_ABBR = { Sun: 'Su', Moon: 'Mo', Mars: 'Ma', Mercury: 'Me', Jupiter: 'Ju', Venus: 'Ve', Saturn: 'Sa', Rahu: 'Ra', Ketu: 'Ke' };
const SIGN_NUM = { Aries: 1, Taurus: 2, Gemini: 3, Cancer: 4, Leo: 5, Virgo: 6, Libra: 7, Scorpio: 8, Sagittarius: 9, Capricorn: 10, Aquarius: 11, Pisces: 12 };

// Identical to public/app.js's NI_HOUSE_CELLS.
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

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

function buildChartSvg(vedicChart) {
  const ascSignNum = SIGN_NUM[vedicChart.ascendant.sign];
  const byHouse = {};
  for (let h = 1; h <= 12; h++) byHouse[h] = [];
  for (const [name, p] of Object.entries(vedicChart.planets)) byHouse[p.house].push({ name, ...p });

  const cells = NI_HOUSE_CELLS.map(cellDef => {
    const rashiNum = ((ascSignNum - 1 + (cellDef.house - 1)) % 12) + 1;
    const occupants = byHouse[cellDef.house];
    const planetTspans = occupants.map((p, i) => {
      const abbr = escapeXml(PLANET_ABBR[p.name] + (p.retrograde ? 'R' : ''));
      return `<tspan x="${cellDef.label[0]}" dy="${i === 0 ? 0 : 12}">${abbr}</tspan>`;
    }).join('');
    const fill = cellDef.house === 1 ? 'rgba(232,121,42,.10)' : 'transparent';
    return `
      <polygon points="${cellDef.points}" fill="${fill}" stroke="#e3c093" stroke-width="1.2" />
      <text x="${cellDef.label[0]}" y="${cellDef.label[1] - (occupants.length ? 10 : 0)}" font-size="11" fill="#8a6b4e" text-anchor="middle" font-weight="600">${rashiNum}</text>
      ${occupants.length ? `<text x="${cellDef.label[0]}" y="${cellDef.label[1] + 6}" font-size="12.5" fill="#cc5e15" font-weight="700" text-anchor="middle">${planetTspans}</text>` : ''}
    `;
  }).join('');

  return `<svg viewBox="0 0 300 300" width="900" height="900" xmlns="http://www.w3.org/2000/svg">
    <rect width="300" height="300" fill="#fffdf8" />
    <rect x="1" y="1" width="298" height="298" fill="none" stroke="#a5760a" stroke-width="2" />
    ${cells}
  </svg>`;
}

/**
 * Renders the natal North Indian diamond chart as a PNG buffer, suitable for
 * embedding in a downloadable report. Returns null (callers must skip the
 * image gracefully) when vedicChart is missing - the same gate used
 * elsewhere in this codebase (e.g. parasharicCrossRef) for charts with no
 * resolved birth-place lat/lon.
 */
async function renderChartImagePng(vedicChart) {
  if (!vedicChart) return null;
  const svg = buildChartSvg(vedicChart);
  return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = { renderChartImagePng };
