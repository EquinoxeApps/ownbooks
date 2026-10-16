import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { jumpToChapter } from '@/features/player/controller';
import { usePlayerStore } from '@/features/player/store';
import { formatClock, formatDurationShort } from '@/lib/time';
import { Text } from '@/ui';
import { fonts, playerColors } from '@/ui/tokens';

const ROW_HEIGHT = 68;

/** Chapter list sheet, opened from the player's "Chapters" button. */
export default function Chapters() {
  const { t } = useTranslation();
  const chapters = usePlayerStore((s) => s.chapters);
  const current = usePlayerStore((s) => s.chapterIdx);
  const title = usePlayerStore((s) => s.title);
  // Scroll to where we were when the sheet opened, with a little context above.
  const [initialIndex] = useState(() => Math.max(0, usePlayerStore.getState().chapterIdx - 2));

  const choose = (index: number) => {
    void jumpToChapter(index);
    if (router.canGoBack()) router.back();
  };

  const durationLabel = (ms: number) => {
    const { hours, minutes } = formatDurationShort(ms);
    return hours > 0 ? t('player.durationHours', { hours, minutes }) : t('player.durationMinutes', { count: minutes });
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.heading} color={playerColors.text} accessibilityRole="header">
          {t('player.chapters')}
        </Text>
        <Text variant="meta" color={playerColors.muted} numberOfLines={1}>
          {title}
        </Text>
      </View>
      <FlatList
        data={chapters}
        // Android sheets only let a list scroll when it supports nested scrolling;
        // otherwise the drag moves the sheet.
        nestedScrollEnabled
        keyExtractor={(c) => `${c.trackIdx}:${c.startMs}`}
        getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
        initialScrollIndex={Math.min(initialIndex, Math.max(0, chapters.length - 1))}
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => {
          const playing = index === current;
          const name = item.title ?? t('player.chapterFallback', { number: index + 1 });
          const color = playing ? playerColors.accent : playerColors.text;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: playing }}
              accessibilityLabel={t('player.chapterA11y', {
                number: index + 1,
                title: name,
                duration: durationLabel(item.durationMs),
              })}
              accessibilityHint={playing ? t('player.nowPlaying') : undefined}
              onPress={() => choose(index)}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
              <Text style={styles.number} color={playing ? playerColors.accent : playerColors.muted}>
                {index + 1}
              </Text>
              <View style={styles.rowText}>
                <Text style={styles.title} color={color} numberOfLines={1}>
                  {name}
                </Text>
                <Text style={styles.meta} color={playing ? playerColors.accent : playerColors.muted} numberOfLines={1}>
                  {playing ? `${t('player.nowPlaying')} · ${formatClock(item.durationMs)}` : formatClock(item.durationMs)}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: playerColors.bg },
  header: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 12, gap: 4 },
  heading: { fontFamily: fonts.extraBold, fontSize: 24 },
  list: { paddingBottom: 32 },
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: playerColors.track,
  },
  rowPressed: { backgroundColor: playerColors.track },
  number: { width: 32, fontFamily: fonts.bold, fontSize: 15, fontVariant: ['tabular-nums'] },
  rowText: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.bold, fontSize: 17 },
  meta: { fontFamily: fonts.medium, fontSize: 14, fontVariant: ['tabular-nums'] },
});
