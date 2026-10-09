import { AlertTriangle, FolderCog, ListChecks, Lock, Plus, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { RecentEntry } from '@/types'

function when(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const minutes = Math.round((Date.now() - then) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days < 30 ? `${days}d ago` : new Date(then).toLocaleDateString()
}

function Shortcut({ keys }: { keys: string }) {
  return (
    <kbd className="ml-1 rounded border border-border/70 bg-background/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
      {keys}
    </kbd>
  )
}

export function WelcomeScreen({
  recent,
  skillCount,
  loadError,
  validating,
  onOpen,
  onNew,
  onValidateAll,
  onFolders,
  onPick,
  onClearRecent,
  onRetry,
}: {
  recent: RecentEntry[]
  skillCount: number
  loadError: string | null
  validating: boolean
  onOpen: () => void
  onNew: () => void
  onValidateAll: () => void
  onFolders: () => void
  onPick: (dir: string) => void
  onClearRecent: () => void
  onRetry: () => void
}) {
  return (
    <div className="absolute inset-0 z-10 overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-2xl px-7 py-14">
        <h1 className="text-2xl font-semibold tracking-tight">Claude Skill Editor</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {loadError
            ? 'Something went wrong loading your skills.'
            : `${skillCount} skills across your folders. Open one to edit it, or start a new one.`}
        </p>

        {loadError && (
          <div className="mt-5 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-destructive">
              <AlertTriangle className="size-4" />
              Could not load your skills
            </div>
            <p className="mt-1.5 text-sm leading-snug text-destructive/90">{loadError}</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={onRetry}>
              Retry
            </Button>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={onOpen}>
            <Search /> Open a skill <Shortcut keys="Ctrl O" />
          </Button>
          <Button variant="outline" onClick={onNew}>
            <Plus /> New skill <Shortcut keys="Ctrl N" />
          </Button>
          <Button variant="outline" onClick={onValidateAll} disabled={validating}>
            <ListChecks /> {validating ? 'Validating…' : 'Validate all'}
          </Button>
          <Button variant="ghost" onClick={onFolders}>
            <FolderCog /> Folders
          </Button>
        </div>

        <div className="mt-10">
          <div className="flex items-baseline justify-between border-b border-border pb-2">
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Recent
            </h2>
            {recent.length > 0 && (
              <Button size="xs" variant="link" onClick={onClearRecent}>
                Clear
              </Button>
            )}
          </div>

          {recent.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nothing yet. Open a skill and it will show up here.
            </p>
          ) : (
            <ul className="mt-1">
              {recent.map((item) => (
                <li key={item.dir}>
                  <button
                    type="button"
                    title={item.dir}
                    onClick={() => onPick(item.dir)}
                    className="flex w-full items-center gap-3 rounded-md px-2.5 py-2.5 text-left transition-colors hover:bg-accent"
                  >
                    <span className="shrink-0 font-mono text-[13px]">{item.name}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {item.rootLabel}
                    </span>
                    {!item.writable && (
                      <Badge variant="warning" className="shrink-0 gap-1">
                        <Lock className="size-2.5" /> read-only
                      </Badge>
                    )}
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {when(item.at)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
