import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { PasswordField } from '@/features/auth/PasswordField';
import { EMAIL_PATTERN, signInWithEmail } from '@/features/auth/providers';
import { useAuthAction } from '@/features/auth/useAuthAction';
import { BackHeader, Button, ErrorText, Screen, Text, TextField } from '@/ui';

/** Sign in with email + password. Links to creating an account and resetting the password. */
export default function EmailSignIn() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [invalid, setInvalid] = useState(false);
  const { busy, error, run } = useAuthAction();

  const submit = async () => {
    const value = email.trim();
    if (!EMAIL_PATTERN.test(value)) {
      setInvalid(true);
      return;
    }
    const outcome: { value?: Awaited<ReturnType<typeof signInWithEmail>> } = {};
    await run('signIn', async () => {
      outcome.value = await signInWithEmail(value, password);
    });
    // Signed in: the auth listener flips the route guard. Unconfirmed: a new code was sent.
    if (outcome.value === 'confirmEmail') router.push({ pathname: '/verify', params: { email: value } });
  };

  const withEmail = (pathname: '/create-account' | '/forgot-password') =>
    router.push({ pathname, params: { email: email.trim() } });

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen
        scroll
        footer={
          <>
            {error ? <ErrorText message={error} /> : null}
            <Button
              label={t('auth.email.submit')}
              loading={busy === 'signIn'}
              disabled={!email.trim() || !password}
              onPress={submit}
            />
            <Button variant="link" label={t('auth.email.createAccount')} onPress={() => withEmail('/create-account')} />
          </>
        }>
        <BackHeader />
        <View style={styles.copy}>
          <Text variant="h1" accessibilityRole="header">
            {t('auth.email.title')}
          </Text>
          <Text variant="lead">{t('auth.email.lead')}</Text>
        </View>
        <View style={styles.fields}>
          <TextField
            label={t('auth.email.label')}
            placeholder={t('auth.email.placeholder')}
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              setInvalid(false);
            }}
            error={invalid ? t('auth.email.invalid') : null}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
          />
          <PasswordField
            purpose="current"
            label={t('auth.email.passwordLabel')}
            value={password}
            onChangeText={setPassword}
            returnKeyType="go"
            onSubmitEditing={submit}
          />
          <View style={styles.forgot}>
            <Button variant="link" label={t('auth.email.forgot')} onPress={() => withEmail('/forgot-password')} />
          </View>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  copy: { gap: 12 },
  fields: { gap: 12, marginTop: 8 },
  forgot: { alignItems: 'flex-start' },
});
