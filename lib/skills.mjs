// ADD [Claude AI - Opus 5] (2026-10-08 10:48:42): skill root discovery, safe path
// resolution and file IO. Every path crossing the API is confined to a known root.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
export const CONFIG_PATH = path.join(CLAUDE_DIR, 'skill-editor-roots.json');
// ADD [Claude AI - Opus 5] (2026-10-08 11:52:07): recently opened skills, so the
// editor opens on a short list instead of the whole tree.
export const RECENT_PATH = path.join(CLAUDE_DIR, 'skill-editor-recent.json');
const RECENT_MAX = 15;

// FIX [Claude AI - Opus 5] (2026-10-08 15:34:10): 3 was too shallow. Pointing a
// root at a plugin repo puts its skills at depth 4 (plugins/<p>/skills/<name>),
// so the folder was accepted and then quietly yielded nothing.
const MAX_DEPTH = 6;
// A mis-aimed root (a drive, a home folder) must not walk forever.
const MAX_DIRS_SCANNED = 20000;

function norm(p) {
  return path.resolve(p);
}

function exists(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

// Installed plugins are read-only: a plugin update overwrites them.
function installedPluginRoots() {
  const data = readJson(path.join(CLAUDE_DIR, 'plugins', 'installed_plugins.json'));
  if (!data || !data.plugins) return [];
  const roots = [];
  for (const [id, entries] of Object.entries(data.plugins)) {
    for (const entry of Array.isArray(entries) ? entries : [entries]) {
      const dir = entry && entry.installPath ? path.join(entry.installPath, 'skills') : null;
      if (dir && exists(dir)) {
        roots.push({
          id: `plugin:${id}@${entry.version || '?'}`,
          label: id.split('@')[0],
          detail: `Installed plugin · ${id} v${entry.version || '?'}`,
          group: 'installed',
          dir: norm(dir),
          kind: 'plugin',
          writable: false,
          loaded: true,
        });
      }
    }
  }
  return roots;
}

function defaultRoots(projectDir) {
  const roots = [
    {
      id: 'user',
      label: 'My skills',
      detail: 'Skills you write, available in every project · ~/.claude/skills',
      group: 'yours',
      dir: norm(path.join(CLAUDE_DIR, 'skills')),
      kind: 'user',
      writable: true,
      loaded: true,
      createIfMissing: true,
    },
  ];

  if (projectDir) {
    const projectSkills = path.join(projectDir, '.claude', 'skills');
    roots.push({
      id: 'project',
      label: 'This project only',
      detail: `Skills that travel with ${path.basename(projectDir)} · .claude/skills`,
      group: 'yours',
      dir: norm(projectSkills),
      kind: 'project',
      writable: true,
      loaded: true,
      createIfMissing: true,
    });

    // Plugin repos checked out under the project are the user's own source, so writable.
    for (const candidate of pluginRepoRoots(projectDir)) roots.push(candidate);
  }

  roots.push(...installedPluginRoots());
  return roots;
}

function pluginRepoRoots(projectDir) {
  const found = [];
  let children = [];
  try {
    children = fs.readdirSync(projectDir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const child of children) {
    if (!child.isDirectory() || child.name.startsWith('.')) continue;
    const repo = path.join(projectDir, child.name);
    const pluginsDir = path.join(repo, 'plugins');
    if (!exists(pluginsDir)) continue;
    let plugins = [];
    try {
      plugins = fs.readdirSync(pluginsDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const plugin of plugins) {
      if (!plugin.isDirectory()) continue;
      const dir = path.join(pluginsDir, plugin.name, 'skills');
      if (!exists(dir)) continue;
      found.push({
        id: `repo:${child.name}/${plugin.name}`,
        label: plugin.name,
        detail: `Plugin source you can edit · ${child.name}/${plugin.name}`,
        group: 'editable',
        dir: norm(dir),
        kind: 'repo',
        writable: true,
        loaded: false,
      });
    }
  }
  return found;
}

export function loadRoots(projectDir) {
  const config = readJson(CONFIG_PATH);
  const extra = config && Array.isArray(config.roots) ? config.roots : [];
  const roots = defaultRoots(projectDir);

  for (const item of extra) {
    if (!item || typeof item.dir !== 'string') continue;
    const dir = norm(item.dir);
    if (roots.some((r) => r.dir === dir)) continue;
    roots.push({
      id: item.id || `custom:${dir}`,
      // FIX [Claude AI - Opus 5] (2026-10-08 19:18:40): older configs stored the full
      // path as the label, which then printed twice next to the real path.
      label: (item.label && item.label !== dir ? item.label : path.basename(dir)) || dir,
      detail: dir,
      group: 'yours',
      dir,
      kind: 'custom',
      writable: item.writable !== false,
      loaded: item.loaded === true,
      createIfMissing: true,
    });
  }

  for (const root of roots) {
    if (root.createIfMissing && !exists(root.dir)) {
      try {
        fs.mkdirSync(root.dir, { recursive: true });
      } catch {
        /* a root we cannot create is reported as missing below */
      }
    }
    root.missing = !exists(root.dir);
  }

  return roots.filter((r) => !r.missing || r.kind === 'user' || r.kind === 'project');
}

export function addCustomRoot(dir, label) {
  const resolved = norm(dir);
  if (!exists(resolved)) throw new Error(`Not a directory: ${resolved}`);
  const config = readJson(CONFIG_PATH) || { roots: [] };
  if (!Array.isArray(config.roots)) config.roots = [];
  if (!config.roots.some((r) => r && norm(r.dir || '') === resolved)) {
    config.roots.push({ dir: resolved, label: label || resolved, writable: true });
  }
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return resolved;
}

export function removeCustomRoot(dir) {
  const resolved = norm(dir);
  const config = readJson(CONFIG_PATH);
  if (!config || !Array.isArray(config.roots)) return false;
  const before = config.roots.length;
  config.roots = config.roots.filter((r) => !r || norm(r.dir || '') !== resolved);
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return config.roots.length !== before;
}

// Reject anything that does not resolve inside a root. Guards the write endpoints.
export function resolveInRoots(roots, candidate) {
  if (typeof candidate !== 'string' || candidate === '') {
    throw new Error('A path is required.');
  }
  const resolved = norm(candidate);
  for (const root of roots) {
    if (resolved === root.dir) return { resolved, root };
    if (resolved.startsWith(root.dir + path.sep)) return { resolved, root };
  }
  throw new Error(`Path is outside every configured skill root: ${resolved}`);
}

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'target', 'vendor']);

async function findSkillDirs(dir, depth, out, budget = { left: MAX_DIRS_SCANNED }) {
  if (budget.left <= 0) return;
  budget.left -= 1;

  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const hasSkill = entries.some((e) => e.isFile() && e.name === 'SKILL.md');
  if (hasSkill) {
    out.push(dir);
    return;
  }
  if (depth >= MAX_DEPTH) return;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    await findSkillDirs(path.join(dir, entry.name), depth + 1, out, budget);
  }
}

export async function listSkills(roots) {
  return (await listSkillsWithStats(roots)).skills;
}

// Per root: how many skills it contributed, and how many it saw that an earlier
// root had already claimed. The second number is what tells a redundant folder
// apart from an empty one.
export async function listSkillsWithStats(roots) {
  const skills = [];
  const stats = new Map();
  const seen = new Set();
  for (const root of roots) {
    stats.set(root.id, { claimed: 0, duplicate: 0 });
    const dirs = [];
    await findSkillDirs(root.dir, 0, dirs);
    for (const dir of dirs.sort()) {
      if (seen.has(norm(dir))) {
        stats.get(root.id).duplicate += 1;
        continue;
      }
      seen.add(norm(dir));
      stats.get(root.id).claimed += 1;
      let text = '';
      try {
        text = await fsp.readFile(path.join(dir, 'SKILL.md'), 'utf8');
      } catch {
        continue;
      }
      const { parse } = await import('./frontmatter.mjs');
      const parsed = parse(text);
      skills.push({
        dir,
        rootId: root.id,
        rootLabel: root.label,
        rootKind: root.kind,
        writable: root.writable,
        loaded: root.loaded !== false,
        folder: path.basename(dir),
        relative: path.relative(root.dir, dir).split(path.sep).join('/'),
        name: parsed.fields.name || '',
        description: parsed.fields.description || '',
      });
    }
  }
  return { skills, stats };
}

export async function listSkillFiles(skillDir) {
  const files = [];
  async function walk(dir, depth) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        if (depth < 4) await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      let size = 0;
      try {
        size = (await fsp.stat(full)).size;
      } catch {
        /* unreadable file still listed with size 0 */
      }
      files.push({
        path: full,
        relative: path.relative(skillDir, full).split(path.sep).join('/'),
        size,
        editable: /\.(md|markdown|txt|json|ya?ml|mjs|js|ts|sh|ps1|py|awk|toml)$/i.test(entry.name),
      });
    }
  }
  await walk(skillDir, 0);
  files.sort((a, b) => {
    if (a.relative === 'SKILL.md') return -1;
    if (b.relative === 'SKILL.md') return 1;
    return a.relative.localeCompare(b.relative);
  });
  return files;
}

export async function readText(file) {
  return fsp.readFile(file, 'utf8');
}

export async function writeText(file, text) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fsp.writeFile(tmp, text, 'utf8');
  // Rename over a file another process is reading can fail with EPERM on Windows.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await fsp.rename(tmp, file);
      return;
    } catch (err) {
      if (attempt === 5) {
        try {
          await fsp.unlink(tmp);
        } catch {
          /* leave the temp file if it cannot be removed */
        }
        throw err;
      }
      await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
    }
  }
}

export async function copyDir(from, to) {
  await fsp.cp(from, to, { recursive: true, errorOnExist: true, force: false });
}

// A recent entry whose SKILL.md is gone (deleted, or a plugin updated to a new
// version folder) is dropped rather than offered.
export function loadRecent() {
  const data = readJson(RECENT_PATH);
  const list = data && Array.isArray(data.recent) ? data.recent : [];
  return list
    .filter((item) => item && typeof item.dir === 'string')
    .filter((item) => {
      try {
        return fs.statSync(path.join(item.dir, 'SKILL.md')).isFile();
      } catch {
        return false;
      }
    })
    .slice(0, RECENT_MAX);
}

export function pushRecent(entry) {
  const dir = norm(entry.dir);
  const kept = loadRecent().filter((item) => norm(item.dir) !== dir);
  const next = [
    {
      dir,
      name: entry.name || path.basename(dir),
      rootLabel: entry.rootLabel || '',
      writable: entry.writable !== false,
      at: new Date().toISOString(),
    },
    ...kept,
  ].slice(0, RECENT_MAX);
  try {
    fs.writeFileSync(RECENT_PATH, `${JSON.stringify({ recent: next }, null, 2)}\n`, 'utf8');
  } catch {
    /* a recents file we cannot write is not worth failing the open over */
  }
  return next;
}

export function clearRecent() {
  try {
    fs.writeFileSync(RECENT_PATH, `${JSON.stringify({ recent: [] }, null, 2)}\n`, 'utf8');
  } catch {
    /* nothing to do */
  }
  return [];
}

export { path as nodePath };
