import type { ButtonHTMLAttributes } from 'react';

import { Spinner } from './Spinner';

/**
 * Button primitive — design-token variants only (no bespoke colors).
 *
 * Focus styling comes from the global `:focus-visible` outline in
 * globals.css; reduced-motion users get the transition for free via the
 * global prefers-reduced-motion override.
 */

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:opacity-90',
  secondary: 'border border-border bg-surface text-foreground hover:bg-surface-raised',
  danger: 'bg-danger text-background hover:opacity-90',
  ghost: 'text-foreground-muted hover:bg-surface-raised hover:text-foreground',
};

const BASE_CLASSES =
  'inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Renders a decorative spinner, sets aria-busy, and blocks clicks. */
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  loading = false,
  className,
  children,
  type = 'button',
  disabled,
  ...rest
}: ButtonProps) {
  const classes = [BASE_CLASSES, variantClasses[variant], className].filter(Boolean).join(' ');

  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={classes}
    >
      {loading ? <Spinner className="size-3.5" /> : null}
      <span>{children}</span>
    </button>
  );
}

export type { ButtonVariant };
