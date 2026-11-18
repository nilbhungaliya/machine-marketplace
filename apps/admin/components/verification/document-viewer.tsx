'use client';

import { useState } from 'react';
import { FileText, Image as ImageIcon, Loader2 } from 'lucide-react';
import type { AdminGstReviewDocument } from '@mpm/shared-types';
import ImageLightbox from '@/components/image-lightbox';
import {
  DOCUMENT_TYPE_LABELS, STORAGE_UNAVAILABLE_MESSAGE, explainVerificationError, fetchDocumentUrl,
} from '@/lib/verification-api';

/**
 * A review's documents. Each link is asked for on the officer's click (a 300-second link, audit-logged), never on
 * load: images open in the lightbox, PDFs in a new tab.
 */
export function DocumentViewer({ proofId, documents, storageAvailable }: {
  proofId: string;
  documents: AdminGstReviewDocument[];
  storageAvailable: boolean;
}) {
  const [opening, setOpening] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [image, setImage] = useState<{ url: string; label: string } | null>(null);

  const open = async (doc: AdminGstReviewDocument) => {
    setError(null);
    setOpening(doc.index);
    // Opened now, inside the click, so the browser doesn't block it as a pop-up; pointed at the link once it arrives.
    const tab = doc.format === 'pdf' ? window.open('about:blank', '_blank') : null;
    if (tab) tab.opener = null;
    try {
      const { url } = await fetchDocumentUrl(proofId, doc.index);
      if (doc.format !== 'pdf') setImage({ url, label: DOCUMENT_TYPE_LABELS[doc.type] });
      else if (tab) tab.location.href = url;
      else window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      tab?.close();
      setError(explainVerificationError(err, 'Could not open the document'));
    } finally {
      setOpening(null);
    }
  };

  if (documents.length === 0) return <p className="text-sm text-gray-500">No documents.</p>;

  return (
    <div className="space-y-2">
      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
        {documents.map((doc) => {
          const Icon = doc.format === 'pdf' ? FileText : ImageIcon;
          return (
            <li key={doc.index} className="flex items-center gap-2 px-3 py-2 text-sm">
              <button
                type="button"
                disabled={!storageAvailable || opening !== null}
                onClick={() => void open(doc)}
                className="inline-flex min-w-0 items-center gap-2 font-medium text-brand-700 hover:underline disabled:cursor-not-allowed disabled:text-gray-500 disabled:no-underline"
              >
                {opening === doc.index
                  ? <Loader2 size={15} aria-hidden className="shrink-0 animate-spin" />
                  : <Icon size={15} aria-hidden className="shrink-0" />}
                <span className="truncate">{DOCUMENT_TYPE_LABELS[doc.type]}</span>
              </button>
              <span className="ml-auto text-xs uppercase text-gray-500">{doc.format}</span>
            </li>
          );
        })}
      </ul>
      {!storageAvailable ? (
        <p className="text-[13px] text-amber-800">{STORAGE_UNAVAILABLE_MESSAGE}. The files can be opened once it is.</p>
      ) : error ? (
        <p role="alert" className="text-[13px] text-red-700">{error}</p>
      ) : (
        <p className="text-[13px] text-gray-500">Each opening is logged. Links last 5 minutes.</p>
      )}
      <ImageLightbox
        urls={image ? [image.url] : []}
        index={image ? 0 : null}
        onIndex={() => {}}
        onClose={() => setImage(null)}
        label={image?.label}
      />
    </div>
  );
}
