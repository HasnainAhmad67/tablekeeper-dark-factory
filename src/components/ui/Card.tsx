import type { HTMLAttributes, ReactNode } from 'react';

/**
 * Card primitive — the standard elevated surface for discrete content
 * (restaurant tiles, panels). Padding lives on the base class; pass
 * layout classes (flex, gap) via `className` rather than overriding it.
 */

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ className, children, ...rest }: CardProps) {
  const classes = ['rounded-lg border border-border bg-surface p-6 shadow-sm', className]
    .filter(Boolean)
    .join(' ');

  return (
    <div {...rest} className={classes}>
      {children}
    </div>
  );
}
