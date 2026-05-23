// src/lib/chatbot/visual-intent.ts

const VISUAL_TOKENS = [
  // English
  'show me', 'show it', 'send me a photo', 'send a photo', 'photo',
  'picture', 'pic', 'see it', 'see them', 'look at', 'looks like',
  'what does it look like', 'any photos', 'any pictures', 'image',
  'visuals', 'preview',
  // Tagalog
  'pakita', 'ipakita', 'litrato', 'larawan', 'patingin',
];

const VISUAL_REGEX = new RegExp(
  '\\b(' + VISUAL_TOKENS.map((t) => t.replace(/ /g, '\\s+')).join('|') + ')\\b',
  'i',
);

export function hasVisualIntent(message: string): boolean {
  if (!message) return false;
  return VISUAL_REGEX.test(message);
}
