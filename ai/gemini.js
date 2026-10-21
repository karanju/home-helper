// Cache for list of candidate Flash models
let cachedFlashCandidates = [];
let lastCandidatesFetch = 0;
const CANDIDATES_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
let lastWorkingModel = null;

export class GeminiUnavailableError extends Error {
  constructor(details) {
    super('All Gemini Flash models are currently busy or unavailable.');
    this.details = details;
  }
}

// Helper to retrieve and sort current Flash models dynamically
export async function getFlashModelCandidates(apiKey) {
  const now = Date.now();
  if (cachedFlashCandidates.length > 0 && (now - lastCandidatesFetch < CANDIDATES_CACHE_TTL)) {
    return cachedFlashCandidates;
  }

  try {
    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const response = await fetch(listUrl);
    if (!response.ok) {
      throw new Error(`Failed to list models: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    const models = data.models || [];

    // Filter for text generation Flash models
    let flashList = models
      .filter(m => {
        const name = (m.name || '').toLowerCase();
        const supportsGen = (m.supportedGenerationMethods || []).includes('generateContent');
        return supportsGen && name.includes('flash') && !name.includes('tts') && !name.includes('image');
      })
      .map(m => m.name.replace(/^models\//, ''));

    // Priority ordering: latest flash models, falling back to flash-lite-latest and earlier versions
    const preferredOrder = [
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash',
      'gemini-1.5-flash'
    ];

    flashList.sort((a, b) => {
      const idxA = preferredOrder.indexOf(a);
      const idxB = preferredOrder.indexOf(b);
      const rankA = idxA === -1 ? 999 : idxA;
      const rankB = idxB === -1 ? 999 : idxB;
      return rankA - rankB;
    });

    if (flashList.length > 0) {
      if (lastWorkingModel && flashList.includes(lastWorkingModel)) {
        flashList = [lastWorkingModel, ...flashList.filter(m => m !== lastWorkingModel)];
      }
      cachedFlashCandidates = flashList;
      lastCandidatesFetch = now;
      console.log(`[Gemini] Discovered ${flashList.length} dynamic Flash models. Active target: ${flashList[0]}`);
      return cachedFlashCandidates;
    }
  } catch (err) {
    console.warn(`[Gemini] Error fetching dynamic model list: ${err.message}`);
  }

  return ['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-1.5-flash'];
}

// The text of a candidate's parts, ignoring function calls and thoughts
export function candidateText(candidate) {
  return (candidate?.content?.parts || [])
    .filter(part => typeof part.text === 'string' && !part.thought)
    .map(part => part.text)
    .join('')
    .trim();
}

export function hasFunctionCall(candidate) {
  return (candidate?.content?.parts || []).some(part => part.functionCall);
}

function postGenerate(apiKey, model, payload) {
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  return fetch(geminiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

// Send a generateContent payload, trying candidates in priority order with graceful failover
// (e.g., if one returns a 503 spike or 404). Returns { candidate, model } for the first answer that
// `accept` likes; by default that is one with visible text, so thought-only or cut-off answers fail over.
export async function callGemini(payload, accept = (candidate) => Boolean(candidateText(candidate))) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }

  const candidates = await getFlashModelCandidates(apiKey);
  let lastError = null;

  for (const model of candidates) {
    try {
      let geminiRes = await postGenerate(apiKey, model, payload);

      // Older models reject thinkingConfig; give them the same request without it rather than skipping them
      if (geminiRes.status === 400 && payload.generationConfig?.thinkingConfig) {
        const { thinkingConfig, ...generationConfig } = payload.generationConfig;
        geminiRes = await postGenerate(apiKey, model, { ...payload, generationConfig });
      }

      if (geminiRes.ok) {
        const geminiData = await geminiRes.json();
        const candidate = geminiData.candidates?.[0];
        if (candidate && accept(candidate)) {
          lastWorkingModel = model;
          return { candidate, model };
        }
        lastError = `${model} returned no usable answer (${candidate?.finishReason || 'no candidate'})`;
      } else {
        const errText = await geminiRes.text();
        console.warn(`[Gemini] Candidate ${model} returned ${geminiRes.status}: ${errText.substring(0, 100)}`);
        lastError = `${geminiRes.status}: ${errText}`;
      }
    } catch (err) {
      console.warn(`[Gemini] Candidate ${model} fetch error: ${err.message}`);
      lastError = err.message;
    }
  }

  throw new GeminiUnavailableError(lastError);
}
