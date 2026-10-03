import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import {
  validateGroupForm,
  type GroupFieldErrors,
  type GroupFormValues,
} from '@/lib/groups-client';
import type { StaffTable } from '@/lib/tables-client';

/**
 * Create/edit form for one table group (plan screen 26, "Form labels" a11y).
 *
 * Name is a Field primitive; table assignment is a native checkbox list in
 * a fieldset/legend — per plan decision, no bespoke form controls. With no
 * tables in the restaurant the checklist degrades to a hint rather than an
 * empty box. Validation runs on submit against the server's rule (name
 * non-empty after trim) and surfaces through Field's role="alert" wiring;
 * on open, focus moves to the name input (TableForm pattern).
 *
 * `description` is not editable here (plan decision: name + table
 * assignment), and because PATCH only updates provided fields, editing a
 * group that has a description leaves it untouched.
 */

export interface GroupFormProps {
  mode: 'create' | 'edit';
  /** Restaurant tables offered for assignment. */
  tables: StaffTable[];
  /** Existing values being edited (edit mode); omitted for create. */
  initialValues?: GroupFormValues;
  /** True while the create/update request is in flight. */
  busy?: boolean;
  /** Inline submit error from the API (role="alert"). */
  error?: string | null;
  onSubmit: (values: GroupFormValues) => void;
  onCancel: () => void;
}

function defaultValues(): GroupFormValues {
  return { name: '', tableIds: [] };
}

export function GroupForm({
  mode,
  tables,
  initialValues,
  busy = false,
  error = null,
  onSubmit,
  onCancel,
}: GroupFormProps) {
  const [values, setValues] = useState<GroupFormValues>(initialValues ?? defaultValues());
  const [errors, setErrors] = useState<GroupFieldErrors>({});
  const formRef = useRef<HTMLFormElement>(null);

  // Land keyboard focus on the name input when the form opens.
  useEffect(() => {
    formRef.current?.querySelector<HTMLInputElement>('input')?.focus();
  }, []);

  function toggleTable(tableId: string, checked: boolean) {
    setValues((previous) => ({
      ...previous,
      tableIds: checked
        ? [...previous.tableIds, tableId]
        : previous.tableIds.filter((id) => id !== tableId),
    }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateGroupForm(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    onSubmit(values);
  }

  return (
    <form
      ref={formRef}
      aria-labelledby="group-form-heading"
      onSubmit={handleSubmit}
      className="grid gap-4"
    >
      <Card>
        <h2 id="group-form-heading" className="text-lg font-semibold text-foreground">
          {mode === 'create' ? 'Create group' : 'Edit group'}
        </h2>

        <div className="mt-4 grid gap-4">
          {error ? <Alert variant="error">{error}</Alert> : null}

          <Field
            id="group-name"
            label="Name"
            value={values.name}
            error={errors.name}
            placeholder="Section A"
            onChange={(event) => setValues((previous) => ({ ...previous, name: event.target.value }))}
          />

          <fieldset className="min-w-0 border-0 p-0">
            <legend className="text-sm font-medium text-foreground">Tables</legend>
            {tables.length === 0 ? (
              <p className="mt-1.5 text-sm text-foreground-muted">
                No tables available yet — add tables first to assign them.
              </p>
            ) : (
              <div className="mt-1.5 grid gap-2">
                {tables.map((table) => (
                  <label
                    key={table.id}
                    htmlFor={`group-table-${table.id}`}
                    className="flex items-center gap-2 text-sm text-foreground"
                  >
                    <input
                      type="checkbox"
                      id={`group-table-${table.id}`}
                      checked={values.tableIds.includes(table.id)}
                      onChange={(event) => toggleTable(table.id, event.target.checked)}
                      className="size-4 accent-primary"
                    />
                    {table.label}
                    <span className="text-foreground-muted">
                      &middot; {table.capacity} seats
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <div className="flex flex-wrap gap-3">
            <Button type="submit" loading={busy}>
              {mode === 'create' ? 'Create group' : 'Save changes'}
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
