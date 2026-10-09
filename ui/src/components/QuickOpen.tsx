import { useMemo, useState } from 'react'
import { Lock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import type { SkillSummary } from '@/types'

interface Counts {
  errors: number
  warnings: number
}

interface Entry {
  skill: SkillSummary
  copies: SkillSummary[]
}

// ADD [Claude AI - Opus 5] (2026-10-08 16:41:05): collapse a skill that exists both
// as a repo checkout and as the plugin installed from it. They are one skill in two
// places, and listing both doubled the palette. Two *loaded* copies are a genuine
// conflict, so those stay listed separately.
function collapseCopies(skills: SkillSummary[]): Entry[] {
  const byName = new Map<string, SkillSummary[]>()
  for (const skill of skills) {
    const key = (skill.name || skill.folder).toLowerCase()
    const list = byName.get(key)
    if (list) list.push(skill)
    else byName.set(key, [skill])
  }

  const entries: Entry[] = []
  for (const list of byName.values()) {
    if (list.length === 1 || list.filter((s) => s.loaded).length > 1) {
      for (const skill of list) entries.push({ skill, copies: [] })
      continue
    }
    // Prefer the copy you can actually save to.
    const primary = list.find((s) => s.writable) ?? list[0]
    entries.push({ skill: primary, copies: list.filter((s) => s !== primary) })
  }
  return entries
}

// Rank exact name, then prefix, then substring, then description. cmdk's own
// fuzzy scorer ignores the fact that the name is what people actually type.
function score(skill: SkillSummary, query: string): number {
  if (!query) return 1
  const name = (skill.name || skill.folder).toLowerCase()
  if (name === query) return 100
  if (name.startsWith(query)) return 50
  if (name.includes(query)) return 25
  if (skill.description.toLowerCase().includes(query)) return 5
  if (skill.rootLabel.toLowerCase().includes(query)) return 2
  return 0
}

export function QuickOpen({
  open,
  skills,
  counts,
  onPick,
  onClose,
}: {
  open: boolean
  skills: SkillSummary[]
  counts: Map<string, Counts>
  onPick: (dir: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')

  const entries = useMemo(() => collapseCopies(skills), [skills])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries
      .map((entry) => ({ entry, rank: score(entry.skill, q) }))
      .filter((scored) => scored.rank > 0)
      .sort(
        (a, b) =>
          b.rank - a.rank ||
          (a.entry.skill.name || a.entry.skill.folder).localeCompare(
            b.entry.skill.name || b.entry.skill.folder,
          ),
      )
      .map((scored) => scored.entry)
  }, [entries, query])

  const hidden = skills.length - entries.length

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setQuery('')
          onClose()
        }
      }}
    >
      <DialogContent hideClose className="max-w-2xl overflow-hidden p-0">
        <DialogTitle className="sr-only">Open a skill</DialogTitle>
        <Command shouldFilter={false} loop>
          <CommandInput
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Type a name, then press Enter…"
          />
          <CommandList>
            <CommandEmpty>No skill matches that.</CommandEmpty>
            <CommandGroup>
              {matches.map(({ skill, copies }) => {
                const count = counts.get(skill.dir)
                return (
                  <CommandItem
                    key={skill.dir}
                    value={skill.dir}
                    title={skill.dir}
                    onSelect={() => {
                      setQuery('')
                      onPick(skill.dir)
                    }}
                  >
                    <span className="shrink-0 font-mono text-[13px]">
                      {skill.name || skill.folder}
                    </span>

                    {count?.errors ? (
                      <Badge
                        variant="error"
                        title={`${count.errors} error${count.errors === 1 ? '' : 's'}`}
                      >
                        {count.errors}E
                      </Badge>
                    ) : null}
                    {count?.warnings ? (
                      <Badge
                        variant="warning"
                        title={`${count.warnings} warning${count.warnings === 1 ? '' : 's'}`}
                      >
                        {count.warnings}W
                      </Badge>
                    ) : null}

                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {skill.description}
                    </span>

                    {copies.length > 0 && (
                      <span
                        title={`Also installed at: ${copies.map((c) => c.rootLabel).join(', ')}`}
                        className="shrink-0 text-[11px] text-muted-foreground/70"
                      >
                        +{copies.length} installed
                      </span>
                    )}
                    {!skill.writable && <Lock className="size-3 shrink-0 text-muted-foreground" />}
                    <span className="max-w-[190px] shrink-0 truncate text-[11px] text-muted-foreground">
                      {skill.rootLabel}
                    </span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>

          <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
            <span>
              {matches.length} of {entries.length}
              {hidden > 0 && ` · ${hidden} installed copies folded in`}
            </span>
            <span>↑↓ move · Enter open · Esc cancel</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
