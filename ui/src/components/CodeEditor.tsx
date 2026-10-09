import { useLayoutEffect, useRef } from 'react'
import { highlightMarkdown } from '@/lib/markdown'
import { cn } from '@/lib/utils'

// A transparent textarea over a highlighted <pre>. Both must share font metrics
// and wrapping exactly, or the caret drifts away from the text.
const SHARED =
  'absolute inset-0 m-0 whitespace-pre-wrap break-words px-5 py-4 font-mono text-[13px] leading-[1.65] tab-size-2'

export function CodeEditor({
  value,
  onChange,
  readOnly,
  className,
}: {
  value: string
  onChange: (next: string) => void
  readOnly?: boolean
  className?: string
}) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const pre = useRef<HTMLPreElement>(null)

  const sync = () => {
    if (!textarea.current || !pre.current) return
    pre.current.scrollTop = textarea.current.scrollTop
    pre.current.scrollLeft = textarea.current.scrollLeft
  }

  useLayoutEffect(sync, [value])

  return (
    <div className={cn('relative min-h-0 flex-1 overflow-hidden bg-background', className)}>
      <pre
        ref={pre}
        aria-hidden
        className={cn(SHARED, 'pointer-events-none overflow-hidden text-foreground')}
        dangerouslySetInnerHTML={{ __html: highlightMarkdown(value) }}
      />
      <textarea
        ref={textarea}
        value={value}
        readOnly={readOnly}
        spellCheck={false}
        onScroll={sync}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return
          event.preventDefault()
          const el = event.currentTarget
          const { selectionStart: start, selectionEnd: end } = el
          const next = `${value.slice(0, start)}  ${value.slice(end)}`
          onChange(next)
          requestAnimationFrame(() => {
            el.selectionStart = el.selectionEnd = start + 2
          })
        }}
        className={cn(
          SHARED,
          'resize-none overflow-auto border-0 bg-transparent text-transparent caret-primary outline-none',
          'selection:bg-primary/30',
        )}
      />
    </div>
  )
}
