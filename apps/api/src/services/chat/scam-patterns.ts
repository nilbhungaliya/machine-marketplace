/**
 * The scam warning (F6 + F7 spec §6.7, R7; ported from textile `services/chat/scam-patterns.ts`, phrase set from plan
 * C0-3): a UPI link or handle, a payment-link host, or an ask for advance / token money in English, Hindi or Gujarati,
 * in their scripts and as commonly typed in Latin. Decided once when a message, offer note or deal note is written
 * (`scam_flag`). A warning shown to the other side, never a filter: false positives and misses are accepted.
 */

/** `upi://pay?…` or a `pay?pa=<vpa>` link. */
const UPI_LINK = /upi:\/\/|pay\?pa=/i;

/** Handles of the common UPI apps: `name@okaxis`, `@okhdfcbank`, `@okicici`, `@oksbi`, `@ybl`, `@paytm`, `@ibl`, `@axl`, `@upi`. */
const UPI_HANDLE = /(?<![A-Za-z0-9._-])[A-Za-z0-9._-]{2,64}@(?:ok(?:axis|hdfcbank|icici|sbi)|ybl|paytm|ibl|axl|upi)(?![A-Za-z0-9.@-])/i;

/** Payment-link hosts. */
const PAYMENT_HOST = /(?<![A-Za-z0-9-])(?:rzp\.io|razorpay\.me|paytm\.me|phon\.pe|gpay\.app\.goo\.gl|pay\.google\.com)\b/i;

/** Lower-cased text. `\b` is ASCII-only in JS, so the Devanagari and Gujarati phrases match as plain substrings. */
const ADVANCE_PHRASES: RegExp[] = [
  // English
  /\badvance\b/,
  /\btoken\s*(?:amount|money)\b/,
  /\bbooking\s*amount\b/,
  /\b(?:pay|send|transfer)\s+(?:the\s+)?(?:money\s+)?first\b/,
  // Hindi / Gujarati typed in Latin
  /\b(?:pehle|pahle|pehla|pahela)\s+(?:payment|paise|paisa)\b/,
  /\b(?:advance|token)\s+(?:bhejo|bhej\s*do|bhejiye)\b/,
  // Hindi
  /एडवांस|अग्रिम|पहले\s*(?:पैसे|पेमेंट|भुगतान)|टोकन\s*(?:राशि|अमाउंट)/,
  // Gujarati
  /એડવાન્સ|પહેલા\S*\s*(?:પૈસા|પેમેન્ટ|ચુકવણી)|ટોકન\s*(?:રકમ|અમાઉન્ટ)/,
];

export function looksLikeScam(text: string): boolean {
  if (UPI_LINK.test(text) || UPI_HANDLE.test(text) || PAYMENT_HOST.test(text)) return true;
  const lower = text.toLowerCase();
  return ADVANCE_PHRASES.some((phrase) => phrase.test(lower));
}
