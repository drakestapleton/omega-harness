import React from 'react';
import { Box, Text } from 'ink';
import { THEME } from '../brand.js';

interface MarkdownProps {
  text: string;
}

function renderInline(line: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Split on inline code `...` and bold **...**
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let lastIndex = 0;
  let key = 0;

  for (const match of line.matchAll(pattern)) {
    const idx = match.index ?? 0;
    if (idx > lastIndex) {
      nodes.push(<Text key={key++}>{line.slice(lastIndex, idx)}</Text>);
    }
    const token = match[0];
    if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <Text key={key++} color={THEME.code}>
          {token.slice(1, -1)}
        </Text>
      );
    } else if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(
        <Text key={key++} bold>
          {token.slice(2, -2)}
        </Text>
      );
    }
    lastIndex = idx + token.length;
  }

  if (lastIndex < line.length) {
    nodes.push(<Text key={key++}>{line.slice(lastIndex)}</Text>);
  }
  return nodes.length > 0 ? nodes : [<Text key={0}>{line}</Text>];
}

export const Markdown: React.FC<MarkdownProps> = ({ text }) => {
  const lines = text.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let inCode = false;
  let codeLang = '';
  let codeLines: string[] = [];
  let blockKey = 0;

  const flushCode = () => {
    blocks.push(
      <Box
        key={`code-${blockKey++}`}
        flexDirection="column"
        borderStyle="round"
        borderColor={THEME.border}
        paddingX={1}
        marginY={0}
      >
        {codeLang ? (
          <Text color={THEME.muted} dimColor>
            {codeLang}
          </Text>
        ) : null}
        <Text color={THEME.code}>{codeLines.join('\n')}</Text>
      </Box>
    );
    codeLines = [];
    codeLang = '';
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith('```')) {
      if (!inCode) {
        inCode = true;
        codeLang = line.trimStart().slice(3).trim();
      } else {
        inCode = false;
        flushCode();
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      blocks.push(
        <Text key={`h-${blockKey++}`} bold color={THEME.symbol}>
          {heading[2]}
        </Text>
      );
      continue;
    }

    const bullet = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (bullet) {
      blocks.push(
        <Text key={`b-${blockKey++}`}>
          {bullet[1]}
          <Text color={THEME.accent}>• </Text>
          {renderInline(bullet[2])}
        </Text>
      );
      continue;
    }

    if (line.trim() === '') {
      blocks.push(<Text key={`sp-${blockKey++}`}> </Text>);
      continue;
    }

    blocks.push(<Text key={`p-${blockKey++}`}>{renderInline(line)}</Text>);
  }

  if (inCode && codeLines.length > 0) {
    flushCode();
  }

  return <Box flexDirection="column">{blocks}</Box>;
};
