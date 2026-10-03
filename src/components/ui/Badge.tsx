import type { ReactNode } from 'react';

/**
 * Status/metadata badge (cuisine, price range, reservation state).
 * The variant is decorative color only — the badge text itself always
 * carries the meaning, so status is never conveyed by color alone.
 */

type BadgeVariant = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const variantClasses: Record<BadgeVariant, string> = {
  neutral: 'border-border bg-surface-raised text-foreground-muted',
  success: 'border-success/40 bg-success/10 text-success',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  danger: 'border-danger/40 bg-danger/10 text-danger',
  info: 'border-info/40 bg-info/10 text-info',
};

export interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}

export function Badge({ variant = 'neutral', children, className }: BadgeProps) {
  const classes = [
    'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
    variantClasses[variant],
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return <span className={classes}>{children}</span>;
}

export type { BadgeVariant };
