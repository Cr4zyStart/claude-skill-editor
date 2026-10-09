import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-tight transition-colors',
  {
    variants: {
      variant: {
        default: 'border-border bg-muted text-muted-foreground',
        error: 'border-destructive/40 bg-destructive/10 text-destructive',
        warning: 'border-warning/40 bg-warning/10 text-warning',
        success: 'border-success/40 bg-success/10 text-success',
        primary: 'border-primary/40 bg-primary/10 text-primary',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
