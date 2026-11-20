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

// F8 (spec §10.3): request names masked by `render.ts`; never the note, a reply message, the budget or an address.
const request = (p: TextParams) => p.requestTitle || 'your requirement';
const sideWord: Record<TextParams['side'], string> = { '': '', left: 'left', right: 'right', pair: 'pair' };
const sideLabel: Record<TextParams['side'], string> = { '': '', left: 'Left', right: 'Right', pair: 'Pair' };
const away = (p: TextParams) => (p.distanceKm ? `, ${p.distanceKm} km away` : '');
const dropReason: Record<TextParams['reason'], string> = {
  '': 'Open the requirement to see why.',
  listing_removed: 'The listing was removed.',
  listing_removed_by_team: 'Our team removed the listing.',
  listing_rejected: "The listing wasn't approved.",
  request_closed: 'The buyer closed the requirement.',
  request_expired: 'The requirement expired.',
  request_removed: 'The requirement was removed.',
  blocked: "It can't be delivered to this buyer.",
  not_eligible: 'You can no longer reply to this requirement.',
  no_longer_fits: 'The listing no longer fits the requirement.',
};
const line = (...parts: string[]) => parts.filter(Boolean).join(' · ');

// M14 rental bookings (spec §11, R14): business names and titles masked by `render.ts`, dates an IST short range.
// Never an amount, a site address, a note or a message.
const machine = (p: TextParams) => p.listingTitle || 'your rental machine';
const Machine = (p: TextParams) => p.listingTitle || 'Your rental machine';
const dates = (p: TextParams) => (p.dates ? `, ${p.dates}` : '');
const booking = (p: TextParams) => (p.bookingRef ? `booking ${p.bookingRef}` : 'your booking');
/** A review's subject mid-sentence: "booking #700001" for a rental, else the deal. */
const subject = (p: TextParams) => (p.bookingRef ? booking(p) : deal(p));

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
    title: p.bookingRef ? 'Review the booking' : 'Review the deal',
    body: `${who(p)} reviewed ${subject(p)}. Add yours${p.dueOn ? ` by ${p.dueOn}` : ''}; both publish together.`,
  }),
  // M14 rental bookings (spec §11).
  rental_booking_requested: (p) => ({ title: 'New booking request', body: `${who(p)} wants ${machine(p)}${dates(p)}.` }),
  rental_booking_changed: (p) => ({ title: 'Booking change proposed', body: `${who(p)} proposed new terms for ${machine(p)}.` }),
  rental_booking_confirmed: (p) => ({ title: 'Booking confirmed', body: `${Machine(p)}${dates(p)}.` }),
  rental_booking_declined: (p) => ({ title: 'Booking declined', body: `${Machine(p)}${dates(p)}.` }),
  rental_booking_withdrawn: (p) => ({ title: 'Request withdrawn', body: `${who(p)} withdrew the request for ${machine(p)}.` }),
  rental_booking_expired: (p) => ({ title: 'Booking request expired', body: `No answer in time for ${machine(p)}.` }),
  rental_booking_cancelled: (p) => ({ title: 'Booking cancelled', body: `${Machine(p)}${dates(p)}.` }),
  rental_booking_on_site: (p) => ({ title: 'Machine on site', body: `${Machine(p)} is on site.` }),
  rental_booking_returned: (p) => ({ title: 'Machine returned', body: `Check the final amount for ${machine(p)}.` }),
  rental_booking_completed: (p) => ({ title: 'Rental completed', body: `Rate ${p.businessName || 'the other business'}.` }),
  rental_booking_starts_tomorrow: (p) => ({ title: 'Booking starts tomorrow', body: `${Machine(p)}${dates(p)}.` }),
  rental_booking_due_back: (p) => ({ title: 'Due back today', body: Machine(p) }),
  rental_booking_overdue: (p) => ({ title: 'Still on rent', body: `Mark ${machine(p)} returned when it's back.` }),
  rental_booking_not_started: (p) => ({ title: 'Did it start?', body: `Mark ${machine(p)} on site, or cancel the booking.` }),
  rental_booking_clash: (p) => ({ title: 'Booking clash', body: `${Machine(p)} is still out and ${p.bookingRef || 'the next booking'} starts soon.` }),
  rental_booking_problem: (p) => ({ title: 'Problem reported', body: `On ${booking(p)}. Our team will look into it.` }),
  rental_booking_dispute_resolved: (p) => ({ title: 'Booking problem resolved', body: `On ${booking(p)}.` }),
  listing_status: (p) => ({ title: 'Listing update', body: p.listingTitle ? `${p.listingTitle} changed status.` : 'Your listing changed status.' }),
  // F8 part requests (spec §10.3).
  part_request_new: (p) => ({
    title: p.requestTitle ? `A buyer needs ${p.requestTitle}` : 'A buyer posted a requirement',
    body: line(sideLabel[p.side], p.quantity, p.city) || 'Open the requirement to see it.',
  }),
  part_request_reply: (p) =>
    p.count > 1
      ? { title: `${p.count} replies for ${request(p)}`, body: p.businessName ? `Latest from ${p.businessName}.` : 'Open the requirement to compare them.' }
      : { title: `${who(p)} replied to your requirement`, body: `${p.requestTitle ? `For ${p.requestTitle}. ` : ''}Open it to see the listing.` },
  part_match: (p) =>
    p.count > 1
      ? { title: `${p.count} new matches for ${request(p)}`, body: `Latest: ${listing(p)}${away(p)}. Open the requirement to compare.` }
      : {
          title: `Your ${sideWord[p.side] ? `${sideWord[p.side]} ` : ''}${request(p)} is available`,
          body: `${listing(p)}${away(p)}. Open it to make an offer.`,
        },
  part_request_expiring: (p) => ({
    title: p.dueOn ? `${request(p)} expires on ${p.dueOn}` : `${request(p)} expires soon`,
    body: 'Renew it to keep getting replies.',
  }),
  part_request_expired: (p) => ({
    title: `${request(p)} has expired`,
    body:
      p.dueOn && !p.duePassed
        ? `You can renew it until ${p.dueOn}.`
        : 'It has reached its maximum time. Post a new requirement if you still need it.',
  }),
  part_request_fulfil_prompt: (p) => ({
    title: p.businessName ? `Deal agreed with ${p.businessName}` : 'Deal agreed',
    body: `Mark ${request(p)} fulfilled?`,
  }),
  part_request_removed: (p) => ({ title: 'Your requirement was removed', body: `${request(p)} was removed by our team.` }),
  part_request_reply_dropped: (p) => ({
    title: `Your reply to ${p.requestTitle || 'a requirement'} wasn't delivered`,
    body: dropReason[p.reason],
  }),
};
