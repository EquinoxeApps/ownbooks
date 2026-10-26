import { Paths } from 'expo-file-system';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { useLiveQuery } from '@/db/provider';
import { listStorage } from '@/db/repositories/books';
import { useAuthStore } from '@/features/auth/store';
import { fileUri } from '@/lib/files';
import { formatSize } from '@/lib/size';
import { BackHeader, Card, colors, Cover, ErrorText, fonts, Icon, Screen, Text } from '@/ui';

/** Space used per book and in total (spec §4.3), from Profile. A row opens the book's details to delete it. */
export default function Storage() {
  const { t } = useTranslation();
  const userId = useAuthStore((s) => s.account?.id ?? '');
  const { data: books, error } = useLiveQuery((db) => listStorage(db, userId), ['books'], userId);

  const totalBytes = (books ?? []).reduce((sum, b) => sum + (b.size_bytes ?? 0), 0);
  const total = totalBytes > 0 ? formatSize(totalBytes) : { value: 0, unit: 'MB' as const };
  const free = formatSize(Paths.availableDiskSpace);

  return (
    <Screen scroll contentStyle={styles.content}>
      <BackHeader />
      <Text variant="h1" accessibilityRole="header">
        {t('storage.title')}
      </Text>

      <Card style={styles.total}>
        <Text variant="meta">{t('storage.total')}</Text>
        <Text style={styles.totalValue}>{t('storage.bookSize', total)}</Text>
        <Text variant="meta">{t('storage.free', free)}</Text>
      </Card>

      <View style={styles.section}>
        <Text variant="h2" accessibilityRole="header">
          {t('storage.books')}
        </Text>
        {error && !books ? <ErrorText message={t('storage.loadFailed')} /> : null}
        {books && books.length === 0 ? <Text variant="body">{t('storage.empty')}</Text> : null}
        {books && books.length > 0 ? (
          <Card padding={0} style={styles.list}>
            {books.map((book, i) => {
              const size = formatSize(book.size_bytes ?? 0);
              return (
                <Pressable
                  key={book.id}
                  accessibilityRole="button"
                  accessibilityLabel={t('storage.bookRow', {
                    title: book.title,
                    type: t(`library.type.${book.type}`),
                    ...size,
                  })}
                  onPress={() => router.push({ pathname: '/book/[id]', params: { id: book.id } })}>
                  {({ pressed }) => (
                    <View style={[styles.row, i > 0 && styles.divider, pressed && styles.pressed]}>
                      <Cover uri={fileUri(book.cover_path)} title={book.title} width={40} height={book.type === 'audio' ? 40 : 56} />
                      <View style={styles.rowText}>
                        <Text variant="bodyStrong" numberOfLines={1}>
                          {book.title}
                        </Text>
                        <Text variant="meta">{t(`library.type.${book.type}`)}</Text>
                      </View>
                      <Text style={styles.size}>{t('storage.bookSize', size)}</Text>
                      <Icon name="chevronRight" size={18} color={colors.muted} strokeWidth={2.4} />
                    </View>
                  )}
                </Pressable>
              );
            })}
          </Card>
        ) : null}
        <Text variant="caption">{t('storage.lead')}</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 24, paddingBottom: 32 },
  total: { gap: 4 },
  totalValue: { fontFamily: fonts.black, fontSize: 34, lineHeight: 40 },
  section: { gap: 12 },
  list: { paddingHorizontal: 18, paddingVertical: 4 },
  row: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8 },
  rowText: { flex: 1, gap: 2 },
  size: { fontFamily: fonts.bold, fontSize: 15 },
  divider: { borderTopWidth: 2, borderTopColor: colors.divider },
  pressed: { opacity: 0.6 },
});
