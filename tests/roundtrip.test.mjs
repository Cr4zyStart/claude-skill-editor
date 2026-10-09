// ADD [Claude AI - Opus 5] (2026-10-08 10:48:42): proves a save never corrupts a skill.
// parse(serialize(parse(x))) must equal parse(x) for every SKILL.md on this machine.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { parse, serialize } from '../lib/frontmatter.mjs';
import { extractLinks, validateSkill } from '../lib/validate.mjs';
import { listSkillFiles, listSkills, loadRoots, readText } from '../lib/skills.mjs';

const PROJECT = path.resolve(import.meta.dirname, '..', '..');

test('frontmatter round-trips on every SKILL.md found on this machine', async () => {
  const roots = loadRoots(PROJECT);
  const skills = await listSkills(roots);
  assert.ok(skills.length > 0, 'found no skills to test against');

  const failures = [];
  for (const skill of skills) {
    const raw = await readText(path.join(skill.dir, 'SKILL.md'));
    const first = parse(raw);
    const second = parse(serialize(first));

    if (first.fields.name !== second.fields.name) {
      failures.push(`${skill.relative}: name changed`);
    }
    if (first.fields.description !== second.fields.description) {
      failures.push(`${skill.relative}: description changed`);
    }
    if (first.body.trim() !== second.body.trim()) {
      failures.push(`${skill.relative}: body changed`);
    }
    if (first.extraLines.join('\n') !== second.extraLines.join('\n')) {
      failures.push(`${skill.relative}: extra frontmatter changed`);
    }
  }
  assert.deepEqual(failures.slice(0, 10), [], `round-trip lost data in ${failures.length} file(s)`);
  console.log(`  round-tripped ${skills.length} skills`);
});

test('quoting survives descriptions with colons and quotes', () => {
  const tricky = 'Use for "how does X work", and placement: ownership questions. 50% done';
  const text = serialize({ fields: { name: 'x', description: tricky }, body: '# X\n' });
  assert.equal(parse(text).fields.description, tricky);
});

test('unknown frontmatter keys are preserved verbatim', () => {
  const raw = ['---', 'name: demo', 'description: A demo. Use when testing.', 'metadata:', '  type: project', 'custom-key: 7', '---', '', '# Demo', ''].join('\n');
  const round = parse(serialize(parse(raw)));
  assert.equal(round.fields.name, 'demo');
  assert.deepEqual(round.extraLines, ['metadata:', '  type: project', 'custom-key: 7']);
});

test('known extra keys are parsed and re-emitted', () => {
  const raw = ['---', 'name: demo', 'description: Use when testing.', 'allowed-tools: Read, Grep', '---', '', '# Demo', ''].join('\n');
  const parsed = parse(raw);
  assert.equal(parsed.fields['allowed-tools'], 'Read, Grep');
  assert.match(serialize(parsed), /allowed-tools: Read, Grep/);
});

test('link extraction ignores fenced code and external urls', () => {
  const body = [
    'See [refs](references/a.md) and [web](https://example.com).',
    '```',
    '[fake](nope.md)',
    '```',
    '[def]: references/b.md',
  ].join('\n');
  assert.deepEqual(extractLinks(body).sort(), ['references/a.md', 'references/b.md']);
});

test('validator flags a broken link and a name mismatch', async () => {
  const roots = loadRoots(PROJECT);
  const skills = await listSkills(roots);
  const target = skills.find((s) => s.name && s.name === s.folder);
  assert.ok(target, 'needed one healthy skill to validate');

  const parsed = parse(await readText(path.join(target.dir, 'SKILL.md')));
  const files = await listSkillFiles(target.dir);

  const clean = validateSkill({ skillDir: target.dir, parsed, body: parsed.body, files });
  assert.equal(
    clean.issues.filter((i) => i.code === 'E_NAME_MISMATCH').length,
    0,
    'healthy skill reported a name mismatch',
  );

  const broken = validateSkill({
    skillDir: target.dir,
    parsed: { ...parsed, fields: { ...parsed.fields, name: 'wrong-name' } },
    body: `${parsed.body}\n\n[gone](references/definitely-missing-xyz.md)\n`,
    files,
  });
  assert.ok(broken.issues.some((i) => i.code === 'E_NAME_MISMATCH'));
});

test('validator catches a missing description and an empty body', () => {
  const result = validateSkill({
    skillDir: path.join(PROJECT, 'skill-editor', 'nope'),
    parsed: { fields: { name: 'nope' }, extraLines: [], hadFrontmatter: true, yamlError: null },
    body: '',
    files: [],
  });
  const codes = result.issues.map((i) => i.code);
  assert.ok(codes.includes('E_DESC_MISSING'));
  assert.ok(codes.includes('E_EMPTY_BODY'));
});

test('a backticked path counts as a reference, not an orphan', async () => {
  const dir = path.join(import.meta.dirname, 'fixtures', 'ref-by-backtick');
  const files = [
    { relative: 'SKILL.md', path: path.join(dir, 'SKILL.md') },
    { relative: 'references/runner.md', path: path.join(dir, 'references', 'runner.md') },
  ];
  const { mkdir, writeFile, rm } = await import('node:fs/promises');
  await mkdir(path.join(dir, 'references'), { recursive: true });
  await writeFile(files[0].path, 'Pass `references/runner.md` to each runner.\n');
  await writeFile(files[1].path, 'Runner prompt.\n');
  try {
    const result = validateSkill({
      skillDir: dir,
      parsed: {
        fields: { name: 'ref-by-backtick', description: 'A fixture. Use when testing orphans.' },
        extraLines: [],
        hadFrontmatter: true,
        yamlError: null,
      },
      body: 'Pass `references/runner.md` to each runner.\n',
      files,
    });
    const codes = result.issues.map((i) => i.code);
    assert.ok(!codes.includes('W_ORPHAN'), `backticked path flagged as orphan: ${codes.join(',')}`);
    assert.ok(!codes.includes('E_LINK_BROKEN'), codes.join(','));
  } finally {
    await rm(path.join(import.meta.dirname, 'fixtures'), { recursive: true, force: true });
  }
});

test('a source-tree copy of an installed skill is not a name collision', () => {
  const shared = { name: 'architect', description: 'd' };
  const installed = { ...shared, dir: 'C:\plugins\cache\pstack\skills\architect', rootLabel: 'plugin', loaded: true };
  const repoCopy = { ...shared, dir: 'C:\repo\plugins\pstack\skills\architect', rootLabel: 'repo', loaded: false };
  const parsed = {
    fields: { name: 'architect', description: 'Design before code. Use when it crosses boundaries.' },
    extraLines: [],
    hadFrontmatter: true,
    yamlError: null,
  };

  const fromRepo = validateSkill({
    skillDir: repoCopy.dir,
    parsed,
    body: '# Architect\n',
    files: [],
    allSkills: [installed, repoCopy],
    loaded: false,
  });
  assert.equal(fromRepo.issues.filter((i) => i.code === 'W_NAME_COLLISION').length, 0);

  const fromInstalled = validateSkill({
    skillDir: installed.dir,
    parsed,
    body: '# Architect\n',
    files: [],
    allSkills: [installed, repoCopy],
    loaded: true,
  });
  assert.equal(fromInstalled.issues.filter((i) => i.code === 'W_NAME_COLLISION').length, 0);

  const twoLoaded = validateSkill({
    skillDir: installed.dir,
    parsed,
    body: '# Architect\n',
    files: [],
    allSkills: [installed, { ...repoCopy, loaded: true, rootLabel: 'user' }],
    loaded: true,
  });
  assert.equal(twoLoaded.issues.filter((i) => i.code === 'W_NAME_COLLISION').length, 1);
});
