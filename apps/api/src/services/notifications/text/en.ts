import type { NotificationTexts, TextParams } from './types.js';

// English notification text (F6 + F7 spec §11.3, §11.4). Business names and titles only; never message text.

const listing = (p: TextParams) => p.listingTitle || 'your listing';
const from = (p: TextParams) => (p.businessName ? ` from ${p.businessName}` : '');
const who = (p: TextParams) => p.businessName || 'The other business';
const at = (p: TextParams) => (p.price ? ` at ${p.price} per unit` : '');
const qty = (p: TextParams) => (p.quantity ? ` for ${p.quantity}` : '');
/** "deal #500001" / "your deal", mid-sentence; `Deal` capitalised to start one. */
const deal = (p: TextParams) => (p.dealRef ? `deal ${p.dealRef}` : 'your deal');
const Deal = (p: TextParams) => (p.dealRef ? `Deal ${p.dealRef}` : 'Your deal');
const on = (p: TextParams) => (p.listingTitle ? ` on ${p.listingTitle}` : '');

export const en: NotificationTexts = {
  enquiry_new: (p) => ({ title: 'New enquiry', body: listing(p) }),
  message_new: (p) => ({
    title: p.count > 1 ? `${p.count} new messages` : 'New message',
    body: p.businessName ? `From ${p.businessName}` : 'Open the chat to read it.',
  }),
  offer_new: (p) => ({ title: 'New offer', body: `An offer${from(p)}${at(p)}${qty(p)} on ${listing(p)}.` }),
  offer_quote: (p) => ({ title: 'Price quoted', body: `${who(p)} quoted${at(p)}${qty(p)} on ${listing(p)}.` }),
  offer_countered: (p) => ({ title: 'Counter-offer', body: `New terms${at(p)}${qty(p)} on ${listing(p)}. It's your turn.` }),
  offer_accepted: (p) => ({ title: 'Offer accepted', body: `The offer on ${listing(p)} was accepted. The deal is on.` }),
  offer_rejected: (p) => ({ title: 'Offer declined', body: `The offer on ${listing(p)} was declined.` }),
  offer_expiring: (p) => ({ title: 'Offer expiring soon', body: `The offer on ${listing(p)} ends in a few hours. Reply before it expires.` }),
  offer_backup: (p) => ({ title: 'Offer on hold', body: `The quantity on ${listing(p)} is no longer available. Your offer is kept as a backup.` }),
  offer_revived: (p) => ({ title: 'Offer is back', body: `Stock on ${listing(p)} is free again. The offer can go ahead.` }),
  deal_handed_over: (p) => ({ title: 'Handed over', body: `${Deal(p)}${on(p)} was handed over. Confirm when you receive it.` }),
  deal_cancel_requested: (p) => ({ title: 'Cancel requested', body: `${who(p)} asked to cancel ${deal(p)}.` }),
  deal_cancelled: (p) => ({ title: 'Deal cancelled', body: `${Deal(p)}${on(p)} was cancelled.` }),
  deal_completed: (p) => ({ title: 'Deal completed', body: `${Deal(p)}${on(p)} is complete. Rate this deal.` }),
  deal_problem: (p) => ({ title: 'Problem reported', body: `A problem was reported on ${deal(p)}. Our team will look into it.` }),
  deal_dispute_resolved: (p) => ({ title: 'Problem resolved', body: `Our team closed the problem on ${deal(p)}.` }),
  deal_agreed_reminder: (p) => ({ title: 'Deal waiting', body: `${Deal(p)}${on(p)} is still waiting for the handover.` }),
  review_received: (p) => ({ title: 'New review', body: `${who(p)} reviewed you${on(p)}.` }),
  review_waiting: (p) => ({
    title: 'Review the deal',
    body: `${who(p)} reviewed ${deal(p)}. Add yours${p.dueOn ? ` by ${p.dueOn}` : ''}; both publish together.`,
  }),
  // Later modules (F8, M14, F2 notices): generic text until they bring their own.
  part_match: (p) => ({ title: 'New match', body: `A listing matches your request${p.listingTitle ? `: ${p.listingTitle}` : ''}.` }),
  booking_update: () => ({ title: 'Booking update', body: 'A booking changed. Open it to see the details.' }),
  listing_status: (p) => ({ title: 'Listing update', body: p.listingTitle ? `${p.listingTitle} changed status.` : 'Your listing changed status.' }),
};
