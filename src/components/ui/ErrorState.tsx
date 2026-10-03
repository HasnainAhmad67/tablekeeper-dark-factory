import { Button } from './Button';

/**
 * Error state with a Retry affordance (plan's required loading/empty/
 * error trio). `role="alert"` announces the failure immediately; Retry
 * re-runs the caller's load function.
 */

export interface ErrorStateProps {
  title?: string;
  message?: string;
  /** Re-fetch callback wired to the Retry button. */
  onRetry?: () => void;
  /** Accessible/visible label for the retry button. */
  retryLabel?: string;
}

export function ErrorState({
  title = 'Something went wrong',
  message = 'We could not load this content. Please try again.',
  onRetry,
  retryLabel = 'Retry',
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-danger/40 bg-danger/10 px-6 py-10 text-center"
    >
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="mt-2 text-sm text-foreground-muted">{message}</p>
      {onRetry ? (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
