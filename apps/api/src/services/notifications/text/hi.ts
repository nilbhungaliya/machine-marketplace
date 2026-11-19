import type { NotificationTexts, TextParams } from './types.js';

// Hindi notification text (F6 + F7 spec §11.3, §11.4). Needs a native speaker's check (spec §25).

const listing = (p: TextParams) => p.listingTitle || 'आपकी लिस्टिंग';
const who = (p: TextParams) => p.businessName || 'दूसरे व्यवसाय';
const at = (p: TextParams) => (p.price ? ` ${p.price} प्रति यूनिट पर` : '');
const qty = (p: TextParams) => (p.quantity ? ` ${p.quantity} के लिए` : '');
const deal = (p: TextParams) => (p.dealRef ? `डील ${p.dealRef}` : 'आपकी डील');
const on = (p: TextParams) => (p.listingTitle ? ` (${p.listingTitle})` : '');

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
  part_match: (p) => ({ title: 'नया मिलान', body: `एक लिस्टिंग आपकी ज़रूरत से मेल खाती है${p.listingTitle ? `: ${p.listingTitle}` : ''}।` }),
  booking_update: () => ({ title: 'बुकिंग अपडेट', body: 'एक बुकिंग बदली है। विवरण देखने के लिए खोलें।' }),
  listing_status: (p) => ({ title: 'लिस्टिंग अपडेट', body: `${listing(p)} की स्थिति बदली है।` }),
};
