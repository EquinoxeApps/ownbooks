import { openBrowserAsync } from 'expo-web-browser';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { setAnalyticsConsent } from '@/features/analytics';
import { FeatureRow } from '@/features/onboarding/OnboardingFrame';
import { env } from '@/lib/env';
import { Button, colors, Icon, Screen, Text } from '@/ui';

/**
 * Asked once per account after sign-in (spec §4.8). Both answers have the same weight, and the
 * choice can be changed later in Profile. Nothing is sent before a yes.
 */
export default function Consent() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const answer = async (granted: boolean) => {
    setBusy(true);
    try {
      await setAnalyticsConsent(granted);
    } finally {
      setBusy(false);
      if (router.canGoBack()) router.back();
      else router.replace('/library');
    }
  };

  return (
    <Screen
      scroll
      contentStyle={styles.content}
      footer={
        <>
          <View style={styles.answers}>
            <View style={styles.answer}>
              <Button
                variant="secondary"
                label={t('consent.decline')}
                onPress={() => void answer(false)}
                disabled={busy}
              />
            </View>
            <View style={styles.answer}>
              <Button
                variant="secondary"
                label={t('consent.accept')}
                onPress={() => void answer(true)}
                disabled={busy}
              />
            </View>
          </View>
          <Text variant="caption" style={styles.center}>
            {t('consent.later')}
          </Text>
        </>
      }>
      <Text variant="h1" accessibilityRole="header">
        {t('consent.title')}
      </Text>
      <Text variant="lead">{t('consent.lead')}</Text>
      <View style={styles.rows}>
        <FeatureRow icon={<Icon name="activity" size={22} color={colors.primaryDark} />}>
          <Text>{t('consent.shared')}</Text>
        </FeatureRow>
        <FeatureRow icon={<Icon name="shield" size={22} color={colors.primaryDark} />}>
          <Text>{t('consent.never')}</Text>
        </FeatureRow>
      </View>
      <Button
        variant="link"
        label={t('profile.privacy')}
        accessibilityRole="link"
        onPress={() => void openBrowserAsync(`${env.legalBaseUrl}/privacy`)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 24, paddingTop: 32, paddingBottom: 16 },
  rows: { gap: 20 },
  answers: { flexDirection: 'row', gap: 12 },
  answer: { flex: 1 },
  center: { textAlign: 'center' },
});
