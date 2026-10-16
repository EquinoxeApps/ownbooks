import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/ui';
import { fonts, playerColors, touch } from '@/ui/tokens';

type PlayerPillProps = {
  label: string;
  onPress: () => void;
  selected?: boolean;
  accessibilityLabel?: string;
};

/** Outlined pill on the dark player (speed, sleep timer, presets). */
export function PlayerPill({ label, onPress, selected = false, accessibilityLabel }: PlayerPillProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      onPress={onPress}>
      {({ pressed }) => (
        <View style={[styles.base, selected && styles.selected, pressed && styles.pressed]}>
          <Text
            style={[styles.label, selected && styles.selectedLabel]}
            color={selected ? playerColors.bg : playerColors.muted}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: touch,
    paddingHorizontal: 18,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: playerColors.track,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selected: { backgroundColor: playerColors.accent, borderColor: playerColors.accent },
  pressed: { backgroundColor: playerColors.track },
  label: { fontFamily: fonts.medium, fontSize: 15, fontVariant: ['tabular-nums'] },
  selectedLabel: { fontFamily: fonts.bold },
});
