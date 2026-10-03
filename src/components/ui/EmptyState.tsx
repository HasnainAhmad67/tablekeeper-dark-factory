import type { ReactNode } from 'react';

/**
 * Empty-state placeholder for zero-result or not-yet-seeded content
 * (plan copy: "No restaurants yet", "No matches").
 *
 * The heading level is configurable so the state nests correctly under
 * its section heading; the optional action slot hosts a Reset/Clear
 * button.
 */

export interface EmptyStateProps {
  title: string;
  description?: string;
  /** Action slot (e.g. a clear-search Button). */
  action?: ReactNode;
  /** Heading level to keep the document outline correct. */
  headingLevel?: 2 | 3;
}

export function EmptyState({
  title,
  description,
  action,
  headingLevel = 2,
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as 'h2' | 'h3';

  return (
    <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
      <Heading className="text-lg font-semibold text-foreground">{title}</Heading>
      {description ? (
        <p className="mt-2 text-sm text-foreground-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
