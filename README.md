# Claude Skill Editor

**A real editor for Claude Code skills — open, edit, validate, in a browser tab.**

![dependencies](https://img.shields.io/badge/runtime%20dependencies-0-brightgreen)
![checks](https://img.shields.io/badge/validator%20checks-18-blue)
![binds](https://img.shields.io/badge/binds-127.0.0.1%20only-informational)
![license](https://img.shields.io/badge/license-MIT-lightgrey)

A skill is a folder, a `SKILL.md`, and a YAML block that Claude Code will silently ignore if you get it
wrong. This finds every skill on your machine — user, project, and plugin — and gives you a form for the
frontmatter, a highlighted editor for the body, and a validator that tells you what Claude Code will choke
on *before* you find out by it not loading.

## Why this exists

| Editing skills by hand | With this |
|---|---|
| Find the folder, remember which of four roots it is in | `Ctrl+O`, type three letters |
| Hand-write YAML and hope | A form — quoting cannot break |
| A typo'd `name` means the skill just never loads | `E_NAME_MISMATCH`, before you save |
| A reference file nothing links to is dead weight you pay for | `W_ORPHAN` |
| Edit an installed plugin skill, lose it on update | Read-only, with **Fork to edit** |

**No npm install to run it.** The server is `serve.mjs` plus three files in `lib/`, pure Node, zero
dependencies. The React toolchain in `ui/` is only needed if you want to change the interface.

## Run

```bash
node serve.mjs
```

From anywhere Node runs. On Windows, double-click `start.bat` instead — it opens your browser for you.

**To change the UI**, use `dev.bat`: it runs `vite build --watch` next to the server, so a React edit
rebuilds and the open page refreshes itself.

## Layout

| Path | What it is |
|---|---|
| `serve.mjs`, `lib/` | The API server. Zero npm dependencies. |
| `ui/` | React + Vite + Tailwind + shadcn-style components. Builds into `public/`. |
| `public/` | **Build output — do not edit**, `vite build` overwrites it. Committed, so a clone runs with no npm install. |
| `legacy-ui/` | The original dependency-free UI, kept as a fallback. Copy it over `public/` to go back. |
| `tests/` | Node test suite for the server, validator and build output. |

Changing the UI means editing `ui/src/**` then running `npm run build` in `ui/` (or just leaving `dev.bat` running).

| Flag | Meaning |
|---|---|
| `--project=<dir>` | Which project's `.claude/skills` to include (default: the current directory) |
| `--port=<n>` | Start port, default 7777. Steps up if busy — **read the URL it prints** |
| `--no-open` | Do not launch a browser |

## What it does

**Opens like a text editor.** It starts on a welcome screen with your **Recent** skills — not a list of everything. **Open…** (`Ctrl+O`) brings up a find-as-you-type picker over every skill on the machine; type a few letters, arrow to the one you want, Enter. **New** is `Ctrl+N`, **Save** is `Ctrl+S`, **Close** returns you to the welcome screen.

Recents are stored in `~/.claude/skill-editor-recent.json` (15 entries, most recent first). Entries whose `SKILL.md` has gone — deleted, or a plugin updated into a new version folder — are dropped silently.

The picker searches across every root:

| Root | Writable | Loaded by Claude Code |
|---|---|---|
| `~/.claude/skills` | yes | yes |
| `<project>/.claude/skills` | yes | yes |
| Local plugin repo checkouts (e.g. `tstack-claude/plugins/tstack/skills`) | yes | no — it is the source, the installed copy is what loads |
| Installed plugins (`~/.claude/plugins/cache/...`) | **no** | yes |

Installed plugin skills are read-only on purpose: a plugin update overwrites them. Use **Fork to edit** to copy one into your user or project folder first.

**Edit** the frontmatter through a form (so YAML quoting can never break) and the body in a highlighted editor. Frontmatter keys the editor does not model are preserved verbatim — a save never drops them. Reference files in the skill folder open in their own tabs.

**Validate.** Errors are what Claude Code will choke on; warnings are quality and context-cost nudges.

| Code | Level | Meaning |
|---|---|---|
| `E_NO_FRONTMATTER`, `E_YAML` | error | The frontmatter block is missing or unparseable |
| `E_NAME_MISSING`, `E_NAME_FORMAT`, `E_NAME_LONG` | error | `name` absent, not kebab-case, or over 64 chars |
| `E_NAME_MISMATCH` | error | `name` disagrees with the folder name |
| `E_DESC_MISSING`, `E_DESC_LONG` | error | `description` absent or over 1024 chars |
| `E_EMPTY_BODY` | error | Frontmatter but no instructions |
| `E_LINK_BROKEN` | error | A relative link points at a file that does not exist |
| `W_DESC_SHORT`, `W_DESC_NO_TRIGGER` | warn | The description is too thin, or never says *when* to use the skill |
| `W_NAME_COLLISION` | warn | Two **loaded** skills share a name |
| `W_ORPHAN` | warn | A reference file no markdown in the skill mentions — it is never read |
| `W_BODY_LONG`, `W_H1_MISSING`, `W_TODO`, `W_ABS_LINK` | warn | Context cost, structure, leftovers, non-portable paths |

**Validate all** (on the welcome screen) sweeps every root; the counts then badge entries in the Open picker as `3E` / `7W`.

## Adding another skills folder

**Folders…** on the welcome screen adds any folder that contains skill folders. Custom roots are stored in `~/.claude/skill-editor-roots.json` and are treated as source trees (not loaded) unless you set `"loaded": true` in that file.

## Live reload

`start.bat` runs `node --watch serve.mjs`, so you never restart it by hand:

| You change | What happens |
|---|---|
| `serve.mjs` or anything in `lib/` | Node restarts the process; the open page reloads itself |
| anything in `ui/src/` (with `dev.bat`) | Vite rebuilds into `public/`; the server pushes a reload |
| anything in `public/` | The server pushes a reload straight to the page — no restart |
| a test file | Nothing; tests are not imported by the server |

The page holds an `EventSource` on `/api/live`. Each boot has a random id; when the page reconnects and sees a different one, it refreshes. **Unsaved edits are never discarded** — the reload is held back, an "Update ready — reload" pill appears in the header, and the page reloads by itself once you save (or when you click the pill).

The auth token lives in `~/.claude/skill-editor-token` rather than being minted per run, so a restart does not lock out the page you already have open — it can still save. Delete that file to rotate it.

If something still goes wrong, the welcome screen shows a banner with the reason and a Retry button; a `403` says in plain words that the page should be refreshed.

## Keyboard

| Key | Action |
|---|---|
| `Ctrl+O` | Open a skill |
| `Ctrl+N` | New skill |
| `Ctrl+S` | Save |
| `↑` `↓` `Enter` `Esc` | Navigate, open, cancel in the Open picker |
| `Tab` | Two spaces in the editor |

## Safety

The server binds `127.0.0.1` only, requires a per-run token that is injected into the page (so another site in your browser cannot drive it), rejects cross-origin requests, and refuses any path that does not resolve inside a configured root. Writes go through a temp file and a rename, with retries for the Windows EPERM-on-rename case.

## Tests

```bash
node --test tests/roundtrip.test.mjs tests/api.test.mjs
```

`roundtrip` proves `parse(serialize(parse(x))) === parse(x)` for every SKILL.md on this machine — a save cannot corrupt a skill. `api` spawns the real server and exercises the guards, the write path, forking and validation, then cleans
up after itself. Three of its cases assert on an **installed** plugin root and fail with `no installed-plugin
root was discovered` when you have no Claude Code plugin installed — that is your machine, not the code.

Note: `node --test tests/` (a directory) fails on Node 25 here; pass the files explicitly.
