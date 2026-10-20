import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { useDb } from '@/db/provider';
import { openBook, resumeBook } from '@/features/library/open';
import { Cover, Icon, Text } from '@/ui';
import { colors, fonts } from '@/ui/tokens';

import { pause } from './controller';
import { fractionOf } from './position';
import { usePlayerStore } from './store';

/** Mini-player from the library design, shown above the tab bar while a book is loaded. */
export function MiniPlayer() {
  const { t } = useTranslation();
  const db = useDb();
  const bookId = usePlayerStore((s) => s.bookId);
  const title = usePlayerStore((s) => s.title);
  const playing = usePlayerStore((s) => s.playing);
  const tracks = usePlayerStore((s) => s.tracks);
  const trackIdx = usePlayerStore((s) => s.trackIdx);
  const positionMs = usePlayerStore((s) => s.positionMs);
  const coverUri = usePlayerStore((s) => s.coverUri);
  const chapterCount = usePlayerStore((s) => s.chapters.length);
  const chapterIdx = usePlayerStore((s) => s.chapterIdx);
  if (!bookId) return null;

  const fraction = fractionOf(tracks, trackIdx, positionMs);
  const subtitle = [
    chapterCount > 1 ? t('player.chapterOf', { current: chapterIdx + 1, total: chapterCount }) : null,
    playing ? t('player.playing') : t('player.paused'),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.strip}>
          <View style={[styles.stripFill, { width: `${fraction * 100}%` }]} />
        </View>
        <View style={styles.row}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('player.open', { title })}
            // Like any open, this offers a newer position from another device first.
            onPress={() => void openBook(db, { id: bookId, type: 'audio', on_device: 1 })}
            style={styles.open}>
            <Cover uri={coverUri} title={title} width={40} height={40} />
            <View style={styles.text}>
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              <Text variant="caption" numberOfLines={1}>
                {subtitle}
              </Text>
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={playing ? t('player.pause') : t('player.play')}
            onPress={() => (playing ? pause() : void resumeBook(db, bookId))}
            hitSlop={8}
            style={styles.playButton}>
            <Icon name={playing ? 'pause' : 'play'} size={20} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingBottom: 10, backgroundColor: 'transparent' },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 18,
    overflow: 'hidden',
  },
  strip: { height: 4, backgroundColor: colors.primaryTint },
  stripFill: { height: 4, backgroundColor: colors.primary },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingLeft: 12, paddingRight: 4 },
  open: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  text: { flex: 1 },
  title: { fontFamily: fonts.bold, fontSize: 15 },
  playButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
