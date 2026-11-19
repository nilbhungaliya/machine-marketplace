import React, { forwardRef, useMemo } from 'react';
import { Pressable, StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useType } from '@/hooks/use-type';
import { Search, X } from '@/lib/icons';
import { radius, spacing, useTheme } from '@/lib/theme';

interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  onFocus?: () => void;
  autoFocus?: boolean;
  testID: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The search bar (v2 `.searchbar`): a white pill with a hairline border, the search glass and a clear ×. The Search tab
 * and the results screen's top row (`.searchtop`, after the back button) use it.
 */
const SearchBar = forwardRef<TextInput, SearchBarProps>(function SearchBar(
  { value, onChangeText, onSubmit, onFocus, autoFocus, testID, style },
  ref,
) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const s = useMemo(() => StyleSheet.create({
    bar: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 50, paddingLeft: spacing.lg,
      borderRadius: radius.full, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline,
    },
    input: { ...type('fieldValue'), flex: 1, color: colors.text, paddingVertical: spacing.sm },
    clear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    pad: { width: spacing.lg },
  }), [colors, type]);

  return (
    <View style={[s.bar, style]}>
      <Search size={20} color={colors.textMuted} />
      <TextInput
        ref={ref}
        style={s.input}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        onFocus={onFocus}
        autoFocus={autoFocus}
        placeholder={t('discover.search.bar.placeholder')}
        placeholderTextColor={colors.textMuted}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        accessibilityLabel={t('discover.search.bar.submit')}
        testID={testID}
      />
      {value ? (
        <Pressable
          style={s.clear}
          onPress={() => onChangeText('')}
          testID={`${testID}-clear`}
          accessibilityRole="button"
          accessibilityLabel={t('discover.search.bar.clear')}
        >
          <X size={18} color={colors.textMuted} />
        </Pressable>
      ) : <View style={s.pad} />}
    </View>
  );
});

export default SearchBar;
