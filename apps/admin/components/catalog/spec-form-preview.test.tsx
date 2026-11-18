import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { TemplateField } from '@mpm/shared-types';
import { SpecFormPreview } from './spec-form-preview';

afterEach(cleanup);

function field(over: Partial<TemplateField> & Pick<TemplateField, 'id' | 'key' | 'label' | 'type'>): TemplateField {
  return {
    categoryId: 'c1', helpText: null, appliesTo: 'both', unit: null, min: null, max: null, required: false, filterable: false,
    highlightRank: null, sortOrder: 0, status: 'active', options: [], ...over,
  };
}

const fields: TemplateField[] = [
  field({ id: 'f1', key: 'heads', label: 'Number of heads', type: 'number', appliesTo: 'machines', highlightRank: 2 }),
  field({ id: 'f2', key: 'hook_size', label: 'Hook size', type: 'number', unit: 'mm', appliesTo: 'parts', required: true, highlightRank: 1 }),
  field({
    id: 'f3', key: 'hook_type', label: 'Hook type', type: 'single_select', highlightRank: 5,
    options: [
      { id: 'o1', key: 'rotary', label: 'Rotary', sortOrder: 0, status: 'active' },
      { id: 'o2', key: 'oscillating', label: 'Oscillating', sortOrder: 1, status: 'retired' },
    ],
  }),
  field({ id: 'f4', key: 'old', label: 'Old field', type: 'text', status: 'retired' }),
];

const block = (label: string) => screen.getByText(label).closest('[data-preview-field]') as HTMLElement;

describe('SpecFormPreview', () => {
  it("kind 'part' renders parts and both fields, not machines-only ones", () => {
    render(<SpecFormPreview fields={fields} kind="part" />);
    expect(screen.getByText('Hook size')).not.toBeNull();
    expect(screen.getByText('Hook type')).not.toBeNull();
    expect(screen.queryByText('Number of heads')).toBeNull();
  });

  it("kind 'machine' renders machines and both fields, not parts-only ones", () => {
    render(<SpecFormPreview fields={fields} kind="machine" />);
    expect(screen.getByText('Number of heads')).not.toBeNull();
    expect(screen.getByText('Hook type')).not.toBeNull();
    expect(screen.queryByText('Hook size')).toBeNull();
  });

  it('marks a required field with *, and shows a number field with its unit', () => {
    render(<SpecFormPreview fields={fields} kind="part" />);
    const size = block('Hook size');
    expect(within(size).getByText('*')).not.toBeNull();
    expect(within(size).getByText('mm')).not.toBeNull();
    expect((within(size).getByRole('spinbutton') as HTMLInputElement).disabled).toBe(true);
    expect(within(block('Hook type')).queryByText('*')).toBeNull();
  });

  it('tags rank 1 "On card", not rank 5', () => {
    render(<SpecFormPreview fields={fields} kind="part" />);
    expect(within(block('Hook size')).getByText('On card')).not.toBeNull();
    expect(within(block('Hook type')).queryByText('On card')).toBeNull();
  });

  it('hides retired options and retired fields', () => {
    render(<SpecFormPreview fields={fields} kind="part" />);
    expect(within(block('Hook type')).getByText('Rotary')).not.toBeNull();
    expect(within(block('Hook type')).queryByText('Oscillating')).toBeNull();
    expect(screen.queryByText('Old field')).toBeNull();
  });

  it('hides the required mark on a select with no active options', () => {
    render(
      <SpecFormPreview
        kind="part"
        fields={[field({ id: 'f5', key: 'finish', label: 'Finish', type: 'single_select', required: true })]}
      />,
    );
    expect(within(block('Finish')).queryByText('*')).toBeNull();
  });

  it('says so when there is nothing to fill in for the kind', () => {
    render(<SpecFormPreview fields={[fields[0]]} kind="part" />);
    expect(screen.getByText(/no fields/i)).not.toBeNull();
  });
});
