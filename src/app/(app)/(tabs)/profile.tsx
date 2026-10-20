import Constants from 'expo-constants';
import { openBrowserAsync } from 'expo-web-browser';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { useDb, useLiveQuery } from '@/db/provider';
import { countUnsynced } from '@/db/repositories/sync';
import { displayName } from '@/features/auth/account';
import { signOutRemote } from '@/features/auth/providers';
import { useAuthStore } from '@/features/auth/store';
import { runSync, stopSync, useSyncStore } from '@/features/sync/service';
import { env, isBackendConfigured } from '@/lib/env';
import { dayAndTime } from '@/lib/time';
import { Button, Card, colors, fonts, Icon, Screen, Text } from '@/ui';

/** Sign-out waits at most this long for a final sync. */
const SIGN_OUT_SYNC_MS = 3_000;

export default function Profile() {
  const { t } = useTranslation();
  const db = useDb();
  const account = useAuthStore((s) => s.account);
  const signedOut = useAuthStore((s) => s.signedOut);
  const [busy, setBusy] = useState(false);

  if (!account) return null;
  const name = displayName(account);

  const signOut = async () => {
    setBusy(true);
    try {
      // Last chance to push this phone's latest position; never wait long for it.
      await Promise.race([runSync(), new Promise((resolve) => setTimeout(resolve, SIGN_OUT_SYNC_MS))]);
      stopSync();
      await signOutRemote();
    } finally {
      // The route guard switches to sign-in once local state is cleared.
      await signedOut(db);
    }
  };

  return (
    <Screen scroll edges={['top']} contentStyle={styles.content}>
      <Text variant="h1" accessibilityRole="header">
        {t('profile.title')}
      </Text>

      <Card style={styles.accountCard}>
        <View style={styles.avatar} accessible={false}>
          <Text style={styles.avatarLetter} color={colors.white}>
            {name.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.accountText}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          <Text variant="meta">{t(`profile.signedInWith.${account.provider}`)}</Text>
        </View>
      </Card>

      {isBackendConfigured ? <SyncSection userId={account.id} /> : null}

      <View style={styles.section}>
        <Text variant="h2" accessibilityRole="header">
          {t('profile.settings')}
        </Text>
        <Card padding={0} style={styles.list}>
          <LinkRow label={t('profile.privacy')} onPress={() => openBrowserAsync(`${env.legalBaseUrl}/privacy`)} divider />
          <LinkRow label={t('profile.terms')} onPress={() => openBrowserAsync(`${env.legalBaseUrl}/terms`)} />
        </Card>
      </View>

      <View style={styles.signOut}>
        <View style={styles.accountLinks}>
          <Button variant="link" label={t('profile.signOut')} onPress={signOut} disabled={busy} />
          {isBackendConfigured ? (
            <Button
              variant="danger-link"
              label={t('profile.deleteAccount')}
              onPress={() => router.push('/delete-account')}
              disabled={busy}
            />
          ) : null}
        </View>
        <Text variant="caption" style={styles.center}>
          {t('profile.signOutNote')}
        </Text>
        <Text variant="caption" style={styles.center}>
          {t('profile.version', { version: Constants.expoConfig?.version ?? '' })}
        </Text>
      </View>
    </Screen>
  );
}

/**
 * Sync status (design: "In sync" beside "Your devices"; the devices list comes after the MVP).
 * In sync means nothing is waiting to be pushed and the last pass succeeded.
 */
function SyncSection({ userId }: { userId: string }) {
  const { t, i18n } = useTranslation();
  const status = useSyncStore((s) => s.status);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);
  const { data: unsynced } = useLiveQuery((db) => countUnsynced(db, userId), ['books', 'progress', 'pending_ops'], userId);

  const state =
    status === 'syncing'
      ? 'syncing'
      : status === 'offline'
        ? 'offline'
        : status === 'error'
          ? 'error'
          : unsynced === 0 && lastSyncedAt
            ? 'inSync'
            : 'waiting';

  let last = t('profile.sync.never');
  if (lastSyncedAt) {
    const { day, time } = dayAndTime(lastSyncedAt, i18n.language);
    const when =
      day === 'today'
        ? t('sync.conflict.today', { time })
        : day === 'yesterday'
          ? t('sync.conflict.yesterday', { time })
          : `${day}, ${time}`;
    last = t('profile.sync.last', { when });
  }

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text variant="h2" accessibilityRole="header">
          {t('profile.sync.title')}
        </Text>
        <Text style={styles.syncState} color={state === 'error' ? colors.danger : colors.primaryDark}>
          {t(`profile.sync.states.${state}`)}
        </Text>
      </View>
      <Card padding={0} style={styles.list}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('profile.sync.thisPhone')}, ${last}`}
          accessibilityHint={t('profile.sync.syncNowHint')}
          onPress={() => void runSync()}>
          {({ pressed }) => (
            <View style={[styles.row, pressed && styles.pressed]}>
              <Text variant="bodyStrong">{t('profile.sync.thisPhone')}</Text>
              <Text variant="meta">{last}</Text>
            </View>
          )}
        </Pressable>
      </Card>
      <Text variant="caption">{t('profile.sync.note')}</Text>
    </View>
  );
}

function LinkRow({ label, onPress, divider }: { label: string; onPress: () => void; divider?: boolean }) {
  return (
    <Pressable accessibilityRole="link" onPress={onPress}>
      {({ pressed }) => (
        <View style={[styles.row, divider && styles.divider, pressed && styles.pressed]}>
          <Text variant="bodyStrong">{label}</Text>
          <Icon name="chevronRight" size={18} color={colors.muted} strokeWidth={2.4} />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { gap: 24, paddingBottom: 32 },
  accountCard: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.indigo,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { fontFamily: fonts.extraBold, fontSize: 26 },
  accountText: { flex: 1, gap: 4 },
  name: { fontFamily: fonts.extraBold, fontSize: 22, lineHeight: 26 },
  section: { gap: 12 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  syncState: { fontFamily: fonts.bold, fontSize: 15 },
  accountLinks: { flexDirection: 'row', justifyContent: 'center', gap: 28 },
  list: { paddingHorizontal: 18, paddingVertical: 4 },
  row: { minHeight: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  divider: { borderBottomWidth: 2, borderBottomColor: colors.divider },
  pressed: { opacity: 0.6 },
  signOut: { alignItems: 'center', gap: 4 },
  center: { textAlign: 'center' },
});
