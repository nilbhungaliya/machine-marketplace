/**
 * Masks contact details in user-written text when a reply is built (F6 + F7 spec §6.5, R6; ported from textile
 * `lib/mask-contact.ts`). The stored text never changes; `visibleText` (`services/chat/chat-view.ts`) decides when a
 * reader gets it masked.
 *
 * Phones: an optional +91, 91 or 0, then 10 digits, the first 6–9 when there's no prefix. Devanagari (U+0966–096F) and
 * Gujarati (U+0AE6–0AEF) digits count. Digits may be split by whitespace (a non-breaking space too), a hyphen, a dot or
 * a parenthesis, with whitespace on either side of one mark ("98765 - 43210", "(98765) 43210"). A digit directly before
 * or after rules out a match, so longer digit runs (part numbers, GSTINs) are left alone; so does a decimal point or
 * comma touching either end ("₹8000.00 - 9500.00", "1.000 - 2.500"): a match never starts right after, or ends right
 * before, a decimal fraction. "98765.43210" (the dot inside the match) is still a phone. The bounded separator and
 * fixed digit count keep this linear in the text's length.
 */

const PHONE_REPLACEMENT = '••••••••••';

const ANY_DIGIT = '[0-9\\u0966-\\u096F\\u0AE6-\\u0AEF]';
const MOBILE_FIRST_DIGIT = '[6-9\\u096C-\\u096F\\u0AEC-\\u0AEF]';
const ZERO = '[0\\u0966\\u0AE6]';
const ONE = '[1\\u0967\\u0AE7]';
const NINE = '[9\\u096F\\u0AEF]';
const SEPARATOR = '(?:\\s?[-.()]?\\s?)';

const NINE_MORE_DIGITS = `(?:${SEPARATOR}${ANY_DIGIT}){9}`;
const TEN_DIGITS = `${ANY_DIGIT}${NINE_MORE_DIGITS}`;

const PHONE = new RegExp(
  `(?<![.,]|${ANY_DIGIT})` +
    '\\(?' +
    '(?:' +
    `\\+?${NINE}${SEPARATOR}${ONE}${SEPARATOR}${TEN_DIGITS}` +
    `|${ZERO}${SEPARATOR}${TEN_DIGITS}` +
    `|${MOBILE_FIRST_DIGIT}${NINE_MORE_DIGITS}` +
    ')' +
    `(?!${ANY_DIGIT}|[.,]${ANY_DIGIT})`,
  'gu',
);

export function maskPhones(text: string): string {
  return text.replace(PHONE, PHONE_REPLACEMENT);
}

const EMAIL_REPLACEMENT = '•••@•••';

/**
 * A local part, `@`, then dot-separated labels ending in a 2+ letter top-level label; every part bounded, so the work
 * stays linear. A UPI handle (`name@okaxis`) has no dot after the `@`, so it isn't an email: the scam check flags it.
 */
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}(?![A-Za-z0-9-])/g;

export function maskEmails(text: string): string {
  return text.replace(EMAIL, EMAIL_REPLACEMENT);
}

/** Emails first: `9876543210@gmail.com` would otherwise lose its digits to the phone rule and keep its domain. */
export function maskContact(text: string): string {
  return maskPhones(maskEmails(text));
}
