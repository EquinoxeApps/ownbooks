import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { useDb, useLiveQuery } from '@/db/provider';
import { getLibraryItem } from '@/db/repositories/books';
import { useAuthStore } from '@/features/auth/store';
import { pickAndImport } from '@/features/import/importer';
import { deleteBook, markFinished, removeEverywhere, renameBook } from '@/features/library/actions';
import { openBook } from '@/features/library/open';
import { isBackendConfigured } from '@/lib/env';
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

/**
 * Book detail: edit title/author, mark as finished, delete from this phone or remove from all
 * devices (spec §4.2, §4.7). A book only on another device explains how to import it here.
 */
export default function BookDetail() {
  const { t, i18n } = useTranslation();
  const db = useDb();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: book, error: loadError } = useLiveQuery((db) => getLibraryItem(db, id), ['books', 'progress'], id);

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [titleError, setTitleError] = useState(false);
  const [confirming, setConfirming] = useState<'phone' | 'everywhere' | null>(null);
  const userId = useAuthStore((s) => s.account?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (book === undefined && !loadError) return <Screen>{null}</Screen>;
  if (!book) {
    return (
      <Screen>
        <BackHeader />
        {loadError ? <ErrorText message={t('book.loadFailed')} /> : <Text variant="lead">{t('book.notFound')}</Text>}
      </Screen>
    );
  }

  const finished = book.finished_at != null;
  const fraction = finished ? 1 : (book.fraction ?? 0);
  const pct = Math.round(fraction * 100);
  const canOpen = book.on_device === 1;
  const started = fraction > 0 && !finished;
  const openLabel =
    book.type === 'ebook'
      ? started
        ? t('book.continueReading')
        : t('book.read')
      : started
        ? t('book.continue')
        : t('book.listen');

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
    setActionError(null);
    try {
      await action();
    } catch (error) {
      console.warn('Book action failed', error);
      setActionError(t('book.actionFailed'));
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

  const open = () => void openBook(db, book);

  const importHere = async () => {
    if (await pickAndImport(db, userId)) router.push('/import');
  };

  const remove = () =>
    run(async () => {
      await (confirming === 'everywhere' ? removeEverywhere(db, book.id) : deleteBook(db, book.id));
      setConfirming(null);
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

      {canOpen ? (
        <Button label={openLabel} onPress={open} />
      ) : (
        <Card style={styles.confirm}>
          <Text variant="title" accessibilityRole="header">
            {t('library.notOnDevice')}
          </Text>
          <Text variant="meta">
            {book.last_device
              ? t('book.notOnDeviceFrom', { device: book.last_device })
              : t('book.notOnDeviceBody')}
          </Text>
          <Button label={t('book.importHere')} onPress={importHere} />
        </Card>
      )}

      {actionError ? <ErrorText message={actionError} /> : null}

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
            error={titleError ? t('book.titleRequired') : null}
          />
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

      {canOpen ? (
        <Button
          variant="secondary"
          label={finished ? t('book.startAgain') : t('book.markFinished')}
          onPress={() => run(() => markFinished(db, book.id, !finished))}
          disabled={busy}
        />
      ) : null}

      {confirming ? (
        <Card style={styles.confirm}>
          <Text variant="title" accessibilityRole="header">
            {confirming === 'everywhere'
              ? t('book.removeEverywhereTitle', { title: book.title })
              : t('book.deleteTitle', { title: book.title })}
          </Text>
          <Text variant="meta">
            {confirming === 'everywhere'
              ? t('book.removeEverywhereBody')
              : isBackendConfigured
                ? t('book.deleteBodySynced')
                : t('book.deleteBody')}
          </Text>
          <Button
            variant="danger-link"
            label={confirming === 'everywhere' ? t('book.removeEverywhereConfirm') : t('book.deleteConfirm')}
            onPress={remove}
            disabled={busy}
          />
          <Button variant="link" label={t('common.cancel')} onPress={() => setConfirming(null)} disabled={busy} />
        </Card>
      ) : (
        <View style={styles.dangerLinks}>
          {canOpen ? (
            <Button variant="danger-link" label={t('book.delete')} onPress={() => setConfirming('phone')} disabled={busy} />
          ) : null}
          {isBackendConfigured ? (
            <Button
              variant="danger-link"
              label={t('book.removeEverywhere')}
              onPress={() => setConfirming('everywhere')}
              disabled={busy}
            />
          ) : null}
        </View>
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
  dangerLinks: { gap: 8, alignItems: 'center' },
});
