// ADD [Claude AI - Opus 5] (2026-10-08 10:48:42): end-to-end proof. Spawns the real
// server on a spare port, exercises the guards and the write path against the real
// ~/.claude/skills, then removes what it created.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process'

import { listSkills } from '../lib/skills.mjs';

const HERE = import.meta.dirname;
const PROJECT = path.resolve(HERE, '..', '..');
const SERVER = path.join(HERE, '..', 'serve.mjs');
const PORT = 7900 + (process.pid % 90);
const FOLDER = `editor-smoke-${process.pid}`;
const SKILL_DIR = path.join(os.homedir(), '.claude', 'skills', FOLDER);
// The recents tests write the user's real recents file; put it back afterwards.
const RECENT_PATH = path.join(os.homedir(), '.claude', 'skill-editor-recent.json');
let recentBackup = null;

let child;
let token;
const base = `http://127.0.0.1:${PORT}`;

function start() {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, [SERVER, `--project=${PROJECT}`, `--port=${PORT}`, '--no-open'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const timer = setTimeout(() => reject(new Error(`server did not start: ${out}`)), 15000);
    child.stdout.on('data', (chunk) => {
      out += chunk;
      if (out.includes('open    :')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on('data', (chunk) => {
      out += chunk;
    });
    child.on('error', reject);
  });
}

async function get(pathname, headers = {}) {
  const res = await fetch(base + pathname, { headers: { 'x-editor-token': token, ...headers } });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function post(pathname, payload, headers = {}) {
  const res = await fetch(base + pathname, {
    method: 'POST',
    headers: { 'x-editor-token': token, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test.before(async () => {
  recentBackup = await fsp.readFile(RECENT_PATH, 'utf8').catch(() => null);
  await start();
  const html = await (await fetch(`${base}/`)).text();
  token = /data-token="([a-f0-9]+)"/.exec(html)[1];
  assert.equal(token.length, 32, 'token was not injected into the page');
});

test.after(async () => {
  await fsp.rm(SKILL_DIR, { recursive: true, force: true });
  if (recentBackup === null) {
    await fsp.rm(RECENT_PATH, { force: true });
  } else {
    await fsp.writeFile(RECENT_PATH, recentBackup, 'utf8');
  }
  if (child) child.kill();
});

test('the API refuses a request with no token', async () => {
  const res = await fetch(`${base}/api/state`);
  assert.equal(res.status, 403);
});

test('the API refuses a cross-origin request that has the token', async () => {
  const res = await get('/api/state', { Origin: 'https://evil.example' });
  assert.equal(res.status, 403);
});

test('the API refuses a path outside every root', async () => {
  const res = await get(`/api/file?path=${encodeURIComponent('C:/Windows/win.ini')}`);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /outside every configured skill root/);
});

test('state lists the real roots with correct writability', async () => {
  const { body } = await get('/api/state');
  assert.ok(body.skills.length > 50, `expected the real skill tree, got ${body.skills.length}`);
  const plugin = body.roots.find((r) => r.kind === 'plugin');
  assert.ok(plugin, 'no installed-plugin root was discovered');
  assert.equal(plugin.writable, false, 'plugin roots must be read-only');
  assert.ok(body.roots.some((r) => r.kind === 'user' && r.writable));
});

test('a plugin skill cannot be written', async () => {
  const { body } = await get('/api/state');
  const pluginRoot = body.roots.find((r) => r.kind === 'plugin');
  const victim = body.skills.find((s) => s.rootId === pluginRoot.id);
  const res = await post('/api/save-skill', {
    dir: victim.dir,
    fields: { name: victim.name, description: 'overwritten' },
    extraLines: [],
    body: '# nope\n',
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /read-only/);

  const after = await get(`/api/skill?dir=${encodeURIComponent(victim.dir)}`);
  assert.equal(after.body.fields.description, victim.description, 'the file was modified anyway');
});

test('a new skill is created clean', async () => {
  const res = await post('/api/new-skill', {
    rootId: 'user',
    folder: FOLDER,
    description: 'Smoke test skill. Use when verifying the editor end to end.',
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.dir, SKILL_DIR);
  assert.equal(res.body.validation.errors, 0, JSON.stringify(res.body.validation.issues));
});

test('a rejected folder name does not create anything', async () => {
  const res = await post('/api/new-skill', { rootId: 'user', folder: '../escape', description: 'x' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /kebab-case/);
});

test('saving preserves unknown frontmatter and reports a broken link', async () => {
  const res = await post('/api/save-skill', {
    dir: SKILL_DIR,
    fields: { name: FOLDER, description: 'Smoke test skill. Use when verifying the editor.' },
    extraLines: ['metadata:', '  type: project'],
    body: '# Smoke\n\nSee [refs](references/missing.md).\n',
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.extraLines, ['metadata:', '  type: project']);
  const codes = res.body.validation.issues.map((i) => i.code);
  assert.ok(codes.includes('E_LINK_BROKEN'), `expected E_LINK_BROKEN, got ${codes.join(',')}`);

  const onDisk = await fsp.readFile(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
  assert.match(onDisk, /^---\nname: /);
  assert.match(onDisk, /metadata:\n {2}type: project/);
});

test('an unlinked reference file is reported as an orphan', async () => {
  const created = await post('/api/new-file', { dir: SKILL_DIR, relative: 'references/notes.md' });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.ok(created.body.files.some((f) => f.relative === 'references/notes.md'));
  const codes = created.body.validation.issues.map((i) => i.code);
  assert.ok(codes.includes('W_ORPHAN'), `expected W_ORPHAN, got ${codes.join(',')}`);
});

test('linking the reference clears both the broken link and the orphan', async () => {
  const res = await post('/api/save-skill', {
    dir: SKILL_DIR,
    fields: { name: FOLDER, description: 'Smoke test skill. Use when verifying the editor.' },
    extraLines: [],
    body: '# Smoke\n\nSee [notes](references/notes.md).\n',
  });
  const codes = res.body.validation.issues.map((i) => i.code);
  assert.ok(!codes.includes('E_LINK_BROKEN'), codes.join(','));
  assert.ok(!codes.includes('W_ORPHAN'), codes.join(','));
  assert.equal(res.body.validation.errors, 0);
});

test('a new file cannot escape the skill folder', async () => {
  const res = await post('/api/new-file', { dir: SKILL_DIR, relative: '../../escaped.md' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /relative path inside the skill folder/);
});

test('forking a read-only plugin skill produces an editable copy', async () => {
  const { body } = await get('/api/state');
  const pluginRoot = body.roots.find((r) => r.kind === 'plugin');
  const source = body.skills.find((s) => s.rootId === pluginRoot.id && s.name);
  const folder = `${FOLDER}-fork`;
  const res = await post('/api/fork-skill', {
    dir: source.dir,
    targetRootId: 'user',
    folder,
  });
  try {
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.writable, true);
    assert.equal(res.body.fields.name, folder, 'fork did not rename the frontmatter name');
  } finally {
    await fsp.rm(path.join(os.homedir(), '.claude', 'skills', folder), {
      recursive: true,
      force: true,
    });
  }
});

test('validate-all covers the whole tree', async () => {
  const res = await post('/api/validate-all', {});
  assert.equal(res.status, 200);
  assert.ok(res.body.results.length > 50);
  const failed = res.body.results.filter((r) => r.failed);
  assert.deepEqual(failed, [], 'some skills could not be validated');
  const errors = res.body.results.reduce((sum, r) => sum + r.errors, 0);
  const warnings = res.body.results.reduce((sum, r) => sum + r.warnings, 0);
  console.log(`  validate-all: ${res.body.results.length} skills, ${errors}E ${warnings}W`);
});

test('opening a skill records it in recents, most recent first', async () => {
  const { body } = await get('/api/state');
  const first = body.skills[0];
  const second = body.skills.find((s) => s.dir !== first.dir);

  await get(`/api/skill?dir=${encodeURIComponent(first.dir)}`);
  await get(`/api/skill?dir=${encodeURIComponent(second.dir)}`);

  const { body: recent } = await get('/api/recent');
  assert.equal(recent.recent[0].dir, second.dir, 'newest open is not first');
  assert.equal(recent.recent[1].dir, first.dir);
  assert.equal(typeof recent.recent[0].rootLabel, 'string');
  assert.equal(typeof recent.recent[0].writable, 'boolean');
});

test('re-opening a skill moves it up without duplicating', async () => {
  const { body } = await get('/api/state');
  const target = body.skills[0];
  await get(`/api/skill?dir=${encodeURIComponent(target.dir)}`);
  const { body: recent } = await get('/api/recent');
  assert.equal(recent.recent[0].dir, target.dir);
  assert.equal(
    recent.recent.filter((r) => r.dir === target.dir).length,
    1,
    'the same skill was listed twice',
  );
});

test('remember=0 opens a skill without touching recents', async () => {
  const { body } = await get('/api/state');
  const before = (await get('/api/recent')).body.recent;
  const other = body.skills.find((s) => s.dir !== before[0].dir);
  await get(`/api/skill?dir=${encodeURIComponent(other.dir)}&remember=0`);
  const after = (await get('/api/recent')).body.recent;
  assert.deepEqual(after.map((r) => r.dir), before.map((r) => r.dir));
});

test('recents can be cleared', async () => {
  const res = await post('/api/clear-recent', {});
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.recent, []);
  assert.deepEqual((await get('/api/recent')).body.recent, []);
});

test('state reports an API version the page can check against', async () => {
  const { body } = await get('/api/state');
  assert.equal(typeof body.apiVersion, 'number');
  const client = await fsp.readFile(path.join(HERE, '..', 'ui', 'src', 'lib', 'api.ts'), 'utf8');
  const expected = Number(/API_VERSION = (\d+)/.exec(client)[1]);
  assert.equal(
    body.apiVersion,
    expected,
    'serve.mjs and ui/src/lib/api.ts disagree on API_VERSION — bump both together',
  );
});

test('the live-reload channel needs the token and announces a boot id', async () => {
  const denied = await fetch(`${base}/api/live`);
  assert.equal(denied.status, 403, 'live channel served without a token');

  const res = await fetch(`${base}/api/live?token=${token}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);

  const reader = res.body.getReader();
  const { value } = await reader.read();
  const text = Buffer.from(value).toString('utf8');
  assert.match(text, /^event: boot\ndata: [a-f0-9]{16}\n\n/);
  await reader.cancel();
});

test('editing a file under public/ pushes a reload to open pages', async () => {
  const res = await fetch(`${base}/api/live?token=${token}`);
  const reader = res.body.getReader();
  await reader.read(); // the boot event

  const probe = path.join(HERE, '..', 'public', '.live-probe.tmp');
  await fsp.writeFile(probe, `${Date.now()}`, 'utf8');
  try {
    const got = await Promise.race([
      reader.read().then(({ value }) => Buffer.from(value).toString('utf8')),
      new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), 4000)),
    ]);
    assert.match(got, /event: reload/, `expected a reload push, got ${got}`);
  } finally {
    await reader.cancel();
    await fsp.rm(probe, { force: true });
  }
});

test('the token survives a restart so an open page keeps working', async () => {
  const tokenFile = path.join(os.homedir(), '.claude', 'skill-editor-token');
  const onDisk = (await fsp.readFile(tokenFile, 'utf8')).trim();
  assert.equal(onDisk, token, 'the served token does not match the persisted one');

  // A second process on another port must accept the same token.
  const otherPort = PORT + 1;
  const other = spawn(
    process.execPath,
    [SERVER, `--project=${PROJECT}`, `--port=${otherPort}`, '--no-open'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  try {
    await new Promise((resolve, reject) => {
      let out = '';
      const timer = setTimeout(() => reject(new Error(`no start: ${out}`)), 15000);
      other.stdout.on('data', (chunk) => {
        out += chunk;
        if (out.includes('open    :')) {
          clearTimeout(timer);
          resolve();
        }
      });
      other.on('error', reject);
    });
    const res = await fetch(`http://127.0.0.1:${otherPort}/api/state`, {
      headers: { 'x-editor-token': token },
    });
    assert.equal(res.status, 200, 'a restarted server rejected the existing token');
  } finally {
    other.kill();
  }
});

test('the built UI is present and still carries the token placeholder', async () => {
  const indexPath = path.join(HERE, '..', 'public', 'index.html');
  const html = await fsp.readFile(indexPath, 'utf8');
  assert.match(
    html,
    /data-token="__EDITOR_TOKEN__"/,
    'the built index.html lost the token placeholder — the page would never authenticate',
  );

  const asset = /src="([^"]+\.js)"/.exec(html);
  assert.ok(asset, 'no script tag in the built index.html');
  const assetPath = path.join(HERE, '..', 'public', asset[1].replace(/^\//, ''));
  const stat = await fsp.stat(assetPath);
  assert.ok(stat.size > 1000, 'the built bundle looks empty');

  // And the server must actually substitute it.
  const served = await (await fetch(`${base}/`)).text();
  assert.ok(!served.includes('__EDITOR_TOKEN__'), 'the served page still has the placeholder');
  assert.match(served, /data-token="[a-f0-9]{32}"/);
});

test('a root pointed at a plugin repo root still finds its skills', async () => {
  const repoRoot = path.join(PROJECT, 'pstack-claude');
  const skills = await listSkills([
    { id: 'probe', label: 'probe', dir: repoRoot, kind: 'custom', writable: true, loaded: false },
  ]);
  assert.ok(
    skills.length > 20,
    `a repo root found ${skills.length} skills; discovery is too shallow`,
  );
  assert.ok(skills.some((s) => s.name === 'architect'));
});

test('a skill reachable from two roots is listed once', async () => {
  const repoRoot = path.join(PROJECT, 'pstack-claude');
  const nested = path.join(repoRoot, 'plugins', 'pstack', 'skills');
  const skills = await listSkills([
    { id: 'nested', label: 'nested', dir: nested, kind: 'repo', writable: true, loaded: false },
    { id: 'outer', label: 'outer', dir: repoRoot, kind: 'custom', writable: true, loaded: false },
  ]);
  const architects = skills.filter((s) => s.name === 'architect');
  assert.equal(architects.length, 1, 'the same skill folder was listed twice');
  assert.equal(architects[0].rootId, 'nested', 'the more specific root should win');
});

test('state reports how many skills each folder yielded', async () => {
  const { body } = await get('/api/state');
  for (const root of body.roots) assert.equal(typeof root.skillCount, 'number');
  const total = body.roots.reduce((sum, r) => sum + r.skillCount, 0);
  assert.equal(total, body.skills.length, 'per-folder counts do not add up to the skill list');
});

test('a redundant folder is reported as redundant, not as empty', async () => {
  const { body } = await get('/api/state');
  for (const root of body.roots) {
    assert.equal(typeof root.duplicateCount, 'number', `${root.label} has no duplicateCount`);
  }
  const empty = path.join(HERE, '..', 'tests');
  await post('/api/add-root', { dir: empty, label: 'probe-empty' });
  try {
    const after = await get('/api/state');
    const probe = after.body.roots.find((r) => r.label === 'probe-empty');
    assert.ok(probe, 'the added folder is not listed');
    assert.equal(probe.skillCount, 0);
    assert.equal(probe.duplicateCount, 0, 'a genuinely empty folder must report no duplicates');
  } finally {
    await post('/api/remove-root', { dir: empty });
  }
});
