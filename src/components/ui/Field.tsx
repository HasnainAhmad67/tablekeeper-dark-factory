import type { InputHTMLAttributes } from 'react';

/**
 * Form field primitive — label + input + inline error as one unit.
 *
 * The error is a `role="alert"` paragraph wired to the input through
 * aria-describedby/aria-invalid, so validation failures are announced
 * without moving focus. Renders one <input>; compose search fields with
 * type="search".
 */

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Unique element id, shared by the label and the input. */
  id: string;
  /** Visible label text. */
  label: string;
  /** Inline validation message; rendered as role="alert" when present. */
  error?: string;
}

export function Field({ id, label, error, className, ...rest }: FieldProps) {
  const errorId = `${id}-error`;
  const inputClasses = [
    'rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-foreground-muted',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <input
        {...rest}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={inputClasses}
      />
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
