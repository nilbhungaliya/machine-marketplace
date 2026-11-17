import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { i18n, isLanguage, type Language } from '@/lib/i18n';
import { queryClient } from '@/lib/queryClient';

export const LANGUAGE_KEY = 'app_language';

/** A read error falls back to English and never overwrites a saved choice. */
export async function resolveBootLanguage(): Promise<Language> {
  try {
    const saved = await AsyncStorage.getItem(LANGUAGE_KEY);
    return isLanguage(saved) ? saved : 'en';
  } catch {
    return 'en';
  }
}

export async function initI18n(): Promise<void> {
  await i18n.changeLanguage(await resolveBootLanguage());
}

/** Rejects, leaving the language unchanged, when the choice cannot be saved. */
export async function setLanguage(lang: Language): Promise<void> {
  await AsyncStorage.setItem(LANGUAGE_KEY, lang);
  const prev = i18n.language;
  await i18n.changeLanguage(lang);
  // Cached catalogue text (categories, grades) is in the old language.
  if (prev !== lang) void queryClient.invalidateQueries();
}

const subscribeLanguage = (l: () => void) => {
  i18n.on('languageChanged', l);
  return () => i18n.off('languageChanged', l);
};
const currentLanguage = (): Language => (isLanguage(i18n.language) ? i18n.language : 'en');

export function useLanguage(): Language {
  return useSyncExternalStore(subscribeLanguage, currentLanguage);
}
