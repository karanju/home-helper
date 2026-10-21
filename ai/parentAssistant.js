import { callGemini, candidateText, hasFunctionCall } from './gemini.js';
import { SYSTEM_PROMPTS, chatGenerationConfig } from './prompts.js';
import { chatHistory, promptSafe, requiredString, toGeminiContents } from './validate.js';

const MAX_PROPOSED = 10;
const DEFAULT_REPLY = 'Here are the chores I would add. Tap Add to put them on the board.';

const AGE_GROUP_LABELS = { kid: 'kid, under 13', teen: 'teen, 13-17', adult: 'adult' };

// Who chores can go to: [{ id, name, ageMode }]. In a family these are its members; without one, the age groups.
export function proposeChoresTool(roster) {
  return {
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
              assigneeIds: {
                type: 'ARRAY',
                items: { type: 'STRING', enum: roster.map(member => member.id) },
                description: 'The ids of the family members who do it'
              },
              points: { type: 'INTEGER', description: 'Reward points for kids and teens, usually 10-25; 0 for adult-only chores' }
            },
            required: ['title', 'emoji', 'assigneeIds']
          }
        }
      },
      required: ['chores']
    }
  };
}

function toolRules(roster) {
  const members = roster
    .map(member => `- ${promptSafe(member.name)} (${AGE_GROUP_LABELS[member.ageMode]}): id "${member.id}"`)
    .join('\n');
  return `
You can also put chores on the family chore board with the propose_chores tool.
- Call it only when the parent asks to add, create, or assign chores. For other questions just answer.
- Chores go to these family members; put their ids in assigneeIds. "The kids" means every kid listed, and so on.
${members}
- Chores for a kid must be kid-safe: no knives, stoves, ovens, hot water, electrical tools or cleaning chemicals. Give those to a teen or adult instead.
- The parent reviews the list before anything is added, so say briefly what you are proposing, by name.`;
}

export function parseParentAssistantInput(body) {
  return {
    history: chatHistory(body?.history, { max: 20, maxLength: 4000 }),
    message: requiredString(body?.message, 'message', 1000)
  };
}

export function buildParentAssistantPayload({ history, message }, roster) {
  return {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPTS.adult + '\n' + toolRules(roster) }] },
    contents: toGeminiContents(history, message),
    tools: [{ functionDeclarations: [proposeChoresTool(roster)] }],
    toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
    // Picking chores from a request needs little reasoning, and minimal thinking answers several times faster
    generationConfig: { ...chatGenerationConfig('adult'), thinkingConfig: { thinkingLevel: 'minimal' } }
  };
}

// Function-call arguments come from the model, so every field is checked before the client sees it
export function cleanProposedChores(args, roster) {
  const chores = Array.isArray(args?.chores) ? args.chores : [];
  return chores.slice(0, MAX_PROPOSED).flatMap((chore) => {
    const title = typeof chore?.title === 'string' ? chore.title.trim().slice(0, 80) : '';
    const requested = Array.isArray(chore?.assigneeIds) ? chore.assigneeIds : [];
    const assignees = roster.filter(member => requested.includes(member.id));
    if (!title || assignees.length === 0) return [];

    const emoji = typeof chore.emoji === 'string' && chore.emoji.trim() && chore.emoji.trim().length <= 8 ? chore.emoji.trim() : '📝';
    const adultsOnly = assignees.every(member => member.ageMode === 'adult');
    const points = adultsOnly ? 0 : Number.isInteger(chore.points) ? Math.min(Math.max(chore.points, 0), 100) : 15;
    return [{ title, emoji, assigneeIds: assignees.map(member => member.id), points }];
  });
}

export async function runParentAssistant(input, roster, call = callGemini) {
  const { candidate, model } = await call(
    buildParentAssistantPayload(input, roster),
    (c) => Boolean(candidateText(c)) || hasFunctionCall(c)
  );
  const proposedChores = (candidate.content?.parts || [])
    .filter(part => part.functionCall?.name === 'propose_chores')
    .flatMap(part => cleanProposedChores(part.functionCall.args, roster))
    .slice(0, MAX_PROPOSED);

  const reply = candidateText(candidate) || (proposedChores.length ? DEFAULT_REPLY : '');
  if (!reply) throw new Error('Gemini returned an empty reply');
  return { reply, proposedChores, model };
}
