import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { useDb, useLiveQuery } from '@/db/provider';
import { getLibraryItem } from '@/db/repositories/books';
import { deleteBook, markFinished, renameBook } from '@/features/library/actions';
import { loadBook } from '@/features/player/controller';
import { fileUri } from '@/lib/files';
import { formatSize } from '@/lib/size';
import { formatDurationShort } from '@/lib/time';
import {
  BackHeader,
  Button,
  Card,
  colors,
  Cover,
  ErrorText,
  fonts,
  ProgressBar,
  Screen,
  Tag,
  Text,
  TextField,
} from '@/ui';

/** Book detail: edit title/author, mark as finished, delete from this phone (spec §4.2). */
export default function BookDetail() {
  const { t, i18n } = useTranslation();
  const db = useDb();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: book } = useLiveQuery((db) => getLibraryItem(db, id), ['books', 'progress'], id);

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [titleError, setTitleError] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  if (book === undefined) return <Screen>{null}</Screen>;
  if (book === null) {
    return (
      <Screen>
        <BackHeader />
        <Text variant="lead">{t('book.notFound')}</Text>
      </Screen>
    );
  }

  const finished = book.finished_at != null;
  const fraction = finished ? 1 : (book.fraction ?? 0);
  const pct = Math.round(fraction * 100);
  const canListen = book.type === 'audio' && book.on_device === 1;

  const durationLabel = (() => {
    if (!book.duration_ms) return null;
    const { hours, minutes } = formatDurationShort(book.duration_ms);
    return hours > 0 ? t('player.durationHours', { hours, minutes }) : t('player.durationMinutes', { count: minutes });
  })();
  const sizeLabel = book.size_bytes ? t('book.size', formatSize(book.size_bytes)) : null;
  const addedLabel = t('book.added', {
    date: new Date(book.added_at).toLocaleDateString(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' }),
  });

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const startEditing = () => {
    setTitle(book.title);
    setAuthor(book.author ?? '');
    setTitleError(false);
    setEditing(true);
  };

  const save = () =>
    run(async () => {
      const cleanTitle = title.trim();
      if (!cleanTitle) {
        setTitleError(true);
        return;
      }
      await renameBook(db, book.id, cleanTitle, author.trim() || null);
      setEditing(false);
    });

  const listen = () => {
    router.push('/player');
    void loadBook(db, book.id);
  };

  const remove = () =>
    run(async () => {
      await deleteBook(db, book.id);
      if (router.canGoBack()) router.back();
    });

  return (
    <Screen scroll contentStyle={styles.content}>
      <BackHeader />

      <View style={styles.top}>
        <Cover uri={fileUri(book.cover_path)} title={book.title} width={120} height={168} radius={12} />
        <View style={styles.topText}>
          <Text variant="h2" accessibilityRole="header">
            {book.title}
          </Text>
          {book.author ? <Text variant="meta">{book.author}</Text> : null}
          <Text variant="meta">{t(`library.type.${book.type}`)}</Text>
          {finished ? (
            <View style={styles.tag}>
              <Tag label={t('book.finished')} />
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.progressRow}>
        <ProgressBar value={fraction} />
        <Text variant="caption" color={colors.primaryDark} style={styles.pct}>
          {pct}%
        </Text>
      </View>

      <View style={styles.facts}>
        {[durationLabel, sizeLabel, addedLabel].filter(Boolean).map((line) => (
          <Text key={line} variant="meta">
            {line}
          </Text>
        ))}
      </View>

      {canListen ? (
        <Button label={fraction > 0 && !finished ? t('book.continue') : t('book.listen')} onPress={listen} />
      ) : null}

      {editing ? (
        <View style={styles.fields}>
          <TextField
            label={t('import.titleLabel')}
            value={title}
            onChangeText={(v) => {
              setTitle(v);
              setTitleError(false);
            }}
            autoCapitalize="words"
          />
          {titleError ? <ErrorText message={t('book.titleRequired')} /> : null}
          <TextField
            label={t('import.authorLabel')}
            value={author}
            placeholder={t('import.authorPlaceholder')}
            onChangeText={setAuthor}
            autoCapitalize="words"
          />
          <Button label={t('book.save')} onPress={save} loading={busy} />
          <Button variant="link" label={t('common.cancel')} onPress={() => setEditing(false)} disabled={busy} />
        </View>
      ) : (
        <Button variant="secondary" label={t('book.edit')} onPress={startEditing} disabled={busy} />
      )}

      <Button
        variant="secondary"
        label={finished ? t('book.startAgain') : t('book.markFinished')}
        onPress={() => run(() => markFinished(db, book.id, !finished))}
        disabled={busy}
      />

      {confirmingDelete ? (
        <Card style={styles.confirm}>
          <Text variant="title" accessibilityRole="header">
            {t('book.deleteTitle', { title: book.title })}
          </Text>
          <Text variant="meta">{t('book.deleteBody')}</Text>
          <Button variant="danger-link" label={t('book.deleteConfirm')} onPress={remove} disabled={busy} />
          <Button variant="link" label={t('common.cancel')} onPress={() => setConfirmingDelete(false)} disabled={busy} />
        </Card>
      ) : (
        <Button variant="danger-link" label={t('book.delete')} onPress={() => setConfirmingDelete(true)} disabled={busy} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16, paddingBottom: 32 },
  top: { flexDirection: 'row', gap: 18, alignItems: 'flex-start' },
  topText: { flex: 1, gap: 6 },
  tag: { flexDirection: 'row', marginTop: 4 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pct: { fontFamily: fonts.bold },
  facts: { gap: 2 },
  fields: { gap: 12 },
  confirm: { gap: 10 },
});
