import { describe, expect, it } from 'vitest';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import { $isLinkNode, LinkNode } from '@lexical/link';
import { $getRoot, createEditor } from 'lexical';
import {
  CHAT_MARKDOWN_TRANSFORMERS,
  trimPlainUrlMatch,
} from './plainUrlTransformer';

function getFirstInlineNode(markdown: string) {
  const editor = createEditor({
    nodes: [LinkNode],
    onError: (error) => {
      throw error;
    },
  });

  editor.update(
    () => {
      $convertFromMarkdownString(markdown, CHAT_MARKDOWN_TRANSFORMERS);
    },
    { discrete: true }
  );

  return editor.getEditorState().read(() => {
    const paragraph = $getRoot().getFirstChildOrThrow();
    const node = paragraph.getFirstChildOrThrow();

    return {
      isLink: $isLinkNode(node),
      text: node.getTextContent(),
      url: $isLinkNode(node) ? node.getURL() : null,
    };
  });
}

function roundTripMarkdown(markdown: string) {
  const editor = createEditor({
    nodes: [LinkNode],
    onError: (error) => {
      throw error;
    },
  });

  editor.update(
    () => {
      $convertFromMarkdownString(markdown, CHAT_MARKDOWN_TRANSFORMERS);
    },
    { discrete: true }
  );

  return editor
    .getEditorState()
    .read(() => $convertToMarkdownString(CHAT_MARKDOWN_TRANSFORMERS));
}

function getParagraphInlineNodes(markdown: string) {
  const editor = createEditor({
    nodes: [LinkNode],
    onError: (error) => {
      throw error;
    },
  });

  editor.update(
    () => {
      $convertFromMarkdownString(markdown, CHAT_MARKDOWN_TRANSFORMERS);
    },
    { discrete: true }
  );

  return editor.getEditorState().read(() => {
    const paragraph = $getRoot().getFirstChildOrThrow();

    return paragraph.getChildren().map((node) => ({
      isLink: $isLinkNode(node),
      text: node.getTextContent(),
      url: $isLinkNode(node) ? node.getURL() : null,
    }));
  });
}

describe('plain URL Markdown transformer', () => {
  it('imports a plain HTTPS URL as a link node', () => {
    const node = getFirstInlineNode('https://example.com/path?x=1#top');

    expect(node).toEqual({
      isLink: true,
      text: 'https://example.com/path?x=1#top',
      url: 'https://example.com/path?x=1#top',
    });
  });

  it('leaves trailing sentence punctuation outside the URL', () => {
    expect(trimPlainUrlMatch('https://example.com/path.')).toBe(
      'https://example.com/path'
    );
    expect(trimPlainUrlMatch('(https://example.com/path)')).toBe(
      '(https://example.com/path)'
    );
    expect(trimPlainUrlMatch('https://example.com/path)')).toBe(
      'https://example.com/path'
    );
    expect(trimPlainUrlMatch('https://example.com/path.)')).toBe(
      'https://example.com/path'
    );
  });

  it('keeps explicit Markdown link syntax working', () => {
    const node = getFirstInlineNode('[docs](https://example.com/docs)');

    expect(node).toEqual({
      isLink: true,
      text: 'docs',
      url: 'https://example.com/docs',
    });
  });

  it('preserves explicit Markdown links with titles', () => {
    expect(
      roundTripMarkdown('[https://example.com](https://example.com "title")')
    ).toBe('[https://example.com](https://example.com "title")');
  });

  it('imports a plain URL embedded in paragraph text as a link node', () => {
    expect(getParagraphInlineNodes('Visit https://example.com today')).toEqual([
      {
        isLink: false,
        text: 'Visit ',
        url: null,
      },
      {
        isLink: true,
        text: 'https://example.com',
        url: 'https://example.com',
      },
      {
        isLink: false,
        text: ' today',
        url: null,
      },
    ]);
  });

  it('imports multiple plain URLs in one paragraph as link nodes', () => {
    expect(
      getParagraphInlineNodes(
        'Compare https://example.com and https://example.org/docs'
      )
    ).toEqual([
      {
        isLink: false,
        text: 'Compare ',
        url: null,
      },
      {
        isLink: true,
        text: 'https://example.com',
        url: 'https://example.com',
      },
      {
        isLink: false,
        text: ' and ',
        url: null,
      },
      {
        isLink: true,
        text: 'https://example.org/docs',
        url: 'https://example.org/docs',
      },
    ]);
  });

  it('leaves URLs inside inline code as inline code', () => {
    expect(roundTripMarkdown('Run `curl https://example.com` first')).toBe(
      'Run `curl https://example.com` first'
    );
  });

  it('intentionally imports plain HTTP URLs as link nodes', () => {
    const node = getFirstInlineNode('http://example.com/path');

    expect(node).toEqual({
      isLink: true,
      text: 'http://example.com/path',
      url: 'http://example.com/path',
    });
  });
});
