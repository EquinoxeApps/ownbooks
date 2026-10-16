import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { useDb } from '@/db/provider';
import { useAuthStore } from '@/features/auth/store';
import {
  cancelImport,
  pickAndImport,
  saveCurrent,
  skipCurrent,
  updateDetails,
} from '@/features/import/importer';
import { useImportStore } from '@/features/import/store';
import {
  Button,
  Card,
  colors,
  Cover,
  fonts,
  Icon,
  IconButton,
  ProgressBar,
  Screen,
  Text,
  TextField,
} from '@/ui';

export default function ImportScreen() {
  const { t } = useTranslation();
  const db = useDb();
  const userId = useAuthStore((s) => s.account?.id ?? '');
  const st = useImportStore();
  const [editing, setEditing] = useState(false);

  // When the whole queue is saved, show the success screen.
  useEffect(() => {
    if (st.status === 'done') router.replace('/import-done');
  }, [st.status]);

  const close = () => {
    cancelImport();
    if (router.canGoBack()) router.back();
    else router.replace('/library');
  };

  const header = (
    <View style={styles.header}>
      <View style={styles.back}>
        <IconButton icon="close" accessibilityLabel={t('import.cancel')} strokeWidth={2.6} onPress={close} />
      </View>
      {st.queue.length > 1 ? (
        <Text variant="meta">{t('import.nextOfQueue', { current: st.index + 1, total: st.queue.length })}</Text>
      ) : null}
    </View>
  );

  if (st.status === 'failed') {
    const hasMore = st.index + 1 < st.queue.length;
    return (
      <Screen
        footer={
          <>
            {hasMore ? <Button label={t('import.skip')} onPress={skipCurrent} /> : null}
            <Button
              variant={hasMore ? 'secondary' : 'primary'}
              label={t('import.chooseOther')}
              onPress={async () => {
                const picked = await pickAndImport(db, userId);
                if (!picked) close();
              }}
            />
            <Button variant="link" label={t('import.close')} onPress={close} />
          </>
        }>
        {header}
        <View style={styles.copy}>
          <Text variant="h1" accessibilityRole="header">
            {t('import.errors.title')}
          </Text>
          <Text variant="lead" accessibilityRole="alert">
            {t(`import.errors.${st.error ?? 'generic'}`)}
          </Text>
          {st.errorDetail ? (
            <Text variant="caption" selectable style={styles.detail}>
              {t('import.errorDetail', { detail: st.errorDetail })}
            </Text>
          ) : null}
        </View>
      </Screen>
    );
  }

  const cur = st.current;
  if (!cur) return <Screen>{header}</Screen>;

  const fileCount = cur.group.files.length;
  const preparing = st.status === 'preparing';
  const copyDone = cur.filesCopied >= fileCount;
  const fraction = cur.bytesTotal > 0 ? cur.bytesCopied / cur.bytesTotal : copyDone ? 1 : 0;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen
        scroll
        contentStyle={styles.content}
        footer={
          <Button
            label={st.status === 'saving' ? t('import.saving') : t('import.save')}
            loading={st.status === 'saving'}
            disabled={st.status !== 'ready'}
            onPress={() => {
              setEditing(false);
              void saveCurrent();
            }}
          />
        }>
        {header}
        <Text variant="h1" accessibilityRole="header">
          {cur.group.kind === 'ebook' ? t('import.foundEbook') : t('import.foundAudiobook')}
        </Text>

        <Card style={styles.bookCard}>
          <Cover
            uri={cur.coverUri}
            title={cur.title || cur.group.suggestedTitle}
            width={76}
            height={76}
            radius={12}
          />
          <View style={styles.bookText}>
            <Text style={styles.bookTitle} numberOfLines={2}>
              {cur.title}
            </Text>
            <Text variant="meta" numberOfLines={1}>
              {cur.author ?? t('import.authorPlaceholder')}
            </Text>
            <Button
              variant="link"
              label={editing ? t('import.doneEditing') : t('import.editDetails')}
              onPress={() => setEditing((e) => !e)}
            />
          </View>
        </Card>

        {editing ? (
          <View style={styles.fields}>
            <TextField
              label={t('import.titleLabel')}
              value={cur.title}
              onChangeText={(v) => updateDetails(v, cur.author)}
              autoCapitalize="words"
            />
            <TextField
              label={t('import.authorLabel')}
              value={cur.author ?? ''}
              placeholder={t('import.authorPlaceholder')}
              onChangeText={(v) => updateDetails(cur.title, v || null)}
              autoCapitalize="words"
            />
          </View>
        ) : null}

        {fileCount > 1 ? (
          <View style={styles.filesRow}>
            <View style={styles.bubble}>
              <Icon name="list" size={22} color={colors.primaryDark} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.filesTitle}>{t('import.filesFound', { count: fileCount })}</Text>
              <Text variant="meta">{t('import.inOrder')}</Text>
            </View>
          </View>
        ) : null}

        <Card padding={20} style={styles.copyCard}>
          <View style={styles.copyHeader}>
            <Text style={styles.filesTitle}>
              {preparing && copyDone ? t('import.analysing') : t('import.copying')}
            </Text>
            <Text style={styles.count} color={colors.primaryDark}>
              {t('import.ofFiles', { done: cur.filesCopied, total: fileCount })}
            </Text>
          </View>
          <ProgressBar value={fraction} height={12} accessibilityLabel={t('import.copying')} />
          <Text variant="meta">{t('import.untouched')}</Text>
        </Card>

        {st.rejected.length > 0 ? (
          <Text variant="meta">{t('import.rejectedSome', { count: st.rejected.length })}</Text>
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { gap: 28, paddingBottom: 24 },
  header: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { marginLeft: -10 },
  copy: { gap: 12 },
  detail: { fontFamily: 'monospace', fontSize: 12 },
  bookCard: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  bookText: { flex: 1, gap: 2 },
  bookTitle: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 24 },
  fields: { gap: 16 },
  filesRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  bubble: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filesTitle: { fontFamily: fonts.bold, fontSize: 18 },
  copyCard: { gap: 12 },
  copyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  count: { fontFamily: fonts.bold, fontSize: 15 },
});
