import { useMemo, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, FolderPlus, Lock, Search, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { Root, SkillSummary } from '@/types'

interface Counts {
  errors: number
  warnings: number
}

// ADD [Claude AI - Opus 5] (2026-10-08 17:12:40): browse one folder at a time. The
// original sidebar listed every skill from every root at once, which is what made it
// unreadable; scoping to a single folder also removes the repo/installed duplicate pair,
// since those always live in different roots.
export function Explorer({
  roots,
  skills,
  activeRootId,
  openDir,
  counts,
  onPick,
  onAddRoot,
  onOpenPicker,
}: {
  roots: Root[]
  skills: SkillSummary[]
  activeRootId: string | null
  openDir: string | null
  counts: Map<string, Counts>
  onPick: (dir: string) => void
  onAddRoot: () => void
  onOpenPicker: () => void
}) {
  const [filter, setFilter] = useState('')

  const root = roots.find((r) => r.id === activeRootId) ?? null

  const listed = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return skills
      .filter((s) => s.rootId === activeRootId)
      .filter(
        (s) =>
          !q ||
          (s.name || s.folder).toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q),
      )
      .sort((a, b) => (a.name || a.folder).localeCompare(b.name || b.folder))
  }, [skills, activeRootId, filter])

  const total = skills.filter((s) => s.rootId === activeRootId).length

  // Which folder actually claimed this one's skills.
  const duplicateOwner = useMemo(() => {
    if (!root || total > 0 || root.duplicateCount === 0) return null
    const prefix = root.dir.toLowerCase()
    return skills.find((s) => s.dir.toLowerCase().startsWith(prefix))?.rootLabel ?? null
  }, [root, skills, total])

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-border bg-card">
      <div className="shrink-0 space-y-2 border-b border-border p-2.5">
        {/* FIX [Claude AI - Opus 5] (2026-10-08 19:08:10): show where the folder
            actually is. Two roots can share a plain name (editable vs installed copy of
            the same plugin), and a name alone was misleading. */}
        <button
          type="button"
          onClick={onOpenPicker}
          title={root ? root.dir : 'Choose a folder'}
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-left transition-colors hover:border-primary/60"
        >
          <span className="flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate text-xs">
              {root ? root.label : 'Choose a folder'}
            </span>
            {root && root.skillCount > 0 && (
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {root.skillCount}
              </span>
            )}
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
          </span>
          <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground" dir="rtl">
            {root ? root.dir : ''}
          </span>
        </button>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter this folder…"
            className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground focus:border-primary"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {listed.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs leading-snug text-muted-foreground">
            {total === 0
              ? root && root.duplicateCount > 0
                ? `All ${root.duplicateCount} skills inside this folder are listed under "${
                    duplicateOwner ?? 'another folder'
                  }". Pick that one instead, or remove this folder in the Folders tab.`
                : 'No skills in this folder yet.'
              : 'Nothing matches that filter.'}
          </p>
        ) : (
          listed.map((s) => {
            const count = counts.get(s.dir)
            const isOpen = s.dir === openDir
            return (
              <button
                key={s.dir}
                type="button"
                title={`${s.dir}\n\n${s.description}`}
                onClick={() => onPick(s.dir)}
                className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors ${
                  isOpen ? 'bg-primary/15 text-primary' : 'hover:bg-accent'
                }`}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {s.name || s.folder}
                </span>
                {/* FIX [Claude AI - Opus 5] (2026-10-08 20:04:15): a bare number meant
                    nothing. Icon plus a spelled-out tooltip, and a tick for a skill that
                    was checked and came back clean — otherwise "no badge" was ambiguous
                    between "fine" and "never looked at". */}
                {count?.errors ? (
                  <Badge
                    variant="error"
                    className="gap-0.5 px-1.5"
                    title={`${count.errors} error${count.errors === 1 ? '' : 's'} — open it to see what`}
                  >
                    <XCircle className="size-2.5" />
                    {count.errors}
                  </Badge>
                ) : null}
                {count?.warnings ? (
                  <Badge
                    variant="warning"
                    className="gap-0.5 px-1.5"
                    title={`${count.warnings} warning${count.warnings === 1 ? '' : 's'} — open it to see what`}
                  >
                    <AlertTriangle className="size-2.5" />
                    {count.warnings}
                  </Badge>
                ) : null}
                {count && !count.errors && !count.warnings && (
                  <span className="shrink-0" title="Checked — no problems found">
                    <Check className="size-3 text-success/70" />
                  </span>
                )}
                {!s.writable && <Lock className="size-3 shrink-0 text-muted-foreground" />}
              </button>
            )
          })
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-border px-2.5 py-1.5">
        <span className="text-[11px] text-muted-foreground">
          {filter.trim() ? `${listed.length} of ${total}` : `${total} skill${total === 1 ? '' : 's'}`}
        </span>
        <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={onAddRoot}>
          <FolderPlus /> Folder
        </Button>
      </div>
    </div>
  )
}
