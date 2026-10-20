import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { useDb } from '@/db/provider';
import { deleteAccount } from '@/features/auth/deleteAccount';
import { AuthFlowError } from '@/features/auth/providers';
import { useAuthStore } from '@/features/auth/store';
import { BackHeader, Button, Card, ErrorText, Screen, Text } from '@/ui';

/** Delete account confirmation (spec §4.1), opened from Profile. */
export default function DeleteAccount() {
  const { t } = useTranslation();
  const db = useDb();
  const userId = useAuthStore((s) => s.account?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      // Signing out locally switches the app to the welcome screen.
      await deleteAccount(db, userId);
    } catch (e) {
      const offline = e instanceof AuthFlowError && e.key === 'errors.offline';
      setError(t(offline ? 'profile.delete.offline' : 'profile.delete.failed'));
      setBusy(false);
    }
  };

  return (
    <Screen scroll contentStyle={styles.content}>
      <BackHeader />
      <Text variant="h1" accessibilityRole="header">
        {t('profile.delete.title')}
      </Text>
      <Text variant="lead">{t('profile.delete.lead')}</Text>
      <Card style={styles.list}>
        {(['account', 'synced', 'phone'] as const).map((item) => (
          <View key={item} style={styles.item}>
            <Text variant="bodyStrong">•</Text>
            <Text variant="body" style={styles.itemText}>
              {t(`profile.delete.items.${item}`)}
            </Text>
          </View>
        ))}
      </Card>
      <Text variant="meta">{t('profile.delete.originals')}</Text>
      {error ? <ErrorText message={error} /> : null}
      <Button label={t('profile.delete.keep')} onPress={() => router.back()} disabled={busy} />
      <Button
        variant="danger-link"
        label={busy ? t('profile.delete.deleting') : t('profile.delete.confirm')}
        onPress={confirm}
        disabled={busy}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16, paddingBottom: 32 },
  list: { gap: 10 },
  item: { flexDirection: 'row', gap: 10 },
  itemText: { flex: 1 },
});
