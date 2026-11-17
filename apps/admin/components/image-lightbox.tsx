'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronLeft, ChevronRight, RotateCw, X, ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import { useDialogLayer } from '@/components/ui/dialog';

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const BUTTON_FACTOR = 1.5;

type Point = { x: number; y: number };

const clamp = (n: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, n));

/**
 * In-page photo viewer: wheel / pinch / double-click zoom toward the pointer,
 * drag to pan, arrows or ←/→ to step through the set, Esc to close.
 */
export default function ImageLightbox({ urls, index, onIndex, onClose, label }: {
  urls: string[];
  /** Index into `urls`; null when closed. */
  index: number | null;
  onIndex: (index: number) => void;
  onClose: () => void;
  label?: string;
}) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [broken, setBroken] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const drag = useRef<{ start: Point; origin: Point; moved: boolean } | null>(null);
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  // Mirrors of state so the native wheel listener never reads stale values.
  const view = useRef({ scale: 1, offset: { x: 0, y: 0 } });
  view.current = { scale, offset };

  const open = index !== null && index >= 0 && index < urls.length;
  const url = open ? urls[index] : null;
  const panel = useRef<HTMLDivElement | null>(null);
  // On the dialog stack: Escape closes only the top layer, and ⌘K stays out.
  useDialogLayer(open, panel, onClose);

  const reset = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    reset();
    setRotation(0);
    setBroken(false);
  }, [index, reset]);

  /** Zoom to `next`, keeping the image point under `at` (stage-centre coords) fixed. */
  const zoomTo = useCallback((next: number, at: Point = { x: 0, y: 0 }) => {
    const { scale: s, offset: o } = view.current;
    const target = clamp(next);
    if (target === MIN_SCALE) {
      reset();
      return;
    }
    const k = target / s;
    setScale(target);
    setOffset({ x: at.x - (at.x - o.x) * k, y: at.y - (at.y - o.y) * k });
  }, [reset]);

  const toStage = useCallback((clientX: number, clientY: number): Point => {
    const r = stageRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: clientX - r.left - r.width / 2, y: clientY - r.top - r.height / 2 };
  }, []);

  const step = useCallback((delta: number) => {
    if (index === null) return;
    const next = index + delta;
    if (next >= 0 && next < urls.length) onIndex(next);
  }, [index, urls.length, onIndex]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === '+' || e.key === '=') zoomTo(view.current.scale * BUTTON_FACTOR);
      if (e.key === '-') zoomTo(view.current.scale / BUTTON_FACTOR);
      if (e.key === '0') reset();
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, step, zoomTo, reset]);

  // React's onWheel is passive, so it cannot stop the page scrolling.
  useEffect(() => {
    const el = stageRef.current;
    if (!open || !el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomTo(view.current.scale * Math.exp(-e.deltaY * 0.002), toStage(e.clientX, e.clientY));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [open, zoomTo, toStage]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values());
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: view.current.scale };
      drag.current = null;
    } else {
      drag.current = { start: { x: e.clientX, y: e.clientY }, origin: view.current.offset, moved: false };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values());
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      zoomTo(pinch.current.scale * (dist / pinch.current.dist), toStage((a.x + b.x) / 2, (a.y + b.y) / 2));
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.start.x;
    const dy = e.clientY - d.start.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (view.current.scale > 1) setOffset({ x: d.origin.x + dx, y: d.origin.y + dy });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const d = drag.current;
    drag.current = null;
    // A plain click on the dark area (not the photo) closes, like the backdrop.
    if (d && !d.moved && e.target === e.currentTarget && view.current.scale === 1) onClose();
  };

  if (!open || !url) return null;

  const btn = 'rounded-lg p-2 hover:bg-white/10 disabled:opacity-40';

  return (
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-label={label ?? 'Photo'}
      tabIndex={-1}
      data-arrows="native"
      className="fixed inset-0 z-50 flex flex-col outline-none"
      style={{ backgroundColor: 'rgba(0,0,0,0.9)' }}
    >
      <div className="flex items-center gap-3 px-4 py-3 text-white" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}>
        <p className="min-w-0 truncate text-sm font-semibold">
          {label ? `${label} · ` : ''}{index + 1} of {urls.length}
        </p>
        <div className="ml-auto flex items-center gap-1">
          <button className={btn} onClick={() => zoomTo(scale / BUTTON_FACTOR)} disabled={scale <= MIN_SCALE} title="Zoom out (−)">
            <ZoomOut size={18} />
          </button>
          <span className="w-12 text-center text-xs tabular-nums" style={{ color: 'rgba(255,255,255,0.7)' }}>
            {Math.round(scale * 100)}%
          </span>
          <button className={btn} onClick={() => zoomTo(scale * BUTTON_FACTOR)} disabled={scale >= MAX_SCALE} title="Zoom in (+)">
            <ZoomIn size={18} />
          </button>
          <button className={btn} onClick={reset} disabled={scale === 1} title="Fit to screen (0)">
            <Maximize size={18} />
          </button>
          <button className={btn} onClick={() => setRotation((r) => (r + 90) % 360)} title="Rotate">
            <RotateCw size={18} />
          </button>
          <button className={btn} onClick={onClose} title="Close (Esc)">
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <div
          ref={stageRef}
          className="absolute inset-0 flex touch-none select-none items-center justify-center p-4"
          style={{ cursor: scale > 1 ? (drag.current ? 'grabbing' : 'grab') : 'zoom-in' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={(e) => (scale > 1 ? reset() : zoomTo(2.5, toStage(e.clientX, e.clientY)))}
        >
          {broken ? (
            <p className="max-w-sm text-center text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
              This photo could not be loaded.
            </p>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={label ?? 'photo'}
              draggable={false}
              onError={() => setBroken(true)}
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale}) rotate(${rotation}deg)`,
                transition: drag.current || pinch.current ? 'none' : 'transform 120ms ease-out',
              }}
              className="max-h-full max-w-full object-contain"
            />
          )}
        </div>

        {urls.length > 1 && (
          <>
            <button
              className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white hover:bg-black/80 disabled:opacity-30"
              onClick={() => step(-1)}
              disabled={index === 0}
              title="Previous (←)"
            >
              <ChevronLeft size={22} />
            </button>
            <button
              className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white hover:bg-black/80 disabled:opacity-30"
              onClick={() => step(1)}
              disabled={index === urls.length - 1}
              title="Next (→)"
            >
              <ChevronRight size={22} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
