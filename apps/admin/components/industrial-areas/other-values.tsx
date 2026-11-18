'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import DataTable, { type Column } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { FormDialog } from '@/components/ui/form-dialog';
import { ApiError } from '@/lib/api';
import { adoptOtherValue, titleCase, type OtherValue } from '@/lib/industrial-areas-api';
import { inputCls } from '@/components/ui/field-classes';

const schema = z.object({ name: z.string().trim().min(2, 'At least 2 characters').max(80, 'At most 80 characters') });

const businesses = (n: number) => `${n} ${n === 1 ? 'business' : 'businesses'}`;

/**
 * "Typed as Other" (F1 spec §4.3): the industrial-area texts businesses typed, by their pincode's district and state.
 * Add to list creates the area there and links every business that typed the text (one transaction on the API).
 */
export function OtherValues({ rows, onAdopted }: { rows: OtherValue[]; onAdopted: () => void }) {
  const [adopting, setAdopting] = useState<OtherValue | null>(null);

  const columns: Column<OtherValue>[] = [
    { key: 'text', header: 'Typed', render: (r) => <span className="font-semibold text-gray-900">{r.text}</span> },
    { key: 'district', header: 'District', render: (r) => r.district || '—' },
    { key: 'state', header: 'State', render: (r) => r.state || '—' },
    { key: 'count', header: 'Businesses', className: 'tnum', render: (r) => r.count },
    {
      key: 'actions',
      header: '',
      className: 'w-1 text-right',
      render: (r) => r.adoptable ? (
        <Button size="sm" variant="secondary" onClick={() => setAdopting(r)}><Plus size={13} aria-hidden /> Add to list</Button>
      ) : (
        <span className="text-[13px] text-gray-500">Unknown pincode — can&apos;t be linked</span>
      ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        data={rows.map((r) => ({ ...r, id: `${r.text}|${r.district}|${r.state}` }))}
        emptyMessage="Nobody has typed an area of their own"
      />
      {adopting && <AdoptDialog value={adopting} onClose={() => setAdopting(null)} onAdopted={onAdopted} />}
    </>
  );
}

function AdoptDialog({ value, onClose, onAdopted }: { value: OtherValue; onClose: () => void; onAdopted: () => void }) {
  const { register, handleSubmit, setError, formState: { errors, isSubmitting, isDirty } } = useForm<{ name: string }>({
    resolver: zodResolver(schema),
    defaultValues: { name: titleCase(value.text) },
  });

  const save = async ({ name }: { name: string }) => {
    try {
      const { linked } = await adoptOtherValue({ text: value.text, district: value.district, state: value.state, name: name.trim() });
      toast.success(`Added and linked ${businesses(linked)}`);
      onAdopted();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NAME_TAKEN') setError('name', { message: 'This city already has an area with that name' });
      else toast.error(err instanceof Error ? err.message : 'Could not add the area');
    }
  };

  return (
    <FormDialog
      open
      onClose={onClose}
      title="Add to the list"
      description={`Creates the area in ${value.district}, ${value.state} and links the ${businesses(value.count)} that typed “${value.text}” there.`}
      dirty={isDirty}
      submitting={isSubmitting}
      submitLabel="Add to list"
      onSubmit={handleSubmit(save)}
    >
      <label htmlFor="adopt-name" className="mb-1.5 block text-[12.5px] font-bold text-gray-600">Area name</label>
      <input id="adopt-name" className={inputCls} autoComplete="off" {...register('name')} />
      {errors.name
        ? <p className="mt-1 text-xs font-semibold text-red-600">{errors.name.message}</p>
        : <p className="mt-1 text-[12.5px] text-gray-500">As the app shows it in the picker.</p>}
    </FormDialog>
  );
}
