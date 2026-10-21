import { AGE_MODES } from './prompts.js';

// Small hand-rolled checks shared by the AI routes. Each returns the cleaned value or throws InputError.
export class InputError extends Error {}

export function requiredString(value, name, maxLength) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new InputError(`${name} is required.`);
  if (text.length > maxLength) throw new InputError(`${name} must be at most ${maxLength} characters.`);
  return text;
}

export function optionalString(value, name, maxLength) {
  if (value === undefined || value === null || value === '') return null;
  return requiredString(value, name, maxLength);
}

export function stringList(value, name, { min, max, maxLength }) {
  if (!Array.isArray(value)) throw new InputError(`${name} must be a list.`);
  const items = value.map((item, i) => requiredString(item, `${name}[${i}]`, maxLength));
  if (items.length < min || items.length > max) throw new InputError(`${name} needs ${min}-${max} items.`);
  return items;
}

export function ageModeList(value, name) {
  if (!Array.isArray(value) || value.length === 0) throw new InputError(`${name} needs at least one of ${AGE_MODES.join(', ')}.`);
  if (value.some(mode => !AGE_MODES.includes(mode))) throw new InputError(`${name} can only contain ${AGE_MODES.join(', ')}.`);
  return AGE_MODES.filter(mode => value.includes(mode));
}

// Client text that is quoted inside a prompt: one line, no double quotes, so it can't break out of its quotes
export function promptSafe(text) {
  return String(text).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/["\u201c\u201d]/g, "'").trim();
}

// Chat history from the client: [{ role: 'user' | 'assistant', text }]
export function chatHistory(value, { max, maxLength }) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new InputError('history must be a list.');
  if (value.length > max) throw new InputError(`history can have at most ${max} messages.`);
  return value.map((entry, i) => {
    if (!['user', 'assistant'].includes(entry?.role)) throw new InputError(`history[${i}].role must be "user" or "assistant".`);
    return { role: entry.role, text: requiredString(entry.text, `history[${i}].text`, maxLength) };
  });
}

// Gemini contents for a conversation. Gemini wants the first turn to come from the user,
// so a leading assistant greeting is dropped.
export function toGeminiContents(history, message) {
  const turns = [...history, { role: 'user', text: message }];
  const firstUser = turns.findIndex(turn => turn.role === 'user');
  return turns.slice(firstUser).map(turn => ({
    role: turn.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: turn.text }]
  }));
}
