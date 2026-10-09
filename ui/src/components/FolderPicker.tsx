import { Check, FolderPlus, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import type { Root, RootGroup } from '@/types'

const GROUPS: { key: RootGroup; heading: string }[] = [
  { key: 'yours', heading: 'Your skills' },
  { key: 'editable', heading: "Plugins you're developing" },
  { key: 'installed', heading: 'Installed plugins (read-only)' },
]

// ADD [Claude AI - Opus 5] (2026-10-08 19:05:30): a native <select> truncates a Windows
// path, so two folders named "pstack" looked identical. This lists every folder with its
// real location on a second line.
export function FolderPicker({
  open,
  roots,
  activeRootId,
  onPick,
  onAddRoot,
  onClose,
}: {
  open: boolean
  roots: Root[]
  activeRootId: string | null
  onPick: (id: string) => void
  onAddRoot: () => void
  onClose: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
        <DialogTitle className="border-b border-border px-4 py-3 text-sm">
          Choose a folder
        </DialogTitle>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {GROUPS.map(({ key, heading }) => {
            // FIX [Claude AI - Opus 5] (2026-10-08 19:41:05): hide a folder whose skills
            // all belong to another folder. Picking it only ever showed an empty list.
            // It stays in the Folders tab, which is where it can be removed.
            const members = roots.filter(
              (r) =>
                (r.group ?? 'yours') === key &&
                !(r.skillCount === 0 && r.duplicateCount > 0),
            )
            if (members.length === 0) return null
            return (
              <div key={key} className="mb-1">
                <div className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {heading}
                </div>
                {members.map((r) => {
                  const active = r.id === activeRootId
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => onPick(r.id)}
                      className={`flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors ${
                        active ? 'bg-primary/15' : 'hover:bg-accent'
                      }`}
                    >
                      <Check
                        className={`mt-0.5 size-3.5 shrink-0 ${
                          active ? 'text-primary' : 'text-transparent'
                        }`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-sm">{r.label}</span>
                          {!r.writable && (
                            <Lock className="size-3 shrink-0 text-muted-foreground" />
                          )}
                        </span>
                        <span className="mt-0.5 block break-all font-mono text-[11px] leading-snug text-muted-foreground">
                          {r.dir}
                        </span>
                      </span>
                      <span className="shrink-0 pt-0.5 text-[11px] text-muted-foreground">
                        {r.skillCount > 0
                          ? `${r.skillCount} skill${r.skillCount === 1 ? '' : 's'}`
                          : 'nothing yet'}
                      </span>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>

        <div className="border-t border-border px-3 py-2">
          <Button size="sm" variant="ghost" onClick={onAddRoot}>
            <FolderPlus /> Add a folder
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
