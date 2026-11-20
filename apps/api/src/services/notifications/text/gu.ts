import type { NotificationTexts, TextParams } from './types.js';

// Gujarati notification text (F6 + F7 spec §11.3, §11.4). Needs a native speaker's check (spec §25).

const listing = (p: TextParams) => p.listingTitle || 'તમારી લિસ્ટિંગ';
const who = (p: TextParams) => p.businessName || 'બીજા વ્યવસાય';
const at = (p: TextParams) => (p.price ? ` ${p.price} પ્રતિ યુનિટ પર` : '');
const qty = (p: TextParams) => (p.quantity ? ` ${p.quantity} માટે` : '');
const deal = (p: TextParams) => (p.dealRef ? `ડીલ ${p.dealRef}` : 'તમારી ડીલ');
const on = (p: TextParams) => (p.listingTitle ? ` (${p.listingTitle})` : '');

export const gu: NotificationTexts = {
  enquiry_new: (p) => ({ title: 'નવી પૂછપરછ', body: listing(p) }),
  message_new: (p) => ({
    title: p.count > 1 ? `${p.count} નવા સંદેશ` : 'નવો સંદેશ',
    body: p.businessName ? `${p.businessName} તરફથી` : 'વાંચવા માટે ચેટ ખોલો.',
  }),
  offer_new: (p) => ({ title: 'નવી ઑફર', body: `${listing(p)} પર${p.businessName ? ` ${p.businessName} તરફથી` : ''}${at(p)}${qty(p)} ઑફર આવી છે.` }),
  offer_quote: (p) => ({ title: 'ભાવ જણાવ્યો', body: `${who(p)}એ ${listing(p)} પર${at(p)}${qty(p)} ભાવ જણાવ્યો છે.` }),
  offer_countered: (p) => ({ title: 'કાઉન્ટર ઑફર', body: `${listing(p)} પર નવી શરતો${at(p)}${qty(p)}. હવે તમારો વારો છે.` }),
  offer_accepted: (p) => ({ title: 'ઑફર સ્વીકારાઈ', body: `${listing(p)} પરની ઑફર સ્વીકારાઈ. ડીલ શરૂ થઈ છે.` }),
  offer_rejected: (p) => ({ title: 'ઑફર નકારાઈ', body: `${listing(p)} પરની ઑફર નકારાઈ.` }),
  offer_expiring: (p) => ({ title: 'ઑફર જલ્દી પૂરી થશે', body: `${listing(p)} પરની ઑફર થોડા કલાકોમાં પૂરી થશે. તે પહેલાં જવાબ આપો.` }),
  offer_backup: (p) => ({ title: 'ઑફર હોલ્ડ પર', body: `${listing(p)} પર જથ્થો હવે ઉપલબ્ધ નથી. તમારી ઑફર બેકઅપ તરીકે રાખી છે.` }),
  offer_revived: (p) => ({ title: 'ઑફર ફરી ઉપલબ્ધ', body: `${listing(p)} પર સ્ટોક ફરી ખાલી છે. ઑફર આગળ વધી શકે છે.` }),
  deal_handed_over: (p) => ({ title: 'સોંપી દીધું', body: `${deal(p)}${on(p)} સોંપી દેવાઈ છે. મળે ત્યારે પુષ્ટિ કરો.` }),
  deal_cancel_requested: (p) => ({ title: 'રદ કરવાની વિનંતી', body: `${who(p)}એ ${deal(p)} રદ કરવા કહ્યું છે.` }),
  deal_cancelled: (p) => ({ title: 'ડીલ રદ', body: `${deal(p)}${on(p)} રદ થઈ.` }),
  deal_completed: (p) => ({ title: 'ડીલ પૂરી', body: `${deal(p)}${on(p)} પૂરી થઈ. આ ડીલને રેટ કરો.` }),
  deal_problem: (p) => ({ title: 'સમસ્યા નોંધાઈ', body: `${deal(p)} પર સમસ્યા નોંધાઈ છે. અમારી ટીમ તે જોશે.` }),
  deal_dispute_resolved: (p) => ({ title: 'સમસ્યા ઉકેલાઈ', body: `અમારી ટીમે ${deal(p)}ની સમસ્યા બંધ કરી છે.` }),
  deal_agreed_reminder: (p) => ({ title: 'ડીલ રાહ જુએ છે', body: `${deal(p)}${on(p)} હજી સોંપણીની રાહ જુએ છે.` }),
  review_received: (p) => ({ title: 'નવી સમીક્ષા', body: `${who(p)}એ તમારી સમીક્ષા કરી${on(p)}.` }),
  review_waiting: (p) => ({
    title: 'ડીલની સમીક્ષા કરો',
    body: `${who(p)}એ ${deal(p)}ની સમીક્ષા કરી છે. ${p.dueOn ? `${p.dueOn} સુધીમાં ` : ''}તમારી સમીક્ષા ઉમેરો; બંને સાથે પ્રકાશિત થશે.`,
  }),
  part_match: (p) => ({ title: 'નવું મેળ', body: `એક લિસ્ટિંગ તમારી જરૂરિયાત સાથે મેળ ખાય છે${p.listingTitle ? `: ${p.listingTitle}` : ''}.` }),
  booking_update: () => ({ title: 'બુકિંગ અપડેટ', body: 'એક બુકિંગ બદલાયું છે. વિગતો જોવા ખોલો.' }),
  listing_status: (p) => ({ title: 'લિસ્ટિંગ અપડેટ', body: `${listing(p)}ની સ્થિતિ બદલાઈ છે.` }),
  // F8 placeholders (plan C0-1): A3-2 replaces them with the spec §10.3 texts.
  part_request_new: () => ({ title: 'એક ખરીદનારને પાર્ટ જોઈએ છે', body: 'જોવા માટે જરૂરિયાત ખોલો.' }),
  part_request_reply: () => ({ title: 'તમારી જરૂરિયાત પર નવો જવાબ', body: 'જોવા માટે જરૂરિયાત ખોલો.' }),
  part_request_expiring: () => ({ title: 'જરૂરિયાત જલ્દી પૂરી થશે', body: 'જવાબ મેળવતા રહેવા માટે તેને રિન્યૂ કરો.' }),
  part_request_expired: () => ({ title: 'જરૂરિયાત પૂરી થઈ ગઈ', body: 'જવાબ મેળવતા રહેવા માટે તેને રિન્યૂ કરો.' }),
  part_request_fulfil_prompt: () => ({ title: 'સોદો નક્કી થયો', body: 'શું તમારી જરૂરિયાત પૂરી થઈ તરીકે માર્ક કરશો?' }),
  part_request_removed: () => ({ title: 'તમારી જરૂરિયાત દૂર કરાઈ', body: 'તેને અમારી ટીમે દૂર કરી છે.' }),
  part_request_reply_dropped: () => ({ title: 'તમારો જવાબ પહોંચ્યો નથી', body: 'કારણ જોવા માટે જરૂરિયાત ખોલો.' }),
};
