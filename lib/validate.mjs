// ADD [Claude AI - Opus 5] (2026-10-08 10:48:42): validation rules for a skill folder.
// Errors are things Claude Code will choke on; warnings are quality and cost nudges.

import fs from 'node:fs';
import path from 'node:path';

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DESC_MAX = 1024;
const NAME_MAX = 64;
const BODY_LINE_WARN = 500;

// Phrases that give the model something to match on when it decides to load a skill.
const TRIGGER_HINTS = [
  'use when',
  'use for',
  'use this',
  'trigger',
  'when the user',
  'when you',
  'apply when',
  'read this',
  'read before',
  'load before',
  'invoke',
];

function fileExists(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function dirExists(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// Markdown inline links, reference definitions and bare backticked paths are all
// ways a SKILL.md points at a sibling file.
export function extractLinks(text) {
  const targets = [];
  const push = (raw) => {
    if (!raw) return;
    const target = raw.trim().replace(/^<|>$/g, '');
    if (!target) return;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return; // http:, mailto:, etc.
    if (target.startsWith('#')) return;
    targets.push(target);
  };

  const fenceless = text.replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, ' '));

  const inline = /\[[^\]\n]*\]\(([^()\s]+(?:\([^()]*\)[^()\s]*)*)\)/g;
  let m;
  while ((m = inline.exec(fenceless)) !== null) push(m[1]);

  const refDef = /^[ \t]*\[[^\]\n]+\]:[ \t]*(\S+)/gm;
  while ((m = refDef.exec(fenceless)) !== null) push(m[1]);

  return targets;
}

function normalizeTarget(target) {
  const withoutAnchor = target.split('#')[0].split('?')[0];
  if (!withoutAnchor) return null;
  let decoded = withoutAnchor;
  try {
    decoded = decodeURIComponent(withoutAnchor);
  } catch {
    /* keep the raw target if it is not valid percent-encoding */
  }
  return decoded.replace(/\\/g, '/');
}

export function validateSkill({ skillDir, parsed, body, files, allSkills = [], loaded = true }) {
  const issues = [];
  const add = (level, code, message, hint) => issues.push({ level, code, message, hint });

  const folder = path.basename(skillDir);
  const fields = parsed.fields || {};

  if (!parsed.hadFrontmatter) {
    add(
      'error',
      'E_NO_FRONTMATTER',
      'SKILL.md has no YAML frontmatter block.',
      'The file must start with --- , then name and description, then --- .',
    );
  }
  if (parsed.yamlError) {
    add('error', 'E_YAML', parsed.yamlError, 'Fix the quoting, then reload.');
  }

  const name = (fields.name || '').trim();
  if (!name) {
    add('error', 'E_NAME_MISSING', 'Frontmatter has no name.', `Set name: ${folder}`);
  } else {
    if (name.length > NAME_MAX) {
      add('error', 'E_NAME_LONG', `name is ${name.length} chars (max ${NAME_MAX}).`);
    }
    if (!NAME_RE.test(name)) {
      add(
        'error',
        'E_NAME_FORMAT',
        `name "${name}" is not kebab-case.`,
        'Use lowercase letters, digits and single hyphens.',
      );
    }
    if (name !== folder) {
      add(
        'error',
        'E_NAME_MISMATCH',
        `name "${name}" does not match the folder "${folder}".`,
        'Claude Code addresses the skill by folder; they must agree.',
      );
    }
    // Only roots Claude Code actually loads can collide. A repo checkout is the
    // source of an installed plugin, not a second skill competing with it.
    if (loaded) {
      const clash = allSkills.filter(
        (s) =>
          s.name === name &&
          s.loaded !== false &&
          path.resolve(s.dir) !== path.resolve(skillDir),
      );
      for (const other of clash) {
        add(
          'warn',
          'W_NAME_COLLISION',
          `Another loaded skill named "${name}" exists in ${other.rootLabel}.`,
          'Two loaded skills with one name are ambiguous to invoke; rename one.',
        );
      }
    }
  }

  const description = (fields.description || '').trim();
  if (!description) {
    add(
      'error',
      'E_DESC_MISSING',
      'Frontmatter has no description.',
      'The description is the only text the model sees when deciding to load this skill.',
    );
  } else {
    if (description.length > DESC_MAX) {
      add('error', 'E_DESC_LONG', `description is ${description.length} chars (max ${DESC_MAX}).`);
    }
    if (description.length < 40) {
      add(
        'warn',
        'W_DESC_SHORT',
        `description is only ${description.length} chars.`,
        'Short descriptions are rarely matched. Say what it does and when to use it.',
      );
    }
    const lower = description.toLowerCase();
    if (!TRIGGER_HINTS.some((hint) => lower.includes(hint))) {
      add(
        'warn',
        'W_DESC_NO_TRIGGER',
        'description does not say when to use the skill.',
        'Add a trigger clause, e.g. "Use when ..." or "Trigger with ...".',
      );
    }
  }

  const bodyText = (body || '').trim();
  if (!bodyText) {
    add('error', 'E_EMPTY_BODY', 'SKILL.md has frontmatter but no instructions.');
  } else {
    if (!/^#[ \t]+\S/m.test(bodyText)) {
      add('warn', 'W_H1_MISSING', 'The body has no top-level heading.');
    }
    const lineCount = bodyText.split('\n').length;
    if (lineCount > BODY_LINE_WARN) {
      add(
        'warn',
        'W_BODY_LONG',
        `The body is ${lineCount} lines; all of it loads into context.`,
        'Move detail into references/ and link to it.',
      );
    }
    const todo = /\b(TODO|FIXME|XXX)\b/.exec(bodyText);
    if (todo) {
      add('warn', 'W_TODO', `The body still contains ${todo[1]}.`);
    }
  }

  const mdFiles = (files || []).filter((f) => /\.(md|markdown)$/i.test(f.relative));
  const referenced = new Set();
  const texts = [];

  for (const file of mdFiles) {
    let text = '';
    try {
      text = fs.readFileSync(file.path, 'utf8');
    } catch {
      continue;
    }
    texts.push({ relative: file.relative, text });
    const fromDir = path.dirname(file.path);
    for (const raw of extractLinks(text)) {
      const target = normalizeTarget(raw);
      if (!target) continue;

      if (path.isAbsolute(target) || /^[A-Za-z]:[\\/]/.test(target)) {
        add(
          'warn',
          'W_ABS_LINK',
          `${file.relative} links to an absolute path: ${target}`,
          'Absolute paths break on another machine; use a relative path.',
        );
        continue;
      }

      const resolved = path.resolve(fromDir, target);
      if (fileExists(resolved)) {
        referenced.add(path.resolve(resolved));
        continue;
      }
      if (dirExists(resolved)) continue;

      const outside = !path.resolve(resolved).startsWith(path.resolve(skillDir) + path.sep);
      add(
        'error',
        'E_LINK_BROKEN',
        `${file.relative} links to a missing file: ${target}`,
        outside
          ? 'The target is outside this skill folder; check the ../ depth.'
          : 'Create the file or fix the link.',
      );
    }
  }

  // A reference can be a markdown link or just a backticked path in prose, so an
  // orphan is a file no other markdown mentions by path at all.
  for (const file of files || []) {
    if (file.relative === 'SKILL.md') continue;
    if (!/\.(md|markdown)$/i.test(file.relative)) continue;
    if (referenced.has(path.resolve(file.path))) continue;

    const base = path.basename(file.relative);
    const mentioned = texts.some(
      (other) =>
        other.relative !== file.relative &&
        (other.text.includes(file.relative) || other.text.includes(base)),
    );
    if (mentioned) continue;

    add(
      'warn',
      'W_ORPHAN',
      `${file.relative} is never mentioned by any markdown in this skill.`,
      'A reference nothing points at is never read. Link it or delete it.',
    );
  }

  const order = { error: 0, warn: 1 };
  issues.sort((a, b) => order[a.level] - order[b.level] || a.code.localeCompare(b.code));
  return {
    issues,
    errors: issues.filter((i) => i.level === 'error').length,
    warnings: issues.filter((i) => i.level === 'warn').length,
  };
}
