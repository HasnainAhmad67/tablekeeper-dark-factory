import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import {
  TABLE_SHAPES,
  validateTableForm,
  type TableFieldErrors,
  type TableFormValues,
  type TableSection,
} from '@/lib/tables-client';

/**
 * Create/edit form for one table (plan screen 25, "Form labels" a11y).
 *
 * Field primitives cover the input-based fields (label, capacity, geometry);
 * shape is a native radio group in a fieldset/legend and section is a
 * labelled native select — per plan decision, no bespoke form controls.
 * Validation runs on submit against the same rules as the server, surfacing
 * errors through Field's role="alert" wiring; on open, focus moves to the
 * first input so keyboard users land in the form.
 *
 * Geometry inputs are optional: blank means "use the default on create,
 * keep the stored value on edit" (see toTablePayload).
 */

export interface TableFormProps {
  mode: 'create' | 'edit';
  sections: TableSection[];
  /** Existing row being edited (edit mode); omitted for create. */
  initialValues?: TableFormValues;
  /** True while the create/update request is in flight. */
  busy?: boolean;
  /** Inline submit error from the API (role="alert"). */
  error?: string | null;
  onSubmit: (values: TableFormValues) => void;
  onCancel: () => void;
}

function defaultValues(): TableFormValues {
  return {
    label: '',
    capacity: '',
    sectionId: '',
    shape: 'round',
    positionX: '',
    positionY: '',
    width: '',
    depth: '',
  };
}

export function TableForm({
  mode,
  sections,
  initialValues,
  busy = false,
  error = null,
  onSubmit,
  onCancel,
}: TableFormProps) {
  const [values, setValues] = useState<TableFormValues>(initialValues ?? defaultValues());
  const [errors, setErrors] = useState<TableFieldErrors>({});
  const formRef = useRef<HTMLFormElement>(null);

  // Land keyboard focus on the first control when the form opens.
  useEffect(() => {
    formRef.current
      ?.querySelector<HTMLInputElement | HTMLSelectElement>('input, select')
      ?.focus();
  }, []);

  function update<K extends keyof TableFormValues>(key: K, value: TableFormValues[K]) {
    setValues((previous) => ({ ...previous, [key]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateTableForm(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    onSubmit(values);
  }

  const headingId = `table-form-heading-${mode}`;

  return (
    <form
      ref={formRef}
      aria-labelledby={headingId}
      onSubmit={handleSubmit}
      className="grid gap-4 rounded-lg border border-border bg-surface p-4"
    >
      <h2 id={headingId} className="text-lg font-semibold text-foreground">
        {mode === 'create' ? 'Add table' : 'Edit table'}
      </h2>

      {error ? <Alert variant="error">{error}</Alert> : null}

      <Field
        id="table-label"
        label="Label"
        value={values.label}
        error={errors.label}
        autoComplete="off"
        onChange={(event) => update('label', event.target.value)}
      />

      <Field
        id="table-capacity"
        label="Capacity"
        type="number"
        inputMode="numeric"
        value={values.capacity}
        error={errors.capacity}
        onChange={(event) => update('capacity', event.target.value)}
      />

      <div className="grid gap-1.5">
        <label htmlFor="table-section" className="text-sm font-medium text-foreground">
          Section
        </label>
        <select
          id="table-section"
          value={values.sectionId}
          onChange={(event) => update('sectionId', event.target.value)}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
        >
          <option value="">No section</option>
          {sections.map((section) => (
            <option key={section.id} value={section.id}>
              {section.name}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="min-w-0 border-0 p-0">
        <legend className="text-sm font-medium text-foreground">Shape</legend>
        <div className="mt-1.5 flex flex-wrap gap-4">
          {TABLE_SHAPES.map((shape) => (
            <label key={shape} className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="radio"
                name="table-shape"
                value={shape}
                checked={values.shape === shape}
                onChange={() => update('shape', shape)}
                className="size-4 accent-primary"
              />
              {shape}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="min-w-0 border-0 p-0">
        <legend className="text-sm font-medium text-foreground">Position and size</legend>
        <div className="mt-1.5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            id="table-position-x"
            label="Position X"
            type="number"
            step="any"
            inputMode="decimal"
            value={values.positionX}
            error={errors.positionX}
            onChange={(event) => update('positionX', event.target.value)}
          />
          <Field
            id="table-position-y"
            label="Position Y"
            type="number"
            step="any"
            inputMode="decimal"
            value={values.positionY}
            error={errors.positionY}
            onChange={(event) => update('positionY', event.target.value)}
          />
          <Field
            id="table-width"
            label="Width"
            type="number"
            step="any"
            inputMode="decimal"
            value={values.width}
            error={errors.width}
            onChange={(event) => update('width', event.target.value)}
          />
          <Field
            id="table-depth"
            label="Depth"
            type="number"
            step="any"
            inputMode="decimal"
            value={values.depth}
            error={errors.depth}
            onChange={(event) => update('depth', event.target.value)}
          />
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={busy}>
          {mode === 'create' ? 'Create table' : 'Save changes'}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
