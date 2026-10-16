import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { useDb } from '@/db/provider';
import { useAuthStore } from '@/features/auth/store';
import { FONT_SIZE, stepFontSize, useReaderSettings, type ReaderSettings } from '@/features/reader/settings';
import { colors, fonts, readerThemes, Text } from '@/ui';

/** "Reading settings" sheet from the design. Every change applies to the open book at once. */
export default function ReaderSettingsSheet() {
  const { t } = useTranslation();
  const db = useDb();
  const userId = useAuthStore((s) => s.account?.id ?? '');
  const settings = useReaderSettings((s) => s.settings);
  const update = useReaderSettings((s) => s.update);
  const change = (c: Partial<ReaderSettings>) => void update(db, userId, c);

  return (
    <View style={styles.root}>
      <Text variant="h2" accessibilityRole="header">
        {t('reader.settings')}
      </Text>

      <Group label={t('reader.theme')}>
        {(['auto', 'light', 'sepia', 'dark'] as const).map((theme) => {
          const swatch = theme === 'auto' ? null : readerThemes[theme];
          return (
            <Segment
              key={theme}
              label={t(`reader.themes.${theme}`)}
              selected={settings.theme === theme}
              background={swatch?.bg}
              color={swatch?.text}
              onPress={() => change({ theme })}
            />
          );
        })}
      </Group>

      <View style={styles.sizeRow}>
        <Text style={styles.groupLabel}>{t('reader.textSize')}</Text>
        <View style={styles.stepper}>
          <Round
            label="A−"
            a11y={t('reader.smaller')}
            disabled={settings.fontSize <= FONT_SIZE.min}
            onPress={() => change({ fontSize: stepFontSize(settings.fontSize, -1) })}
          />
          <Text style={styles.size} accessibilityLiveRegion="polite">
            {settings.fontSize}
          </Text>
          <Round
            label="A+"
            a11y={t('reader.larger')}
            disabled={settings.fontSize >= FONT_SIZE.max}
            onPress={() => change({ fontSize: stepFontSize(settings.fontSize, 1) })}
          />
        </View>
      </View>

      <Group label={t('reader.lineSpacing')}>
        {(['tight', 'normal', 'loose'] as const).map((lineSpacing) => (
          <Segment
            key={lineSpacing}
            label={t(`reader.lineSpacings.${lineSpacing}`)}
            selected={settings.lineSpacing === lineSpacing}
            onPress={() => change({ lineSpacing })}
          />
        ))}
      </Group>

      <Group label={t('reader.margins')}>
        {(['narrow', 'normal', 'wide'] as const).map((margins) => (
          <Segment
            key={margins}
            label={t(`reader.marginOptions.${margins}`)}
            selected={settings.margins === margins}
            onPress={() => change({ margins })}
          />
        ))}
      </Group>

      <Group label={t('reader.font')}>
        {(['literata', 'publisher'] as const).map((font) => (
          <Segment
            key={font}
            label={t(`reader.fonts.${font}`)}
            selected={settings.font === font}
            onPress={() => change({ font })}
          />
        ))}
      </Group>
    </View>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text style={styles.groupLabel}>{label}</Text>
      <View style={styles.segments}>{children}</View>
    </View>
  );
}

function Segment({
  label,
  selected,
  onPress,
  background,
  color,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  background?: string;
  color?: string;
}) {
  // Theme buttons show their own colours, with a green ring when chosen (as in the design).
  const swatch = background !== undefined;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.segment,
        swatch
          ? { backgroundColor: background, borderColor: selected ? colors.primary : colors.border }
          : selected
            ? styles.segmentSelected
            : styles.segmentIdle,
        pressed && styles.pressed,
      ]}>
      <Text
        style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}
        color={swatch ? color : selected ? colors.white : colors.ink}
        numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function Round({ label, a11y, disabled, onPress }: { label: string; a11y: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.round, pressed && styles.pressed, disabled && styles.disabled]}>
      <Text style={styles.roundLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.surface, paddingHorizontal: 20, paddingTop: 28, paddingBottom: 32, gap: 18 },
  group: { gap: 8 },
  groupLabel: { fontFamily: fonts.medium, fontSize: 15, color: colors.muted },
  segments: { flexDirection: 'row', gap: 8 },
  segment: {
    flex: 1,
    height: 44,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  segmentIdle: { backgroundColor: colors.surface, borderColor: colors.border },
  segmentSelected: { backgroundColor: colors.inkButton, borderColor: colors.inkButton },
  segmentLabel: { fontFamily: fonts.medium, fontSize: 15 },
  segmentLabelSelected: { fontFamily: fonts.bold },
  pressed: { opacity: 0.75 },
  sizeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  size: { fontFamily: fonts.bold, fontSize: 18, width: 28, textAlign: 'center' },
  round: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundLabel: { fontFamily: fonts.bold, fontSize: 16 },
  disabled: { opacity: 0.35 },
});
