// ADD [Claude AI - Opus 5] (2026-10-08 10:48:42): tiny markdown renderer and source
// highlighter. Skill text is data: it is HTML-escaped before anything else happens.

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(text) {
  let out = text;
  const codeSpans = [];
  out = out.replace(/`([^`]+)`/g, (_, code) => {
    codeSpans.push(code);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, alt) => `<em>[image: ${alt}]</em>`);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, label, href) => {
    const external = /^https?:\/\//.test(href);
    const attrs = external ? ' target="_blank" rel="noreferrer noopener"' : '';
    return `<a href="${external ? href : '#'}" title="${href}"${attrs}>${label}</a>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codeSpans[Number(i)]}</code>`);
  return out;
}

function tableRow(line) {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

export function renderMarkdown(source) {
  const lines = escapeHtml(source || '').split('\n');
  const out = [];
  let i = 0;

  const flushParagraph = (buffer) => {
    if (buffer.length) out.push(`<p>${inline(buffer.join(' '))}</p>`);
    buffer.length = 0;
  };
  const paragraph = [];

  while (i < lines.length) {
    const line = lines[i];

    const fence = /^\s*(```+|~~~+)(.*)$/.exec(line);
    if (fence) {
      flushParagraph(paragraph);
      const marker = fence[1][0];
      const code = [];
      i += 1;
      while (i < lines.length && !new RegExp(`^\\s*${marker === '`' ? '```' : '~~~'}`).test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1;
      out.push(`<pre class="code"><code>${code.join('\n')}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph(paragraph);
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      flushParagraph(paragraph);
      out.push('<hr>');
      i += 1;
      continue;
    }

    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      flushParagraph(paragraph);
      const head = tableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(tableRow(lines[i]));
        i += 1;
      }
      const thead = head.map((c) => `<th>${inline(c)}</th>`).join('');
      const tbody = rows
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
        .join('');
      out.push(`<table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`);
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flushParagraph(paragraph);
      const quote = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote>${renderMarkdown(quote.join('\n'))}</blockquote>`);
      continue;
    }

    const bullet = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph(paragraph);
      const ordered = /\d/.test(bullet[2]);
      const items = [];
      while (i < lines.length) {
        const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (!item) {
          if (/^\s{2,}\S/.test(lines[i]) && items.length) {
            items[items.length - 1] += ` ${lines[i].trim()}`;
            i += 1;
            continue;
          }
          break;
        }
        if (/\d/.test(item[2]) !== ordered) break;
        items.push(item[3]);
        i += 1;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${tag}>`);
      continue;
    }

    if (line.trim() === '') {
      flushParagraph(paragraph);
      i += 1;
      continue;
    }

    paragraph.push(line.trim());
    i += 1;
  }

  flushParagraph(paragraph);
  return out.join('\n');
}

// Source-pane highlighting: escape, then wrap tokens. Fenced blocks win over
// everything inside them so code is not re-tokenised.
export function highlightMarkdown(source) {
  const escaped = escapeHtml(source || '');
  const lines = escaped.split('\n');
  const out = [];
  let inFence = false;

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      out.push(`<span class="t-fence">${line}</span>`);
      continue;
    }
    if (inFence) {
      out.push(`<span class="t-code">${line}</span>`);
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      out.push(`<span class="t-head">${line}</span>`);
      continue;
    }
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      out.push(`<span class="t-rule">${line}</span>`);
      continue;
    }

    let marked = line;
    marked = marked.replace(/`[^`]+`/g, (m) => `\u0001${m}\u0002`);
    marked = marked.replace(/\[[^\]\n]*\]\([^)\s]+\)/g, (m) => `\u0003${m}\u0004`);
    marked = marked.replace(/\*\*[^*\n]+\*\*/g, (m) => `\u0005${m}\u0006`);
    marked = marked.replace(/^(\s*)([-*+]|\d+[.)])(\s)/, '$1\u0007$2\u0008$3');
    marked = marked
      .replace(/\u0001([\s\S]*?)\u0002/g, '<span class="t-code">$1</span>')
      .replace(/\u0003([\s\S]*?)\u0004/g, '<span class="t-link">$1</span>')
      .replace(/\u0005([\s\S]*?)\u0006/g, '<span class="t-bold">$1</span>')
      .replace(/\u0007([\s\S]*?)\u0008/g, '<span class="t-bullet">$1</span>');
    out.push(marked);
  }

  // A trailing newline needs a character after it or the overlay loses a line.
  return `${out.join('\n')}\n`;
}
