import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { setSleepTimer } from '@/features/player/controller';
import { SLEEP_MINUTES } from '@/features/player/sleep';
import { usePlayerStore } from '@/features/player/store';
import { formatClock } from '@/lib/time';
import { Text } from '@/ui';
import { fonts, playerColors } from '@/ui/tokens';

/** Sleep timer sheet, opened from the player. */
export default function Sleep() {
  const { t } = useTranslation();
  const sleep = usePlayerStore((s) => s.sleep);
  const hasChapters = usePlayerStore((s) => s.chapters.length > 1);

  const choose = (choice: Parameters<typeof setSleepTimer>[0]) => {
    setSleepTimer(choice);
    if (router.canGoBack()) router.back();
  };

  const status =
    sleep?.kind === 'duration'
      ? t('player.sleepStopsIn', { time: formatClock(sleep.remainingMs) })
      : sleep?.kind === 'chapterEnd'
        ? t('player.sleepStopsAtChapterEnd')
        : null;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.heading} color={playerColors.text} accessibilityRole="header">
          {t('player.sleep')}
        </Text>
        {status ? (
          <Text variant="meta" color={playerColors.accent}>
            {status}
          </Text>
        ) : null}
      </View>
      {SLEEP_MINUTES.map((minutes) => (
        <Row
          key={minutes}
          label={minutes === 60 ? t('player.sleepOneHour') : t('player.durationMinutes', { count: minutes })}
          onPress={() => choose({ minutes })}
        />
      ))}
      {hasChapters ? (
        <Row
          label={t('player.sleepEndOfChapter')}
          selected={sleep?.kind === 'chapterEnd'}
          onPress={() => choose('chapterEnd')}
        />
      ) : null}
      {sleep ? <Row label={t('player.sleepOff')} accent onPress={() => choose(null)} /> : null}
    </View>
  );
}

function Row({
  label,
  onPress,
  selected = false,
  accent = false,
}: {
  label: string;
  onPress: () => void;
  selected?: boolean;
  accent?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <Text style={styles.rowLabel} color={selected || accent ? playerColors.accent : playerColors.text}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: playerColors.bg, paddingBottom: 32 },
  header: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 12, gap: 4 },
  heading: { fontFamily: fonts.extraBold, fontSize: 24 },
  row: {
    minHeight: 56,
    justifyContent: 'center',
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: playerColors.track,
  },
  rowPressed: { backgroundColor: playerColors.track },
  rowLabel: { fontFamily: fonts.bold, fontSize: 17 },
});
