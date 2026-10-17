import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { PasswordField } from '@/features/auth/PasswordField';
import {
  AuthFlowError,
  passwordProblem,
  sendResetCode,
  setNewPassword,
  verifyResetCode,
} from '@/features/auth/providers';
import { useAuthAction } from '@/features/auth/useAuthAction';
import { BackHeader, Button, ErrorText, Screen, Text, TextField } from '@/ui';

const CODE_LENGTH = 6;
const RESEND_AFTER_S = 60;

/**
 * Step 2 of a password reset: the emailed code plus a new password. The code is verified once;
 * if the server then refuses the password (e.g. it was leaked), only the password is retried.
 */
export default function ResetPassword() {
  const { t } = useTranslation();
  const { email = '' } = useLocalSearchParams<{ email: string }>();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [verified, setVerified] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_AFTER_S);
  const { busy, error, run } = useAuthAction();

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  // Success needs no navigation: saving the password signs the user in and flips the route guard.
  const submit = () =>
    run('save', async () => {
      const problem = passwordProblem(password);
      if (problem) throw new AuthFlowError(problem);
      if (!verified) {
        await verifyResetCode(email, code);
        setVerified(true);
      }
      await setNewPassword(password);
    });

  const resend = async () => {
    if (await run('resend', () => sendResetCode(email))) {
      setCode('');
      setCooldown(RESEND_AFTER_S);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen
        scroll
        footer={
          <>
            {error ? <ErrorText message={error} /> : null}
            <Button
              label={t('auth.reset.submit')}
              loading={busy === 'save'}
              disabled={(!verified && code.length !== CODE_LENGTH) || !password || busy != null}
              onPress={submit}
            />
            {!verified ? (
              <View style={styles.resend}>
                <Button
                  variant="link"
                  label={cooldown > 0 ? t('auth.verify.resendIn', { seconds: cooldown }) : t('auth.verify.resend')}
                  disabled={cooldown > 0 || busy != null}
                  onPress={resend}
                />
              </View>
            ) : null}
          </>
        }>
        <BackHeader />
        <View style={styles.copy}>
          <Text variant="h1" accessibilityRole="header">
            {t('auth.reset.title')}
          </Text>
          <Text variant="lead">{t('auth.reset.lead', { email })}</Text>
        </View>
        <View style={styles.fields}>
          {!verified ? (
            <TextField
              label={t('auth.reset.codeLabel')}
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, CODE_LENGTH))}
              autoFocus
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH}
              style={styles.code}
            />
          ) : null}
          <PasswordField
            purpose="new"
            label={t('auth.reset.newPassword')}
            value={password}
            onChangeText={setPassword}
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
  code: { fontSize: 28, letterSpacing: 10, textAlign: 'center' },
  resend: { alignItems: 'center' },
});
