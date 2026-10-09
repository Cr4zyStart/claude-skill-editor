import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { toast, Toaster } from 'sonner'
import {
  ChevronDown,
  GitFork,
  Moon,
  Plus,
  RotateCw,
  Save,
  Search,
  PanelLeft,
  Sun,
  X,
} from 'lucide-react'

import { CodeEditor } from '@/components/CodeEditor'
import { PromptDialog, type PromptSpec } from '@/components/PromptDialog'
import { Explorer } from '@/components/Explorer'
import { FolderPicker } from '@/components/FolderPicker'
import { QuickOpen } from '@/components/QuickOpen'
import { SidePanel } from '@/components/SidePanel'
import { WelcomeScreen } from '@/components/WelcomeScreen'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useLiveReload } from '@/hooks/useLiveReload'
import { api } from '@/lib/api'
import { yamlLine } from '@/lib/markdown'
import { cn } from '@/lib/utils'
import type { RecentEntry, Root, Skill, SkillSummary } from '@/types'

const EXTRA_KEYS = ['license', 'model', 'allowed-tools', 'disable-model-invocation']

function extraText(skill: Skill): string {
  const lines = EXTRA_KEYS.filter((key) => (skill.fields[key] ?? '').trim() !== '').map((key) =>
    yamlLine(key, skill.fields[key]),
  )
  return [...lines, ...skill.extraLines].join('\n')
}

export default function App() {
  const [roots, setRoots] = useState<Root[]>([])
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [recent, setRecent] = useState<RecentEntry[]>([])
  const [counts, setCounts] = useState(new Map<string, { errors: number; warnings: number }>())
  const [loadError, setLoadError] = useState<string | null>(null)
  const [validating, setValidating] = useState(false)

  const [skill, setSkill] = useState<Skill | null>(null)
  const [activeFile, setActiveFile] = useState('SKILL.md')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [extra, setExtra] = useState('')
  const [text, setText] = useState('')
  const [baseline, setBaseline] = useState<string | null>(null)
  const [extraOpen, setExtraOpen] = useState(false)

  // ADD [Claude AI - Opus 5] (2026-10-08 17:14:05): browsable folder sidebar.
  const [explorerRoot, setExplorerRoot] = useState<string | null>(
    () => localStorage.getItem('skill-editor-root'),
  )
  const [folderPicker, setFolderPicker] = useState(false)
  const [explorerOpen, setExplorerOpen] = useState(
    () => localStorage.getItem('skill-editor-explorer') !== 'closed',
  )

  const [side, setSide] = useState('validation')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [prompt, setPrompt] = useState<PromptSpec | null>(null)
  const [updatePending, setUpdatePending] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('skill-editor-theme') as 'dark' | 'light') ?? 'dark',
  )

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try {
      localStorage.setItem('skill-editor-theme', theme)
    } catch {
      /* a blocked localStorage only costs the remembered choice */
    }
  }, [theme])

  useEffect(() => {
    if (roots.length === 0) return
    // FIX [Claude AI - Opus 5] (2026-10-08 18:26:15): a fully-redundant folder is no
    // longer offered in the Explorer, so a remembered one would leave the select blank.
    const listed = roots.filter((r) => !(r.skillCount === 0 && r.duplicateCount > 0))
    if (listed.length === 0) return
    if (explorerRoot && listed.some((r) => r.id === explorerRoot)) return
    // Land on the folder that actually has something in it.
    const best = [...listed].sort((a, b) => b.skillCount - a.skillCount)[0]
    setExplorerRoot(best.id)
  }, [roots, explorerRoot])

  useEffect(() => {
    try {
      if (explorerRoot) localStorage.setItem('skill-editor-root', explorerRoot)
      localStorage.setItem('skill-editor-explorer', explorerOpen ? 'open' : 'closed')
    } catch {
      /* a blocked localStorage only costs the remembered choice */
    }
  }, [explorerRoot, explorerOpen])

  const onSkillMd = activeFile === 'SKILL.md'

  const snapshot = useMemo(
    () => JSON.stringify(onSkillMd ? [activeFile, name, description, extra, text] : [activeFile, text]),
    [activeFile, name, description, extra, text, onSkillMd],
  )
  const dirty = baseline !== null && snapshot !== baseline
  const writable = Boolean(skill?.writable)

  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  /* ---------------- loading ---------------- */

  const refresh = useCallback(async () => {
    const state = await api.state()
    setRoots(state.roots)
    setSkills(state.skills)
    setLoadError(null)
    const { recent: list } = await api.recent().catch(() => ({ recent: [] as RecentEntry[] }))
    setRecent(list)
    return state
  }, [])

  useEffect(() => {
    refresh().catch((err: Error) => setLoadError(err.message))
  }, [refresh])

  const applySkill = useCallback((next: Skill) => {
    setSkill(next)
    setCounts((prev) =>
      new Map(prev).set(next.dir, {
        errors: next.validation.errors,
        warnings: next.validation.warnings,
      }),
    )
  }, [])

  const confirmDiscard = useCallback(() => {
    if (!dirtyRef.current) return true
    return window.confirm('Discard unsaved changes?')
  }, [])

  const openSkill = useCallback(
    async (dir: string) => {
      if (!confirmDiscard()) return
      try {
        const next = await api.skill(dir)
        applySkill(next)
        setActiveFile('SKILL.md')
        setName(next.fields.name ?? '')
        setDescription(next.fields.description ?? '')
        const extras = extraText(next)
        setExtra(extras)
        setExtraOpen(extras.length > 0)
        setText(next.body)
        setBaseline(
          JSON.stringify(['SKILL.md', next.fields.name ?? '', next.fields.description ?? '', extras, next.body]),
        )
        const { recent: list } = await api.recent().catch(() => ({ recent: [] as RecentEntry[] }))
        setRecent(list)
      } catch (err) {
        const message = (err as Error).message
        setLoadError(message)
        toast.error(message)
      }
    },
    [applySkill, confirmDiscard],
  )

  const openFile = useCallback(
    async (relative: string) => {
      if (!skill || relative === activeFile) return
      if (!confirmDiscard()) return
      if (relative === 'SKILL.md') {
        await openSkill(skill.dir)
        return
      }
      const file = skill.files.find((item) => item.relative === relative)
      if (!file) return
      try {
        const data = await api.file(file.path)
        setActiveFile(relative)
        setText(data.text)
        setBaseline(JSON.stringify([relative, data.text]))
      } catch (err) {
        toast.error((err as Error).message)
      }
    },
    [activeFile, confirmDiscard, openSkill, skill],
  )

  const closeSkill = useCallback(() => {
    if (!confirmDiscard()) return
    setSkill(null)
    setBaseline(null)
    setActiveFile('SKILL.md')
    setText('')
  }, [confirmDiscard])

  /* ---------------- saving ---------------- */

  const save = useCallback(async () => {
    if (!skill || !writable || !dirty) return
    try {
      if (onSkillMd) {
        const extraLines = extra.split('\n').filter((line) => line.trim() !== '')
        const clash = extraLines.find((line) => /^\s*(name|description)\s*:/.test(line))
        if (clash) {
          toast.error('Remove the name/description line from "Other frontmatter" — use the fields above.')
          return
        }
        const fields: Record<string, string> = { ...skill.fields }
        for (const key of EXTRA_KEYS) delete fields[key]
        fields.name = name.trim()
        fields.description = description.trim()

        const next = await api.saveSkill({ dir: skill.dir, fields, extraLines, body: text })
        applySkill(next)
        setSkills((prev) =>
          prev.map((item) =>
            item.dir === next.dir
              ? { ...item, name: next.fields.name ?? '', description: next.fields.description ?? '' }
              : item,
          ),
        )
      } else {
        const file = skill.files.find((item) => item.relative === activeFile)
        if (!file) return
        await api.saveFile(file.path, text)
        applySkill(await api.skill(skill.dir, false))
      }

      setBaseline(snapshot)
      if (updatePending) {
        toast.success('Saved. Reloading to pick up the new code…')
        setTimeout(() => location.reload(), 600)
        return
      }
      toast.success('Saved.')
    } catch (err) {
      const message = (err as Error).message
      toast.error(`${message} Your changes are still in the editor.`)
    }
  }, [
    activeFile,
    applySkill,
    description,
    dirty,
    extra,
    name,
    onSkillMd,
    skill,
    snapshot,
    text,
    updatePending,
    writable,
  ])

  const revert = useCallback(() => {
    if (!skill) return
    if (onSkillMd) {
      setName(skill.fields.name ?? '')
      setDescription(skill.fields.description ?? '')
      setExtra(extraText(skill))
      setText(skill.body)
    } else {
      void openFile(activeFile)
    }
    // The re-baseline effect below picks up the restored values on the next render.
    setBaseline(null)
  }, [activeFile, onSkillMd, openFile, skill])

  // Re-baseline after a revert once the new values have landed.
  useEffect(() => {
    if (baseline === null && skill) setBaseline(snapshot)
  }, [baseline, skill, snapshot])

  /* ---------------- live reload ---------------- */

  useLiveReload(
    useCallback((reason: string) => {
      if (dirtyRef.current) {
        setUpdatePending(true)
        toast.warning(`${reason} — your unsaved changes are kept. Save, then reload.`, {
          duration: 10000,
        })
        return
      }
      location.reload()
    }, []),
  )

  /* ---------------- actions ---------------- */

  const writableRoots = roots.filter((root) => root.writable)

  const newSkill = useCallback(() => {
    if (writableRoots.length === 0) {
      toast.error('No writable skill folder is configured.')
      return
    }
    setPrompt({
      title: 'New skill',
      description: 'Creates the folder and a SKILL.md with a starter outline.',
      okLabel: 'Create',
      fields: [
        {
          key: 'rootId',
          label: 'Where',
          options: writableRoots.map((root) => ({ value: root.id, label: root.label })),
        },
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
      onSubmit: async (values) => {
        try {
          const created = await api.newSkill({
            rootId: values.rootId,
            folder: values.folder,
            description: values.description,
          })
          setPrompt(null)
          await refresh()
          await openSkill(created.dir)
          toast.success('Skill created.')
        } catch (err) {
          toast.error((err as Error).message)
        }
      },
    })
  }, [openSkill, refresh, writableRoots])

  const fork = useCallback(() => {
    if (!skill) return
    setPrompt({
      title: 'Fork skill',
      description: 'Copies this skill into a folder you can edit, and renames its frontmatter to match.',
      okLabel: 'Fork',
      fields: [
        {
          key: 'targetRootId',
          label: 'Copy into',
          options: writableRoots.map((root) => ({ value: root.id, label: root.label })),
        },
        { key: 'folder', label: 'New folder name', value: skill.folder },
      ],
      onSubmit: async (values) => {
        try {
          const copy = await api.forkSkill({
            dir: skill.dir,
            targetRootId: values.targetRootId,
            folder: values.folder,
          })
          setPrompt(null)
          await refresh()
          await openSkill(copy.dir)
          toast.success('Forked. You are now editing the copy.')
        } catch (err) {
          toast.error((err as Error).message)
        }
      },
    })
  }, [openSkill, refresh, skill, writableRoots])

  const newFile = useCallback(() => {
    if (!skill) return
    setPrompt({
      title: 'New file in this skill',
      okLabel: 'Create',
      fields: [
        {
          key: 'relative',
          label: 'Relative path',
          placeholder: 'references/notes.md',
          hint: 'Remember to mention it from SKILL.md, or it is never read.',
        },
      ],
      onSubmit: async (values) => {
        try {
          const next = await api.newFile(skill.dir, values.relative)
          applySkill(next)
          setPrompt(null)
          await openFile(values.relative.replace(/\\/g, '/'))
          toast.success('File created.')
        } catch (err) {
          toast.error((err as Error).message)
        }
      },
    })
  }, [applySkill, openFile, skill])

  const addRoot = useCallback(() => {
    setPrompt({
      title: 'Add a skills folder',
      description: 'The folder that contains skill folders.',
      okLabel: 'Add',
      fields: [
        { key: 'dir', label: 'Folder path', placeholder: 'C:\\path\\to\\.claude\\skills' },
        { key: 'label', label: 'Label (optional)' },
      ],
      onSubmit: async (values) => {
        try {
          const before = new Set(roots.map((r) => r.id))
          await api.addRoot(values.dir, values.label || undefined)
          setPrompt(null)
          const state = await refresh()
          // FIX [Claude AI - Opus 5] (2026-10-08 17:48:20): "Folder added." was a lie when
          // the folder contributed nothing — the user then saw a (0) with no explanation.
          const added = state.roots.find((r) => !before.has(r.id))
          if (added && added.skillCount > 0) {
            setExplorerRoot(added.id)
            toast.success(`Added — ${added.skillCount} skills.`)
          } else if (added && added.duplicateCount > 0) {
            const owner = state.skills.find((s) =>
              s.dir.toLowerCase().startsWith(added.dir.toLowerCase()),
            )
            toast.warning(
              `Nothing new. All ${added.duplicateCount} skills in there are already listed under "${
                owner?.rootLabel ?? 'another folder'
              }".`,
            )
          } else if (added) {
            toast.warning('Added, but no SKILL.md was found anywhere inside.')
          } else {
            toast.success('Folder added.')
          }
        } catch (err) {
          toast.error((err as Error).message)
        }
      },
    })
  }, [refresh, roots])

  const removeRoot = useCallback(
    async (dir: string) => {
      try {
        await api.removeRoot(dir)
        await refresh()
        toast.success('Folder removed.')
      } catch (err) {
        toast.error((err as Error).message)
      }
    },
    [refresh],
  )

  const validateAll = useCallback(async () => {
    setValidating(true)
    try {
      const { results } = await api.validateAll()
      setCounts(new Map(results.map((r) => [r.dir, { errors: r.errors, warnings: r.warnings }])))
      const errors = results.reduce((sum, r) => sum + r.errors, 0)
      const warnings = results.reduce((sum, r) => sum + r.warnings, 0)
      toast.success(`${results.length} skills — ${errors} errors, ${warnings} warnings.`)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setValidating(false)
    }
  }, [])

  const tryOpenPicker = useCallback(() => {
    if (!confirmDiscard()) return
    if (skills.length === 0) {
      refresh()
        .then((state) => {
          if (state.skills.length === 0) {
            toast.error('No skills found. Use Folders to add one.')
            return
          }
          setPickerOpen(true)
        })
        .catch((err: Error) => {
          setLoadError(err.message)
          toast.error(err.message)
        })
      return
    }
    setPickerOpen(true)
  }, [confirmDiscard, refresh, skills.length])

  /* ---------------- shortcuts ---------------- */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      if (key === 's') {
        event.preventDefault()
        void save()
      } else if (key === 'o') {
        event.preventDefault()
        tryOpenPicker()
      } else if (key === 'n') {
        event.preventDefault()
        newSkill()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newSkill, save, tryOpenPicker])

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  /* ---------------- render ---------------- */

  const nameLength = name.trim().length
  const descriptionLength = description.trim().length

  return (
    <div className="flex h-full flex-col">
      <Toaster theme={theme} position="bottom-center" richColors closeButton />

      <header className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2">
        <span className="shrink-0 text-sm font-semibold tracking-tight">Claude Skill Editor</span>

        <Button
          size="iconSm"
          variant="ghost"
          title={explorerOpen ? 'Hide the folder sidebar' : 'Show the folder sidebar'}
          onClick={() => setExplorerOpen(!explorerOpen)}
        >
          <PanelLeft />
        </Button>

        <Button size="sm" variant="ghost" onClick={tryOpenPicker} title="Open a skill (Ctrl+O)">
          <Search /> Open
        </Button>
        <Button size="sm" variant="ghost" onClick={newSkill} title="New skill (Ctrl+N)">
          <Plus /> New
        </Button>

        <span
          className="min-w-0 flex-1 truncate px-1 font-mono text-[11px] text-muted-foreground"
          title={skill ? skill.dir : undefined}
        >
          {skill ? `${skill.dir}\\${activeFile}` : 'No skill open'}
        </span>

        {dirty && (
          <span className="shrink-0 text-lg leading-none text-primary" title="Unsaved changes">
            •
          </span>
        )}

        {updatePending && (
          <Button
            size="xs"
            variant="outline"
            className="border-primary/50 text-primary"
            onClick={() => {
              if (dirtyRef.current && !window.confirm('Reload and discard unsaved changes?')) return
              setBaseline(null)
              location.reload()
            }}
          >
            Update ready — reload
          </Button>
        )}

        <Button
          size="iconSm"
          variant="ghost"
          title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark' ? <Sun /> : <Moon />}
        </Button>

        <Button
          size="iconSm"
          variant="ghost"
          title="Reload from disk"
          onClick={() => {
            if (!confirmDiscard()) return
            const open = skill?.dir
            setBaseline(null)
            refresh()
              .then(() => (open ? openSkill(open) : undefined))
              .then(() => toast.success('Reloaded from disk.'))
              .catch((err: Error) => setLoadError(err.message))
          }}
        >
          <RotateCw />
        </Button>

        {skill && !skill.writable && (
          <Button size="sm" variant="outline" onClick={fork} title="Copy into a writable folder">
            <GitFork /> Fork to edit
          </Button>
        )}

        <Button size="sm" variant="ghost" disabled={!dirty} onClick={revert} title="Discard changes">
          Revert
        </Button>
        <Button size="sm" variant="ghost" disabled={!skill} onClick={closeSkill} title="Close">
          <X /> Close
        </Button>
        <Button size="sm" disabled={!dirty || !writable} onClick={() => void save()}>
          <Save /> Save
        </Button>
      </header>

      {skill && !skill.writable && (
        <div className="shrink-0 border-b border-warning/40 bg-warning/10 px-4 py-1.5 text-xs text-warning">
          {skill.rootLabel} is read-only — a plugin update would overwrite your edits. Fork it first.
        </div>
      )}

      <PanelGroup direction="horizontal" className="min-h-0 flex-1">
        {explorerOpen && (
          <>
            <Panel defaultSize={18} minSize={12} maxSize={34} className="min-h-0">
              <Explorer
                roots={roots}
                skills={skills}
                activeRootId={explorerRoot}
                openDir={skill?.dir ?? null}
                counts={counts}
                onPick={(dir) => void openSkill(dir)}
                onAddRoot={addRoot}
                onOpenPicker={() => setFolderPicker(true)}
              />
            </Panel>
            <PanelResizeHandle className="w-1 bg-border/60 transition-colors hover:bg-primary/60 data-[resize-handle-active]:bg-primary" />
          </>
        )}

        <Panel defaultSize={52} minSize={30} className="relative flex min-h-0 flex-col">
          {skill && onSkillMd && (
            <div className="shrink-0 space-y-3 border-b border-border px-5 py-4">
              <div className="grid gap-1.5">
                <div className="flex items-baseline justify-between">
                  <label
                    htmlFor="f-name"
                    className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                  >
                    name <span className="normal-case">(must match the folder)</span>
                  </label>
                  <span
                    className={cn(
                      'font-mono text-[11px]',
                      nameLength > 64 ? 'text-destructive' : 'text-muted-foreground',
                    )}
                  >
                    {nameLength}/64
                  </span>
                </div>
                <Input
                  id="f-name"
                  value={name}
                  readOnly={!writable}
                  spellCheck={false}
                  className="font-mono"
                  onChange={(event) => setName(event.target.value)}
                />
              </div>

              <div className="grid gap-1.5">
                <div className="flex items-baseline justify-between">
                  <label
                    htmlFor="f-desc"
                    className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                  >
                    description{' '}
                    <span className="normal-case">
                      (the only text the model sees when choosing this skill)
                    </span>
                  </label>
                  <span
                    className={cn(
                      'font-mono text-[11px]',
                      descriptionLength > 1024
                        ? 'text-destructive'
                        : descriptionLength > 0 && descriptionLength < 40
                          ? 'text-warning'
                          : 'text-muted-foreground',
                    )}
                  >
                    {descriptionLength}/1024
                  </span>
                </div>
                <Textarea
                  id="f-desc"
                  rows={3}
                  value={description}
                  readOnly={!writable}
                  spellCheck={false}
                  className="resize-y"
                  onChange={(event) => setDescription(event.target.value)}
                />
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => setExtraOpen(!extraOpen)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ChevronDown className={cn('size-3 transition-transform', !extraOpen && '-rotate-90')} />
                  Other frontmatter ({extra.split('\n').filter((l) => l.trim()).length} lines, preserved
                  verbatim)
                </button>
                {extraOpen && (
                  <Textarea
                    rows={4}
                    value={extra}
                    readOnly={!writable}
                    spellCheck={false}
                    className="mt-2 font-mono text-xs"
                    onChange={(event) => setExtra(event.target.value)}
                  />
                )}
              </div>
            </div>
          )}

          {skill && (
            <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-card px-2">
              {skill.files
                .filter((file) => file.editable || file.relative === 'SKILL.md')
                .map((file) => (
                  <button
                    key={file.relative}
                    type="button"
                    onClick={() => void openFile(file.relative)}
                    className={cn(
                      '-mb-px whitespace-nowrap border-b-2 px-2.5 py-2 font-mono text-xs transition-colors',
                      file.relative === activeFile
                        ? 'border-primary text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {file.relative}
                  </button>
                ))}
            </div>
          )}

          <CodeEditor value={text} onChange={setText} readOnly={!writable} />

          {!skill && (
            <WelcomeScreen
              recent={recent}
              skillCount={skills.length}
              loadError={loadError}
              validating={validating}
              onOpen={tryOpenPicker}
              onNew={newSkill}
              onValidateAll={() => void validateAll()}
              onFolders={() => setSide('roots')}
              onPick={(dir) => void openSkill(dir)}
              onClearRecent={() => {
                void api.clearRecent().then(() => setRecent([]))
              }}
              onRetry={() => {
                refresh().catch((err: Error) => setLoadError(err.message))
              }}
            />
          )}
        </Panel>

        <PanelResizeHandle className="w-1 bg-border/60 transition-colors hover:bg-primary/60 data-[resize-handle-active]:bg-primary" />

        <Panel defaultSize={38} minSize={20} className="min-h-0">
          <SidePanel
            skill={skill}
            tab={side}
            onTabChange={setSide}
            previewSource={text}
            previewName={name}
            previewDescription={description}
            dirty={dirty}
            roots={roots}
            onOpenFile={(relative) => void openFile(relative)}
            onNewFile={newFile}
            onAddRoot={addRoot}
            onRemoveRoot={(dir) => void removeRoot(dir)}
          />
        </Panel>
      </PanelGroup>

      <FolderPicker
        open={folderPicker}
        roots={roots}
        activeRootId={explorerRoot}
        onPick={(id) => {
          setExplorerRoot(id)
          setFolderPicker(false)
        }}
        onAddRoot={() => {
          setFolderPicker(false)
          addRoot()
        }}
        onClose={() => setFolderPicker(false)}
      />

      <QuickOpen
        open={pickerOpen}
        skills={skills}
        counts={counts}
        onPick={(dir) => {
          setPickerOpen(false)
          void openSkill(dir)
        }}
        onClose={() => setPickerOpen(false)}
      />

      <PromptDialog spec={prompt} onClose={() => setPrompt(null)} />

      {skill && dirty && (
        <div className="pointer-events-none fixed bottom-3 left-3 z-20">
          <Badge variant="primary" className="pointer-events-auto">
            Unsaved changes
          </Badge>
        </div>
      )}
    </div>
  )
}
