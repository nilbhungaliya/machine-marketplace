import type { NotificationTexts, TextParams } from './types.js';

// Gujarati notification text (F6 + F7 spec §11.3, §11.4). Needs a native speaker's check (spec §25).

const listing = (p: TextParams) => p.listingTitle || 'તમારી લિસ્ટિંગ';
const who = (p: TextParams) => p.businessName || 'બીજા વ્યવસાય';
const at = (p: TextParams) => (p.price ? ` ${p.price} પ્રતિ યુનિટ પર` : '');
const qty = (p: TextParams) => (p.quantity ? ` ${p.quantity} માટે` : '');
const deal = (p: TextParams) => (p.dealRef ? `ડીલ ${p.dealRef}` : 'તમારી ડીલ');
const on = (p: TextParams) => (p.listingTitle ? ` (${p.listingTitle})` : '');

// F8 (spec §10.3): request names masked by `render.ts`; never the note, a reply message, the budget or an address.
const request = (p: TextParams) => p.requestTitle || 'તમારી જરૂરિયાત';
const sideWord: Record<TextParams['side'], string> = { '': '', left: 'લેફ્ટ', right: 'રાઇટ', pair: 'જોડી' };
const away = (p: TextParams) => (p.distanceKm ? `, ${p.distanceKm} કિમી દૂર` : '');
const dropReason: Record<TextParams['reason'], string> = {
  '': 'કારણ જોવા માટે જરૂરિયાત ખોલો.',
  listing_removed: 'લિસ્ટિંગ દૂર કરાઈ હતી.',
  listing_removed_by_team: 'અમારી ટીમે લિસ્ટિંગ દૂર કરી.',
  listing_rejected: 'લિસ્ટિંગ મંજૂર થઈ નથી.',
  request_closed: 'ખરીદનારે જરૂરિયાત બંધ કરી.',
  request_expired: 'જરૂરિયાત પૂરી થઈ ગઈ.',
  request_removed: 'જરૂરિયાત દૂર કરાઈ.',
  blocked: 'તે આ ખરીદનાર સુધી પહોંચી શકતો નથી.',
  not_eligible: 'હવે તમે આ જરૂરિયાતનો જવાબ આપી શકતા નથી.',
  no_longer_fits: 'લિસ્ટિંગ હવે આ જરૂરિયાત સાથે મેળ ખાતી નથી.',
};
const line = (...parts: string[]) => parts.filter(Boolean).join(' · ');

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
  booking_update: () => ({ title: 'બુકિંગ અપડેટ', body: 'એક બુકિંગ બદલાયું છે. વિગતો જોવા ખોલો.' }),
  listing_status: (p) => ({ title: 'લિસ્ટિંગ અપડેટ', body: `${listing(p)}ની સ્થિતિ બદલાઈ છે.` }),
  // F8 part requests (spec §10.3). Needs a native speaker's check.
  part_request_new: (p) => ({
    title: p.requestTitle ? `એક ખરીદનારને ${p.requestTitle} જોઈએ છે` : 'એક ખરીદનારે જરૂરિયાત પોસ્ટ કરી',
    body: line(sideWord[p.side], p.quantity, p.city) || 'જોવા માટે જરૂરિયાત ખોલો.',
  }),
  part_request_reply: (p) =>
    p.count > 1
      ? { title: `${request(p)} માટે ${p.count} જવાબ`, body: p.businessName ? `સૌથી નવો: ${p.businessName}.` : 'સરખામણી કરવા માટે જરૂરિયાત ખોલો.' }
      : { title: `${who(p)} એ તમારી જરૂરિયાતનો જવાબ આપ્યો`, body: `${p.requestTitle ? `${p.requestTitle}: ` : ''}લિસ્ટિંગ જોવા માટે ખોલો.` },
  part_match: (p) =>
    p.count > 1
      ? { title: `${request(p)} માટે ${p.count} નવા મેળ`, body: `સૌથી નવું: ${listing(p)}${away(p)}. સરખામણી કરવા માટે જરૂરિયાત ખોલો.` }
      : {
          title: `તમારું ${sideWord[p.side] ? `${sideWord[p.side]} ` : ''}${request(p)} ઉપલબ્ધ છે`,
          body: `${listing(p)}${away(p)}. ઑફર આપવા માટે તેને ખોલો.`,
        },
  part_request_expiring: (p) => ({
    title: p.dueOn ? `${request(p)} ${p.dueOn} ના રોજ પૂરી થશે` : `${request(p)} જલ્દી પૂરી થશે`,
    body: 'જવાબ મેળવતા રહેવા માટે તેને રિન્યૂ કરો.',
  }),
  part_request_expired: (p) => ({
    title: `${request(p)} પૂરી થઈ ગઈ`,
    body:
      p.dueOn && !p.duePassed
        ? `તમે તેને ${p.dueOn} સુધી રિન્યૂ કરી શકો છો.`
        : 'તે તેના મહત્તમ સમય સુધી પહોંચી ગઈ છે. હજુ જરૂર હોય તો નવી જરૂરિયાત પોસ્ટ કરો.',
  }),
  part_request_fulfil_prompt: (p) => ({
    title: p.businessName ? `${p.businessName} સાથે ડીલ નક્કી થઈ` : 'ડીલ નક્કી થઈ',
    body: `${request(p)} ને પૂરી થઈ તરીકે માર્ક કરશો?`,
  }),
  part_request_removed: (p) => ({ title: 'તમારી જરૂરિયાત દૂર કરાઈ', body: `${request(p)} ને અમારી ટીમે દૂર કરી છે.` }),
  part_request_reply_dropped: (p) => ({
    title: `${p.requestTitle ? `${p.requestTitle} પર ` : ''}તમારો જવાબ પહોંચ્યો નથી`,
    body: dropReason[p.reason],
  }),
};
