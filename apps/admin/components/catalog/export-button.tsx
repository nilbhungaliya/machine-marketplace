'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { downloadExport, type ExportSheet } from '@/lib/catalog-api';

/** Downloads one catalogue CSV sheet (A4 export). */
export function ExportButton({ sheet, label }: { sheet: ExportSheet; label: string }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await downloadExport(sheet);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="secondary" loading={busy} onClick={() => void run()}>
      {!busy && <Download size={15} />} {label}
    </Button>
  );
}
