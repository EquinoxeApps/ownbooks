import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { useDb } from '@/db/provider';
import { getBook } from '@/db/repositories/books';
import { cancelImport } from '@/features/import/importer';
import { useImportStore } from '@/features/import/store';
import { loadBook } from '@/features/player/controller';
import { fileUri } from '@/lib/files';
import { Button, colors, Cover, Icon, Screen, Text } from '@/ui';

export default function ImportDone() {
  const { t } = useTranslation();
  const db = useDb();
  // Snapshot what was imported, then reset the import state.
  const [{ savedBookIds, fileCount }] = useState(() => ({
    savedBookIds: useImportStore.getState().savedBookIds,
    fileCount: useImportStore.getState().lastSavedFileCount,
  }));
  const [book, setBook] = useState<{ title: string; coverUri: string | null; ebook: boolean }>({
    title: '',
    coverUri: null,
    ebook: false,
  });
  const title = book.title;
  const lastId = savedBookIds[savedBookIds.length - 1];

  useEffect(() => {
    cancelImport();
    if (lastId) {
      void getBook(db, lastId).then((b) =>
        setBook({ title: b?.title ?? '', coverUri: fileUri(b?.cover_path), ebook: b?.type === 'ebook' }),
      );
    }
  }, [db, lastId]);

  const many = savedBookIds.length > 1;

  return (
    <Screen
      footer={
        <>
          <Button
            label={book.ebook ? t('import.done.startReading') : t('import.done.start')}
            disabled={!lastId}
            onPress={async () => {
              if (book.ebook) {
                router.replace({ pathname: '/reader/[id]', params: { id: lastId } });
                return;
              }
              router.replace('/player');
              await loadBook(db, lastId, { autoplay: true });
            }}
          />
          <Button variant="link" label={t('import.done.library')} onPress={() => router.replace('/library')} />
        </>
      }
      contentStyle={styles.content}>
      <View style={styles.circle} accessible={false} importantForAccessibility="no-hide-descendants">
        <Cover uri={book.coverUri} title={title || ' '} width={116} height={116} radius={16} />
        <View style={styles.check}>
          <Icon name="check" size={26} color={colors.white} strokeWidth={3.2} />
        </View>
      </View>
      <View style={styles.copy}>
        <Text variant="h1" style={styles.center} accessibilityRole="header">
          {many ? t('import.done.titleMany', { count: savedBookIds.length }) : t('import.done.title', { title })}
        </Text>
        <Text variant="lead" style={styles.center}>
          {fileCount > 1 ? t('import.done.filesBecameOne', { count: fileCount }) : t('import.done.single')}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 32 },
  circle: {
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: {
    position: 'absolute',
    right: 30,
    bottom: 30,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primary,
    borderWidth: 4,
    borderColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { gap: 12 },
  center: { textAlign: 'center' },
});
