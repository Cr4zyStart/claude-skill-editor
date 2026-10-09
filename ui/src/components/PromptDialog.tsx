import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

export interface PromptField {
  key: string
  label: string
  hint?: string
  placeholder?: string
  value?: string
  options?: { value: string; label: string }[]
}

export interface PromptSpec {
  title: string
  description?: string
  okLabel?: string
  fields: PromptField[]
  onSubmit: (values: Record<string, string>) => void | Promise<void>
}

export function PromptDialog({
  spec,
  onClose,
}: {
  spec: PromptSpec | null
  onClose: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!spec) return
    const initial: Record<string, string> = {}
    for (const field of spec.fields) {
      initial[field.key] = field.value ?? field.options?.[0]?.value ?? ''
    }
    setValues(initial)
    setBusy(false)
  }, [spec])

  if (!spec) return null

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{spec.title}</DialogTitle>
          {spec.description && <DialogDescription>{spec.description}</DialogDescription>}
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={async (event) => {
            event.preventDefault()
            setBusy(true)
            try {
              await spec.onSubmit(values)
            } finally {
              setBusy(false)
            }
          }}
        >
          {spec.fields.map((field) => (
            <div key={field.key} className="grid gap-1.5">
              <label
                htmlFor={`prompt-${field.key}`}
                className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
              >
                {field.label}
              </label>

              {field.options ? (
                <select
                  id={`prompt-${field.key}`}
                  value={values[field.key] ?? ''}
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                  }
                  className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {field.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id={`prompt-${field.key}`}
                  autoFocus={field === spec.fields[0]}
                  placeholder={field.placeholder}
                  value={values[field.key] ?? ''}
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                  }
                />
              )}

              {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
            </div>
          ))}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Working…' : (spec.okLabel ?? 'OK')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
