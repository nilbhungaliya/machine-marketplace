import 'intl-pluralrules';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { resources } from '@/locales';

export type Language = 'en' | 'hi' | 'gu';
export const isLanguage = (v: unknown): v is Language => v === 'en' || v === 'hi' || v === 'gu';

export const i18n = i18next.createInstance();

// Synchronous English init: pure helpers and tests can call i18n.t() at import
// time without awaiting boot; initI18n() switches language afterwards.
void i18n.use(initReactI18next).init({
  resources,
  lng: 'en',
  fallbackLng: 'en',
  initAsync: false,
  interpolation: { escapeValue: false },
  returnNull: false,
  showSupportNotice: false,
});
