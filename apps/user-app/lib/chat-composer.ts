import { CHAT_LIMITS, type ListingDetail, type QuickEnquiry, type ThreadDetail } from '@mpm/shared-types';
import { newInstallId } from './install-id';
import { parseQuantity, type QuantityProblem } from './quantity';

/**
 * What the thread's composer and the Enquire sheet may send (F6 + F7 spec §6.3, §6.4, §6.8; textile
 * `lib/chat-composer.ts`). The API decides and enforces every rule; this only mirrors them so the screen says why
 * before a round trip. Pure.
 */

// ─── Composer ───

export type ComposerReasonKey =
  | 'chats.composer.viewer'
  | 'chats.composer.blockedByMe'
  | 'chats.composer.blockedMe'
  | 'chats.composer.readOnly';

/**
 * Whether the reader can write here, and the line shown instead of the composer when not: a `viewer` reads only
 * (§12), a block either way replaces it (§6.11: "You blocked …" / "You can't reply in this conversation").
 */
export function composerState(
  detail: Pick<ThreadDetail, 'canWrite' | 'blockState' | 'memberRole'>,
): { canWrite: boolean; reasonKey: ComposerReasonKey | null } {
  if (detail.memberRole === 'viewer') return { canWrite: false, reasonKey: 'chats.composer.viewer' };
  if (detail.blockState === 'blocked_by_me') return { canWrite: false, reasonKey: 'chats.composer.blockedByMe' };
  if (detail.blockState === 'blocked_me') return { canWrite: false, reasonKey: 'chats.composer.blockedMe' };
  if (!detail.canWrite) return { canWrite: false, reasonKey: 'chats.composer.readOnly' };
  return { canWrite: true, reasonKey: null };
}

/** A new `clientMessageId` (v4 UUID). The composer keeps it until the send succeeds, so a retry reuses it (§6.4). */
export function nextClientMessageId(): string {
  return newInstallId();
}

/** Photos one message may still take (≤ 5, §6.8). */
export function photosLeft(current: number): number {
  return Math.max(0, CHAT_LIMITS.photosPerMessage - current);
}

/** Of `adding` picked photos, how many fit; `overflow` when some were left out (the screen says so). */
export function acceptPhotos(current: number, adding: number): { accepted: number; overflow: boolean } {
  const accepted = Math.min(photosLeft(current), Math.max(0, adding));
  return { accepted, overflow: accepted < adding };
}

export type MessageProblem = 'empty' | 'tooLong';

/** Text 1–2 000 characters after trim, or photos with an optional caption of the same length (§6.4). */
export function messageProblem(text: string, photoCount: number): MessageProblem | null {
  const trimmed = text.trim();
  if (trimmed.length > CHAT_LIMITS.messageMax) return 'tooLong';
  if (photoCount === 0 && trimmed.length === 0) return 'empty';
  return null;
}

/** What a send carries: the trimmed text (null when empty) and the photo keys. */
export function messageBody(clientMessageId: string, text: string, photoKeys: string[]) {
  const trimmed = text.trim();
  return {
    clientMessageId,
    text: trimmed === '' ? null : trimmed,
    ...(photoKeys.length > 0 ? { photoKeys } : {}),
  };
}

// ─── Enquire sheet (§6.3) ───

export interface EnquiryForm {
  quick: QuickEnquiry[];
  /** As typed (Hindi / Gujarati digits allowed). */
  quantityText: string;
  note: string;
  /** Send the stored Check my machine choice with "Will it fit my machine?". */
  sendMachine: boolean;
}

/** The options a listing offers: Price please only on price-on-request, Best price otherwise; fit only for parts. */
export function quickOptionsFor(listing: Pick<ListingDetail, 'kind' | 'priceModel'>): QuickEnquiry[] {
  const onRequest = listing.priceModel === 'on_request';
  return [
    'is_available',
    'more_photos',
    'video',
    'specifications',
    ...(listing.kind === 'part' ? (['compatibility'] as const) : []),
    onRequest ? 'price_request' : 'best_price',
  ];
}

/** Whether an option takes a quantity (Best price for N, Price please). */
export const takesQuantity = (q: QuickEnquiry): boolean => q === 'best_price' || q === 'price_request';

/** The sheet's opening state: Ask price preselects Price please; quantity = the minimum order, else 1. */
export function enquiryDefaults(listing: Pick<ListingDetail, 'minOrderQty'>, preset?: 'ask_price'): EnquiryForm {
  return {
    quick: preset === 'ask_price' ? ['price_request'] : [],
    quantityText: listing.minOrderQty ?? '1',
    note: '',
    sendMachine: true,
  };
}

export type EnquiryProblem = 'empty' | 'noteTooLong' | { quantity: QuantityProblem };

/** At least one option or a note; the note ≤ 500; a valid quantity when an option takes one. */
export function enquiryProblem(form: EnquiryForm, decimals: number): EnquiryProblem | null {
  const note = form.note.trim();
  if (note.length > CHAT_LIMITS.noteMax) return 'noteTooLong';
  if (form.quick.length === 0 && note === '') return 'empty';
  if (form.quick.some(takesQuantity)) {
    const q = parseQuantity(form.quantityText, decimals);
    if (!q.ok) return { quantity: q.problem };
  }
  return null;
}

/** `POST /listings/:id/enquiry`'s body; call after `enquiryProblem` is null. Names are the server's to resolve. */
export function enquiryBody(
  form: EnquiryForm,
  decimals: number,
  machine: { brandId: string; modelId: string | null; year: number | null } | null,
) {
  const note = form.note.trim();
  const q = form.quick.some(takesQuantity) ? parseQuantity(form.quantityText, decimals) : null;
  const fit = machine && form.sendMachine && form.quick.includes('compatibility')
    ? { brandId: machine.brandId, modelId: machine.modelId, year: machine.year }
    : null;
  return {
    quick: form.quick,
    quantity: q && q.ok ? q.value : null,
    note: note === '' ? null : note,
    fit,
  };
}
