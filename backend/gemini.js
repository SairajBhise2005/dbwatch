// gemini.js — thin Google Gemini client over the REST API (native fetch,
// no SDK dependency). Mirrors the graceful pattern used by aws.js: every
// call returns { available:false, reason } instead of throwing when the
// key is missing or the API errors, so AI features stay optional.

const KEY = process.env.GEMINI_API_KEY || '';
// Model id is config — override with GEMINI_MODEL if the default changes.
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

export function geminiConfigured() {
  return Boolean(KEY);
}

/**
 * Generate text from a prompt.
 * @param {string} prompt - user prompt.
 * @param {object} [opts] - { system, json, temperature, maxTokens }.
 * @returns {Promise<{available:boolean, text?:string, reason?:string}>}
 */
export async function generate(prompt, opts = {}) {
  if (!KEY) return { available: false, reason: 'GEMINI_API_KEY not set' };
  const { system, json = false, temperature = 0.2, maxTokens = 2048 } = opts;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      ...(json ? { responseMimeType: 'application/json' } : {}),
    },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) {
      const t = await r.text();
      return { available: false, reason: `Gemini ${r.status}: ${t.slice(0, 200)}` };
    }
    const data = await r.json();
    const text =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
    return { available: true, text };
  } catch (err) {
    return { available: false, reason: err.message };
  }
}

// Parse a JSON reply, tolerating markdown code fences the model may add.
export function parseJson(text) {
  if (!text) return null;
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}
