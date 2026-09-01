// Place-of-birth resolution: turns a free-text place name into lat/lon
// (OpenStreetMap Nominatim, no API key required) and then resolves the
// correct historical UTC offset for that lat/lon + date/time using the IANA
// time zone database (via geo-tz for the boundary lookup and
// moment-timezone for the actual historical offset, which correctly handles
// past DST rules and India's own pre-1947/1955 zone history rather than
// assuming today's fixed +5:30 applies to every birth year).

const geotz = require('geo-tz');
const moment = require('moment-timezone');

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'BNN_ASTRO_AI/1.0 (astrology chart prototype; contact via app)';

async function searchPlace(query) {
  if (!query || query.trim().length < 2) return [];
  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=6&addressdetails=1`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Geocoding lookup failed (${res.status})`);
  const data = await res.json();
  return data.map(d => ({
    displayName: d.display_name,
    lat: parseFloat(d.lat),
    lon: parseFloat(d.lon),
    type: d.addresstype || d.type
  }));
}

/**
 * Resolve the correct UTC offset (in minutes, east-positive) for a given
 * lat/lon and local civil date+time, using the real IANA tz history for
 * that location (not just today's rule).
 * @param {number} lat
 * @param {number} lon
 * @param {string} dob - YYYY-MM-DD (local civil date)
 * @param {string} tob - HH:MM (local civil time)
 */
function resolveTimezone(lat, lon, dob, tob) {
  const zones = geotz.find(lat, lon);
  if (!zones || !zones.length) return null;
  const tzName = zones[0];
  const m = moment.tz(`${dob} ${tob}`, 'YYYY-MM-DD HH:mm', tzName);
  if (!m.isValid()) return null;
  return {
    tzName,
    offsetMinutes: m.utcOffset(),
    abbreviation: m.format('z')
  };
}

module.exports = { searchPlace, resolveTimezone };
