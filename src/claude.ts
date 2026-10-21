/**
 * Optional Claude calls, made from the browser with the key pasted into
 * Settings. Two jobs only: reading handwriting, and pulling an article body
 * out of a page the extractor flagged. Both must return the source's words,
 * never a rewrite.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Settings } from './types';

function client(s: Settings): Anthropic {
  if (!s.anthropicKey) throw new Error('Add an Anthropic API key in Settings first.');
  return new Anthropic({ apiKey: s.anthropicKey, dangerouslyAllowBrowser: true });
}

/** Models that accept the server-side refusal fallback. */
const FALLBACK_MODELS = /^claude-(opus-5|sonnet-5-5|fable-5)/;

async function ask(s: Settings, content: Anthropic.Beta.BetaContentBlockParam[], system: string, effort: 'low' | 'medium'): Promise<string> {
  const fallback = FALLBACK_MODELS.test(s.claudeModel);
  const stream = client(s).beta.messages.stream({
    model: s.claudeModel,
    max_tokens: 64000,
    system,
    output_config: { effort },
    messages: [{ role: 'user', content }],
    // A declined request is retried server-side on another model rather than failing.
    ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error('Claude declined this request.');
  if (msg.stop_reason === 'max_tokens') throw new Error('The response was cut off at the output limit.');
  return msg.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

const TRANSCRIBE = `You transcribe photographs of handwritten pages for the writer who wrote them.

Return only the text on the page, exactly as written: the writer's own words, spelling, punctuation and paragraph breaks. Do not correct, modernise, complete or tidy anything. Keep crossings-out out of the text unless the replacement is unclear, in which case write the crossed-out word in [brackets]. Write [illegible] for any word you cannot read. Join lines that wrap within a paragraph; keep a blank line between paragraphs. No preamble, no commentary, no Markdown.`;

export async function transcribe(s: Settings, image: Blob): Promise<string> {
  const data = await blobToBase64(image);
  const media = (image.type || 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  return ask(s, [{ type: 'image', source: { type: 'base64', media_type: media, data } }, { type: 'text', text: 'Transcribe this page.' }], TRANSCRIBE, 'medium');
}

const EXTRACT = `You extract the body of an article from a web page's HTML for a private, printed reading copy.

Return the article body verbatim as Markdown: every paragraph, heading, quotation and list in the order it appears, with the author's exact words. Do not rewrite, summarise, shorten, reorder, translate or add anything. Leave out the headline, byline, navigation, share buttons, newsletter boxes, related links, comments and ads. Keep emphasis and footnotes if present.

If the full body is not in the HTML (for example it is behind a paywall, truncated, or loaded later by JavaScript), reply with exactly UNEXTRACTABLE and nothing else.`;

export async function extractBody(s: Settings, html: string): Promise<string> {
  return ask(s, [{ type: 'text', text: `<html_source>\n${html}\n</html_source>` }], EXTRACT, 'low');
}

export function blobToBase64(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}
