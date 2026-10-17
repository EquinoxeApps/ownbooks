import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { confirmSignUp, resendSignUpCode } from '@/features/auth/providers';
import { useAuthAction } from '@/features/auth/useAuthAction';
import { BackHeader, Button, ErrorText, Screen, Text, TextField } from '@/ui';

const CODE_LENGTH = 6;
const RESEND_AFTER_S = 60;

/** Confirms a new email + password account with the 6-digit code from the sign-up email. */
export default function VerifyCode() {
  const { t } = useTranslation();
  const { email = '' } = useLocalSearchParams<{ email: string }>();
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(RESEND_AFTER_S);
  const { busy, error, run } = useAuthAction();

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  // Success needs no navigation: the auth listener flips the route guard.
  const verify = (value: string) => run('verify', () => confirmSignUp(email, value));

  const onChange = (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    if (digits.length === CODE_LENGTH && busy == null) void verify(digits);
  };

  const resend = async () => {
    const ok = await run('resend', () => resendSignUpCode(email));
    if (ok) {
      setCode('');
      setCooldown(RESEND_AFTER_S);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen
        footer={
          <>
            {error ? <ErrorText message={error} /> : null}
            <Button
              label={t('auth.verify.submit')}
              loading={busy === 'verify'}
              disabled={code.length !== CODE_LENGTH || busy != null}
              onPress={() => verify(code)}
            />
            <View style={styles.resend}>
              <Button
                variant="link"
                label={
                  cooldown > 0
                    ? t('auth.verify.resendIn', { seconds: cooldown })
                    : t('auth.verify.resend')
                }
                disabled={cooldown > 0 || busy != null}
                onPress={resend}
              />
            </View>
          </>
        }>
        <BackHeader />
        <View style={styles.copy}>
          <Text variant="h1" accessibilityRole="header">
            {t('auth.verify.title')}
          </Text>
          <Text variant="lead">{t('auth.verify.lead', { email })}</Text>
        </View>
        <TextField
          label={t('auth.verify.label')}
          value={code}
          onChangeText={onChange}
          autoFocus
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={CODE_LENGTH}
          style={styles.code}
        />
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  copy: { gap: 12 },
  code: { fontSize: 28, letterSpacing: 10, textAlign: 'center' },
  resend: { alignItems: 'center' },
});
