import { useRef, useState, type FormEvent } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import {
  SETTINGS_READ_ONLY_MESSAGE,
  validateSettingsForm,
  type SettingsFieldErrors,
  type SettingsFormValues,
} from '@/lib/settings-client';

/**
 * Restaurant settings surface (plan screen 29, "Form labels" a11y).
 *
 * Name and timezone are Field primitives validated on submit against the
 * client mirror of the settings rules (non-empty name, IANA timezone via
 * booking's isValidTimeZone); errors surface through Field's role="alert"
 * wiring. The slug is displayed in a permanently read-only Field (slug is
 * never editable per decision), and operating hours link out to
 * /staff/hours (screen 28) because they are edited there.
 *
 * Unlike the GroupForm/WaitlistForm editors, this form is always mounted,
 * so there is no open transition to move focus into — focus stays where
 * the user put it. In read-only state (staff role, or a write returned
 * 403) the fields render read-only with the banner and the Save/Cancel
 * controls disappear; Cancel resets any unsaved edits back to the values
 * the form was last (re)mounted with.
 */

export interface SettingsFormProps {
  slug: string;
  /** Current stored values; the parent keys remounts after a save. */
  initialValues: SettingsFormValues;
  /** Hides the save affordances and locks the fields (403/staff role). */
  readOnly?: boolean;
  /** True while the save request is in flight. */
  busy?: boolean;
  /** Inline submit error from the API (role="alert"). */
  error?: string | null;
  onSubmit: (values: SettingsFormValues) => void;
  onCancel: () => void;
}

export function SettingsForm({
  slug,
  initialValues,
  readOnly = false,
  busy = false,
  error = null,
  onSubmit,
  onCancel,
}: SettingsFormProps) {
  const [values, setValues] = useState<SettingsFormValues>(initialValues);
  const [errors, setErrors] = useState<SettingsFieldErrors>({});
  const initialRef = useRef(initialValues);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateSettingsForm(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    onSubmit(values);
  }

  function handleCancel() {
    setErrors({});
    setValues(initialRef.current);
    onCancel();
  }

  return (
    <form
      aria-labelledby="settings-form-heading"
      onSubmit={handleSubmit}
      className="grid gap-4"
    >
      <Card>
        <h2 id="settings-form-heading" className="text-lg font-semibold text-foreground">
          Restaurant details
        </h2>

        <div className="mt-4 grid gap-4">
          {readOnly ? <Alert variant="info">{SETTINGS_READ_ONLY_MESSAGE}</Alert> : null}
          {error ? <Alert variant="error">{error}</Alert> : null}

          <Field
            id="settings-name"
            label="Name"
            value={values.name}
            error={errors.name}
            readOnly={readOnly}
            onChange={(event) =>
              setValues((previous) => ({ ...previous, name: event.target.value }))
            }
          />

          <Field
            id="settings-timezone"
            label="Timezone"
            value={values.timezone}
            error={errors.timezone}
            readOnly={readOnly}
            placeholder="America/New_York"
            onChange={(event) =>
              setValues((previous) => ({ ...previous, timezone: event.target.value }))
            }
          />

          <Field id="settings-slug" label="Slug" value={slug} readOnly />

          <p className="text-sm text-foreground-muted">
            Operating hours are managed separately —{' '}
            <a
              href="/staff/hours"
              className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
            >
              Manage operating hours
            </a>
          </p>

          {!readOnly ? (
            <div className="flex flex-wrap gap-3">
              <Button type="submit" loading={busy}>
                Save settings
              </Button>
              <Button type="button" variant="secondary" disabled={busy} onClick={handleCancel}>
                Cancel
              </Button>
            </div>
          ) : null}
        </div>
      </Card>
    </form>
  );
}
