'use client';

import { useState, type KeyboardEvent } from 'react';
import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { CATALOG_KEY_REGEX, type FieldOption, type TemplateField } from '@mpm/shared-types';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { createOption, reorderOptions, updateOption } from '@/lib/catalog-api';
import { cn } from '@/lib/utils';
import { KEY_MESSAGE, toCatalogKey } from '@/lib/catalog-key';

const inputCls = 'w-full rounded-lg border-gray-300 text-sm';

/** Enter here acts on this row; it must not submit the field form around it. */
function onEnter(run: () => void) {
  return (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    run();
  };
}

/**
 * A select field's options, inside the field's edit dialog. Every change is saved at once
 * (not with the dialog's Save). Options are never deleted, only retired.
 */
export function OptionsEditor({ field, onChanged }: {
  field: TemplateField;
  /**
   * Reloads the field after a saved change, or after STALE_ORDER. The editor stays disabled
   * until it resolves, so the next move starts from the order the server has.
   */
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newKey, setNewKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const options = field.options;

  const run = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      try {
        await work();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not save the option');
        // Only a stale list needs the reload; any other failure changed nothing.
        if (err instanceof ApiError && err.code === 'STALE_ORDER') await onChanged();
        return false;
      }
      if (done) toast.success(done);
      await onChanged();
      return true;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const label = newLabel.trim();
    if (!label) { setProblem('Enter a label'); return; }
    if (!CATALOG_KEY_REGEX.test(newKey)) { setProblem(KEY_MESSAGE); return; }
    setProblem(null);
    setBusy(true);
    try {
      await createOption(field.id, { key: newKey, label });
      setNewLabel('');
      setNewKey('');
      setKeyTouched(false);
      await onChanged();
    } catch (err) {
      setProblem(err instanceof ApiError && err.code === 'KEY_TAKEN'
        ? 'This field already has an option with that key'
        : err instanceof Error ? err.message : 'Could not add the option');
    } finally {
      setBusy(false);
    }
  };

  const move = (index: number, delta: -1 | 1) => {
    const ids = options.map((o) => o.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    void run(() => reorderOptions(field.id, ids));
  };

  return (
    <section data-enter="ignore" aria-label="Options" className="rounded-[10px] border border-gray-200">
      <h3 className="border-b border-gray-200 px-4 py-2.5 text-[15px] font-bold text-gray-900">
        Options <span className="text-[13px] font-normal text-gray-500">· saved as you go</span>
      </h3>
      {options.length === 0 ? (
        <p className="px-4 py-3 text-sm text-gray-500">No options yet.</p>
      ) : (
        <ul className="divide-y divide-gray-200">
          {options.map((o, i) => (
            <OptionRow
              // A fresh row when the saved label changes, so the draft starts from it.
              key={`${o.id}:${o.label}`}
              option={o}
              busy={busy}
              first={i === 0}
              last={i === options.length - 1}
              onRename={(label) => run(() => updateOption(o.id, { label }), 'Option renamed')}
              onToggle={() => run(
                () => updateOption(o.id, { status: o.status === 'active' ? 'retired' : 'active' }),
                o.status === 'active' ? 'Option retired' : 'Option reactivated',
              )}
              onMove={(d) => move(i, d)}
            />
          ))}
        </ul>
      )}
      <div className="flex items-start gap-2 border-t border-gray-200 px-4 py-3">
        <input
          aria-label="New option label"
          placeholder="Label"
          className={inputCls}
          value={newLabel}
          onChange={(e) => {
            setNewLabel(e.target.value);
            if (!keyTouched) setNewKey(toCatalogKey(e.target.value));
          }}
          onKeyDown={onEnter(() => void add())}
        />
        <input
          aria-label="New option key"
          placeholder="key"
          className={cn(inputCls, 'font-mono')}
          spellCheck={false}
          value={newKey}
          onChange={(e) => { setNewKey(e.target.value); setKeyTouched(true); }}
          onKeyDown={onEnter(() => void add())}
        />
        <Button variant="secondary" onClick={() => void add()} disabled={busy}><Plus size={14} /> Add</Button>
      </div>
      {problem && <p className="px-4 pb-3 text-xs text-red-700">{problem}</p>}
    </section>
  );
}

function OptionRow({ option: o, busy, first, last, onRename, onToggle, onMove }: {
  option: FieldOption;
  busy: boolean;
  first: boolean;
  last: boolean;
  onRename: (label: string) => Promise<boolean>;
  onToggle: () => void;
  onMove: (delta: -1 | 1) => void;
}) {
  const [draft, setDraft] = useState(o.label);
  const retired = o.status === 'retired';
  const commit = () => {
    const label = draft.trim();
    if (!label) { setDraft(o.label); return; }
    if (label !== o.label) void onRename(label);
  };

  return (
    <li className={cn('flex items-center gap-2 px-2.5 py-1.5', retired && 'bg-gray-50')}>
      <input
        aria-label={`Label of ${o.key}`}
        className={cn(inputCls, 'h-8', retired && 'text-gray-500')}
        value={draft}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onEnter(commit)}
      />
      <code className="w-36 shrink-0 truncate font-mono text-xs text-gray-500" title={o.key}>{o.key}</code>
      {retired && <span className="inline-flex h-6 items-center rounded-full bg-gray-100 px-[9px] text-[13px] font-semibold text-gray-500">Retired</span>}
      <Button variant="ghost" size="sm" disabled={busy} onClick={onToggle}>{retired ? 'Reactivate' : 'Retire'}</Button>
      <button type="button" aria-label={`Move ${o.label} up`} disabled={busy || first} onClick={() => onMove(-1)}
        className={cn('rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-40', first && 'invisible')}>
        <ArrowUp size={13} />
      </button>
      <button type="button" aria-label={`Move ${o.label} down`} disabled={busy || last} onClick={() => onMove(1)}
        className={cn('rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-40', last && 'invisible')}>
        <ArrowDown size={13} />
      </button>
    </li>
  );
}
