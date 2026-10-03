import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import {
  validateWaitlistForm,
  type WaitlistFieldErrors,
  type WaitlistFormValues,
} from '@/lib/waitlist-client';

/**
 * Add-party form for the waitlist (plan screen 23, "Form labels" a11y).
 *
 * Four Field primitives — name, party size, phone, notes — following the
 * M6/M7 GroupForm shape: validation runs on submit against the server's
 * add-party rules (non-empty name, integer party size >= 1) and surfaces
 * through Field's role="alert" wiring; on open, focus moves to the name
 * input. Phone and notes are optional; both trim to null in the payload.
 * This screen only adds parties (plan: POST /api/waitlist) — position
 * moves and status changes happen from the list, not an edit form.
 */

export interface WaitlistFormProps {
  /** True while the create request is in flight. */
  busy?: boolean;
  /** Inline submit error from the API (role="alert"). */
  error?: string | null;
  onSubmit: (values: WaitlistFormValues) => void;
  onCancel: () => void;
}

function defaultValues(): WaitlistFormValues {
  return { name: '', partySize: '', phone: '', notes: '' };
}

export function WaitlistForm({ busy = false, error = null, onSubmit, onCancel }: WaitlistFormProps) {
  const [values, setValues] = useState<WaitlistFormValues>(defaultValues());
  const [errors, setErrors] = useState<WaitlistFieldErrors>({});
  const formRef = useRef<HTMLFormElement>(null);

  // Land keyboard focus on the name input when the form opens.
  useEffect(() => {
    formRef.current?.querySelector<HTMLInputElement>('input')?.focus();
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateWaitlistForm(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    onSubmit(values);
  }

  return (
    <form
      ref={formRef}
      aria-labelledby="waitlist-form-heading"
      onSubmit={handleSubmit}
      className="grid gap-4"
    >
      <Card>
        <h2 id="waitlist-form-heading" className="text-lg font-semibold text-foreground">
          Add party
        </h2>

        <div className="mt-4 grid gap-4">
          {error ? <Alert variant="error">{error}</Alert> : null}

          <Field
            id="waitlist-name"
            label="Name"
            value={values.name}
            error={errors.name}
            placeholder="Alex Kim"
            onChange={(event) => setValues((previous) => ({ ...previous, name: event.target.value }))}
          />

          <Field
            id="waitlist-party-size"
            label="Party size"
            type="number"
            min={1}
            inputMode="numeric"
            value={values.partySize}
            error={errors.partySize}
            placeholder="4"
            onChange={(event) =>
              setValues((previous) => ({ ...previous, partySize: event.target.value }))
            }
          />

          <Field
            id="waitlist-phone"
            label="Phone"
            type="tel"
            value={values.phone}
            placeholder="Optional"
            onChange={(event) =>
              setValues((previous) => ({ ...previous, phone: event.target.value }))
            }
          />

          <Field
            id="waitlist-notes"
            label="Notes"
            value={values.notes}
            placeholder="Optional"
            onChange={(event) =>
              setValues((previous) => ({ ...previous, notes: event.target.value }))
            }
          />

          <div className="flex flex-wrap gap-3">
            <Button type="submit" loading={busy}>
              Add party
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      </Card>
    </form>
  );
}
