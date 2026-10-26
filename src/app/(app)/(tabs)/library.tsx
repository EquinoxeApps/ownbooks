import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDb, useLiveQuery } from '@/db/provider';
import { listLibrary, type LibraryFilter, type LibraryItem } from '@/db/repositories/books';
import { useAuthStore } from '@/features/auth/store';
import { pickAndImport } from '@/features/import/importer';
import { openBook as open } from '@/features/library/open';
import { useLibraryPrefs } from '@/features/library/store';
import { fileUri } from '@/lib/files';
import { formatDurationShort } from '@/lib/time';
import {
  Button,
  Card,
  Chip,
  colors,
  Cover,
  ErrorText,
  fonts,
  Icon,
  IconButton,
  ProgressBar,
  Text,
} from '@/ui';

const FILTERS: LibraryFilter[] = ['all', 'audio', 'ebook'];

export default function Library() {
  const { t } = useTranslation();
  const userId = useAuthStore((s) => s.account?.id ?? '');
  const choice = useAuthStore((s) => s.onboardingChoice);
  // The onboarding answer picks the starting filter.
  const [filter, setFilter] = useState<LibraryFilter>(
    choice === 'audio' ? 'audio' : choice === 'ebook' ? 'ebook' : 'all',
  );
  const db = useDb();
  const sort = useLibraryPrefs((s) => s.sort);
  const loadPrefs = useLibraryPrefs((s) => s.load);

  useEffect(() => {
    if (userId) void loadPrefs(db, userId);
  }, [db, userId, loadPrefs]);

  const { data: all, error } = useLiveQuery(
    (db) => listLibrary(db, userId, 'all', sort),
    ['books', 'progress'],
    `${userId}:${sort}`,
  );
  const books = (all ?? []).filter((b) => filter === 'all' || b.type === filter);
  // The most recently opened book that isn't finished.
  const current = (all ?? [])
    .filter((b) => b.last_opened_at != null && b.finished_at == null && b.on_device === 1)
    .sort((a, b) => (b.last_opened_at ?? 0) - (a.last_opened_at ?? 0))[0];

  const startImport = async () => {
    if (await pickAndImport(db, userId)) router.push('/import');
  };

  const openBook = (book: LibraryItem, autoplay = false) => void open(db, book, { autoplay });

  const openDetails = (book: LibraryItem) => router.push({ pathname: '/book/[id]', params: { id: book.id } });

  if (error && !all) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <View style={styles.emptyPage}>
          <Text variant="h1" accessibilityRole="header">
            {t('library.title')}
          </Text>
          <View style={styles.emptyBody}>
            <ErrorText message={t('library.loadFailed')} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Avoid flashing the list header before we know whether the shelf is empty.
  if (!all) return <SafeAreaView edges={['top']} style={styles.root} />;

  if (all.length === 0) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <View style={styles.emptyPage}>
          <Text variant="h1" accessibilityRole="header">
            {t('library.title')}
          </Text>
          <View style={styles.emptyBody}>
            <View style={styles.emptyArt} accessible={false} importantForAccessibility="no-hide-descendants">
              <View style={styles.emptyBooks}>
                <View style={[styles.dashedSpine, { width: 24, height: 76 }]} />
                <View style={[styles.dashedSpine, { width: 30, height: 92 }]} />
                <View style={[styles.dashedSpine, { width: 22, height: 64 }]} />
              </View>
              <View style={styles.emptyShelf} />
            </View>
            <View style={styles.emptyCopy}>
              <Text variant="sheetTitle" style={styles.center} accessibilityRole="header">
                {t('library.empty.title')}
              </Text>
              <Text variant="lead" style={styles.center}>
                {t(
                  choice === 'audio'
                    ? 'library.empty.bodyAudio'
                    : choice === 'ebook'
                      ? 'library.empty.bodyEbook'
                      : 'library.empty.body',
                )}
              </Text>
            </View>
          </View>
          <View style={styles.emptyFooter}>
            <Button label={t('library.empty.cta')} onPress={startImport} />
            <Text variant="meta" style={styles.center}>
              {t('library.empty.formats')}
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <FlatList
        data={books}
        keyExtractor={(b) => b.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Text variant="h1" accessibilityRole="header">
                {t('library.title')}
              </Text>
              <IconButton
                icon="plus"
                variant="ink"
                size={48}
                iconSize={22}
                strokeWidth={2.8}
                accessibilityLabel={t('library.import')}
                onPress={startImport}
              />
            </View>
            {current ? (
              <View style={styles.section}>
                <Text variant="h2" accessibilityRole="header">
                  {t('library.continue')}
                </Text>
                <ContinueCard book={current} onOpen={() => openBook(current)} onPlay={() => openBook(current, true)} />
              </View>
            ) : null}
            <View style={styles.sectionRow}>
              <Text variant="h2" accessibilityRole="header">
                {t('library.yourBooks')}
              </Text>
              <Button variant="link" label={t('library.sort')} onPress={() => router.push('/sort')} />
            </View>
            <View style={styles.filters}>
              {FILTERS.map((f) => (
                <Chip
                  key={f}
                  label={t(`library.filter.${f}`)}
                  selected={filter === f}
                  onPress={() => setFilter(f)}
                />
              ))}
            </View>
          </View>
        }
        renderItem={({ item }) =>
          item.on_device ? (
            <BookRow book={item} onPress={() => openBook(item)} onDetails={() => openDetails(item)} />
          ) : (
            <PlaceholderRow book={item} onPress={() => openDetails(item)} onImport={startImport} />
          )
        }
        ItemSeparatorComponent={() => <View style={{ height: 24 }} />}
        ListEmptyComponent={
          <Text variant="body" style={styles.center}>
            {t(filter === 'audio' ? 'library.noneOfType.audio' : 'library.noneOfType.ebook')}
          </Text>
        }
      />
    </SafeAreaView>
  );
}

function ContinueCard({ book, onOpen, onPlay }: { book: LibraryItem; onOpen: () => void; onPlay: () => void }) {
  const { t } = useTranslation();
  const pct = Math.round((book.fraction ?? 0) * 100);
  let left: string | null = book.type === 'ebook' ? t('library.percentRead', { percent: pct }) : null;
  if (book.type === 'audio' && book.duration_ms) {
    const { hours, minutes } = formatDurationShort(book.duration_ms * (1 - (book.fraction ?? 0)));
    left = hours > 0 ? t('library.hoursLeft', { hours, minutes }) : t('library.minutesLeft', { count: minutes });
  }
  return (
    <Card style={styles.continueCard} padding={16}>
      <Pressable
        style={({ pressed }) => [styles.continueBody, pressed && styles.rowPressed]}
        accessibilityRole="button"
        accessibilityLabel={[book.title, left, `${pct}%`].filter(Boolean).join(', ')}
        onPress={onOpen}>
        <Cover uri={fileUri(book.cover_path)} title={book.title} width={64} height={88} radius={10} />
        <View style={styles.rowText}>
          <Text style={styles.continueTitle} numberOfLines={2}>
            {book.title}
          </Text>
          {left ? <Text variant="meta">{left}</Text> : null}
          <View style={styles.progressRow}>
            <ProgressBar value={book.fraction ?? 0} />
            <Text variant="caption" color={colors.primaryDark} style={styles.pct}>
              {pct}%
            </Text>
          </View>
        </View>
      </Pressable>
      <IconButton
        icon={book.type === 'ebook' ? 'book' : 'play'}
        variant="ink"
        size={52}
        iconSize={22}
        accessibilityLabel={
          book.type === 'ebook'
            ? t('library.continueReading', { title: book.title })
            : t('library.continueListening', { title: book.title })
        }
        onPress={onPlay}
      />
    </Card>
  );
}

function BookRow({ book, onPress, onDetails }: { book: LibraryItem; onPress: () => void; onDetails: () => void }) {
  const { t } = useTranslation();
  const pct = Math.round((book.fraction ?? 0) * 100);
  const meta = [book.author, t(`library.type.${book.type}`)].filter(Boolean).join(' · ');
  const details = t('library.more', { title: book.title });
  return (
    <View style={styles.rowWrap}>
      <Pressable
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        accessibilityRole="button"
        accessibilityLabel={`${book.title}, ${meta}, ${pct}%`}
        accessibilityActions={[{ name: 'details', label: details }]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'details') onDetails();
        }}
        onLongPress={onDetails}
        onPress={onPress}>
        <Cover uri={fileUri(book.cover_path)} title={book.title} width={60} height={84} />
        <View style={styles.rowText}>
          <Text variant="title" numberOfLines={2}>
            {book.title}
          </Text>
          <Text variant="meta">{meta}</Text>
          <View style={styles.progressRow}>
            <ProgressBar value={book.fraction ?? 0} />
            <Text variant="caption" color={colors.primaryDark} style={styles.pct}>
              {pct}%
            </Text>
          </View>
        </View>
      </Pressable>
      <IconButton icon="more" accessibilityLabel={details} color={colors.muted} iconSize={20} onPress={onDetails} />
    </View>
  );
}

/** A book known from another device (design: library, "Not on this device"). */
function PlaceholderRow({ book, onPress, onImport }: { book: LibraryItem; onPress: () => void; onImport: () => void }) {
  const { t } = useTranslation();
  const pct = Math.round((book.fraction ?? 0) * 100);
  const last = book.last_device
    ? t(book.type === 'ebook' ? 'library.lastReadOn' : 'library.lastListenedOn', { device: book.last_device, percent: pct })
    : t('library.percentDone', { percent: pct });
  return (
    <View style={styles.rowWrap}>
      <Pressable
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        accessibilityRole="button"
        accessibilityLabel={`${book.title}, ${t('library.notOnDevice')}, ${last}`}
        accessibilityHint={t('library.placeholderHint')}
        onPress={onPress}>
        <View style={styles.placeholderCover}>
          <Icon name="cloud" size={24} color={colors.muted} />
        </View>
        <View style={styles.rowText}>
          <Text variant="title" numberOfLines={2}>
            {book.title}
          </Text>
          <Text variant="meta">{t('library.notOnDevice')}</Text>
          <Text variant="caption">{last}</Text>
        </View>
      </Pressable>
      <Button variant="secondary" compact label={t('library.importHere')} onPress={onImport} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { textAlign: 'center' },
  emptyPage: { flex: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24, justifyContent: 'space-between' },
  emptyBody: { alignItems: 'center', gap: 28 },
  emptyArt: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyBooks: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: 92 },
  dashedSpine: { borderRadius: 6, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.primary },
  emptyShelf: { width: 124, height: 8, borderRadius: 4, backgroundColor: colors.primaryDark, marginTop: 4 },
  emptyCopy: { gap: 12 },
  emptyFooter: { gap: 10 },
  list: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32 },
  header: { gap: 12, marginBottom: 20 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  section: { gap: 12, marginBottom: 16 },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  filters: { flexDirection: 'row', gap: 8 },
  continueCard: { flexDirection: 'row', alignItems: 'center', gap: 14, borderBottomWidth: 4 },
  continueBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14 },
  continueTitle: { fontFamily: fonts.bold, fontSize: 19, lineHeight: 23 },
  rowWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  row: { flex: 1, flexDirection: 'row', gap: 16, alignItems: 'center' },
  rowPressed: { opacity: 0.7 },
  rowText: { flex: 1, gap: 4 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  pct: { fontFamily: fonts.bold },
  placeholderCover: {
    width: 60,
    height: 84,
    borderRadius: 8,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.dashed,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
