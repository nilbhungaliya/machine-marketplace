import { ValidationError, type AnySchema } from 'yup';
import type { FormikErrors } from 'formik';

// Small Formik glue for the sell steps.

/** Next's check: counts a submit (so every error shows) and answers whether the form is valid. */
export async function formCheck<V>(form: {
  submitForm: () => Promise<unknown>;
  validateForm: () => Promise<FormikErrors<V>>;
}): Promise<boolean> {
  await form.submitForm();
  const errors = await form.validateForm();
  return Object.keys(errors).length === 0;
}

/** A template's Yup schema run on the spec values: `{ specs: { key: message } }`, or `{}` when valid. */
export function specErrors(schema: AnySchema, specs: unknown): { specs?: Record<string, string> } {
  try {
    schema.validateSync(specs, { abortEarly: false });
    return {};
  } catch (err) {
    if (!(err instanceof ValidationError)) return {};
    const out: Record<string, string> = {};
    for (const e of err.inner.length > 0 ? err.inner : [err]) {
      const key = (e.path ?? '').split(/[.[]/)[0];
      if (key && !out[key]) out[key] = e.message;
    }
    return Object.keys(out).length > 0 ? { specs: out } : {};
  }
}
