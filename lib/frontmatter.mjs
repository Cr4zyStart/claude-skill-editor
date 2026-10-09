// ADD [Claude AI - Opus 5] (2026-10-08 10:48:42): YAML frontmatter parse/serialize for SKILL.md.
// Known keys are parsed into fields; every other line is preserved verbatim so a
// save never drops frontmatter the editor does not understand.

const KNOWN = [
  'name',
  'description',
  'license',
  'model',
  'allowed-tools',
  'disable-model-invocation',
];

function unquote(raw) {
  const s = raw.trim();
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    return s
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\');
  }
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

function needsQuotes(value) {
  if (value === '') return true;
  if (/^[\s]|[\s]$/.test(value)) return true;
  if (/[:#"'\n\r\t]/.test(value)) return true;
  if (/^[-?|>@`&*!%[\]{},]/.test(value)) return true;
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(value)) return true;
  if (/^[\d.+-]+$/.test(value)) return true;
  return false;
}

export function quoteYaml(value) {
  if (!needsQuotes(value)) return value;
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '');
  return `"${escaped}"`;
}

// Returns { fields, extraLines, body, hadFrontmatter, yamlError }.
export function parse(text) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/^﻿/, '');
  const match = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(normalized);
  if (!match) {
    return {
      fields: {},
      extraLines: [],
      body: normalized,
      hadFrontmatter: false,
      yamlError: null,
    };
  }

  const block = match[1];
  const body = normalized.slice(match[0].length);
  const fields = {};
  const extraLines = [];
  let yamlError = null;

  const lines = block.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') continue;

    const kv = /^([A-Za-z0-9_-]+)[ \t]*:(.*)$/.exec(line);
    if (!kv) {
      // Continuation of a block scalar or a nested map: keep it with its owner.
      extraLines.push(line);
      continue;
    }

    const key = kv[1];
    const rest = kv[2];

    if (!KNOWN.includes(key)) {
      extraLines.push(line);
      // Carry any indented children of an unknown key along with it.
      while (i + 1 < lines.length && /^[ \t]+\S/.test(lines[i + 1])) {
        i += 1;
        extraLines.push(lines[i]);
      }
      continue;
    }

    const trimmedRest = rest.trim();

    if (trimmedRest === '|' || trimmedRest === '>' || /^[|>][-+]?\d*$/.test(trimmedRest)) {
      const folded = trimmedRest[0] === '>';
      const chunk = [];
      while (i + 1 < lines.length && (lines[i + 1].trim() === '' || /^[ \t]+/.test(lines[i + 1]))) {
        i += 1;
        chunk.push(lines[i].replace(/^[ \t]{1,4}/, ''));
      }
      while (chunk.length && chunk[chunk.length - 1].trim() === '') chunk.pop();
      fields[key] = folded ? chunk.join(' ').replace(/\s+/g, ' ').trim() : chunk.join('\n');
      continue;
    }

    if (trimmedRest === '') {
      const items = [];
      while (i + 1 < lines.length && /^[ \t]*-[ \t]+/.test(lines[i + 1])) {
        i += 1;
        items.push(unquote(lines[i].replace(/^[ \t]*-[ \t]+/, '')));
      }
      if (items.length) {
        fields[key] = items.join(', ');
        continue;
      }
      // An empty known key with nested children we cannot model: preserve raw.
      extraLines.push(line);
      while (i + 1 < lines.length && /^[ \t]+\S/.test(lines[i + 1])) {
        i += 1;
        extraLines.push(lines[i]);
      }
      continue;
    }

    if (
      (trimmedRest[0] === '"' && !/"$/.test(trimmedRest)) ||
      (trimmedRest[0] === "'" && !/'$/.test(trimmedRest))
    ) {
      yamlError = `Unterminated quoted value for "${key}" on line ${i + 2}.`;
      fields[key] = trimmedRest;
      continue;
    }

    fields[key] = unquote(trimmedRest);
  }

  return { fields, extraLines, body, hadFrontmatter: true, yamlError };
}

export function serialize({ fields = {}, extraLines = [], body = '' }) {
  const out = [];
  for (const key of KNOWN) {
    const value = fields[key];
    if (value === undefined || value === null || String(value).trim() === '') continue;
    out.push(`${key}: ${quoteYaml(String(value))}`);
  }
  for (const line of extraLines) out.push(line);

  const trimmedBody = body.replace(/\r\n/g, '\n').replace(/^\n+/, '');
  return `---\n${out.join('\n')}\n---\n\n${trimmedBody.replace(/\s*$/, '')}\n`;
}

export { KNOWN as KNOWN_KEYS };
