import { describe, expect, it } from 'vitest';
import { looksLikeScam } from './scam-patterns.js';

// F6 + F7 §6.7 (R7), plan C0-3: every phrase, handle and host of the set is flagged; ordinary enquiries are not.
describe('looksLikeScam', () => {
  it.each([
    // English
    'Please send the advance first',
    'advance payment needed to book',
    'token amount 5000 and the part is yours',
    'pay first, then I dispatch',
    'booking amount required today',
    // Latin-typed Hindi / Gujarati
    'pehle payment karo',
    'pehle paise bhejo bhai',
    'advance bhejo',
    'token bhejo aaj',
    // Hindi
    'एडवांस भेज दीजिए',
    'अग्रिम राशि',
    'पहले पैसे भेजो',
    'पहले पेमेंट करें',
    'टोकन राशि जमा करें',
    // Gujarati
    'એડવાન્સ મોકલો',
    'પહેલા પૈસા મોકલો',
    'પહેલાં પેમેન્ટ કરો',
    'ટોકન રકમ આપો',
    // UPI links and handles
    'upi://pay?pa=rocky@okaxis&am=500',
    'https://example.com/pay?pa=shop',
    'pay to rocky@okaxis',
    'shop@okhdfcbank',
    'x.y@okicici',
    'ab@oksbi',
    'seller@ybl',
    'seller99@paytm',
    'seller@ibl',
    'seller@axl',
    'seller@upi',
    // Payment-link hosts
    'https://rzp.io/l/abc',
    'razorpay.me/@shop',
    'paytm.me/x-1',
    'phon.pe/abc',
    'gpay.app.goo.gl/xyz',
    'https://pay.google.com/abc',
  ])('flags %s', (text) => {
    expect(looksLikeScam(text)).toBe(true);
  });

  it.each([
    'Is the left-hand side cylinder still available?',
    'Can you send more photos of the gearbox?',
    'What is the final price for 10 pieces?',
    'Mail me at rahul@gmail.com for the invoice',
    'Machine चालू हालत में है? कब देख सकते हैं?',
  ])('does not flag %s', (text) => {
    expect(looksLikeScam(text)).toBe(false);
  });
});
