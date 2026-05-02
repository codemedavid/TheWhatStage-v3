import type { ParsedSource } from '../types';

/**
 * FAQ → atomic markdown. The entire Q+A becomes a single chunk so retrieval
 * never returns a half-answer. The H1 is the question; the answer is the body.
 */
export function parseFaq(input: { question: string; answer: string }): ParsedSource {
  const question = input.question.trim();
  const answer = (input.answer ?? '').trim();
  const markdown = `# ${question}\n\n${answer}`.replace(/\r\n?/g, '\n');
  return { kind: 'faq', title: question, markdown, atomic: true };
}
