import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme, fonts } from '@/lib/theme';
import { ChevronLeft } from '@/lib/icons';

interface HeaderProps {
  title: string;
  showBack?: boolean;
  onBack?: () => void;
  rightIcon?: React.ReactNode;
}

export default function Header({ title, showBack = true, onBack, rightIcon }: HeaderProps) {
  const navigation = useNavigation();
  const { colors } = useTheme();

  const s = useMemo(() => StyleSheet.create({
    container: {
      height: 56,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      backgroundColor: colors.background,
    },
    backButton: {
      width: 44,
      alignItems: 'flex-start',
      justifyContent: 'center',
    },
    backCircle: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rightButton: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      flex: 1,
      fontFamily: fonts.bold,
      fontSize: 20,
      color: colors.text,
      letterSpacing: -0.3,
      marginLeft: 12,
    },
    titleNoBack: {
      paddingLeft: 0,
    },
  }), [colors]);

  const handleBack = () => {
    if (onBack) onBack();
    else navigation.goBack();
  };

  return (
    <View style={s.container}>
      {showBack ? (
        <TouchableOpacity ph-label="Back-button" onPress={handleBack} style={s.backButton}>
          <View style={s.backCircle}>
            <ChevronLeft size={24} color={colors.text} />
          </View>
        </TouchableOpacity>
      ) : null}
      <Text style={[s.title, !showBack && s.titleNoBack]}>{title}</Text>
      {rightIcon ? (
        <View style={s.rightButton}>{rightIcon}</View>
      ) : showBack ? (
        <View style={s.backButton} />
      ) : null}
    </View>
  );
}
