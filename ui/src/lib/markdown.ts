// ADD [Claude AI - Opus 5] (2026-10-08 14:05:12): markdown renderer and source
// highlighter, ported from the vanilla UI. Skill text is data: escaped first.

export function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inline(text: string): string {
  let out = text
  const codeSpans: string[] = []
  out = out.replace(/`([^`]+)`/g, (_m, code: string) => {
    codeSpans.push(code)
    return `\u0000${codeSpans.length - 1}\u0000`
  })
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_m, alt: string) => `<em>[image: ${alt}]</em>`)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_m, label: string, href: string) => {
    const external = /^https?:\/\//.test(href)
    const attrs = external ? ' target="_blank" rel="noreferrer noopener"' : ''
    return `<a href="${external ? href : '#'}" title="${href}"${attrs}>${label}</a>`
  })
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  out = out.replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>')
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  out = out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => `<code>${codeSpans[Number(i)]}</code>`)
  return out
}

function tableRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

export function renderMarkdown(source: string): string {
  const lines = escapeHtml(source || '').split('\n')
  const out: string[] = []
  const paragraph: string[] = []
  let i = 0

  const flush = () => {
    if (paragraph.length) out.push(`<p>${inline(paragraph.join(' '))}</p>`)
    paragraph.length = 0
  }

  while (i < lines.length) {
    const line = lines[i]

    const fence = /^\s*(```+|~~~+)/.exec(line)
    if (fence) {
      flush()
      const marker = fence[1][0] === '`' ? '```' : '~~~'
      const code: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trimStart().startsWith(marker)) {
        code.push(lines[i])
        i += 1
      }
      i += 1
      out.push(`<pre class="code"><code>${code.join('\n')}</code></pre>`)
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      const level = heading[1].length
      out.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`)
      i += 1
      continue
    }

    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      flush()
      out.push('<hr>')
      i += 1
      continue
    }

    if (
      /^\s*\|.*\|\s*$/.test(line) &&
      i + 1 < lines.length &&
      /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])
    ) {
      flush()
      const head = tableRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(tableRow(lines[i]))
        i += 1
      }
      const thead = head.map((c) => `<th>${inline(c)}</th>`).join('')
      const tbody = rows
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
        .join('')
      out.push(`<table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`)
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      flush()
      const quote: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''))
        i += 1
      }
      out.push(`<blockquote>${renderMarkdown(quote.join('\n'))}</blockquote>`)
      continue
    }

    const bullet = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (bullet) {
      flush()
      const ordered = /\d/.test(bullet[2])
      const items: string[] = []
      while (i < lines.length) {
        const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i])
        if (!item) {
          if (/^\s{2,}\S/.test(lines[i]) && items.length) {
            items[items.length - 1] += ` ${lines[i].trim()}`
            i += 1
            continue
          }
          break
        }
        if (/\d/.test(item[2]) !== ordered) break
        items.push(item[3])
        i += 1
      }
      const tag = ordered ? 'ol' : 'ul'
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${tag}>`)
      continue
    }

    if (line.trim() === '') {
      flush()
      i += 1
      continue
    }

    paragraph.push(line.trim())
    i += 1
  }

  flush()
  return out.join('\n')
}

// Source-pane highlighting: escape, then wrap tokens. Fenced blocks win over
// everything inside them so code is not re-tokenised.
export function highlightMarkdown(source: string): string {
  const lines = escapeHtml(source || '').split('\n')
  const out: string[] = []
  let inFence = false

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      out.push(`<span class="tok-fence">${line}</span>`)
      continue
    }
    if (inFence) {
      out.push(`<span class="tok-code">${line}</span>`)
      continue
    }
    if (/^#{1,6}\s/.test(line)) {
      out.push(`<span class="tok-head">${line}</span>`)
      continue
    }
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      out.push(`<span class="tok-fence">${line}</span>`)
      continue
    }

    let marked = line
    marked = marked.replace(/`[^`]+`/g, (m) => `\u0001${m}\u0002`)
    marked = marked.replace(/\[[^\]\n]*\]\([^)\s]+\)/g, (m) => `\u0003${m}\u0004`)
    marked = marked.replace(/\*\*[^*\n]+\*\*/g, (m) => `\u0005${m}\u0006`)
    marked = marked.replace(/^(\s*)([-*+]|\d+[.)])(\s)/, '$1\u0007$2\u0008$3')
    marked = marked
      .replace(/\u0001([\s\S]*?)\u0002/g, '<span class="tok-code">$1</span>')
      .replace(/\u0003([\s\S]*?)\u0004/g, '<span class="tok-link">$1</span>')
      .replace(/\u0005([\s\S]*?)\u0006/g, '<span class="tok-bold">$1</span>')
      .replace(/\u0007([\s\S]*?)\u0008/g, '<span class="tok-bullet">$1</span>')
    out.push(marked)
  }

  // A trailing newline needs a character after it or the overlay loses a line.
  return `${out.join('\n')}\n`
}

// Emit a frontmatter line, quoting only when YAML needs it.
export function yamlLine(key: string, value: string): string {
  const plain = !/^$|^\s|\s$|[:#"'\n\r\t]|^[-?|>@`&*!%[\]{},]/.test(value)
  return `${key}: ${plain ? value : JSON.stringify(value)}`
}
