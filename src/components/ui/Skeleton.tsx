/**
 * Skeleton placeholder — purely decorative loading geometry.
 *
 * Announce loading with a surrounding live region (role="status" plus
 * sr-only text) rather than on the skeleton itself; the global
 * reduced-motion rule already flattens the pulse animation.
 */

export interface SkeletonProps {
  /** Tailwind sizing classes; defaults to a heading-sized bar. */
  className?: string;
}

export function Skeleton({ className = 'h-5' }: SkeletonProps) {
  const classes = ['animate-pulse rounded-md bg-surface-raised', className]
    .filter(Boolean)
    .join(' ');

  return <div aria-hidden="true" className={classes} />;
}
