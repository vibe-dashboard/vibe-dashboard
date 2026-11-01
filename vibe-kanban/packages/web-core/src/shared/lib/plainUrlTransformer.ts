import { type TextMatchTransformer, TRANSFORMERS } from '@lexical/markdown';
import { $createLinkNode, $isLinkNode, LinkNode } from '@lexical/link';
import { $createTextNode, type TextNode } from 'lexical';

const PLAIN_URL_REGEXP = /\bhttps?:\/\/[^\s<]+/i;
const PLAIN_URL_MARKDOWN_SHORTCUT_REGEXP = /\bhttps?:\/\/[^\s<]+$/i;
const TRAILING_URL_PUNCTUATION_REGEXP = /[.,!?;:'"]+$/;
const TRAILING_CLOSING_DELIMITERS = new Set([')', ']', '}']);

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function hasUnmatchedTrailingDelimiter(value: string, delimiter: string) {
  if (delimiter === ')') {
    return countOccurrences(value, '(') < countOccurrences(value, ')');
  }
  if (delimiter === ']') {
    return countOccurrences(value, '[') < countOccurrences(value, ']');
  }
  return countOccurrences(value, '{') < countOccurrences(value, '}');
}

export function trimPlainUrlMatch(value: string): string {
  let url = value;

  for (;;) {
    const withoutPunctuation = url.replace(TRAILING_URL_PUNCTUATION_REGEXP, '');
    if (withoutPunctuation !== url) {
      url = withoutPunctuation;
      continue;
    }

    if (
      url.length > 0 &&
      TRAILING_CLOSING_DELIMITERS.has(url[url.length - 1]) &&
      hasUnmatchedTrailingDelimiter(url, url[url.length - 1])
    ) {
      url = url.slice(0, -1);
      continue;
    }

    return url;
  }
}

export const PLAIN_URL_TRANSFORMER: TextMatchTransformer = {
  dependencies: [LinkNode],
  export: (node, exportChildren) => {
    if (!$isLinkNode(node)) return null;

    const url = node.getURL();
    if (node.getTitle()) return null;

    const text = exportChildren(node);

    return text === url ? url : null;
  },
  getEndIndex: (_node: TextNode, match: RegExpMatchArray) => {
    const rawUrl = match[0];
    const url = trimPlainUrlMatch(rawUrl);

    return url.length > 0 ? (match.index ?? 0) + url.length : false;
  },
  importRegExp: PLAIN_URL_REGEXP,
  regExp: PLAIN_URL_MARKDOWN_SHORTCUT_REGEXP,
  replace: (node) => {
    const url = node.getTextContent();
    const linkNode = $createLinkNode(url);
    const textNode = $createTextNode(url);

    textNode.setFormat(node.getFormat());
    textNode.setDetail(node.getDetail());
    textNode.setStyle(node.getStyle());
    linkNode.append(textNode);
    node.replace(linkNode);
  },
  type: 'text-match',
};

export const CHAT_MARKDOWN_TRANSFORMERS = [
  PLAIN_URL_TRANSFORMER,
  ...TRANSFORMERS,
];
