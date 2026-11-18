import { useMemo } from 'react';
import { useLanguage } from '@/lib/i18n/language';
import { typeStyle, type TypeStyle, type TypeToken } from '@/lib/typography';

/**
 * The type scale for the current language: `const type = useType(); … title: { ...type('title'), color }`.
 * Memoised on the language, so add `type` to the deps of the `useMemo` that builds the StyleSheet.
 */
export function useType(): (token: TypeToken) => TypeStyle {
  const lang = useLanguage();
  return useMemo(() => (token: TypeToken) => typeStyle(token, lang), [lang]);
}
