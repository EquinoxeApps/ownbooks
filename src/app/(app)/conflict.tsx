import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { useDb } from '@/db/provider';
import { track } from '@/features/analytics';
import { listChapters } from '@/db/repositories/chapters';
import { listTracks } from '@/db/repositories/tracks';
import type { Db, ProgressRow, RemoteProgressRow } from '@/db/types';
import { goToBook } from '@/features/library/open';
import { buildChapters, chapterAt, type Chapter } from '@/features/player/chapters';
import { toGlobal, type TrackSpan } from '@/features/player/position';
import { acceptRemote, findConflict, keepLocal, type Conflict } from '@/features/sync/conflict';
import { dayAndTime, formatClock } from '@/lib/time';
import { Button, Card, colors, fonts, Text } from '@/ui';

type Position = Pick<ProgressRow, 'track_idx' | 'position_ms' | 'fraction'>;
type Loaded = Conflict & { tracks: TrackSpan[]; chapters: Chapter[] };

/**
 * "You're further ahead on <device>." (design: sync conflict). Shown before a book opens when
 * another device holds a newer position that's meaningfully different from this phone's.
 */
export default function ConflictSheet() {
  const { t, i18n } = useTranslation();
  const db = useDb();
  const { id, autoplay } = useLocalSearchParams<{ id: string; autoplay?: string }>();
  const [data, setData] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void load(db, id).then((loaded) => {
      if (cancelled) return;
      // Settled in the meantime (e.g. a newer sync): nothing to ask, so close.
      if (!loaded && router.canGoBack()) router.back();
      if (loaded) track('sync_conflict_shown', { type: loaded.book.type });
      setData(loaded);
    }, (error: unknown) => {
      // Never leave an empty sheet: close it, the book stays as it was.
      console.warn('Loading the conflict failed', error);
      if (!cancelled && router.canGoBack()) router.back();
    });
    return () => {
      cancelled = true;
    };
  }, [db, id]);

  if (!data) return <View style={styles.root} />;
  const { book, local, remote, tracks, chapters } = data;

  const where = (p: Position) => {
    if (book.type === 'ebook') return t('sync.conflict.percent', { percent: percent(p) });
    const globalMs = toGlobal(tracks, p.track_idx ?? 0, p.position_ms ?? 0);
    if (chapters.length > 1) {
      const idx = chapterAt(chapters, globalMs);
      return chapters[idx]?.title ?? t('sync.conflict.chapter', { number: idx + 1 });
    }
    return formatClock(globalMs);
  };
  // Ebooks have no chapter names here (the contents live in the EPUB), so only the percentage shows.
  const place = (p: Position) => [book.type === 'audio' ? where(p) : null, `${percent(p)}%`].filter(Boolean).join(' · ');
  const device = remote.device_name ?? t('sync.conflict.otherDevice');
  const ahead = remote.fraction >= local.fraction;
  const { day, time } = dayAndTime(remote.updated_at, i18n.language);
  const when = day === 'today' ? t('sync.conflict.today', { time }) : day === 'yesterday' ? t('sync.conflict.yesterday', { time }) : `${day}, ${time}`;

  const choose = (action: (db: Db, bookId: string) => Promise<void>) => async () => {
    setBusy(true);
    try {
      await action(db, book.id);
      goToBook(db, book, { autoplay: autoplay === '1', replace: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.copy}>
        <Text variant="sheetTitle" accessibilityRole="header">
          {ahead ? t('sync.conflict.ahead', { device }) : t('sync.conflict.newer', { device })}
        </Text>
        <Text variant="lead">{t('sync.conflict.question', { where: where(remote) })}</Text>
      </View>

      <Card selected style={styles.card}>
        <View style={styles.cardTop}>
          <View style={styles.cardText}>
            <Text style={styles.cardTitle}>{book.type === 'audio' ? `${device} · ${where(remote)}` : device}</Text>
            <Text variant="meta" color={colors.mutedStrong}>
              {`${when} · ${percent(remote)}%`}
            </Text>
          </View>
          <View style={styles.badge}>
            <Text style={styles.badgeLabel} color={colors.white}>
              {t('sync.conflict.recommended')}
            </Text>
          </View>
        </View>
        <Button label={t('sync.conflict.continue', { device })} onPress={choose(acceptRemote)} loading={busy} />
      </Card>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('sync.conflict.keep')}, ${place(local)}`}
        disabled={busy}
        onPress={choose(keepLocal)}
        style={({ pressed }) => [styles.keep, pressed && styles.pressed]}>
        <Text variant="link" style={styles.keepLabel}>
          {t('sync.conflict.keep')}
        </Text>
        <Text variant="meta">{place(local)}</Text>
      </Pressable>

      <Text variant="caption" style={styles.center}>
        {book.type === 'ebook' ? t('sync.conflict.noteEbook') : t('sync.conflict.noteAudio')}
      </Text>
    </View>
  );
}

async function load(db: Db, bookId: string): Promise<Loaded | null> {
  const conflict = await findConflict(db, bookId);
  if (!conflict) return null;
  const [trackRows, chapterRows] = await Promise.all([listTracks(db, bookId), listChapters(db, bookId)]);
  const tracks = trackRows.map((r) => ({ title: r.title, durationMs: r.duration_ms }));
  return { ...conflict, tracks, chapters: buildChapters(tracks, chapterRows) };
}

const percent = (p: Pick<RemoteProgressRow, 'fraction'>) => Math.round(p.fraction * 100);

const styles = StyleSheet.create({
  root: { backgroundColor: colors.bg, paddingHorizontal: 20, paddingTop: 28, paddingBottom: 32, gap: 22 },
  copy: { gap: 10 },
  card: { gap: 16 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  cardText: { flex: 1, gap: 4 },
  cardTitle: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 24 },
  badge: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: colors.primaryDark },
  badgeLabel: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 16 },
  keep: { minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 3, paddingVertical: 4 },
  keepLabel: { fontSize: 17 },
  pressed: { opacity: 0.6 },
  center: { textAlign: 'center' },
});
