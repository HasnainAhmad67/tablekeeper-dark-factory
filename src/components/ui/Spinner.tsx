/**
 * Spinner primitive.
 *
 * Without a `label` the spinner is decorative (`aria-hidden`) — the
 * surrounding control (e.g. Button's aria-busy plus its visible text)
 * communicates progress. With a `label` it becomes a polite live region
 * for standalone loading indicators. The global reduced-motion rule
 * neutralizes the rotation for motion-sensitive users.
 */

export interface SpinnerProps {
  /** Visually hidden text announced when the spinner mounts. */
  label?: string;
  /** Tailwind size classes; defaults to a compact control-sized disc. */
  className?: string;
}

export function Spinner({ label, className = 'size-4' }: SpinnerProps) {
  const disc = (
    <span
      aria-hidden="true"
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );

  if (!label) {
    return disc;
  }

  return (
    <span role="status" className="inline-flex items-center gap-2">
      {disc}
      <span className="sr-only">{label}</span>
    </span>
  );
}
