// ADD [Claude AI - Opus 5] (2026-10-08 10:48:42): Claude Skill Editor front end.

import { escapeHtml, highlightMarkdown, renderMarkdown } from '/md.js';

const TOKEN = document.body.dataset.token;
const API_VERSION = 2;
const $ = (id) => document.getElementById(id);

const state = {
  roots: [],
  skills: [],
  counts: new Map(),
  skill: null,
  activeFile: 'SKILL.md',
  fileText: '',
  baseline: null,
  side: 'validation',
  recent: [],
  updatePending: false,
};

/* ---------------- api ---------------- */

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'x-editor-token': TOKEN,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Bad response from server: ${text.slice(0, 200)}`);
  }
  if (res.status === 403) {
    throw new Error(
      'The server rejected this page (403). It was most likely restarted with a new token — refresh the page.',
    );
  }
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data;
}

const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });

/* ---------------- toast ---------------- */

let toastTimer = null;
function toast(message, bad = false) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = `toast${bad ? ' bad' : ''}`;
  el.textContent = message;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), bad ? 7000 : 2800);
}

/* ---------------- dialog ---------------- */

function dialog(title, fields, okLabel = 'OK') {
  return new Promise((resolve) => {
    const dlg = $('dlg');
    $('dlg-title').textContent = title;
    $('dlg-ok').textContent = okLabel;
    const host = $('dlg-fields');
    host.textContent = '';

    for (const field of fields) {
      const wrap = document.createElement('div');
      wrap.className = 'field';
      const label = document.createElement('label');
      label.textContent = field.label;
      label.setAttribute('for', `dlg-${field.key}`);
      wrap.appendChild(label);

      let input;
      if (field.type === 'select') {
        input = document.createElement('select');
        for (const option of field.options) {
          const opt = document.createElement('option');
          opt.value = option.value;
          opt.textContent = option.label;
          input.appendChild(opt);
        }
      } else {
        input = document.createElement('input');
        input.type = 'text';
        input.spellcheck = false;
        if (field.placeholder) input.placeholder = field.placeholder;
      }
      input.id = `dlg-${field.key}`;
      input.name = field.key;
      if (field.value !== undefined) input.value = field.value;
      wrap.appendChild(input);

      if (field.hint) {
        const hint = document.createElement('div');
        hint.style.cssText = 'font-size:12px;color:var(--fg-dim);margin-top:3px';
        hint.textContent = field.hint;
        wrap.appendChild(hint);
      }
      host.appendChild(wrap);
    }

    const finish = (value) => {
      dlg.close();
      $('dlg-form').onsubmit = null;
      $('dlg-cancel').onclick = null;
      resolve(value);
    };

    $('dlg-form').onsubmit = (event) => {
      event.preventDefault();
      const result = {};
      for (const field of fields) result[field.key] = $(`dlg-${field.key}`).value.trim();
      finish(result);
    };
    $('dlg-cancel').onclick = () => finish(null);
    dlg.addEventListener('cancel', () => finish(null), { once: true });

    dlg.showModal();
    const first = host.querySelector('input, select');
    if (first) first.focus();
  });
}

/* ---------------- dirty tracking ---------------- */

function snapshot() {
  if (!state.skill) return null;
  if (state.activeFile === 'SKILL.md') {
    return JSON.stringify({
      f: 'SKILL.md',
      name: $('f-name').value,
      desc: $('f-desc').value,
      extra: $('f-extra').value,
      body: $('editor').value,
    });
  }
  return JSON.stringify({ f: state.activeFile, text: $('editor').value });
}

function isDirty() {
  return Boolean(state.baseline) && snapshot() !== state.baseline;
}

function refreshDirty() {
  const dirty = isDirty();
  const writable = Boolean(state.skill && state.skill.writable);
  $('dirty').classList.toggle('hidden', !dirty);
  $('btn-save').disabled = !dirty || !writable;
  $('btn-revert').disabled = !dirty;
}

/* ---------------- skill list ---------------- */

/* ---------------- recents + quick open ---------------- */
// ADD [Claude AI - Opus 5] (2026-10-08 11:52:07): the editor opens on recents and a
// find-as-you-type Open dialog instead of listing every skill in a sidebar.

function timeAgo(iso) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(then).toLocaleDateString();
}

function showLoadError(message) {
  const host = $('load-error');
  host.textContent = '';
  host.classList.remove('hidden');

  const title = document.createElement('div');
  title.className = 'msg';
  title.textContent = 'Could not load your skills.';
  host.appendChild(title);

  const detail = document.createElement('div');
  detail.className = 'hint';
  detail.textContent = message;
  host.appendChild(detail);

  const retry = document.createElement('button');
  retry.textContent = 'Retry';
  retry.style.marginTop = '8px';
  retry.onclick = () =>
    reload()
      .then(() => renderSide())
      .catch((err) => showLoadError(err.message));
  host.appendChild(retry);
}

function clearLoadError() {
  $('load-error').classList.add('hidden');
}

function showWelcome() {
  $('welcome').classList.remove('hidden');
  renderRecent();
}

function hideWelcome() {
  $('welcome').classList.add('hidden');
}

function renderRecent() {
  const host = $('recent-list');
  host.textContent = '';
  if (!state.recent.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Nothing yet. Open a skill and it will show up here.';
    host.appendChild(empty);
    return;
  }
  for (const item of state.recent) {
    const row = document.createElement('div');
    row.className = 'recent-row';
    row.title = item.dir;

    const name = document.createElement('span');
    name.className = 'nm';
    name.textContent = item.name;

    const where = document.createElement('span');
    where.className = 'where';
    where.textContent = item.rootLabel || item.dir;

    row.appendChild(name);
    row.appendChild(where);

    if (item.writable === false) {
      const badge = document.createElement('span');
      badge.className = 'badge ro';
      badge.textContent = 'read-only';
      row.appendChild(badge);
    }

    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = timeAgo(item.at);
    row.appendChild(when);

    row.onclick = () => openSkill(item.dir);
    host.appendChild(row);
  }
}

async function refreshRecent() {
  try {
    const data = await api('/api/recent');
    state.recent = data.recent || [];
  } catch {
    state.recent = [];
  }
  renderRecent();
}

function matchScore(skill, query) {
  if (!query) return 1;
  const name = (skill.name || skill.folder || '').toLowerCase();
  if (name === query) return 100;
  if (name.startsWith(query)) return 50;
  if (name.includes(query)) return 25;
  if ((skill.description || '').toLowerCase().includes(query)) return 5;
  if ((skill.rootLabel || '').toLowerCase().includes(query)) return 2;
  return 0;
}

async function quickOpen() {
  if (!state.skills.length) {
    try {
      await reload();
    } catch (err) {
      showWelcome();
      showLoadError(err.message);
      toast(err.message, true);
      return;
    }
  }
  if (!state.skills.length) {
    toast('No skills found in any configured folder. Use Folders… to add one.', true);
    return;
  }
  const dlg = $('quick');
  const input = $('quick-input');
  const list = $('quick-list');
  let rows = [];
  let selected = 0;

  const draw = () => {
    const query = input.value.trim().toLowerCase();
    rows = state.skills
      .map((skill) => ({ skill, score: matchScore(skill, query) }))
      .filter((r) => r.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          (a.skill.name || a.skill.folder).localeCompare(b.skill.name || b.skill.folder),
      )
      .map((r) => r.skill);

    if (selected >= rows.length) selected = Math.max(0, rows.length - 1);
    list.textContent = '';

    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'quick-empty';
      empty.textContent = 'No skill matches that.';
      list.appendChild(empty);
    }

    rows.forEach((skill, index) => {
      const row = document.createElement('div');
      row.className = `quick-row${index === selected ? ' sel' : ''}`;
      row.title = skill.dir;

      const name = document.createElement('span');
      name.className = 'nm';
      name.textContent = skill.name || skill.folder;
      row.appendChild(name);

      const counts = state.counts.get(skill.dir);
      if (counts && counts.errors) {
        const badge = document.createElement('span');
        badge.className = 'badge err';
        badge.textContent = `${counts.errors}E`;
        row.appendChild(badge);
      }
      if (counts && counts.warnings) {
        const badge = document.createElement('span');
        badge.className = 'badge warn';
        badge.textContent = `${counts.warnings}W`;
        row.appendChild(badge);
      }

      const desc = document.createElement('span');
      desc.className = 'desc';
      desc.textContent = skill.description || '';
      row.appendChild(desc);

      const root = document.createElement('span');
      root.className = `badge${skill.writable ? '' : ' ro'}`;
      root.textContent = skill.rootLabel;
      root.style.maxWidth = '170px';
      root.style.overflow = 'hidden';
      root.style.textOverflow = 'ellipsis';
      root.style.whiteSpace = 'nowrap';
      row.appendChild(root);

      row.onclick = () => choose(index);
      list.appendChild(row);
    });

    $('quick-count').textContent = `${rows.length} of ${state.skills.length}`;
    const active = list.children[selected];
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  };

  const close = () => {
    input.oninput = null;
    input.onkeydown = null;
    dlg.close();
  };

  const choose = (index) => {
    const skill = rows[index];
    if (!skill) return;
    close();
    openSkill(skill.dir);
  };

  input.value = '';
  selected = 0;
  draw();

  input.oninput = () => {
    selected = 0;
    draw();
  };
  input.onkeydown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selected = Math.min(selected + 1, rows.length - 1);
      draw();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      selected = Math.max(selected - 1, 0);
      draw();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(selected);
    } else if (event.key === 'Escape') {
      close();
    }
  };

  dlg.showModal();
  input.focus();
}

/* ---------------- editor ---------------- */

function paintHighlight() {
  $('highlight').innerHTML = highlightMarkdown($('editor').value);
  syncScroll();
}

function syncScroll() {
  const editor = $('editor');
  const pre = $('highlight');
  pre.scrollTop = editor.scrollTop;
  pre.scrollLeft = editor.scrollLeft;
}

function updateCounters() {
  const name = $('f-name').value.trim();
  const nameCounter = $('name-counter');
  nameCounter.textContent = `${name.length}/64`;
  nameCounter.className = `counter${name.length > 64 ? ' bad' : ''}`;

  const desc = $('f-desc').value.trim();
  const descCounter = $('desc-counter');
  descCounter.textContent = `${desc.length}/1024`;
  descCounter.className = `counter${
    desc.length > 1024 ? ' bad' : desc.length && desc.length < 40 ? ' soft' : ''
  }`;
}

function yamlLine(key, value) {
  const text = String(value);
  const plain = !/^$|^[\s]|[\s]$|[:#"'\n\r\t]|^[-?|>@`&*!%[\]{},]/.test(text);
  return `${key}: ${plain ? text : JSON.stringify(text)}`;
}

function renderFileTabs() {
  const host = $('file-tabs');
  host.textContent = '';
  if (!state.skill) return;
  for (const file of state.skill.files) {
    if (!file.editable && file.relative !== 'SKILL.md') continue;
    const tab = document.createElement('button');
    tab.className = `tab${file.relative === state.activeFile ? ' active' : ''}`;
    tab.textContent = file.relative;
    tab.onclick = () => openFile(file.relative);
    host.appendChild(tab);
  }
}

function renderForm() {
  const skill = state.skill;
  const onSkillMd = state.activeFile === 'SKILL.md';
  $('form').classList.toggle('hidden', !onSkillMd || !skill);
  if (!skill || !onSkillMd) return;

  $('f-name').value = skill.fields.name || '';
  $('f-desc').value = skill.fields.description || '';

  const extras = [];
  for (const key of ['license', 'model', 'allowed-tools', 'disable-model-invocation']) {
    if (skill.fields[key] !== undefined && String(skill.fields[key]).trim() !== '') {
      extras.push(yamlLine(key, skill.fields[key]));
    }
  }
  extras.push(...skill.extraLines);
  $('f-extra').value = extras.join('\n');
  $('extra-count').textContent = String(extras.length);
  $('extra-wrap').open = extras.length > 0;

  const readOnly = !skill.writable;
  for (const id of ['f-name', 'f-desc', 'f-extra']) $(id).readOnly = readOnly;
  updateCounters();
}

function renderHeader() {
  const skill = state.skill;
  $('current-path').textContent = skill
    ? `${skill.dir}${state.activeFile === 'SKILL.md' ? '\\SKILL.md' : `\\${state.activeFile}`}`
    : 'No skill open';

  const banner = $('ro-banner');
  if (skill && !skill.writable) {
    banner.classList.remove('hidden');
    $('ro-text').textContent = `${skill.rootLabel} is read-only — a plugin update overwrites it.`;
  } else {
    banner.classList.add('hidden');
  }
  $('btn-fork').disabled = !skill;
}

/* ---------------- side panel ---------------- */

function renderSide() {
  const host = $('side-body');
  host.textContent = '';
  for (const tab of document.querySelectorAll('#side-tabs .tab')) {
    tab.classList.toggle('active', tab.dataset.side === state.side);
  }

  if (state.side === 'roots') {
    renderRoots(host);
    return;
  }
  if (!state.skill) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Open a skill to see this panel.';
    host.appendChild(empty);
    return;
  }
  if (state.side === 'validation') renderValidation(host);
  if (state.side === 'preview') renderPreview(host);
  if (state.side === 'files') renderFiles(host);
}

function renderValidation(host) {
  const validation = state.skill.validation;
  const summary = document.createElement('div');
  summary.style.cssText = 'margin-bottom:10px;color:var(--fg-dim);font-size:12px';
  summary.textContent = isDirty()
    ? 'Checked against the file on disk — save to re-check.'
    : `${validation.errors} error(s), ${validation.warnings} warning(s).`;
  host.appendChild(summary);

  if (!validation.issues.length) {
    const clean = document.createElement('div');
    clean.className = 'clean';
    clean.textContent = '\u2713  No problems found.';
    host.appendChild(clean);
    return;
  }

  for (const issue of validation.issues) {
    const el = document.createElement('div');
    el.className = `issue ${issue.level}`;
    const code = document.createElement('div');
    code.className = 'code';
    code.textContent = `${issue.level.toUpperCase()} · ${issue.code}`;
    const msg = document.createElement('div');
    msg.className = 'msg';
    msg.textContent = issue.message;
    el.appendChild(code);
    el.appendChild(msg);
    if (issue.hint) {
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = issue.hint;
      el.appendChild(hint);
    }
    host.appendChild(el);
  }
}

function renderPreview(host) {
  const wrap = document.createElement('div');
  wrap.className = 'preview';
  const source = $('editor').value;
  if (state.activeFile === 'SKILL.md') {
    const name = $('f-name').value.trim();
    const desc = $('f-desc').value.trim();
    wrap.innerHTML = `${
      name || desc
        ? `<div style="border:1px solid var(--line);border-radius:6px;padding:8px 10px;margin-bottom:12px">
             <div style="font:12px var(--mono);color:var(--accent)">${escapeHtml(name)}</div>
             <div style="color:var(--fg-dim);font-size:12.5px">${escapeHtml(desc)}</div>
           </div>`
        : ''
    }${renderMarkdown(source)}`;
  } else if (/\.(md|markdown)$/i.test(state.activeFile)) {
    wrap.innerHTML = renderMarkdown(source);
  } else {
    const pre = document.createElement('pre');
    pre.className = 'code';
    pre.textContent = source;
    wrap.appendChild(pre);
  }
  host.appendChild(wrap);
}

function renderFiles(host) {
  const add = document.createElement('button');
  add.textContent = 'New file…';
  add.style.marginBottom = '10px';
  add.disabled = !state.skill.writable;
  add.onclick = newFile;
  host.appendChild(add);

  for (const file of state.skill.files) {
    const row = document.createElement('div');
    row.className = 'file-row';
    const name = document.createElement('span');
    name.className = 'nm';
    name.textContent = file.relative;
    if (file.editable) {
      name.onclick = () => openFile(file.relative);
      name.style.color = 'var(--fg)';
    } else {
      name.style.color = 'var(--fg-dim)';
      name.style.cursor = 'default';
      name.title = 'Not a text file the editor opens';
    }
    const size = document.createElement('span');
    size.className = 'sz';
    size.textContent = file.size > 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${file.size} B`;
    row.appendChild(name);
    row.appendChild(size);
    host.appendChild(row);
  }
}

function renderRoots(host) {
  const note = document.createElement('div');
  note.style.cssText = 'color:var(--fg-dim);font-size:12px;margin-bottom:10px';
  note.textContent = 'Folders scanned for skills. Custom roots are stored in ~/.claude/skill-editor-roots.json.';
  host.appendChild(note);

  for (const root of state.roots) {
    const el = document.createElement('div');
    el.className = 'issue';
    el.style.borderLeftColor = root.writable ? 'var(--ok)' : 'var(--warn)';
    const title = document.createElement('div');
    title.className = 'msg';
    title.textContent = root.label;
    const dir = document.createElement('div');
    dir.className = 'code';
    dir.textContent = root.dir;
    const meta = document.createElement('div');
    meta.className = 'hint';
    meta.textContent = `${root.kind} · ${root.writable ? 'writable' : 'read-only'} · ${
      root.loaded ? 'loaded by Claude Code' : 'source tree, not loaded'
    }`;
    el.appendChild(title);
    el.appendChild(dir);
    el.appendChild(meta);
    if (root.kind === 'custom') {
      const remove = document.createElement('button');
      remove.textContent = 'Remove root';
      remove.style.marginTop = '6px';
      remove.onclick = async () => {
        await post('/api/remove-root', { dir: root.dir });
        toast('Root removed.');
        await reload();
      };
      el.appendChild(remove);
    }
    host.appendChild(el);
  }
}

/* ---------------- loading ---------------- */

async function reload(keepOpen = true) {
  const data = await api('/api/state');
  if (data.apiVersion !== API_VERSION) {
    throw new Error(
      `This page needs API v${API_VERSION}, but the server is speaking v${
        data.apiVersion || 1
      }. It is still running older code: stop it with Ctrl+C and start it again.`,
    );
  }
  state.roots = data.roots;
  state.skills = data.skills;
  const recent = await api('/api/recent').catch(() => ({ recent: [] }));
  state.recent = recent.recent || [];
  clearLoadError();
  if (keepOpen && state.skill && !state.skills.some((s) => s.dir === state.skill.dir)) {
    state.skill = null;
    state.baseline = null;
  }
  if (!state.skill) showWelcome();
  renderRecent();
  renderSide();
}

function applySkill(skill) {
  state.skill = skill;
  const index = state.skills.findIndex((s) => s.dir === skill.dir);
  if (index >= 0) {
    state.skills[index].name = skill.fields.name || '';
    state.skills[index].description = skill.fields.description || '';
  }
  state.counts.set(skill.dir, {
    errors: skill.validation.errors,
    warnings: skill.validation.warnings,
  });
}

async function openSkill(dir) {
  if (!(await confirmDiscard())) return;
  const skill = await api(`/api/skill?dir=${encodeURIComponent(dir)}`);
  applySkill(skill);
  state.activeFile = 'SKILL.md';
  $('editor').value = skill.body;
  $('editor').readOnly = !skill.writable;
  renderForm();
  renderFileTabs();
  renderHeader();
  paintHighlight();
  state.baseline = snapshot();
  refreshDirty();
  hideWelcome();
  $('btn-close').disabled = false;
  renderSide();
  refreshRecent();
}

function closeSkill() {
  state.skill = null;
  state.baseline = null;
  state.activeFile = 'SKILL.md';
  $('editor').value = '';
  paintHighlight();
  $('file-tabs').textContent = '';
  $('btn-close').disabled = true;
  refreshDirty();
  renderHeader();
  renderForm();
  showWelcome();
  renderSide();
}

async function openFile(relative) {
  if (relative === state.activeFile) return;
  if (!(await confirmDiscard())) return;
  if (relative === 'SKILL.md') {
    await openSkill(state.skill.dir);
    return;
  }
  const file = state.skill.files.find((f) => f.relative === relative);
  if (!file) return;
  const data = await api(`/api/file?path=${encodeURIComponent(file.path)}`);
  state.activeFile = relative;
  state.fileText = data.text;
  $('editor').value = data.text;
  $('editor').readOnly = !state.skill.writable;
  renderForm();
  renderFileTabs();
  renderHeader();
  paintHighlight();
  state.baseline = snapshot();
  refreshDirty();
  renderSide();
}

async function confirmDiscard() {
  if (!isDirty()) return true;
  return window.confirm('Discard unsaved changes?');
}

/* ---------------- actions ---------------- */

async function save() {
  if (!state.skill || !state.skill.writable || !isDirty()) return;
  try {
    if (state.activeFile === 'SKILL.md') {
      const extraLines = $('f-extra')
        .value.split('\n')
        .filter((line) => line.trim() !== '');
      const bad = extraLines.find((line) => /^\s*(name|description)\s*:/.test(line));
      if (bad) {
        toast('Remove the name/description line from "Other frontmatter" — use the fields above.', true);
        return;
      }
      const fields = { ...state.skill.fields };
      for (const key of ['license', 'model', 'allowed-tools', 'disable-model-invocation']) {
        delete fields[key]; // these now live in the extra block
      }
      fields.name = $('f-name').value.trim();
      fields.description = $('f-desc').value.trim();

      const skill = await post('/api/save-skill', {
        dir: state.skill.dir,
        fields,
        extraLines,
        body: $('editor').value,
      });
      applySkill(skill);
      renderForm();
      renderFileTabs();
    } else {
      const file = state.skill.files.find((f) => f.relative === state.activeFile);
      await post('/api/save-file', { path: file.path, text: $('editor').value });
      const skill = await api(`/api/skill?dir=${encodeURIComponent(state.skill.dir)}`);
      applySkill(skill);
    }
    state.baseline = snapshot();
    refreshDirty();
    renderHeader();
    renderSide();
    if (state.updatePending) {
      toast('Saved. Reloading to pick up the new code…');
      setTimeout(() => location.reload(), 600);
      return;
    }
    toast('Saved.');
  } catch (err) {
    toast(err.message, true);
    showLoadError(`${err.message} Your changes are still in the editor.`);
  }
}

function revert() {
  if (!state.skill) return;
  if (state.activeFile === 'SKILL.md') {
    renderForm();
    $('editor').value = state.skill.body;
  } else {
    $('editor').value = state.fileText;
  }
  paintHighlight();
  state.baseline = snapshot();
  refreshDirty();
  renderSide();
}

function writableRootOptions() {
  return state.roots
    .filter((r) => r.writable)
    .map((r) => ({ value: r.id, label: r.label }));
}

async function newSkill() {
  const options = writableRootOptions();
  if (!options.length) {
    toast('No writable skill root is configured.', true);
    return;
  }
  const answer = await dialog(
    'New skill',
    [
      { key: 'rootId', label: 'Where', type: 'select', options },
      {
        key: 'folder',
        label: 'Folder / name',
        placeholder: 'my-skill',
        hint: 'kebab-case; becomes both the folder and the frontmatter name.',
      },
      {
        key: 'description',
        label: 'Description',
        placeholder: 'What it does. Use when …',
        hint: 'The only text the model sees when deciding to load the skill.',
      },
    ],
    'Create',
  );
  if (!answer) return;
  try {
    const skill = await post('/api/new-skill', answer);
    await reload(false);
    await openSkill(skill.dir);
    toast('Skill created.');
  } catch (err) {
    toast(err.message, true);
  }
}

async function fork() {
  if (!state.skill) return;
  const options = writableRootOptions();
  if (!options.length) {
    toast('No writable skill root is configured.', true);
    return;
  }
  const answer = await dialog(
    'Fork skill',
    [
      { key: 'targetRootId', label: 'Copy into', type: 'select', options },
      { key: 'folder', label: 'New folder name', value: state.skill.folder },
    ],
    'Fork',
  );
  if (!answer) return;
  try {
    const skill = await post('/api/fork-skill', { dir: state.skill.dir, ...answer });
    await reload(false);
    await openSkill(skill.dir);
    toast('Forked. You are now editing the copy.');
  } catch (err) {
    toast(err.message, true);
  }
}

async function newFile() {
  const answer = await dialog(
    'New file in this skill',
    [
      {
        key: 'relative',
        label: 'Relative path',
        placeholder: 'references/notes.md',
        hint: 'Remember to link it from SKILL.md, or it is never read.',
      },
    ],
    'Create',
  );
  if (!answer || !answer.relative) return;
  try {
    const skill = await post('/api/new-file', { dir: state.skill.dir, relative: answer.relative });
    applySkill(skill);
    renderFileTabs();
    renderSide();
    await openFile(answer.relative.replace(/\\/g, '/'));
    toast('File created.');
  } catch (err) {
    toast(err.message, true);
  }
}

async function addRoot() {
  const answer = await dialog(
    'Add a skills folder',
    [
      {
        key: 'dir',
        label: 'Folder path',
        placeholder: 'C:\\path\\to\\.claude\\skills',
        hint: 'The folder that contains skill folders.',
      },
      { key: 'label', label: 'Label (optional)' },
    ],
    'Add',
  );
  if (!answer || !answer.dir) return;
  try {
    await post('/api/add-root', answer);
    await reload();
    toast('Root added.');
  } catch (err) {
    toast(err.message, true);
  }
}

async function validateAll() {
  const button = $('w-validate');
  button.disabled = true;
  button.textContent = 'Validating…';
  try {
    const data = await post('/api/validate-all', {});
    state.counts = new Map(
      data.results.map((r) => [r.dir, { errors: r.errors, warnings: r.warnings }]),
    );
    const errors = data.results.reduce((sum, r) => sum + r.errors, 0);
    const warnings = data.results.reduce((sum, r) => sum + r.warnings, 0);
    toast(`${data.results.length} skills: ${errors} error(s), ${warnings} warning(s).`);
  } catch (err) {
    toast(err.message, true);
  } finally {
    button.disabled = false;
    button.textContent = 'Validate all';
  }
}

/* ---------------- live reload ---------------- */

function wireLiveReload() {
  let bootId = null;

  const refresh = (why) => {
    // Never throw away unsaved edits for a code change.
    if (isDirty()) {
      state.updatePending = true;
      $('update-pending').classList.remove('hidden');
      toast(`${why} — your unsaved changes are kept. Save, then reload.`, true);
      return;
    }
    location.reload();
  };

  const connect = () => {
    const source = new EventSource(`/api/live?token=${encodeURIComponent(TOKEN)}`);
    source.addEventListener('boot', (event) => {
      if (bootId === null) {
        bootId = event.data;
        return;
      }
      if (event.data !== bootId) refresh('The server restarted with new code');
    });
    source.addEventListener('reload', () => refresh('The page code changed'));
    source.onerror = () => {
      // The server is restarting; EventSource retries on its own.
      source.close();
      setTimeout(connect, 700);
    };
  };

  connect();
}

/* ---------------- splitters ---------------- */

function wireSplitters() {
  for (const splitter of document.querySelectorAll('.splitter')) {
    splitter.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const pane = $(splitter.dataset.target);
      const fromRight = splitter.dataset.target === 'pane-side';
      const startX = event.clientX;
      const startWidth = pane.getBoundingClientRect().width;

      const move = (moveEvent) => {
        const delta = moveEvent.clientX - startX;
        const width = startWidth + (fromRight ? -delta : delta);
        pane.style.width = `${Math.max(180, Math.min(900, width))}px`;
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        document.body.style.cursor = '';
      };
      document.body.style.cursor = 'col-resize';
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
  }
}

/* ---------------- wiring ---------------- */

function wire() {
  const editor = $('editor');
  editor.addEventListener('input', () => {
    paintHighlight();
    refreshDirty();
    if (state.side === 'preview') renderSide();
  });
  editor.addEventListener('scroll', syncScroll);
  editor.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.value = `${editor.value.slice(0, start)}  ${editor.value.slice(end)}`;
    editor.selectionStart = editor.selectionEnd = start + 2;
    paintHighlight();
    refreshDirty();
  });

  for (const id of ['f-name', 'f-desc', 'f-extra']) {
    $(id).addEventListener('input', () => {
      updateCounters();
      refreshDirty();
      if (state.side === 'preview') renderSide();
    });
  }

  $('btn-save').onclick = save;
  $('btn-revert').onclick = revert;
  $('btn-new').onclick = newSkill;
  $('btn-fork').onclick = fork;
  $('btn-open').onclick = async () => {
    if (!(await confirmDiscard())) return;
    quickOpen();
  };
  $('btn-close').onclick = async () => {
    if (!(await confirmDiscard())) return;
    closeSkill();
  };
  $('btn-reload').onclick = async () => {
    if (!(await confirmDiscard())) return;
    const open = state.skill && state.skill.dir;
    state.baseline = null;
    await reload(false);
    if (open) await openSkill(open);
    toast('Reloaded from disk.');
  };

  $('update-pending').onclick = () => {
    if (isDirty() && !window.confirm('Reload and discard unsaved changes?')) return;
    state.baseline = null;
    location.reload();
  };

  $('w-open').onclick = () => quickOpen();
  $('w-new').onclick = newSkill;
  $('w-validate').onclick = validateAll;
  $('w-roots').onclick = () => {
    state.side = 'roots';
    renderSide();
    addRoot();
  };
  $('w-clear-recent').onclick = async () => {
    await post('/api/clear-recent', {});
    state.recent = [];
    renderRecent();
  };

  for (const tab of document.querySelectorAll('#side-tabs .tab')) {
    tab.onclick = () => {
      state.side = tab.dataset.side;
      renderSide();
    };
  }

  window.addEventListener('keydown', async (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 's') {
      event.preventDefault();
      save();
    } else if (key === 'o') {
      event.preventDefault();
      if (await confirmDiscard()) quickOpen();
    } else if (key === 'n') {
      event.preventDefault();
      newSkill();
    }
  });

  window.addEventListener('beforeunload', (event) => {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = '';
  });

  wireSplitters();
  wireLiveReload();
}

wire();
showWelcome();
reload()
  .then(() => renderSide())
  .catch((err) => showLoadError(err.message));
