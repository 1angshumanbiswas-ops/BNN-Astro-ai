// Computes sidereal (Lahiri) geocentric longitudes for the 9 BNN grahas
// (Sun, Moon, Mars, Mercury, Jupiter, Venus, Saturn, Rahu, Ketu) using the
// Swiss Ephemeris (via the `sweph` Node bindings to the official Astrodienst
// C library) — the de-facto professional standard for astrological
// calculations. We use its Moshier analytical model (SEFLG_MOSEPH), which is
// accurate to within about 1 arcsecond for many centuries around the present
// and needs no external .se1 data files, so the app has no runtime download/
// licensing dependency while still using genuine Swiss Ephemeris code and
// output (not a hand-rolled approximation).
//
// NOTE ON A PRIOR BUG: an earlier version of this file used the
// `astronomy-engine` library's EclipticLongitude() for the Moon, which is
// only valid for heliocentric-orbit bodies and silently returns the Moon's
// longitude 180 degrees off. That was caught by cross-checking against a
// known new-moon date (Sun and Moon longitudes should coincide) and is why
// this module was rewritten on Swiss Ephemeris directly.

const sweph = require('sweph');
const path = require('path');

const c = sweph.constants;

// No .se1 data files are bundled, so point at an empty/nonexistent dir and
// rely on SEFLG_MOSEPH (Moshier), which does not require them.
sweph.set_ephe_path(path.join(__dirname, '..', 'ephe'));
sweph.set_sid_mode(c.SE_SIDM_LAHIRI, 0, 0);

const CALC_FLAGS = c.SEFLG_MOSEPH | c.SEFLG_SIDEREAL | c.SEFLG_SPEED;

const SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];

const BODY_IDS = {
  Sun: c.SE_SUN,
  Moon: c.SE_MOON,
  Mars: c.SE_MARS,
  Mercury: c.SE_MERCURY,
  Jupiter: c.SE_JUPITER,
  Venus: c.SE_VENUS,
  Saturn: c.SE_SATURN
};

function norm360(x) {
  x = x % 360;
  if (x < 0) x += 360;
  return x;
}

function signOf(longitude) {
  const idx = Math.floor(norm360(longitude) / 30);
  const deg = norm360(longitude) - idx * 30;
  return { sign: SIGNS[idx], signIndex: idx, degreeInSign: deg };
}

function dateToJd(date) {
  // date is a JS Date representing the UTC instant of birth.
  const h = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const r = sweph.utc_to_jd(
    date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(),
    date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(),
    c.SE_GREG_CAL
  );
  if (r.error) throw new Error('Swiss Ephemeris date error: ' + r.error);
  return r.data[1]; // JD(UT)
}

/**
 * @param {Date} date - UTC instant of birth
 * @returns {object} { ayanamsa, planets: { <name>: {longitude, sign, signIndex, degreeInSign, retrograde, speed} } }
 */
function computeChart(date) {
  const jd = dateToJd(date);
  const ayanamsa = sweph.get_ayanamsa_ut(jd);
  const result = {};

  for (const [name, id] of Object.entries(BODY_IDS)) {
    const r = sweph.calc_ut(jd, id, CALC_FLAGS);
    if (r.error) throw new Error(`Swiss Ephemeris error computing ${name}: ${r.error}`);
    const [lon, , , speedLon] = r.data;
    const { sign, signIndex, degreeInSign } = signOf(lon);
    result[name] = { longitude: norm360(lon), sign, signIndex, degreeInSign, retrograde: speedLon < 0, speed: speedLon };
  }

  // True Node (Rahu) - Swiss Ephemeris's precise (non-mean) lunar node.
  const rahuR = sweph.calc_ut(jd, c.SE_TRUE_NODE, CALC_FLAGS);
  if (rahuR.error) throw new Error('Swiss Ephemeris error computing Rahu: ' + rahuR.error);
  const rahuLon = norm360(rahuR.data[0]);
  const ketuLon = norm360(rahuLon + 180);
  result.Rahu = { longitude: rahuLon, ...signOf(rahuLon), retrograde: true, speed: rahuR.data[3] };
  result.Ketu = { longitude: ketuLon, ...signOf(ketuLon), retrograde: true, speed: rahuR.data[3] };

  return { ayanamsa, planets: result, julianDayUT: jd };
}

/**
 * Sidereal Ascendant (Lagna) for the standard Vedic Rashi (D1) chart.
 * Requires geographic coordinates (unlike BNN's Jupiter-based Jeeva Lagna,
 * which needs no birth place at all) - used only for the conventional
 * cross-reference chart, not by the BNN rule engine itself.
 * @param {Date} date - UTC instant of birth
 * @param {number} lat
 * @param {number} lon
 */
function computeAscendant(date, lat, lon) {
  const jd = dateToJd(date);
  const flags = c.SEFLG_MOSEPH | c.SEFLG_SIDEREAL;
  const h = sweph.houses_ex(jd, flags, lat, lon, 'W'); // Whole Sign house system (standard for Vedic D1)
  if (h.error) throw new Error('Swiss Ephemeris error computing houses: ' + h.error);
  const ascLon = norm360(h.data.points[0]);
  return { longitude: ascLon, ...signOf(ascLon) };
}

/**
 * Sunrise/sunset (local apparent, standard refraction) for the birth date at
 * the given geographic coordinates - used for Panchanga (Vara begins at
 * sunrise in traditional reckoning is a refinement we skip for simplicity;
 * we report civil-midnight-to-midnight Vara as most modern Kundli tools
 * default to, but still surface sunrise/sunset themselves for reference).
 */
function computeSunTimes(date, lat, lon) {
  const dayStartJd = dateToJd(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())));
  const geopos = [lon, lat, 0];
  const flags = c.SEFLG_MOSEPH;
  const rise = sweph.rise_trans(dayStartJd, c.SE_SUN, null, flags, c.SE_CALC_RISE, geopos, 0, 0);
  const set = sweph.rise_trans(dayStartJd, c.SE_SUN, null, flags, c.SE_CALC_SET, geopos, 0, 0);
  const jdToDate = (jd) => new Date((jd - 2440587.5) * 86400000);
  return {
    sunrise: rise.error ? null : jdToDate(rise.data).toISOString(),
    sunset: set.error ? null : jdToDate(set.data).toISOString()
  };
}

module.exports = { computeChart, computeAscendant, computeSunTimes, SIGNS, norm360 };
