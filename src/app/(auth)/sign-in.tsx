import { router, useLocalSearchParams } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';
import { Trans, useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import {
  isAppleSignInSupported,
  isFacebookSignInConfigured,
  signInWithApple,
  signInWithFacebook,
  signInWithGoogle,
} from '@/features/auth/providers';
import { useAuthAction } from '@/features/auth/useAuthAction';
import { OnboardingFrame, ONBOARDING_STEPS } from '@/features/onboarding/OnboardingFrame';
import { env } from '@/lib/env';
import { BackHeader, Button, colors, ErrorText, fonts, Screen, Text } from '@/ui';

export default function SignIn() {
  const { t } = useTranslation();
  const { returning } = useLocalSearchParams<{ returning?: string }>();
  const { busy, error, run } = useAuthAction();
  const isReturning = returning === '1';

  // Success needs no navigation: the auth listener flips the route guard.
  const actions = (
    <>
      {isAppleSignInSupported ? (
        <Button
          label={t('auth.signIn.apple')}
          loading={busy === 'apple'}
          disabled={busy != null}
          onPress={() => run('apple', signInWithApple)}
        />
      ) : null}
      <Button
        variant={isAppleSignInSupported ? 'secondary' : 'primary'}
        label={t('auth.signIn.google')}
        loading={busy === 'google'}
        disabled={busy != null}
        onPress={() => run('google', signInWithGoogle)}
      />
      {isFacebookSignInConfigured ? (
        <Button
          variant="secondary"
          label={t('auth.signIn.facebook')}
          loading={busy === 'facebook'}
          disabled={busy != null}
          onPress={() => run('facebook', signInWithFacebook)}
        />
      ) : null}
      <Button
        variant="secondary"
        label={t('auth.signIn.email')}
        disabled={busy != null}
        onPress={() => router.push('/email')}
      />
      {error ? <ErrorText message={error} /> : null}
      <LegalNote />
    </>
  );

  const copy = (
    <View style={styles.copy}>
      <Text variant="h1" accessibilityRole="header">
        {t(isReturning ? 'auth.signIn.returningTitle' : 'auth.signIn.title')}
      </Text>
      <Text variant="lead">{t(isReturning ? 'auth.signIn.returningLead' : 'auth.signIn.lead')}</Text>
    </View>
  );

  if (isReturning) {
    return (
      <Screen footer={actions}>
        <BackHeader />
        {copy}
      </Screen>
    );
  }

  return (
    <OnboardingFrame step={ONBOARDING_STEPS} footer={actions}>
      {copy}
    </OnboardingFrame>
  );
}

function LegalNote() {
  const open = (path: string) => () => void openBrowserAsync(`${env.legalBaseUrl}/${path}`);
  return (
    <Text variant="caption" style={styles.legal}>
      <Trans
        i18nKey="auth.signIn.legal"
        components={{
          terms: <Text variant="caption" style={styles.legalLink} onPress={open('terms')} accessibilityRole="link" />,
          privacy: <Text variant="caption" style={styles.legalLink} onPress={open('privacy')} accessibilityRole="link" />,
        }}
      />
    </Text>
  );
}

const styles = StyleSheet.create({
  copy: { gap: 12 },
  legal: { textAlign: 'center', marginTop: 6, lineHeight: 21 },
  legalLink: { color: colors.primaryDark, textDecorationLine: 'underline', fontFamily: fonts.medium },
});
