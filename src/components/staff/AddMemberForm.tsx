import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import {
  TEAM_ROLES,
  validateInviteForm,
  type InviteFieldErrors,
  type InviteFormValues,
  type TeamMember,
} from '@/lib/team-client';

/**
 * Invite form for the team screen (plan screen 30, "Form labels" a11y).
 *
 * Email uses the M6/M7 Field primitive; role uses a native <select>
 * labelled through Field's exact markup (no Select primitive exists in
 * the ui kit) with the ('owner', 'manager', 'staff') options. Validation
 * runs on submit against the invite rules mirrored in team-client
 * (valid email, known role, not already on the team) and surfaces through
 * the same role="alert" wiring. On open, focus lands on the email input —
 * the form opens behind an "Invite member" button, like WaitlistForm.
 */

export interface AddMemberFormProps {
  /** Members already on the team — duplicates are rejected inline. */
  members: TeamMember[];
  /** True while the invite request is in flight. */
  busy?: boolean;
  /** Inline submit error from the API (role="alert"). */
  error?: string | null;
  onSubmit: (values: InviteFormValues) => void;
  onCancel: () => void;
}

function defaultValues(): InviteFormValues {
  return { email: '', role: 'staff' };
}

export function AddMemberForm({
  members,
  busy = false,
  error = null,
  onSubmit,
  onCancel,
}: AddMemberFormProps) {
  const [values, setValues] = useState<InviteFormValues>(defaultValues());
  const [errors, setErrors] = useState<InviteFieldErrors>({});
  const formRef = useRef<HTMLFormElement>(null);

  // Land keyboard focus on the email input when the form opens.
  useEffect(() => {
    formRef.current?.querySelector<HTMLInputElement>('input')?.focus();
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateInviteForm(values, members);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    onSubmit(values);
  }

  return (
    <form
      ref={formRef}
      aria-labelledby="invite-form-heading"
      onSubmit={handleSubmit}
      className="grid gap-4"
    >
      <Card>
        <h2 id="invite-form-heading" className="text-lg font-semibold text-foreground">
          Invite member
        </h2>

        <div className="mt-4 grid gap-4">
          {error ? <Alert variant="error">{error}</Alert> : null}

          <Field
            id="team-invite-email"
            label="Email"
            type="email"
            value={values.email}
            error={errors.email}
            placeholder="sam@example.com"
            onChange={(event) =>
              setValues((previous) => ({ ...previous, email: event.target.value }))
            }
          />

          <div className="grid gap-1.5">
            <label
              htmlFor="team-invite-role"
              className="text-sm font-medium text-foreground"
            >
              Role
            </label>
            <select
              id="team-invite-role"
              value={values.role}
              aria-invalid={errors.role ? true : undefined}
              aria-describedby={errors.role ? 'team-invite-role-error' : undefined}
              onChange={(event) =>
                setValues((previous) => ({ ...previous, role: event.target.value }))
              }
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
            >
              {TEAM_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            {errors.role ? (
              <p id="team-invite-role-error" role="alert" className="text-sm text-danger">
                {errors.role}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-3">
            <Button type="submit" loading={busy}>
              Send invite
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
