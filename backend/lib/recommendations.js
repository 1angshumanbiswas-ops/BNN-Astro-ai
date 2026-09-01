// "Recommendations & Suggestions" — assembled entirely from material already
// present in the BNN knowledge base (Sections 1.9, 7.4, 7.5, 10.5-10.10),
// applied to this specific chart's computed placements. Nothing here is a
// generic/invented astrology claim; every remedy or suggestion traces back
// to an explicit rule or table in server/knowledge/bnn_knowledge_base.md.

const fs = require('fs');
const path = require('path');

const professionBySign = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'profession_by_sign.json'), 'utf8'));
const professionCombos = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'profession_combos.json'), 'utf8'));
const significators = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'significators.json'), 'utf8'));

const TRINE_ELEMENT_REMEDY = {
  1: { element: 'Fire (Agni) — houses 1, 5, 9', remedy: 'A fire ritual (havan) or lighting a lamp (diya).' },
  2: { element: 'Earth (Prithvi) — houses 2, 6, 10', remedy: 'Parikrama (circumambulation of a temple/sacred tree) or wearing gemstones.' },
  3: { element: 'Air (Vayu) — houses 3, 7, 11', remedy: 'Agarbatti (incense) or mantra chanting.' },
  4: { element: 'Water (Jal) — houses 4, 8, 12', remedy: 'Donation, or Jal Pravah (a water offering/immersion).' }
};

const MALEFIC_DEITY_REMEDY = {
  Rahu: 'Bhairav Baba',
  Saturn: 'Shani Mandir / Peepal Tree',
  Mars: 'Hanuman Mandir',
  Ketu: 'Ganesh Ji'
};

const MALEFICS = new Set(['Saturn', 'Rahu', 'Mars', 'Ketu']);

function extractRemedyClauses(combosFound) {
  const seen = new Set();
  const out = [];
  for (const c of combosFound) {
    const re = /remedy[:\s—-]*([^;|]+)/gi;
    let m;
    while ((m = re.exec(c.text)) !== null) {
      let clause = m[1].trim().replace(/\*\*/g, '').replace(/\.$/, '');
      // Strip a trailing unmatched ")" left over when "remedy" appeared inside "(...)"
      if (clause.endsWith(')') && !clause.includes('(')) clause = clause.slice(0, -1).trim();
      const key = clause.toLowerCase();
      if (clause && !seen.has(key)) {
        seen.add(key);
        out.push({ text: clause, fromCombo: c.num, planets: `${c.behind} + ${c.ahead}` });
      }
    }
  }
  return out;
}

function extractNotableYogas(combosFound) {
  const seen = new Set();
  const out = [];
  for (const c of combosFound) {
    const re = /\*\*([^*]+)\*\*/g;
    let m;
    while ((m = re.exec(c.text)) !== null) {
      const name = m[1].trim();
      const key = name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ name, fromCombo: c.num, planets: `${c.behind} + ${c.ahead}`, context: c.text });
      }
    }
  }
  return out;
}

function buildRemedies(reading) {
  const remedies = [];

  // Elemental remedies for trine groups containing a challenged/isolated planet
  for (const [group, planets] of Object.entries(reading.trines)) {
    const needsSupport = planets.filter(p => {
      const s = reading.strength[p.name];
      return s && (s.level === 'isolated' || s.level === 'challenged');
    });
    if (needsSupport.length) {
      const info = TRINE_ELEMENT_REMEDY[group];
      remedies.push({
        type: 'elemental',
        title: `${info.element}`,
        text: `${needsSupport.map(p => p.name).join(', ')} in this trine could use extra support: ${info.remedy}`
      });
    }
  }

  // Deity remedies for unsupported malefics
  for (const name of Object.keys(reading.strength)) {
    if (!MALEFICS.has(name)) continue;
    const s = reading.strength[name];
    if (s.level === 'isolated' || s.level === 'challenged') {
      remedies.push({
        type: 'deity',
        title: `${name} (${s.level})`,
        text: `Traditionally paired with worship/visits to ${MALEFIC_DEITY_REMEDY[name]}.`
      });
    }
  }

  // Remedy clauses embedded directly in matched combination texts
  for (const r of extractRemedyClauses(reading.combosFound)) {
    remedies.push({ type: 'combination', title: `From combination #${r.fromCombo} (${r.planets})`, text: r.text });
  }

  // BNN's Saturn+Venus Vastu note, if that pairing is present in this chart
  const hasSaturnVenus = reading.combosFound.some(c =>
    (c.behind === 'Saturn' && c.ahead === 'Venus') || (c.behind === 'Venus' && c.ahead === 'Saturn'));
  if (hasSaturnVenus) {
    remedies.push({
      type: 'vastu',
      title: 'Saturn + Venus household (Vastu) pattern',
      text: 'BNN links this exact combination to a specific home layout: storeroom/godown near the kitchen, a cash box kept in storage, kitchen in the western corner or storeroom in the southeast, and generally good savings habits — worth checking against the native\'s actual home layout.'
    });
  }

  return remedies;
}

function houseOccupants(reading, fromPlanet, offset) {
  const base = reading.planets[fromPlanet].house;
  const target = ((base - 1 + offset) % 12) + 1;
  return Object.entries(reading.planets).filter(([name, p]) => p.house === target && name !== fromPlanet).map(([name]) => name);
}

function classifyEnvironment(occupants) {
  const poor = occupants.filter(n => ['Mars', 'Rahu', 'Ketu'].includes(n));
  const superior = occupants.filter(n => ['Venus', 'Jupiter', 'Sun'].includes(n));
  if (superior.length && !poor.length) return { verdict: 'favorable', by: superior };
  if (poor.length && !superior.length) return { verdict: 'difficult', by: poor };
  if (poor.length && superior.length) return { verdict: 'mixed', by: [...superior, ...poor] };
  return { verdict: 'neutral', by: [] };
}

function buildCareerEducation(reading) {
  const saturn = reading.planets.Saturn;
  const mercury = reading.planets.Mercury;

  const saturnProfile = professionBySign[saturn.sign];
  const mercuryProfile = professionBySign[mercury.sign];

  const saturn12th = houseOccupants(reading, 'Saturn', 11); // 12th from Saturn = offset 11
  const mercury12th = houseOccupants(reading, 'Mercury', 11);
  const workEnv = classifyEnvironment(saturn12th);
  const studyEnv = classifyEnvironment(mercury12th);

  // Combined-with flavor: any planet sharing Saturn's or Mercury's trine group
  const combinedNotes = [];
  for (const [group, planets] of Object.entries(reading.trines)) {
    const names = planets.map(p => p.name);
    if (names.includes('Saturn')) {
      for (const other of names) {
        if (other !== 'Saturn' && professionCombos[other]) {
          combinedNotes.push({ significator: 'Saturn (profession)', with: other, text: professionCombos[other].saturnEffect, keyword: professionCombos[other].keyword });
        }
      }
    }
    if (names.includes('Mercury')) {
      for (const other of names) {
        if (other !== 'Mercury' && professionCombos[other]) {
          combinedNotes.push({ significator: 'Mercury (education/business)', with: other, text: professionCombos[other].mercuryEffect, keyword: professionCombos[other].keyword });
        }
      }
    }
  }

  const mercuryRahuLinked = reading.combosFound.some(c =>
    (c.behind === 'Mercury' && c.ahead === 'Rahu') || (c.behind === 'Rahu' && c.ahead === 'Mercury'));
  const foreignEducation = {
    likely: mercuryRahuLinked || mercury.retrograde || reading.planets.Jupiter.retrograde,
    reasons: [
      mercuryRahuLinked ? 'Mercury is linked with Rahu (a classic BNN foreign-education/foreign-connection indicator)' : null,
      mercury.retrograde ? 'Mercury is retrograde' : null,
      reading.planets.Jupiter.retrograde ? 'Jupiter is retrograde' : null
    ].filter(Boolean)
  };

  return {
    saturnSign: saturn.sign,
    mercurySign: mercury.sign,
    profession: saturnProfile.saturnProfession,
    education: mercuryProfile.mercuryEducation,
    workEnvironment: { ...workEnv, houseNote: '12th house from Saturn' },
    studyEnvironment: { ...studyEnv, houseNote: '12th house from Mercury' },
    combinedNotes,
    foreignEducation
  };
}

function buildFocusAreas(reading) {
  const out = [];
  for (const [name, s] of Object.entries(reading.strength)) {
    if (s.level === 'isolated' || s.level === 'challenged') {
      const sig = significators[name];
      out.push({
        planet: name,
        level: s.level,
        text: s.level === 'isolated'
          ? `${name} has no planets in its 2nd, 12th or 7th house (BNN Rule 8) — unsupported, which BNN reads as unresolved challenge in this planet's domain (${sig.jeeva.split(',')[0]}; ${sig.ajeeva.split(',').slice(0, 3).join(',')}).`
          : `${name} is supported only by planets it doesn't get along with (BNN Rule 5's Dev Grah/Danav Grah groupings) — real support is present, but it comes with friction in this planet's domain (${sig.jeeva.split(',')[0]}; ${sig.ajeeva.split(',').slice(0, 3).join(',')}).`
      });
    }
  }
  return out;
}

function buildRecommendations(reading) {
  return {
    remedies: buildRemedies(reading),
    notableYogas: extractNotableYogas(reading.combosFound),
    career: buildCareerEducation(reading),
    focusAreas: buildFocusAreas(reading)
  };
}

module.exports = { buildRecommendations };
