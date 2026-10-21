import { callGemini, candidateText, hasFunctionCall } from './gemini.js';
import { AGE_MODES, SYSTEM_PROMPTS, chatGenerationConfig } from './prompts.js';
import { chatHistory, requiredString, toGeminiContents } from './validate.js';

const MAX_PROPOSED = 10;
const DEFAULT_REPLY = 'Here are the chores I would add. Tap Add to put them on the board.';

export const PROPOSE_CHORES_TOOL = {
  name: 'propose_chores',
  description: 'Suggest chores to add to the family chore board. The parent confirms before anything is added.',
  parameters: {
    type: 'OBJECT',
    properties: {
      chores: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING', description: 'Short chore name, e.g. "Feed the cat"' },
            emoji: { type: 'STRING', description: 'One emoji for the chore' },
            assignees: {
              type: 'ARRAY',
              items: { type: 'STRING', enum: AGE_MODES },
              description: 'Who does it: kid (under 13), teen (13-17), adult'
            },
            points: { type: 'INTEGER', description: 'Reward points for kids and teens, usually 10-25; 0 for adult-only chores' }
          },
          required: ['title', 'emoji', 'assignees']
        }
      }
    },
    required: ['chores']
  }
};

const TOOL_RULES = `
You can also put chores on the family chore board with the propose_chores tool.
- Call it only when the parent asks to add, create, or assign chores. For other questions just answer.
- Family members are age groups: kid (under 13), teen (13-17) and adult.
- Kid chores must be kid-safe: no knives, stoves, ovens, hot water, electrical tools or cleaning chemicals. Give those to a teen or adult instead.
- The parent reviews the list before anything is added, so say briefly what you are proposing.`;

export function parseParentAssistantInput(body) {
  return {
    history: chatHistory(body?.history, { max: 20, maxLength: 4000 }),
    message: requiredString(body?.message, 'message', 1000)
  };
}

export function buildParentAssistantPayload({ history, message }) {
  return {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPTS.adult + '\n' + TOOL_RULES }] },
    contents: toGeminiContents(history, message),
    tools: [{ functionDeclarations: [PROPOSE_CHORES_TOOL] }],
    toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
    // Picking chores from a request needs little reasoning, and minimal thinking answers several times faster
    generationConfig: { ...chatGenerationConfig('adult'), thinkingConfig: { thinkingLevel: 'minimal' } }
  };
}

// Function-call arguments come from the model, so every field is checked before the client sees it
export function cleanProposedChores(args) {
  const chores = Array.isArray(args?.chores) ? args.chores : [];
  return chores.slice(0, MAX_PROPOSED).flatMap((chore) => {
    const title = typeof chore?.title === 'string' ? chore.title.trim().slice(0, 100) : '';
    const assignees = AGE_MODES.filter(mode => Array.isArray(chore?.assignees) && chore.assignees.includes(mode));
    if (!title || assignees.length === 0) return [];

    const emoji = typeof chore.emoji === 'string' && chore.emoji.trim() && chore.emoji.trim().length <= 8 ? chore.emoji.trim() : '📝';
    const adultOnly = assignees.length === 1 && assignees[0] === 'adult';
    const points = adultOnly ? 0 : Number.isInteger(chore.points) ? Math.min(Math.max(chore.points, 0), 100) : 15;
    return [{ title, emoji, assignees, points }];
  });
}

export async function runParentAssistant(input, call = callGemini) {
  const { candidate, model } = await call(
    buildParentAssistantPayload(input),
    (c) => Boolean(candidateText(c)) || hasFunctionCall(c)
  );
  const proposedChores = (candidate.content?.parts || [])
    .filter(part => part.functionCall?.name === PROPOSE_CHORES_TOOL.name)
    .flatMap(part => cleanProposedChores(part.functionCall.args))
    .slice(0, MAX_PROPOSED);

  const reply = candidateText(candidate) || (proposedChores.length ? DEFAULT_REPLY : '');
  if (!reply) throw new Error('Gemini returned an empty reply');
  return { reply, proposedChores, model };
}
