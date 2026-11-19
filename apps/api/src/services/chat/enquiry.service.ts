import { and, eq } from 'drizzle-orm';
import {
  CHAT_LIMITS,
  checkFit,
  milliToQuantity,
  quantityToMilli,
  type EnquiryMachine,
  type QuickEnquiry,
  type ThreadMessage,
} from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { brands, businesses, listingFitments, listings, machineModels, units } from '../../db/schema.js';
import { ValidationError } from '../../lib/errors.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { lockThread } from '../deals/locks.js';
import { notify } from '../notifications/notify.js';
import { publicText } from './chat-view.js';
import { toThreadMessages } from './message.service.js';
import { openOrGetThread } from './open-thread.js';
import { looksLikeScam } from './scam-patterns.js';
import { insertMessage, recomputeTurns } from './thread-lines.js';

/**
 * Enquire and Ask price (F6 + F7 spec §6.1, §6.3, R1, R5; textile `openThread` + the first message). The enquiry is a
 * card in the thread: quick options, an optional note and the buyer's "Check my machine" choice, whose names and
 * verdict are resolved here (never trusted from the client). The thread is opened by `openOrGetThread` (refusals,
 * the daily new-thread limit, one thread per buyer business and listing); an enquiry on an existing thread appends a
 * new card (our call). The seller business gets `enquiry_new`.
 */

export interface EnquiryInput {
  quick: QuickEnquiry[];
  quantity?: string | null;
  note?: string | null;
  fit?: { brandId: string; modelId?: string | null; year?: number | null } | null;
}

const QUANTITY_OPTIONS: ReadonlySet<QuickEnquiry> = new Set(['best_price', 'price_request']);

/** Brand / model names and the fit verdict against the listing's fitments (§5.2 `fit_machine`). */
async function resolveMachine(tx: Tx, listingId: string, fit: NonNullable<EnquiryInput['fit']>): Promise<EnquiryMachine> {
  const [brand] = await tx.select({ id: brands.id, name: brands.name }).from(brands).where(eq(brands.id, fit.brandId));
  if (!brand) throw new ValidationError('Choose a brand from the list', { field: 'fit.brandId' });
  let model: { id: string; name: string } | undefined;
  if (fit.modelId) {
    [model] = await tx
      .select({ id: machineModels.id, name: machineModels.name })
      .from(machineModels)
      .where(and(eq(machineModels.id, fit.modelId), eq(machineModels.brandId, brand.id)));
    if (!model) throw new ValidationError('Choose a model of this brand', { field: 'fit.modelId' });
  }
  const fitments = await tx
    .select({
      brandId: listingFitments.brandId,
      modelId: listingFitments.modelId,
      modelOther: listingFitments.modelOther,
      yearFrom: listingFitments.yearFrom,
      yearTo: listingFitments.yearTo,
    })
    .from(listingFitments)
    .where(eq(listingFitments.listingId, listingId));
  const year = fit.year ?? null;
  return {
    brandId: brand.id,
    brandName: brand.name,
    modelId: model?.id ?? null,
    modelName: model?.name ?? null,
    year,
    verdict: checkFit(fitments, { brandId: brand.id, modelId: model?.id ?? null, year }),
  };
}

/** The asked quantity: the body's, else the listing's minimum order, else 1; checked against the unit's decimals. */
function askedQuantity(raw: string | null | undefined, minOrderQty: string | null, decimals: number): string {
  const value = raw?.trim() || minOrderQty || '1';
  let milli: bigint;
  try {
    milli = quantityToMilli(value);
  } catch {
    throw new ValidationError('Enter a quantity', { field: 'quantity' });
  }
  if (milli <= 0n) throw new ValidationError('Enter a quantity', { field: 'quantity' });
  if (milli % 10n ** BigInt(3 - decimals) !== 0n) {
    throw new ValidationError('This unit takes fewer decimals', { field: 'quantity', decimals }, 'QUANTITY_DECIMALS');
  }
  return milliToQuantity(milli);
}

/** `POST /listings/:id/enquiry` → `{ threadId, message }` (the card as the sender reads it). */
export async function sendEnquiry(
  tx: Tx,
  user: UserTokenPayload,
  listingId: string,
  input: EnquiryInput,
): Promise<{ threadId: string; message: ThreadMessage }> {
  const quick = [...new Set(input.quick)];
  const note = input.note?.trim() || null;
  if (quick.length === 0 && note === null) throw new ValidationError('Pick a question or write a note', undefined, 'MESSAGE_EMPTY');
  if (note !== null && note.length > CHAT_LIMITS.noteMax) throw new ValidationError('This note is too long', { max: CHAT_LIMITS.noteMax });

  const { thread: opened, reader } = await openOrGetThread(tx, user, listingId);

  const [listing] = await tx
    .select({ title: listings.title, minOrderQty: listings.minOrderQty, decimals: units.decimals })
    .from(listings)
    .leftJoin(units, eq(units.id, listings.unitId))
    .where(eq(listings.id, listingId));
  const quantity = quick.some((q) => QUANTITY_OPTIONS.has(q))
    ? askedQuantity(input.quantity, listing!.minOrderQty, listing!.decimals ?? 3)
    : null;
  const machine = input.fit ? await resolveMachine(tx, listingId, input.fit) : null;

  // Thread last in the §8.5 order (the buyer business is already held by `openOrGetThread`).
  const thread = await lockThread(tx, opened.id);
  const row = await insertMessage(tx, thread, {
    kind: 'enquiry',
    senderSide: 'buyer',
    senderUserId: reader.userId,
    text: note,
    quickOptions: quick,
    enquiryQuantity: quantity,
    fitMachine: machine,
    scamFlag: note !== null && looksLikeScam(note),
  });

  const [buyer] = await tx.select({ name: businesses.tradeName }).from(businesses).where(eq(businesses.id, reader.businessId));
  await notify(tx, {
    type: 'enquiry_new',
    recipientBusinessId: thread.sellerBusinessId,
    params: { businessName: publicText(buyer?.name ?? ''), listingTitle: publicText(listing!.title ?? '') },
    destination: { threadId: thread.id },
    dedupeKey: `enquiry_new:${row.id}`,
  });
  await recomputeTurns(tx, thread.id);
  const [message] = await toThreadMessages(tx, [row], reader, thread);
  return { threadId: thread.id, message: message! };
}
