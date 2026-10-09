// ADD [Claude AI - Opus 5] (2026-10-08 10:48:42): local-only HTTP server for the
// Claude Skill Editor. Zero npm dependencies. Binds 127.0.0.1 and requires a
// per-run token so another site in the browser cannot drive it.

import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { parse, serialize } from './lib/frontmatter.mjs';
import { validateSkill } from './lib/validate.mjs';
import {
  addCustomRoot,
  clearRecent,
  copyDir,
  listSkillFiles,
  listSkills,
  listSkillsWithStats,
  loadRecent,
  loadRoots,
  pushRecent,
  readText,
  removeCustomRoot,
  resolveInRoots,
  writeText,
} from './lib/skills.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, 'public');

// The token outlives a restart so an open page keeps working (and can still save
// unsaved edits) while `node --watch` cycles the process.
const TOKEN_PATH = path.join(os.homedir(), '.claude', 'skill-editor-token');

function loadOrCreateToken() {
  try {
    const existing = fsSync.readFileSync(TOKEN_PATH, 'utf8').trim();
    if (/^[a-f0-9]{32}$/.test(existing)) return existing;
  } catch {
    /* fall through and mint a new one */
  }
  const minted = crypto.randomBytes(16).toString('hex');
  try {
    fsSync.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
    fsSync.writeFileSync(TOKEN_PATH, `${minted}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch {
    /* an unwritable token file only costs us cross-restart continuity */
  }
  return minted;
}

const TOKEN = loadOrCreateToken();
// Bump whenever the API the page depends on changes, so a page served by a
// still-running old process says so instead of failing silently.
const API_VERSION = 2;
// A fresh id each boot: the page reloads when it sees this change.
const BOOT_ID = crypto.randomBytes(8).toString('hex');
const liveClients = new Set();

const args = process.argv.slice(2);
function flag(name, fallback) {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const PROJECT_DIR = path.resolve(flag('project', process.cwd()));
const START_PORT = Number(flag('port', '7777'));
const SHOULD_OPEN = !args.includes('--no-open');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) throw new Error('Request body too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// Only this page, loaded from this server, may call the API.
function authorized(req, url) {
  const host = (req.headers.host || '').split(':')[0];
  if (host !== '127.0.0.1' && host !== 'localhost') return false;
  const origin = req.headers.origin;
  if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return false;
  if (req.headers['x-editor-token'] === TOKEN) return true;
  // EventSource cannot set headers; the token still has to be present.
  return Boolean(url && url.pathname === '/api/live' && url.searchParams.get('token') === TOKEN);
}

function broadcastLive(event, data) {
  for (const res of liveClients) {
    try {
      res.write(`event: ${event}\ndata: ${data}\n\n`);
    } catch {
      liveClients.delete(res);
    }
  }
}

function openLiveChannel(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  });
  res.write(`event: boot\ndata: ${BOOT_ID}\n\n`);
  liveClients.add(res);

  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* the close handler below cleans up */
    }
  }, 25000);

  const done = () => {
    clearInterval(ping);
    liveClients.delete(res);
  };
  req.on('close', done);
  res.on('error', done);
}

function rootsNow() {
  return loadRoots(PROJECT_DIR);
}

function rootById(roots, id) {
  const root = roots.find((r) => r.id === id);
  if (!root) throw new Error(`Unknown root: ${id}`);
  return root;
}

async function loadSkill(roots, dirInput) {
  const { resolved, root } = resolveInRoots(roots, dirInput);
  const files = await listSkillFiles(resolved);
  const raw = await readText(path.join(resolved, 'SKILL.md'));
  const parsed = parse(raw);
  const allSkills = await listSkills(roots);
  const validation = validateSkill({
    skillDir: resolved,
    parsed,
    body: parsed.body,
    files,
    allSkills,
    loaded: root.loaded !== false,
  });
  return {
    dir: resolved,
    folder: path.basename(resolved),
    rootId: root.id,
    rootLabel: root.label,
    rootKind: root.kind,
    writable: root.writable,
    loaded: root.loaded !== false,
    fields: parsed.fields,
    extraLines: parsed.extraLines,
    body: parsed.body,
    files,
    validation,
  };
}

const SKELETON = (name) => `# ${name
  .split('-')
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
  .join(' ')}

Describe what this skill does and the steps to follow.

## When to use

## Steps

1.
`;

async function handleApi(req, res, url) {
  if (!authorized(req, url)) {
    send(res, 403, { error: 'Forbidden. Open the editor from the URL this server printed.' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/live') {
    openLiveChannel(req, res);
    return;
  }

  const roots = rootsNow();

  if (req.method === 'GET' && url.pathname === '/api/state') {
    // Report what each folder yielded, so one that found nothing says so instead
    // of just sitting there — and says whether it was empty or merely redundant.
    const { skills, stats } = await listSkillsWithStats(roots);
    send(res, 200, {
      apiVersion: API_VERSION,
      projectDir: PROJECT_DIR,
      roots: roots.map(({ id, label, detail, group, dir, kind, writable, loaded }) => ({
        id,
        label,
        detail: detail || dir,
        group: group || 'yours',
        dir,
        kind,
        writable,
        loaded: loaded !== false,
        skillCount: stats.get(id)?.claimed ?? 0,
        duplicateCount: stats.get(id)?.duplicate ?? 0,
      })),
      skills,
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/skill') {
    const skill = await loadSkill(roots, url.searchParams.get('dir'));
    if (url.searchParams.get('remember') !== '0') {
      pushRecent({
        dir: skill.dir,
        name: skill.fields.name || skill.folder,
        rootLabel: skill.rootLabel,
        writable: skill.writable,
      });
    }
    send(res, 200, skill);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/recent') {
    send(res, 200, { recent: loadRecent() });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/file') {
    const { resolved } = resolveInRoots(roots, url.searchParams.get('path'));
    send(res, 200, { path: resolved, text: await readText(resolved) });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/validate-all') {
    const skills = await listSkills(roots);
    const results = [];
    for (const skill of skills) {
      try {
        const raw = await readText(path.join(skill.dir, 'SKILL.md'));
        const parsed = parse(raw);
        const files = await listSkillFiles(skill.dir);
        const validation = validateSkill({
          skillDir: skill.dir,
          parsed,
          body: parsed.body,
          files,
          allSkills: skills,
          loaded: skill.loaded !== false,
        });
        results.push({ dir: skill.dir, errors: validation.errors, warnings: validation.warnings });
      } catch (err) {
        results.push({ dir: skill.dir, errors: 1, warnings: 0, failed: String(err.message) });
      }
    }
    send(res, 200, { results });
    return;
  }

  if (req.method === 'POST') {
    const body = await readBody(req);

    if (url.pathname === '/api/save-skill') {
      const { resolved, root } = resolveInRoots(roots, body.dir);
      if (!root.writable) throw new Error(`${root.label} is read-only. Fork the skill first.`);
      const text = serialize({
        fields: body.fields || {},
        extraLines: body.extraLines || [],
        body: body.body || '',
      });
      await writeText(path.join(resolved, 'SKILL.md'), text);
      send(res, 200, await loadSkill(roots, resolved));
      return;
    }

    if (url.pathname === '/api/save-file') {
      const { resolved, root } = resolveInRoots(roots, body.path);
      if (!root.writable) throw new Error(`${root.label} is read-only. Fork the skill first.`);
      if (typeof body.text !== 'string') throw new Error('No text supplied.');
      await writeText(resolved, body.text.replace(/\r\n/g, '\n'));
      send(res, 200, { ok: true, path: resolved });
      return;
    }

    if (url.pathname === '/api/new-skill') {
      const root = rootById(roots, body.rootId);
      if (!root.writable) throw new Error(`${root.label} is read-only.`);
      const folder = String(body.folder || '').trim();
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(folder)) {
        throw new Error('Folder name must be kebab-case: lowercase letters, digits, hyphens.');
      }
      const dir = path.join(root.dir, folder);
      try {
        await fsp.access(dir);
        throw new Error(`${folder} already exists in ${root.label}.`);
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
      const text = serialize({
        fields: { name: folder, description: String(body.description || '').trim() },
        extraLines: [],
        body: SKELETON(folder),
      });
      await writeText(path.join(dir, 'SKILL.md'), text);
      send(res, 200, await loadSkill(rootsNow(), dir));
      return;
    }

    if (url.pathname === '/api/fork-skill') {
      const { resolved } = resolveInRoots(roots, body.dir);
      const target = rootById(roots, body.targetRootId);
      if (!target.writable) throw new Error(`${target.label} is read-only.`);
      const folder = String(body.folder || path.basename(resolved)).trim();
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(folder)) {
        throw new Error('Folder name must be kebab-case.');
      }
      const dest = path.join(target.dir, folder);
      await copyDir(resolved, dest);

      // Keep frontmatter name in step with the new folder.
      const raw = await readText(path.join(dest, 'SKILL.md'));
      const parsed = parse(raw);
      if (parsed.fields.name !== folder) {
        parsed.fields.name = folder;
        await writeText(
          path.join(dest, 'SKILL.md'),
          serialize({ fields: parsed.fields, extraLines: parsed.extraLines, body: parsed.body }),
        );
      }
      send(res, 200, await loadSkill(rootsNow(), dest));
      return;
    }

    if (url.pathname === '/api/new-file') {
      const { resolved, root } = resolveInRoots(roots, body.dir);
      if (!root.writable) throw new Error(`${root.label} is read-only.`);
      const rel = String(body.relative || '').trim().replace(/\\/g, '/');
      if (!rel || rel.startsWith('/') || rel.split('/').includes('..')) {
        throw new Error('Give a relative path inside the skill folder, e.g. references/notes.md');
      }
      const dest = path.join(resolved, rel);
      resolveInRoots(roots, dest);
      try {
        await fsp.access(dest);
        throw new Error(`${rel} already exists.`);
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
      await writeText(dest, String(body.text || ''));
      send(res, 200, await loadSkill(roots, resolved));
      return;
    }

    if (url.pathname === '/api/clear-recent') {
      send(res, 200, { recent: clearRecent() });
      return;
    }

    if (url.pathname === '/api/add-root') {
      const dir = addCustomRoot(String(body.dir || ''), body.label);
      send(res, 200, { ok: true, dir });
      return;
    }

    if (url.pathname === '/api/remove-root') {
      send(res, 200, { ok: removeCustomRoot(String(body.dir || '')) });
      return;
    }
  }

  send(res, 404, { error: `No such endpoint: ${req.method} ${url.pathname}` });
}

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
    return;
  }
  let text;
  try {
    text = await fsp.readFile(file);
  } catch {
    send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    return;
  }
  const ext = path.extname(file).toLowerCase();
  if (ext === '.html') {
    const injected = text.toString('utf8').replace('__EDITOR_TOKEN__', TOKEN);
    send(res, 200, injected, MIME[ext]);
    return;
  }
  send(res, 200, text, MIME[ext] || 'application/octet-stream');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const run = url.pathname.startsWith('/api/')
    ? handleApi(req, res, url)
    : serveStatic(res, url.pathname);
  run.catch((err) => {
    if (res.headersSent) return;
    send(res, 400, { error: String(err && err.message ? err.message : err) });
  });
});

function watchPublic() {
  try {
    let timer = null;
    fsSync.watch(PUBLIC_DIR, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => broadcastLive('reload', 'public'), 400);
    });
  } catch {
    /* without a watcher the page still reloads on a server restart */
  }
}

function listen(port, attemptsLeft) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      listen(port + 1, attemptsLeft - 1);
      return;
    }
    console.error(`Could not start: ${err.message}`);
  });
  server.listen(port, '127.0.0.1', () => {
    // FIX [Claude AI - Opus 5] (2026-10-08 11:34:10): report the port actually bound.
    // The callback from the first listen() stays attached across EADDRINUSE retries,
    // so a closed-over `port` printed the busy port and sent you to the wrong server.
    const urlString = `http://127.0.0.1:${server.address().port}/`;
    console.log('Claude Skill Editor');
    console.log(`  project : ${PROJECT_DIR}`);
    console.log(`  open    : ${urlString}`);
    console.log('  stop    : Ctrl+C');
    watchPublic();
    if (SHOULD_OPEN) {
      const child =
        process.platform === 'win32'
          ? spawn('cmd', ['/c', 'start', '', urlString], { detached: true, stdio: 'ignore' })
          : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [urlString], {
              detached: true,
              stdio: 'ignore',
            });
      child.on('error', () => console.log('  (open the URL above manually)'));
      child.unref();
    }
  });
}

listen(Number.isFinite(START_PORT) ? START_PORT : 7777, 20);
