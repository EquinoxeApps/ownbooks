import { router, Stack } from 'expo-router';
import { useEffect } from 'react';

import { useDb } from '@/db/provider';
import { useAuthStore } from '@/features/auth/store';
import { backfillTags } from '@/features/import/backfill';
import { cleanupStaleImports } from '@/features/import/importer';
import { useSync } from '@/features/sync/useSync';
import { colors, playerColors } from '@/ui/tokens';

export default function AppLayout() {
  const db = useDb();
  const userId = useAuthStore((s) => s.account?.id ?? '');
  const hasOtherAccounts = useAuthStore((s) => s.otherAccounts.length > 0);

  // A different account signed in on this device: offer to clean up once.
  useEffect(() => {
    if (hasOtherAccounts) router.push('/account-switch');
  }, [hasOtherAccounts]);

  // Remove half-copied files if the app was killed during an import.
  useEffect(() => {
    cleanupStaleImports();
  }, []);

  // Books imported before tag support get their covers, chapters and names now.
  useEffect(() => {
    if (userId) void backfillTags(db, userId);
  }, [db, userId]);

  useSync(db, userId);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="player"
        options={{
          presentation: 'fullScreenModal',
          animation: 'slide_from_bottom',
          contentStyle: { backgroundColor: playerColors.bg },
        }}
      />
      <Stack.Screen
        name="chapters"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: [0.9],
          sheetGrabberVisible: true,
          sheetCornerRadius: 28,
          contentStyle: { backgroundColor: playerColors.bg },
        }}
      />
      {['speed', 'sleep'].map((name) => (
        <Stack.Screen
          key={name}
          name={name}
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: 'fitToContents',
            sheetGrabberVisible: true,
            sheetCornerRadius: 28,
            contentStyle: { backgroundColor: playerColors.bg },
          }}
        />
      ))}
      <Stack.Screen
        name="contents"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: [0.9],
          sheetGrabberVisible: true,
          sheetCornerRadius: 28,
        }}
      />
      <Stack.Screen
        name="reader-settings"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: 'fitToContents',
          sheetGrabberVisible: true,
          sheetCornerRadius: 28,
          contentStyle: { backgroundColor: colors.surface },
        }}
      />
      <Stack.Screen
        name="sort"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: 'fitToContents',
          sheetGrabberVisible: true,
          sheetCornerRadius: 28,
        }}
      />
      <Stack.Screen
        name="conflict"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: 'fitToContents',
          sheetGrabberVisible: true,
          sheetCornerRadius: 28,
        }}
      />
      <Stack.Screen name="import" options={{ gestureEnabled: false }} />
      <Stack.Screen name="import-done" options={{ gestureEnabled: false, animation: 'fade' }} />
      <Stack.Screen
        name="account-switch"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: 'fitToContents',
          sheetGrabberVisible: true,
          sheetCornerRadius: 28,
          gestureEnabled: false,
        }}
      />
    </Stack>
  );
}
