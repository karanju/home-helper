import { callGemini, candidateText } from './gemini.js';
import { SYSTEM_PROMPTS } from './prompts.js';
import { ageModeList, optionalString, requiredString } from './validate.js';

// How many steps each age gets. Kid steps double as captions on the picture poster.
export const STEP_RANGE = { kid: [3, 5], teen: [4, 7], adult: [3, 8] };

const AGE_SET_SCHEMA = {
  type: 'OBJECT',
  properties: {
    steps: { type: 'ARRAY', items: { type: 'STRING' } },
    tip: { type: 'STRING', nullable: true },
    safety: { type: 'STRING', nullable: true }
  },
  required: ['steps', 'tip', 'safety']
};

const STYLE_BY_AGE = {
  kid: 'Each step is one simple action in under 12 words, written for a 6-12 year old. These steps will also be captions on a picture guide.',
  teen: 'Each step is one clear action in one sentence, written for a 13-17 year old.',
  adult: 'Each step is one concise action; include time estimates or product notes where useful.'
};

export function parseInstructionsInput(body) {
  return {
    title: requiredString(body?.title, 'title', 100),
    assignees: ageModeList(body?.assignees, 'assignees'),
    notes: optionalString(body?.notes, 'notes', 300)
  };
}

export function buildInstructionsPayload(ageMode, { title, notes }) {
  const [min, max] = STEP_RANGE[ageMode];
  const task = `Write step-by-step instructions for this household chore: "${title}".${notes ? `\nParent's notes: ${notes}` : ''}

Return JSON with:
- steps: ${min}-${max} steps, in order, without numbering. ${STYLE_BY_AGE[ageMode]}
- tip: one short, encouraging tip, or null.
- safety: one short safety line if anything hot, sharp, electrical or chemical is involved, otherwise null.`;

  return {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPTS[ageMode] }] },
    contents: [{ role: 'user', parts: [{ text: task }] }],
    generationConfig: {
      temperature: ageMode === 'kid' ? 0.3 : 0.5,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
      responseSchema: AGE_SET_SCHEMA
    }
  };
}

// Gemini's JSON is checked rather than trusted: steps must be non-empty strings, trimmed to the age's cap
export function parseAgeSet(text, ageMode) {
  const data = JSON.parse(text);
  const steps = (Array.isArray(data?.steps) ? data.steps : [])
    .filter(step => typeof step === 'string' && step.trim())
    .map(step => step.trim().replace(/^\d+[.)]\s*/, ''))
    .slice(0, STEP_RANGE[ageMode][1]);
  if (steps.length === 0) throw new Error(`No steps in the ${ageMode} instructions`);

  const shortText = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  return { steps, tip: shortText(data.tip), safety: shortText(data.safety) };
}

// One Gemini call per age, in parallel, so the strict kid rules never mix with the teen or adult prompt.
// Ages that fail are listed in `failed` instead of failing the whole request.
export async function generateInstructions({ title, assignees, notes }, call = callGemini) {
  const results = await Promise.allSettled(
    assignees.map(async (ageMode) => {
      const { candidate, model } = await call(buildInstructionsPayload(ageMode, { title, notes }));
      return { ageMode, model, set: parseAgeSet(candidateText(candidate), ageMode) };
    })
  );

  const byAge = {};
  const failed = [];
  let model = null;

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      byAge[result.value.ageMode] = result.value.set;
      model = model || result.value.model;
    } else {
      console.warn(`[AI] ${assignees[i]} instructions failed: ${result.reason?.message}`);
      failed.push(assignees[i]);
    }
  });

  return { byAge, failed, model };
}
