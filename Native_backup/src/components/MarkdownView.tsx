import { useMemo, type ReactNode } from 'react';

type Block =
  | { type: 'h'; level: number; text: string }
  | { type: 'p'; text: string }
  | { type: 'code'; text: string; info: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'hr' }
  | { type: 'table'; head: string[]; rows: string[][] };

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    const fence = /^(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      const marker = fence[1][0];
      const info = fence[2].trim();
      const buffer: string[] = [];
      i++;
      const closer = new RegExp(`^\\s*\\${marker}{3,}\\s*$`);
      while (i < lines.length && !closer.test(lines[i])) {
        buffer.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ type: 'code', text: buffer.join('\n'), info });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: 'h', level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const buffer: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buffer.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'quote', text: buffer.join(' ') });
      continue;
    }

    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ type: 'table', head, rows });
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        if (/^\s*[-*+]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
          i++;
        } else if (/^\s{2,}\S/.test(lines[i]) && items.length > 0) {
          items[items.length - 1] += ` ${lines[i].trim()}`;
          i++;
        } else {
          break;
        }
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        if (/^\s*\d+[.)]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
          i++;
        } else if (/^\s{2,}\S/.test(lines[i]) && items.length > 0) {
          items[items.length - 1] += ` ${lines[i].trim()}`;
          i++;
        } else {
          break;
        }
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    const buffer: string[] = [line];
    i++;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^(#{1,6}\s|>|`{3,}|~{3,}|\s*[-*+]\s|\s*\d+[.)]\s)/.test(lines[i])
    ) {
      buffer.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'p', text: buffer.join(' ') });
  }

  return blocks;
}

function safeHref(raw: string): string | null {
  const url = raw.trim();
  if (/^(https?:|mailto:)/i.test(url)) return url;
  if (url.startsWith('#') || url.startsWith('/')) return url;
  return null;
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*|\[[^\]]+\]\([^)]+\))/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith('`')) {
      nodes.push(
        <code
          key={key++}
          className="rounded border border-border bg-elevated px-1 py-0.5 font-mono text-[0.78em] text-foreground"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**')) {
      nodes.push(
        <strong key={key++} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('*')) {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const href = link ? safeHref(link[2]) : null;
      if (link && href) {
        nodes.push(
          <a
            key={key++}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
          >
            {link[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

export function MarkdownView({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => parseBlocks(markdown), [markdown]);

  return (
    <div className="space-y-3 text-[13px] leading-relaxed text-muted">
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'h': {
            const size =
              block.level === 1
                ? 'text-xl font-semibold text-foreground'
                : block.level === 2
                  ? 'mt-5 border-b border-border pb-1.5 text-base font-semibold text-foreground'
                  : 'mt-3 text-sm font-semibold text-foreground';
            return (
              <p key={index} className={size} role="heading" aria-level={Math.min(block.level, 6)}>
                {renderInline(block.text)}
              </p>
            );
          }
          case 'p':
            return <p key={index}>{renderInline(block.text)}</p>;
          case 'quote':
            return (
              <blockquote
                key={index}
                className="border-l-2 border-primary/40 bg-elevated/60 py-1.5 pl-3 text-[12.5px] italic"
              >
                {renderInline(block.text)}
              </blockquote>
            );
          case 'code':
            return (
              <pre
                key={index}
                className="scroll-thin overflow-x-auto rounded-lg border border-border bg-elevated p-3 font-mono text-[12px] leading-relaxed text-foreground"
              >
                <code>{block.text}</code>
              </pre>
            );
          case 'ul':
            return (
              <ul key={index} className="list-disc space-y-1 pl-5 marker:text-faint">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{renderInline(item)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={index} className="list-decimal space-y-1 pl-5 marker:text-faint">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{renderInline(item)}</li>
                ))}
              </ol>
            );
          case 'hr':
            return <hr key={index} className="border-border" />;
          case 'table':
            return (
              <div key={index} className="scroll-thin overflow-x-auto rounded-lg border border-border">
                <table className="w-full border-collapse text-left text-[12px]">
                  <thead className="bg-elevated text-foreground">
                    <tr>
                      {block.head.map((cell, cellIndex) => (
                        <th key={cellIndex} className="border-b border-border px-2.5 py-1.5 font-medium">
                          {renderInline(cell)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex} className="odd:bg-elevated/40">
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex} className="border-b border-border/60 px-2.5 py-1.5 align-top">
                            {renderInline(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
