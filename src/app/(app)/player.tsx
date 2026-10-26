import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  nextChapter,
  previousChapter,
  seekToGlobal,
  skipBy,
  togglePlay,
} from '@/features/player/controller';
import { PlayerCover } from '@/features/player/PlayerCover';
import { PlayerPill } from '@/features/player/PlayerPill';
import { toGlobal } from '@/features/player/position';
import { SeekBar } from '@/features/player/SeekBar';
import { formatSpeed } from '@/features/player/speed';
import { usePlayerStore } from '@/features/player/store';
import { formatClock, formatRemaining } from '@/lib/time';
import { Icon, IconButton, Text, useAnnounce } from '@/ui';
import { fonts, playerColors } from '@/ui/tokens';

// Matches the lock-screen buttons (patches/expo-audio+57.0.5.patch).
const SKIP_MS = 30_000;

export default function Player() {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const s = usePlayerStore();

  const close = () => (router.canGoBack() ? router.back() : router.replace('/library'));

  if (!s.bookId) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.topRow}>
          <IconButton icon="chevronDown" accessibilityLabel={t('player.close')} color={playerColors.text} onPress={close} />
        </View>
        <View style={styles.pending}>
          {s.error ? (
            <PlayerError message={t(`player.errors.${s.error}`)} />
          ) : (
            <ActivityIndicator
              color={playerColors.text}
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel={t('player.loading')}
            />
          )}
        </View>
      </SafeAreaView>
    );
  }

  // The seek bar and times cover the current chapter (a whole track when it has no chapters).
  const chapter = s.chapters[s.chapterIdx];
  const multi = s.chapters.length > 1;
  const chapterStart = chapter?.globalStartMs ?? 0;
  const chapterDuration = chapter?.durationMs ?? 0;
  const elapsed = Math.min(chapterDuration, Math.max(0, toGlobal(s.tracks, s.trackIdx, s.positionMs) - chapterStart));
  const heading = multi ? (chapter?.title ?? t('player.chapterFallback', { number: s.chapterIdx + 1 })) : s.title;
  // Smaller on short screens, so the controls and the speed / sleep row still fit.
  const coverSize = Math.min(292, width - 96, height * 0.34);
  const sleepLabel =
    s.sleep?.kind === 'duration'
      ? t('player.sleepIn', { time: formatClock(s.sleep.remainingMs) })
      : s.sleep?.kind === 'chapterEnd'
        ? t('player.sleepAtChapterEnd')
        : t('player.sleep');

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.topRow}>
        <View style={styles.closeButton}>
          <IconButton
            icon="chevronDown"
            accessibilityLabel={t('player.close')}
            color={playerColors.text}
            strokeWidth={2.6}
            onPress={close}
          />
        </View>
        <Text variant="meta" color={playerColors.muted} style={styles.topLabel}>
          {multi ? t('player.chapterOf', { current: s.chapterIdx + 1, total: s.chapters.length }) : ''}
        </Text>
        <View style={styles.chaptersButton}>
          {multi ? (
            <IconButton
              icon="list"
              accessibilityLabel={t('player.chapters')}
              color={playerColors.text}
              strokeWidth={2.4}
              onPress={() => router.push('/chapters')}
            />
          ) : (
            <View style={styles.spacer} />
          )}
        </View>
      </View>

      <PlayerCover uri={s.coverUri} title={s.title} author={s.author} size={coverSize} />

      <View style={styles.titles}>
        <Text style={styles.heading} color={playerColors.text} numberOfLines={2} accessibilityRole="header">
          {heading}
        </Text>
        <Text style={styles.sub} color={playerColors.muted} numberOfLines={1}>
          {[multi ? s.title : null, s.author].filter(Boolean).join(' · ')}
        </Text>
      </View>

      {s.error ? (
        <PlayerError message={t(`player.errors.${s.error}`)} />
      ) : (
        <View style={styles.seek}>
          <SeekBar
            positionMs={elapsed}
            durationMs={chapterDuration}
            onSeek={(ms) => seekToGlobal(chapterStart + ms)}
            accessibilityLabel={t('player.seek')}
            accessibilityValueText={`${t('player.elapsed', { time: formatClock(elapsed) })}, ${t(
              'player.remaining',
              { time: formatClock(chapterDuration - elapsed) },
            )}`}
          />
          <View style={styles.times}>
            <Text style={styles.time} color={playerColors.muted}>
              {formatClock(elapsed)}
            </Text>
            <Text style={styles.time} color={playerColors.muted}>
              {formatRemaining(chapterDuration - elapsed)}
            </Text>
          </View>
        </View>
      )}

      <View style={styles.controls}>
        {multi ? (
          <IconButton
            icon="prevChapter"
            accessibilityLabel={t('player.previousChapter')}
            color={playerColors.muted}
            iconSize={20}
            onPress={previousChapter}
          />
        ) : (
          <View style={styles.spacer} />
        )}
        <RoundSkip label={'−30'} a11y={t('player.skipBack', { seconds: 30 })} onPress={() => skipBy(-SKIP_MS)} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={s.playing ? t('player.pause') : t('player.play')}
          onPress={togglePlay}
          disabled={!!s.error}>
          {({ pressed }) => (
            <View style={[styles.playButton, pressed && styles.playPressed]}>
              <Icon name={s.playing ? 'pause' : 'play'} size={30} color={playerColors.bg} />
            </View>
          )}
        </Pressable>
        <RoundSkip label="+30" a11y={t('player.skipForward', { seconds: 30 })} onPress={() => skipBy(SKIP_MS)} />
        {multi ? (
          <IconButton
            icon="nextChapter"
            accessibilityLabel={t('player.nextChapter')}
            color={playerColors.muted}
            iconSize={20}
            onPress={nextChapter}
          />
        ) : (
          <View style={styles.spacer} />
        )}
      </View>

      <View style={styles.extras}>
        <PlayerPill
          label={t('player.speedButton', { speed: formatSpeed(s.speed) })}
          accessibilityLabel={t('player.speedA11y', { speed: formatSpeed(s.speed) })}
          onPress={() => router.push('/speed')}
        />
        <PlayerPill label={sleepLabel} selected={!!s.sleep} onPress={() => router.push('/sleep')} />
      </View>
    </SafeAreaView>
  );
}

function RoundSkip({ label, a11y, onPress }: { label: string; a11y: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y} onPress={onPress}>
      {({ pressed }) => (
        <View style={[styles.skip, pressed && styles.skipPressed]}>
          <Text style={styles.skipLabel} color={playerColors.text}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

function PlayerError({ message }: { message: string }) {
  useAnnounce(message);
  return (
    <Text style={styles.error} color={playerColors.accent} accessibilityRole="alert" accessibilityLiveRegion="polite">
      {message}
    </Text>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: playerColors.bg,
    paddingHorizontal: 24,
    paddingBottom: 24,
    justifyContent: 'space-between',
  },
  topRow: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  closeButton: { marginLeft: -10 },
  topLabel: { fontFamily: fonts.medium },
  chaptersButton: { marginRight: -10 },
  titles: { gap: 10 },
  heading: { fontFamily: fonts.black, fontSize: 30, lineHeight: 34, letterSpacing: -0.3 },
  sub: { fontSize: 16 },
  error: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 22 },
  pending: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  seek: { gap: 2 },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { fontFamily: fonts.medium, fontSize: 14, fontVariant: ['tabular-nums'] },
  controls: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  extras: { flexDirection: 'row', justifyContent: 'center', gap: 12 },
  spacer: { width: 44, height: 44 },
  playButton: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: playerColors.text,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 4,
    borderBottomColor: playerColors.muted,
  },
  playPressed: { borderBottomWidth: 1, transform: [{ translateY: 3 }] },
  skip: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: playerColors.ring,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipPressed: { backgroundColor: playerColors.track },
  skipLabel: { fontFamily: fonts.bold, fontSize: 16 },
});
