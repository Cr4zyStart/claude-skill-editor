import { AlertTriangle, CheckCircle2, FilePlus2, FolderPlus, Lock, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { renderMarkdown } from '@/lib/markdown'
import type { Root, Skill } from '@/types'

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-1 py-10 text-center text-sm text-muted-foreground">{children}</p>
}

function Validation({ skill, stale }: { skill: Skill; stale: boolean }) {
  const { issues, errors, warnings } = skill.validation

  return (
    <div className="space-y-2.5">
      <p className="text-xs text-muted-foreground">
        {stale
          ? 'Checked against the file on disk — save to re-check.'
          : `${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${
              warnings === 1 ? '' : 's'
            }.`}
      </p>

      {issues.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-success/35 bg-success/10 px-3 py-2.5 text-sm text-success">
          <CheckCircle2 className="size-4" />
          No problems found.
        </div>
      ) : (
        issues.map((issue, index) => (
          <div
            key={`${issue.code}-${index}`}
            className={`rounded-lg border-l-[3px] border border-border bg-card p-3 ${
              issue.level === 'error' ? 'border-l-destructive' : 'border-l-warning'
            }`}
          >
            <div className="mb-1 flex items-center gap-1.5">
              {issue.level === 'error' ? (
                <XCircle className="size-3.5 text-destructive" />
              ) : (
                <AlertTriangle className="size-3.5 text-warning" />
              )}
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {issue.code}
              </span>
            </div>
            <p className="text-sm leading-snug">{issue.message}</p>
            {issue.hint && (
              <p className="mt-1 text-xs leading-snug text-muted-foreground">{issue.hint}</p>
            )}
          </div>
        ))
      )}
    </div>
  )
}

export function SidePanel({
  skill,
  tab,
  onTabChange,
  previewSource,
  previewName,
  previewDescription,
  dirty,
  roots,
  onOpenFile,
  onNewFile,
  onAddRoot,
  onRemoveRoot,
}: {
  skill: Skill | null
  tab: string
  onTabChange: (next: string) => void
  previewSource: string
  previewName: string
  previewDescription: string
  dirty: boolean
  roots: Root[]
  onOpenFile: (relative: string) => void
  onNewFile: () => void
  onAddRoot: () => void
  onRemoveRoot: (dir: string) => void
}) {
  return (
    <Tabs
      value={tab}
      onValueChange={onTabChange}
      className="flex h-full min-h-0 flex-col bg-card"
    >
      <TabsList className="shrink-0">
        <TabsTrigger value="validation">Validation</TabsTrigger>
        <TabsTrigger value="preview">Preview</TabsTrigger>
        <TabsTrigger value="files">Files</TabsTrigger>
        <TabsTrigger value="roots">Folders</TabsTrigger>
      </TabsList>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <TabsContent value="validation">
          {skill ? <Validation skill={skill} stale={dirty} /> : <Empty>Open a skill to see this.</Empty>}
        </TabsContent>

        <TabsContent value="preview">
          {skill ? (
            <div className="prose-skill">
              {(previewName || previewDescription) && (
                <div className="mb-4 rounded-lg border border-border bg-muted/40 p-3">
                  <div className="font-mono text-xs text-primary">{previewName}</div>
                  <div className="mt-0.5 text-xs leading-snug text-muted-foreground">
                    {previewDescription}
                  </div>
                </div>
              )}
              <div dangerouslySetInnerHTML={{ __html: renderMarkdown(previewSource) }} />
            </div>
          ) : (
            <Empty>Open a skill to see this.</Empty>
          )}
        </TabsContent>

        <TabsContent value="files">
          {skill ? (
            <div className="space-y-1">
              <Button
                size="sm"
                variant="outline"
                className="mb-2 w-full"
                disabled={!skill.writable}
                onClick={onNewFile}
              >
                <FilePlus2 /> New file
              </Button>

              {skill.files.map((file) => (
                <div
                  key={file.path}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
                >
                  <button
                    type="button"
                    disabled={!file.editable}
                    onClick={() => onOpenFile(file.relative)}
                    title={file.editable ? 'Open' : 'Not a text file the editor opens'}
                    className="min-w-0 flex-1 truncate text-left font-mono text-xs enabled:hover:text-primary disabled:text-muted-foreground"
                  >
                    {file.relative}
                  </button>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {file.size > 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${file.size} B`}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <Empty>Open a skill to see this.</Empty>
          )}
        </TabsContent>

        <TabsContent value="roots">
          <div className="space-y-2.5">
            <Button size="sm" variant="outline" className="w-full" onClick={onAddRoot}>
              <FolderPlus /> Add a folder
            </Button>

            {roots.map((root) => (
              <div key={root.id} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-start gap-2">
                  <span className="min-w-0 flex-1 text-sm leading-snug">{root.label}</span>
                  {!root.writable && <Lock className="mt-0.5 size-3.5 text-muted-foreground" />}
                </div>
                <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                  {root.dir}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Badge variant={root.skillCount > 0 ? 'success' : 'warning'}>
                    {root.skillCount} skill{root.skillCount === 1 ? '' : 's'}
                  </Badge>
                  <Badge>{root.kind}</Badge>
                  <Badge variant={root.writable ? 'success' : 'warning'}>
                    {root.writable ? 'writable' : 'read-only'}
                  </Badge>
                  <Badge variant={root.loaded ? 'primary' : 'default'}>
                    {root.loaded ? 'loaded by Claude Code' : 'source tree'}
                  </Badge>
                </div>
                {root.skillCount === 0 && root.duplicateCount > 0 && (
                  <p className="mt-2 rounded-md border border-border bg-muted/50 px-2.5 py-2 text-xs leading-snug text-muted-foreground">
                    All {root.duplicateCount} skills here are already listed under another folder
                    above, so nothing is hidden. You can remove this one.
                  </p>
                )}

                {/* FIX [Claude AI - Opus 5] (2026-10-08 16:44:30): an empty default root is
                    normal, not a mistake. Only a folder the user added deserves the warning. */}
                {root.skillCount === 0 && root.duplicateCount === 0 && root.kind !== 'custom' && (
                  <p className="mt-2 text-xs leading-snug text-muted-foreground">
                    Empty — new skills you create go here.
                  </p>
                )}

                {root.skillCount === 0 && root.duplicateCount === 0 && root.kind === 'custom' && (
                  <p className="mt-2 rounded-md border border-warning/35 bg-warning/10 px-2.5 py-2 text-xs leading-snug text-warning">
                    No skills found here. A skill is a folder containing a{' '}
                    <span className="font-mono">SKILL.md</span>. Point this at the folder that holds
                    those folders — for a plugin repo that is usually{' '}
                    <span className="font-mono">plugins/&lt;name&gt;/skills</span>.
                  </p>
                )}

                {root.kind === 'custom' && (
                  <Button
                    size="xs"
                    variant="ghost"
                    className="mt-2 text-muted-foreground"
                    onClick={() => onRemoveRoot(root.dir)}
                  >
                    Remove
                  </Button>
                )}
              </div>
            ))}
          </div>
        </TabsContent>
      </div>
    </Tabs>
  )
}
