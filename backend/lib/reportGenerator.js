// Generates a downloadable Word (.docx) or PDF report of a computed BNN
// reading, covering: birth details, the Vedic Kundli summary (Ascendant +
// Panchanga), Graha Info, BNN's Jeeva-Lagna-based analysis (houses,
// matched combinations, house-by-house reading), Recommendations &
// Suggestions, and the Vimshottari Dasha timeline. Pure-JS libraries
// (`docx`, `pdfkit`) — no headless browser / native deps required.

const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, ImageRun } = require('docx');
const PDFDocument = require('pdfkit');
const { renderChartImagePng } = require('./chartImage');

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
}
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}
function fmtDMS(dms) { return `${dms.d}°${String(dms.m).padStart(2, '0')}'${String(dms.s).padStart(2, '0')}"`; }

// pdfkit's built-in Helvetica (WinAnsi encoding) can't render Devanagari
// diacritics (ā, ñ, ṅ, ś, ...) or the "→" arrow used elsewhere in the app -
// they come out as mojibake. Fold diacritics to their plain-ASCII base
// letter and swap the arrow for "->" before handing text to pdfkit. (Word/
// docx handles full Unicode natively, so this is PDF-only.)
function pdfSafe(s) {
  return String(s)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/→/g, '->');
}

// AI explanation text is prompted (see server/lib/aiExplain.js) to come back
// as four sections under exact plain-text headings. Parse those out when
// present so each renders as its own labeled sub-section; if the model
// didn't follow the format, fall back to one flowing block - no need to
// over-engineer this.
const AI_SECTION_HEADINGS = ['Summary', 'Notable Combinations Explained', 'House-by-House Highlights', 'Remedies & Suggestions Explained'];
function parseAiSections(text) {
  const lines = String(text).split('\n');
  const found = [];
  let current = null;
  for (const line of lines) {
    const trimmed = line.trim().replace(/^#+\s*/, '').replace(/\*\*/g, '').replace(/:$/, '');
    const matchHeading = AI_SECTION_HEADINGS.find(h => h.toLowerCase() === trimmed.toLowerCase());
    if (matchHeading) {
      current = { heading: matchHeading, body: '' };
      found.push(current);
    } else if (current) {
      current.body += (current.body ? '\n' : '') + line;
    }
  }
  if (found.length < 2) return null; // didn't reliably follow the format
  found.forEach(s => { s.body = s.body.trim(); });
  return found;
}

// ---------------------------------------------------------------- DOCX ----

function cell(text, opts = {}) {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text: String(text), bold: !!opts.bold, size: 20 })] })],
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined
  });
}

function simpleTable(headers, rows) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: headers.map(h => cell(h, { bold: true })) }),
      ...rows.map(r => new TableRow({ children: r.map(v => cell(v)) }))
    ]
  });
}

function heading(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({ text, heading: level, spacing: { before: 240, after: 120 } });
}
function para(text, opts = {}) {
  return new Paragraph({ children: [new TextRun({ text, italics: !!opts.italic, size: opts.size || 21 })], spacing: { after: 100 } });
}

async function buildDocx(reading) {
  const p = reading.planets;
  const children = [];

  children.push(new Paragraph({ text: 'BNN_ASTRO_AI — Chart Report', heading: HeadingLevel.TITLE }));
  children.push(para(`${reading.meta.name || 'Native'} — ${reading.meta.place || ''}`, { italic: true }));
  children.push(para(`Birth: ${fmtDate(reading.birthUtc)} ${fmtTime(reading.birthUtc)} UTC  |  Ayanamsa (Lahiri): ${reading.ayanamsa}°  |  Jeeva Lagna (BNN): ${reading.jeevaLagna.sign}`));

  const chartImagePng = await renderChartImagePng(reading.vedicChart);
  if (chartImagePng) {
    children.push(heading('Natal Chart (D1, North Indian)'));
    children.push(new Paragraph({
      children: [new ImageRun({ type: 'png', data: chartImagePng, transformation: { width: 320, height: 320 } })],
      spacing: { after: 120 }
    }));
  }

  if (reading.vedicChart) {
    children.push(heading('Vedic Kundli Summary'));
    children.push(para(`Ascendant (Lagna): ${reading.vedicChart.ascendant.sign} ${reading.vedicChart.ascendant.degree}°  |  Nakshatra: ${reading.vedicChart.ascendant.nakshatra.name}, pada ${reading.vedicChart.ascendant.nakshatra.pada}`));
  }
  if (reading.panchanga) {
    const pc = reading.panchanga;
    children.push(heading('Pañchāṅga', HeadingLevel.HEADING_2));
    children.push(para(`Tithi: ${pc.tithi.name} (${pc.tithi.paksha})   Nakshatra: ${pc.nakshatra.name} pada ${pc.nakshatra.pada}   Yoga: ${pc.yoga.name}   Karana: ${pc.karana.name}   Vāra: ${pc.vara.name}`));
    children.push(para(`Sunrise: ${pc.sunrise ? fmtTime(pc.sunrise) : '—'}   Sunset: ${pc.sunset ? fmtTime(pc.sunset) : '—'}`));
  }

  children.push(heading('Graha Info'));
  children.push(simpleTable(
    ['Planet', 'Sign', 'Degree', 'Nakshatra (Lord)', 'Pada', 'Retrograde'],
    Object.entries(p).map(([name, v]) => [name, v.sign, fmtDMS(v.dms), `${v.nakshatra.name} (${v.nakshatra.lord})`, String(v.nakshatra.pada), v.retrograde ? 'Yes' : ''])
  ));

  children.push(heading('BNN Analysis — Houses from Jeeva Lagna (Jupiter)'));
  children.push(simpleTable(
    ['Planet', 'Sign', 'Degree', 'House', 'Rule 8 Strength'],
    Object.entries(p).map(([name, v]) => [name, v.sign, `${v.degree}°`, `House ${v.house}`, reading.strength[name] ? reading.strength[name].level : ''])
  ));

  children.push(heading('Matched Planetary Combinations'));
  reading.combosFound.slice().sort((a, b) => a.num - b.num).forEach(c => {
    children.push(new Paragraph({ children: [new TextRun({ text: `#${c.num}  ${c.behind} → ${c.ahead}`, bold: true, size: 21 })], spacing: { before: 100 } }));
    children.push(para(c.text.replace(/\*\*/g, '')));
  });

  children.push(heading('House-by-House Reading'));
  reading.houseReadings.forEach(h => {
    children.push(new Paragraph({ children: [new TextRun({ text: `House ${h.house}${h.title ? ' — ' + h.title : ''}`, bold: true, size: 22 })], spacing: { before: 140 } }));
    if (h.lines.length) {
      h.lines.forEach(l => children.push(para(`${l.planet}${l.retrograde ? ' (R)' : ''}: ${l.text}`)));
    } else if (h.emptyNote) {
      children.push(para(h.emptyNote, { italic: true }));
    }
  });

  const rec = reading.recommendations;
  if (rec) {
    children.push(heading('Recommendations & Suggestions'));
    if (rec.notableYogas.length) {
      children.push(new Paragraph({ children: [new TextRun({ text: 'Notable Yogas / Combinations', bold: true, size: 22 })], spacing: { before: 100 } }));
      rec.notableYogas.forEach(y => children.push(para(`${y.name} — from combination #${y.fromCombo} (${y.planets})`)));
    }
    if (rec.remedies.length) {
      children.push(new Paragraph({ children: [new TextRun({ text: 'Remedies', bold: true, size: 22 })], spacing: { before: 100 } }));
      rec.remedies.forEach(r => children.push(para(`• ${r.title}: ${r.text}`)));
    }
    children.push(new Paragraph({ children: [new TextRun({ text: 'Career & Education', bold: true, size: 22 })], spacing: { before: 100 } }));
    children.push(para(`Profession (Saturn in ${rec.career.saturnSign}): ${rec.career.profession}`));
    children.push(para(`Education/Business (Mercury in ${rec.career.mercurySign}): ${rec.career.education}`));
    if (rec.career.foreignEducation.likely) {
      children.push(para(`Foreign education/connection indicated: ${rec.career.foreignEducation.reasons.join('; ')}`));
    }
    if (rec.focusAreas.length) {
      children.push(new Paragraph({ children: [new TextRun({ text: 'Focus Areas', bold: true, size: 22 })], spacing: { before: 100 } }));
      rec.focusAreas.forEach(f => children.push(para(`${f.planet} (${f.level}): ${f.text}`)));
    }
  }

  children.push(heading('AI-Generated Explanations'));
  if (reading.aiExplanation && reading.aiExplanation.text) {
    children.push(para(`Generated via the user's own Anthropic API key on ${fmtDate(reading.aiExplanation.generatedAt)} ${fmtTime(reading.aiExplanation.generatedAt)} UTC (model: ${reading.aiExplanation.model || 'claude-sonnet-5'}).`, { italic: true }));
    const sections = parseAiSections(reading.aiExplanation.text);
    if (sections) {
      sections.forEach(s => {
        children.push(new Paragraph({ children: [new TextRun({ text: s.heading, bold: true, size: 22 })], spacing: { before: 120 } }));
        s.body.split('\n').filter(l => l.trim()).forEach(l => children.push(para(l)));
      });
    } else {
      reading.aiExplanation.text.split('\n').filter(l => l.trim()).forEach(l => children.push(para(l)));
    }
    children.push(para('This is an AI-generated interpretation of a deterministic reading, not a guarantee.', { italic: true }));
  } else {
    children.push(para('Add your Anthropic API key in Settings to include AI-generated explanations in future reports.', { italic: true }));
  }

  if (reading.vimshottariDasha) {
    children.push(heading('Vimshottari Mahadasha'));
    children.push(para(`Starting lord at birth: ${reading.vimshottariDasha.startingLord} (birth nakshatra: ${reading.vimshottariDasha.birthNakshatra.name})`));
    children.push(simpleTable(
      ['Lord', 'Start', 'End', 'Duration'],
      reading.vimshottariDasha.mahadashas.map(e => [e.lord, fmtDate(e.start), fmtDate(e.end), `${e.years.toFixed(2)} yrs`])
    ));
  }

  if (reading.nakshatraDetail && reading.nakshatraDetail.moonNakshatra) {
    const n = reading.nakshatraDetail.moonNakshatra;
    children.push(heading('Nakshatra Profile (Moon)'));
    children.push(para('Standard Vedic Nakshatra reference for the natal Moon\'s nakshatra - separate from BNN\'s own methodology.', { italic: true }));
    children.push(para(`${n.name} (lord: ${n.lord}) — Pada ${n.pada}, Navamsha sign: ${n.navamshaSign || '—'}${n.rashi ? `, Rashi span: ${n.rashi}` : ''}`));
    if (n.deity) children.push(para(`Deity: ${n.deity}   Symbol: ${n.symbol || '—'}`));
    if (n.tagline) children.push(para(n.tagline, { italic: true }));
    if (n.predictions) { children.push(new Paragraph({ children: [new TextRun({ text: 'Predictions', bold: true, size: 22 })], spacing: { before: 100 } })); children.push(para(n.predictions)); }
    if (n.thingsToDo) { children.push(new Paragraph({ children: [new TextRun({ text: 'Things to do', bold: true, size: 22 })], spacing: { before: 100 } })); children.push(para(n.thingsToDo)); }
    if (n.remedies) { children.push(new Paragraph({ children: [new TextRun({ text: 'Remedies', bold: true, size: 22 })], spacing: { before: 100 } })); children.push(para(n.remedies)); }
  }

  if (reading.parasharicCrossRef) {
    const pc = reading.parasharicCrossRef;
    children.push(heading('Parashari Cross-Reference'));
    children.push(para('Standard Ascendant-based Parashari Jyotish (House Lords in Houses, Graha Phala) - conventional cross-reference, not BNN\'s own methodology.', { italic: true }));

    children.push(new Paragraph({ children: [new TextRun({ text: 'House Lords', bold: true, size: 22 })], spacing: { before: 100 } }));
    children.push(simpleTable(
      ['House', 'Sign', 'Lord', 'Lord placed in house', 'Interpretation'],
      pc.houseLords.map(h => [String(h.house), h.sign, h.lordName, h.lordPlacedInHouse ? String(h.lordPlacedInHouse) : '—', h.interpretation || '—'])
    ));

    children.push(new Paragraph({ children: [new TextRun({ text: 'Planets in Houses', bold: true, size: 22 })], spacing: { before: 140 } }));
    children.push(simpleTable(
      ['Planet', 'House', 'Interpretation'],
      pc.planetsInHouses.map(p => [p.planet, String(p.house), p.interpretation || '—'])
    ));
  }

  if (reading.navtaraLive) {
    const nv = reading.navtaraLive;
    children.push(heading('Live Transit Reading (Navtara Chakra)'));
    children.push(para(`As of report generation: ${fmtDate(nv.asOf)} ${fmtTime(nv.asOf)} UTC. This reflects the sky at the moment of generation, not the birth chart itself.`, { italic: true }));
    children.push(para(`Natal Moon Nakshatra (Janma): ${nv.natalMoonNakshatra}`));
    children.push(simpleTable(
      ['Planet', 'Current Nakshatra', 'Sign', 'Tara', 'Auspiciousness'],
      nv.transits.map(t => [t.planet, t.currentNakshatra, t.currentSign, `${t.taraNumber} (${t.taraName})`, t.auspiciousness || '—'])
    ));
  }

  children.push(new Paragraph({ text: '', spacing: { before: 300 } }));
  children.push(para('Generated by BNN_ASTRO_AI. BNN analysis is deterministic, rule-based output derived from BNN bootcamp training material; the Vedic Kundli/Pañchāṅga/Vimshottari Dasha section is the conventional Ascendant-based cross-reference. For guidance only — not a substitute for a qualified practitioner’s consultation.', { italic: true }));

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

// ----------------------------------------------------------------- PDF ----

async function buildPdf(reading) {
  const chartImagePng = await renderChartImagePng(reading.vedicChart);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, bufferPages: true });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const p = reading.planets;
    const h1 = (t) => { doc.moveDown(0.6); doc.fontSize(16).fillColor('#8f1d21').text(pdfSafe(t), { underline: false }); doc.fillColor('black').fontSize(10); };
    const h2 = (t) => { doc.moveDown(0.3); doc.fontSize(12).fillColor('#cc5e15').text(pdfSafe(t)); doc.fillColor('black').fontSize(10); };
    const body = (t) => { doc.fontSize(10).fillColor('black').text(pdfSafe(t), { align: 'left' }); };

    doc.fontSize(22).fillColor('#cc5e15').text('BNN_ASTRO_AI - Chart Report', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(11).fillColor('black').text(pdfSafe(`${reading.meta.name || 'Native'} — ${reading.meta.place || ''}`), { align: 'center' });
    doc.fontSize(10).text(pdfSafe(`Birth: ${fmtDate(reading.birthUtc)} ${fmtTime(reading.birthUtc)} UTC  |  Ayanamsa: ${reading.ayanamsa}°  |  Jeeva Lagna: ${reading.jeevaLagna.sign}`), { align: 'center' });

    if (chartImagePng) {
      h1('Natal Chart (D1, North Indian)');
      doc.image(chartImagePng, { fit: [220, 220], align: 'center' });
      doc.moveDown(0.5);
    }

    if (reading.vedicChart) {
      h1('Vedic Kundli Summary');
      body(`Ascendant (Lagna): ${reading.vedicChart.ascendant.sign} ${reading.vedicChart.ascendant.degree}°  |  Nakshatra: ${reading.vedicChart.ascendant.nakshatra.name}, pada ${reading.vedicChart.ascendant.nakshatra.pada}`);
    }
    if (reading.panchanga) {
      const pc = reading.panchanga;
      h2('Pañchāṅga');
      body(`Tithi: ${pc.tithi.name} (${pc.tithi.paksha})   Nakshatra: ${pc.nakshatra.name} pada ${pc.nakshatra.pada}   Yoga: ${pc.yoga.name}   Karana: ${pc.karana.name}   Vāra: ${pc.vara.name}`);
      body(`Sunrise: ${pc.sunrise ? fmtTime(pc.sunrise) : '—'}   Sunset: ${pc.sunset ? fmtTime(pc.sunset) : '—'}`);
    }

    h1('Graha Info');
    Object.entries(p).forEach(([name, v]) => {
      body(`${name}: ${v.sign} ${fmtDMS(v.dms)}  |  ${v.nakshatra.name} (${v.nakshatra.lord}) pada ${v.nakshatra.pada}${v.retrograde ? '  [R]' : ''}`);
    });

    h1('BNN Analysis — Houses from Jeeva Lagna (Jupiter)');
    Object.entries(p).forEach(([name, v]) => {
      const s = reading.strength[name];
      body(`${name}: ${v.sign} ${v.degree}° — House ${v.house} — ${s ? s.level : ''}`);
    });

    h1('Matched Planetary Combinations');
    reading.combosFound.slice().sort((a, b) => a.num - b.num).forEach(c => {
      doc.fontSize(10).fillColor('#a5760a').text(pdfSafe(`#${c.num}  ${c.behind} -> ${c.ahead}`), { continued: false });
      doc.fillColor('black').text(pdfSafe(c.text.replace(/\*\*/g, '')));
      doc.moveDown(0.2);
    });

    h1('House-by-House Reading');
    reading.houseReadings.forEach(hr => {
      doc.fontSize(11).fillColor('#8f1d21').text(pdfSafe(`House ${hr.house}${hr.title ? ' — ' + hr.title : ''}`));
      doc.fillColor('black').fontSize(10);
      if (hr.lines.length) hr.lines.forEach(l => body(`${l.planet}${l.retrograde ? ' (R)' : ''}: ${l.text}`));
      else if (hr.emptyNote) body(hr.emptyNote);
    });

    const rec = reading.recommendations;
    if (rec) {
      h1('Recommendations & Suggestions');
      if (rec.notableYogas.length) {
        h2('Notable Yogas / Combinations');
        rec.notableYogas.forEach(y => body(`${y.name} — from combination #${y.fromCombo} (${y.planets})`));
      }
      if (rec.remedies.length) {
        h2('Remedies');
        rec.remedies.forEach(r => body(`• ${r.title}: ${r.text}`));
      }
      h2('Career & Education');
      body(`Profession (Saturn in ${rec.career.saturnSign}): ${rec.career.profession}`);
      body(`Education/Business (Mercury in ${rec.career.mercurySign}): ${rec.career.education}`);
      if (rec.career.foreignEducation.likely) body(`Foreign education/connection indicated: ${rec.career.foreignEducation.reasons.join('; ')}`);
      if (rec.focusAreas.length) {
        h2('Focus Areas');
        rec.focusAreas.forEach(f => body(`${f.planet} (${f.level}): ${f.text}`));
      }
    }

    h1('AI-Generated Explanations');
    if (reading.aiExplanation && reading.aiExplanation.text) {
      body(`Generated via the user's own Anthropic API key on ${fmtDate(reading.aiExplanation.generatedAt)} ${fmtTime(reading.aiExplanation.generatedAt)} UTC (model: ${reading.aiExplanation.model || 'claude-sonnet-5'}).`);
      const sections = parseAiSections(reading.aiExplanation.text);
      if (sections) {
        sections.forEach(s => { h2(s.heading); body(s.body); });
      } else {
        body(reading.aiExplanation.text);
      }
      body('This is an AI-generated interpretation of a deterministic reading, not a guarantee.');
    } else {
      body('Add your Anthropic API key in Settings to include AI-generated explanations in future reports.');
    }

    if (reading.vimshottariDasha) {
      h1('Vimshottari Mahadasha');
      body(`Starting lord at birth: ${reading.vimshottariDasha.startingLord} (birth nakshatra: ${reading.vimshottariDasha.birthNakshatra.name})`);
      reading.vimshottariDasha.mahadashas.forEach(e => body(`${e.lord}: ${fmtDate(e.start)} → ${fmtDate(e.end)}  (${e.years.toFixed(2)} yrs)`));
    }

    if (reading.nakshatraDetail && reading.nakshatraDetail.moonNakshatra) {
      const n = reading.nakshatraDetail.moonNakshatra;
      h1('Nakshatra Profile (Moon)');
      body(`Standard Vedic Nakshatra reference for the natal Moon's nakshatra - separate from BNN's own methodology.`);
      body(`${n.name} (lord: ${n.lord}) — Pada ${n.pada}, Navamsha sign: ${n.navamshaSign || '—'}${n.rashi ? `, Rashi span: ${n.rashi}` : ''}`);
      if (n.deity) body(`Deity: ${n.deity}   Symbol: ${n.symbol || '—'}`);
      if (n.tagline) body(n.tagline);
      if (n.predictions) { h2('Predictions'); body(n.predictions); }
      if (n.thingsToDo) { h2('Things to do'); body(n.thingsToDo); }
      if (n.remedies) { h2('Remedies'); body(n.remedies); }
    }

    if (reading.parasharicCrossRef) {
      const pc = reading.parasharicCrossRef;
      h1('Parashari Cross-Reference');
      body(`Standard Ascendant-based Parashari Jyotish (House Lords in Houses, Graha Phala) - conventional cross-reference, not BNN's own methodology.`);
      h2('House Lords');
      pc.houseLords.forEach(hL => body(`House ${hL.house} (${hL.sign}) — Lord ${hL.lordName}, placed in house ${hL.lordPlacedInHouse || '—'}: ${hL.interpretation || '—'}`));
      h2('Planets in Houses');
      pc.planetsInHouses.forEach(pl => body(`${pl.planet} in house ${pl.house}: ${pl.interpretation || '—'}`));
    }

    if (reading.navtaraLive) {
      const nv = reading.navtaraLive;
      h1('Live Transit Reading (Navtara Chakra)');
      body(`As of report generation: ${fmtDate(nv.asOf)} ${fmtTime(nv.asOf)} UTC. This reflects the sky at the moment of generation, not the birth chart itself.`);
      body(`Natal Moon Nakshatra (Janma): ${nv.natalMoonNakshatra}`);
      nv.transits.forEach(t => body(`${t.planet}: ${t.currentNakshatra} (${t.currentSign}) — Tara ${t.taraNumber} (${t.taraName}), ${t.auspiciousness || '—'}`));
    }

    doc.moveDown(1);
    doc.fontSize(8).fillColor('gray').text(pdfSafe('Generated by BNN_ASTRO_AI. BNN analysis is deterministic, rule-based output derived from BNN bootcamp training material; the Vedic Kundli/Panchanga/Vimshottari Dasha section is the conventional Ascendant-based cross-reference. For guidance only — not a substitute for a qualified practitioner’s consultation.'), { align: 'left' });

    doc.end();
  });
}

module.exports = { buildDocx, buildPdf };
