import type { ReactNode } from 'react';

/**
 * Inline alert for form and API feedback.
 *
 * Errors use role="alert" (assertive — matches the auth pages' inline
 * error requirement); success/warning/info use role="status" (polite).
 * Colors are token pairs: full-strength text on a 10% tinted surface.
 */

type AlertVariant = 'error' | 'success' | 'warning' | 'info';

const variantClasses: Record<AlertVariant, string> = {
  error: 'border-danger/40 bg-danger/10 text-danger',
  success: 'border-success/40 bg-success/10 text-success',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  info: 'border-info/40 bg-info/10 text-info',
};

export interface AlertProps {
  variant?: AlertVariant;
  children: ReactNode;
  className?: string;
}

export function Alert({ variant = 'info', children, className }: AlertProps) {
  const classes = ['rounded-md border px-4 py-3 text-sm', variantClasses[variant], className]
    .filter(Boolean)
    .join(' ');

  return (
    <p role={variant === 'error' ? 'alert' : 'status'} className={classes}>
      {children}
    </p>
  );
}

export type { AlertVariant };
