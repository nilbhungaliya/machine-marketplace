import type { Language } from '@/lib/i18n';

/** The app runs in English until a choice is saved, so the picker preselects it. */
export const DEFAULT_LANGUAGE: Language = 'en';

// Each language named in itself, whatever the current one is.
export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', hi: 'हिन्दी', gu: 'ગુજરાતી' };

// Picker order. The hint names the option for someone who reads the other languages.
export const LANGUAGE_OPTIONS: ReadonlyArray<{ id: Language; label: string; hint: string }> = [
  { id: 'en', label: LANGUAGE_NAMES.en, hint: 'अंग्रेज़ी · અંગ્રેજી' },
  { id: 'hi', label: LANGUAGE_NAMES.hi, hint: 'Hindi' },
  { id: 'gu', label: LANGUAGE_NAMES.gu, hint: 'Gujarati' },
];
