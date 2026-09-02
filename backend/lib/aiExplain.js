// Calls the Anthropic Messages API directly (Node 18+ global fetch, no SDK
// dependency) to turn a computed BNN reading into warm, plain-language prose
// - strictly grounded in the deterministic JSON data already produced by
// bnnEngine.js. Each user supplies and stores their own Anthropic API key
// (see server/lib/crypto.js + the /api/settings/anthropic-key routes in
// server/index.js); this module never sees or stores a key beyond the single
// call it's handed for.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 8192; // headroom for charts with many matched combinations/houses, so the reply doesn't truncate mid-section

const SYSTEM_PROMPT = `You are a BNN (Bhrigu Nandi Nadi) astrology assistant. You are given a
deterministic, rule-based BNN chart reading as JSON, already computed by a
rule engine from the bootcamp training material. Your job is to turn that
data into warm, plain-language prose explanations for the native reading
their own chart.

Strict grounding rules:
- Base every statement STRICTLY on the JSON data you are given. Do not invent
  new astrological rules, combinations, planetary relationships, or
  predictions that are not present in the data.
- Do not introduce yogas, doshas, remedies, or timing predictions beyond what
  is already listed in the JSON.
- You may explain, contextualize and make the given data more readable, but
  you must not add substantive new astrological claims.
- Write in a warm, encouraging, plain-language tone suitable for someone with
  no astrology background, while staying accurate to the source data.

Structure your reply as four clearly labeled sections, in this exact order,
using these exact headings on their own line:
Summary
Notable Combinations Explained
House-by-House Highlights
Remedies & Suggestions Explained

End the reply with one short disclaimer sentence stating that this is an
AI-generated interpretation of a deterministic reading, not a guarantee.`;

function trimReadingForPrompt(reading) {
  return {
    natalSummary: {
      name: reading.meta && reading.meta.name,
      birthUtc: reading.birthUtc,
      place: reading.meta && reading.meta.place,
      jeevaLagnaSign: reading.jeevaLagna && reading.jeevaLagna.sign
    },
    combosFound: (reading.combosFound || []).map(c => ({
      num: c.num, behind: c.behind, ahead: c.ahead, relType: c.relType, text: c.text
    })),
    houseReadings: (reading.houseReadings || []).map(h => ({
      house: h.house,
      title: h.title,
      occupants: (h.occupants || []).map(o => o.name),
      lines: (h.lines || []).map(l => ({ planet: l.planet, retrograde: l.retrograde, text: l.text })),
      emptyNote: h.emptyNote
    })),
    recommendations: reading.recommendations || null
  };
}

async function generateExplanations(reading, apiKey) {
  const userContent = JSON.stringify(trimReadingForPrompt(reading));

  let response;
  try {
    response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: `Here is the deterministic BNN reading data (JSON). Write the four labeled sections from this data only:\n\n${userContent}` }
        ]
      })
    });
  } catch (e) {
    throw new Error('Could not reach Anthropic API');
  }

  if (!response.ok) {
    let briefReason = response.statusText || 'request failed';
    try {
      const errBody = await response.json();
      if (errBody && errBody.error && errBody.error.message) {
        briefReason = String(errBody.error.message).slice(0, 200);
      }
    } catch (_) { /* ignore parse failure, use statusText */ }
    throw new Error(`Anthropic API request failed: ${response.status} ${briefReason}`);
  }

  let data;
  try {
    data = await response.json();
  } catch (e) {
    throw new Error('Anthropic API returned a malformed response');
  }

  // Look through ALL content blocks for the first text block, rather than
  // assuming it's always at index 0 — a response can legitimately carry other
  // block types (e.g. a thinking block) ahead of the text block.
  const blocks = Array.isArray(data && data.content) ? data.content : [];
  const textBlock = blocks.find(b => b && b.type === 'text' && typeof b.text === 'string' && b.text.length);

  if (!textBlock) {
    // Surface real diagnostics instead of a bare "unexpected format" — this
    // is what an astrologer (or whoever debugs this next) actually needs to
    // see: what Anthropic sent back, without dumping the whole payload.
    const blockTypes = blocks.map(b => b && b.type).join(', ') || 'none';
    const stopReason = (data && data.stop_reason) || 'unknown';
    throw new Error(`Anthropic API returned no usable text (stop_reason: ${stopReason}, content block types: [${blockTypes}]) — this usually means the response was truncated (try again) or the model refused the request.`);
  }

  return textBlock.text;
}

module.exports = { generateExplanations };
