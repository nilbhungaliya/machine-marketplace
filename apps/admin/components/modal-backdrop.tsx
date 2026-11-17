'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * The dimmed layer behind a popup. Mounted on <body> so no page wrapper can
 * offset it, and the dim runs 6rem past the top and bottom: when the page is
 * pulled down (a scroll bounce, Chrome's full-screen toolbar sliding in) the
 * band that opens up is still dimmed instead of a white strip. The page behind
 * does not scroll while it is open. The child must be `relative` to sit above
 * the dim.
 */
// One lock shared by every open backdrop: the first saves the page's own
// overflow, the last to close puts it back, whatever order they close in.
let locks = 0;
let savedOverflow = '';

function lockScroll() {
  if (locks++ === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
}

function unlockScroll() {
  if (locks === 0) return;
  if (--locks === 0) document.body.style.overflow = savedOverflow;
}

export default function ModalBackdrop({ onClose, className = 'bg-gray-900/40', position = 'center', children }: {
  onClose?: () => void;
  className?: string;
  /** 'top': the popup sits near the top of the screen, e.g. the search palette. */
  position?: 'center' | 'top';
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    lockScroll();
    return unlockScroll;
  }, []);

  if (!mounted) return null;
  return createPortal(
    <div className={`fixed inset-0 z-50 flex justify-center p-4 ${position === 'top' ? 'items-start pt-[12vh]' : 'items-center'}`}>
      <div aria-hidden className={`fixed inset-x-0 -inset-y-24 ${className}`} onClick={onClose} />
      {children}
    </div>,
    document.body,
  );
}
