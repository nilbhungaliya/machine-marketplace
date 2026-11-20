import type { NotificationTexts, TextParams } from './types.js';

// Hindi notification text (F6 + F7 spec §11.3, §11.4). Needs a native speaker's check (spec §25).

const listing = (p: TextParams) => p.listingTitle || 'आपकी लिस्टिंग';
const who = (p: TextParams) => p.businessName || 'दूसरे व्यवसाय';
const at = (p: TextParams) => (p.price ? ` ${p.price} प्रति यूनिट पर` : '');
const qty = (p: TextParams) => (p.quantity ? ` ${p.quantity} के लिए` : '');
const deal = (p: TextParams) => (p.dealRef ? `डील ${p.dealRef}` : 'आपकी डील');
const on = (p: TextParams) => (p.listingTitle ? ` (${p.listingTitle})` : '');

// F8 (spec §10.3): request names masked by `render.ts`; never the note, a reply message, the budget or an address.
const request = (p: TextParams) => p.requestTitle || 'आपकी ज़रूरत';
const sideWord: Record<TextParams['side'], string> = { '': '', left: 'लेफ़्ट', right: 'राइट', pair: 'जोड़ी' };
const away = (p: TextParams) => (p.distanceKm ? `, ${p.distanceKm} किमी दूर` : '');
const dropReason: Record<TextParams['reason'], string> = {
  '': 'कारण देखने के लिए ज़रूरत खोलें।',
  listing_removed: 'लिस्टिंग हटा दी गई थी।',
  listing_removed_by_team: 'हमारी टीम ने लिस्टिंग हटा दी।',
  listing_rejected: 'लिस्टिंग स्वीकृत नहीं हुई।',
  request_closed: 'खरीदार ने ज़रूरत बंद कर दी।',
  request_expired: 'ज़रूरत समाप्त हो गई।',
  request_removed: 'ज़रूरत हटा दी गई।',
  blocked: 'यह इस खरीदार तक नहीं पहुँच सकता।',
  not_eligible: 'अब आप इस ज़रूरत पर जवाब नहीं दे सकते।',
  no_longer_fits: 'लिस्टिंग अब इस ज़रूरत से मेल नहीं खाती।',
};
const line = (...parts: string[]) => parts.filter(Boolean).join(' · ');

const rental = () => ({ title: 'किराये की बुकिंग अपडेट', body: 'एक किराये की बुकिंग बदली है। विवरण देखने के लिए खोलें।' });

export const hi: NotificationTexts = {
  enquiry_new: (p) => ({ title: 'नई पूछताछ', body: listing(p) }),
  message_new: (p) => ({
    title: p.count > 1 ? `${p.count} नए संदेश` : 'नया संदेश',
    body: p.businessName ? `${p.businessName} से` : 'पढ़ने के लिए चैट खोलें।',
  }),
  offer_new: (p) => ({ title: 'नया ऑफ़र', body: `${listing(p)} पर${p.businessName ? ` ${p.businessName} से` : ''}${at(p)}${qty(p)} ऑफ़र आया है।` }),
  offer_quote: (p) => ({ title: 'कीमत बताई गई', body: `${who(p)} ने ${listing(p)} पर${at(p)}${qty(p)} कीमत बताई है।` }),
  offer_countered: (p) => ({ title: 'काउंटर ऑफ़र', body: `${listing(p)} पर नई शर्तें${at(p)}${qty(p)}। अब आपकी बारी है।` }),
  offer_accepted: (p) => ({ title: 'ऑफ़र स्वीकार', body: `${listing(p)} पर ऑफ़र स्वीकार हो गया। डील शुरू हो गई है।` }),
  offer_rejected: (p) => ({ title: 'ऑफ़र अस्वीकार', body: `${listing(p)} पर ऑफ़र अस्वीकार हो गया।` }),
  offer_expiring: (p) => ({ title: 'ऑफ़र जल्द समाप्त', body: `${listing(p)} पर ऑफ़र कुछ घंटों में समाप्त होगा। उससे पहले जवाब दें।` }),
  offer_backup: (p) => ({ title: 'ऑफ़र होल्ड पर', body: `${listing(p)} पर मात्रा अब उपलब्ध नहीं है। आपका ऑफ़र बैकअप के रूप में रखा गया है।` }),
  offer_revived: (p) => ({ title: 'ऑफ़र फिर से उपलब्ध', body: `${listing(p)} पर स्टॉक फिर खाली है। ऑफ़र आगे बढ़ सकता है।` }),
  deal_handed_over: (p) => ({ title: 'सौंप दिया गया', body: `${deal(p)}${on(p)} सौंप दी गई है। मिलने पर पुष्टि करें।` }),
  deal_cancel_requested: (p) => ({ title: 'रद्द करने का अनुरोध', body: `${who(p)} ने ${deal(p)} रद्द करने को कहा है।` }),
  deal_cancelled: (p) => ({ title: 'डील रद्द', body: `${deal(p)}${on(p)} रद्द हो गई।` }),
  deal_completed: (p) => ({ title: 'डील पूरी', body: `${deal(p)}${on(p)} पूरी हो गई। इस डील को रेट करें।` }),
  deal_problem: (p) => ({ title: 'समस्या दर्ज', body: `${deal(p)} पर समस्या दर्ज की गई है। हमारी टीम इसे देखेगी।` }),
  deal_dispute_resolved: (p) => ({ title: 'समस्या सुलझी', body: `हमारी टीम ने ${deal(p)} की समस्या बंद कर दी है।` }),
  deal_agreed_reminder: (p) => ({ title: 'डील इंतज़ार में', body: `${deal(p)}${on(p)} अभी भी सौंपे जाने का इंतज़ार कर रही है।` }),
  review_received: (p) => ({ title: 'नई समीक्षा', body: `${who(p)} ने आपकी समीक्षा की${on(p)}।` }),
  review_waiting: (p) => ({
    title: 'डील की समीक्षा करें',
    body: `${who(p)} ने ${deal(p)} की समीक्षा की है। ${p.dueOn ? `${p.dueOn} तक ` : ''}अपनी समीक्षा जोड़ें; दोनों साथ में प्रकाशित होंगी।`,
  }),
  // M14 rental bookings: placeholder text until A3-3 writes each type's own (spec §10.3).
  rental_booking_requested: rental,
  rental_booking_changed: rental,
  rental_booking_confirmed: rental,
  rental_booking_declined: rental,
  rental_booking_withdrawn: rental,
  rental_booking_expired: rental,
  rental_booking_cancelled: rental,
  rental_booking_on_site: rental,
  rental_booking_returned: rental,
  rental_booking_completed: rental,
  rental_booking_starts_tomorrow: rental,
  rental_booking_due_back: rental,
  rental_booking_overdue: rental,
  rental_booking_not_started: rental,
  rental_booking_clash: rental,
  rental_booking_problem: rental,
  rental_booking_dispute_resolved: rental,
  listing_status: (p) => ({ title: 'लिस्टिंग अपडेट', body: `${listing(p)} की स्थिति बदली है।` }),
  // F8 part requests (spec §10.3). Needs a native speaker's check.
  part_request_new: (p) => ({
    title: p.requestTitle ? `एक खरीदार को ${p.requestTitle} चाहिए` : 'एक खरीदार ने ज़रूरत पोस्ट की',
    body: line(sideWord[p.side], p.quantity, p.city) || 'देखने के लिए ज़रूरत खोलें।',
  }),
  part_request_reply: (p) =>
    p.count > 1
      ? { title: `${request(p)} के लिए ${p.count} जवाब`, body: p.businessName ? `सबसे नया: ${p.businessName}।` : 'तुलना करने के लिए ज़रूरत खोलें।' }
      : { title: `${who(p)} ने आपकी ज़रूरत पर जवाब दिया`, body: `${p.requestTitle ? `${p.requestTitle}: ` : ''}लिस्टिंग देखने के लिए खोलें।` },
  part_match: (p) =>
    p.count > 1
      ? { title: `${request(p)} के लिए ${p.count} नए मिलान`, body: `सबसे नया: ${listing(p)}${away(p)}। तुलना करने के लिए ज़रूरत खोलें।` }
      : {
          title: `आपका ${sideWord[p.side] ? `${sideWord[p.side]} ` : ''}${request(p)} उपलब्ध है`,
          body: `${listing(p)}${away(p)}। ऑफ़र देने के लिए इसे खोलें।`,
        },
  part_request_expiring: (p) => ({
    title: p.dueOn ? `${request(p)} ${p.dueOn} को समाप्त होगी` : `${request(p)} जल्द समाप्त होगी`,
    body: 'जवाब पाते रहने के लिए इसे रिन्यू करें।',
  }),
  part_request_expired: (p) => ({
    title: `${request(p)} समाप्त हो गई`,
    body:
      p.dueOn && !p.duePassed
        ? `आप इसे ${p.dueOn} तक रिन्यू कर सकते हैं।`
        : 'यह अपनी अधिकतम अवधि पूरी कर चुकी है। अगर अब भी ज़रूरत है तो नई ज़रूरत पोस्ट करें।',
  }),
  part_request_fulfil_prompt: (p) => ({
    title: p.businessName ? `${p.businessName} के साथ डील तय हुई` : 'डील तय हुई',
    body: `क्या ${request(p)} को पूरी हुई मार्क करें?`,
  }),
  part_request_removed: (p) => ({ title: 'आपकी ज़रूरत हटा दी गई', body: `${request(p)} को हमारी टीम ने हटाया है।` }),
  part_request_reply_dropped: (p) => ({
    title: `${p.requestTitle ? `${p.requestTitle} पर ` : ''}आपका जवाब नहीं पहुँचा`,
    body: dropReason[p.reason],
  }),
};
