import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { PasswordField } from '@/features/auth/PasswordField';
import { createAccount, EMAIL_PATTERN } from '@/features/auth/providers';
import { useAuthAction } from '@/features/auth/useAuthAction';
import { BackHeader, Button, ErrorText, Screen, Text, TextField } from '@/ui';

/** Creates an email + password account; the email is confirmed with a 6-digit code next. */
export default function CreateAccount() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? '');
  const [password, setPassword] = useState('');
  const [invalid, setInvalid] = useState(false);
  const { busy, error, run } = useAuthAction();

  const submit = async () => {
    const value = email.trim();
    if (!EMAIL_PATTERN.test(value)) {
      setInvalid(true);
      return;
    }
    const outcome: { value?: Awaited<ReturnType<typeof createAccount>> } = {};
    await run('create', async () => {
      outcome.value = await createAccount(value, password);
    });
    if (outcome.value === 'confirmEmail') router.replace({ pathname: '/verify', params: { email: value } });
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen
        scroll
        footer={
          <>
            {error ? <ErrorText message={error} /> : null}
            <Button
              label={t('auth.createAccount.submit')}
              loading={busy === 'create'}
              disabled={!email.trim() || !password}
              onPress={submit}
            />
            <Button
              variant="link"
              label={t('auth.createAccount.haveAccount')}
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/email'))}
            />
          </>
        }>
        <BackHeader />
        <View style={styles.copy}>
          <Text variant="h1" accessibilityRole="header">
            {t('auth.createAccount.title')}
          </Text>
          <Text variant="lead">{t('auth.createAccount.lead')}</Text>
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
            autoFocus={!params.email}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
          />
          <PasswordField
            purpose="new"
            label={t('auth.email.passwordLabel')}
            value={password}
            onChangeText={setPassword}
            autoFocus={!!params.email}
            returnKeyType="go"
            onSubmitEditing={submit}
          />
          <Text variant="caption">{t('auth.createAccount.passwordHint')}</Text>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  copy: { gap: 12 },
  fields: { gap: 12, marginTop: 8 },
});
