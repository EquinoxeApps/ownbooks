import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { setSpeed } from '@/features/player/controller';
import { PlayerPill } from '@/features/player/PlayerPill';
import { formatSpeed, MAX_SPEED, MIN_SPEED, SPEED_PRESETS, stepSpeed } from '@/features/player/speed';
import { usePlayerStore } from '@/features/player/store';
import { Text } from '@/ui';
import { fonts, playerColors } from '@/ui/tokens';

/** Playback speed sheet, opened from the player. Changes apply straight away. */
export default function Speed() {
  const { t } = useTranslation();
  const speed = usePlayerStore((s) => s.speed);
  const value = formatSpeed(speed);

  return (
    <View style={styles.root}>
      <Text style={styles.heading} color={playerColors.text} accessibilityRole="header">
        {t('player.speed')}
      </Text>

      <View style={styles.stepper}>
        <StepButton
          label="−"
          a11y={t('player.slower')}
          disabled={speed <= MIN_SPEED}
          onPress={() => setSpeed(stepSpeed(speed, -1))}
        />
        <Text
          style={styles.value}
          color={playerColors.text}
          accessibilityLabel={t('player.speedA11y', { speed: value })}
          accessibilityLiveRegion="polite">
          {t('player.speedValue', { speed: value })}
        </Text>
        <StepButton
          label="+"
          a11y={t('player.faster')}
          disabled={speed >= MAX_SPEED}
          onPress={() => setSpeed(stepSpeed(speed, 1))}
        />
      </View>

      <View style={styles.presets}>
        {SPEED_PRESETS.map((preset) => (
          <PlayerPill
            key={preset}
            label={t('player.speedValue', { speed: formatSpeed(preset) })}
            accessibilityLabel={t('player.speedA11y', { speed: formatSpeed(preset) })}
            selected={formatSpeed(preset) === value}
            onPress={() => setSpeed(preset)}
          />
        ))}
      </View>
    </View>
  );
}

function StepButton({
  label,
  a11y,
  disabled,
  onPress,
}: {
  label: string;
  a11y: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}>
      {({ pressed }) => (
        <View style={[styles.step, pressed && styles.stepPressed, disabled && styles.stepDisabled]}>
          <Text style={styles.stepLabel} color={playerColors.text}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: playerColors.bg, paddingHorizontal: 24, paddingTop: 28, paddingBottom: 40, gap: 28 },
  heading: { fontFamily: fonts.extraBold, fontSize: 24 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  value: { fontFamily: fonts.black, fontSize: 44, fontVariant: ['tabular-nums'] },
  step: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: playerColors.ring,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepPressed: { backgroundColor: playerColors.track },
  stepDisabled: { opacity: 0.35 },
  stepLabel: { fontFamily: fonts.bold, fontSize: 26, lineHeight: 30 },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
});
