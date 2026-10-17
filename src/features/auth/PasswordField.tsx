import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type TextInputProps } from 'react-native';

import { Button, TextField } from '@/ui';

type PasswordFieldProps = Omit<TextInputProps, 'secureTextEntry'> & {
  label: string;
  error?: string | null;
  /** 'new' for creating or resetting a password, so password managers offer to save it. */
  purpose: 'current' | 'new';
};

/** A password input with a show / hide toggle. */
export function PasswordField({ purpose, ...rest }: PasswordFieldProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  return (
    <View>
      <TextField
        {...rest}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete={purpose === 'new' ? 'new-password' : 'current-password'}
        textContentType={purpose === 'new' ? 'newPassword' : 'password'}
      />
      <View style={styles.toggle}>
        <Button
          variant="link"
          label={visible ? t('auth.email.hide') : t('auth.email.show')}
          onPress={() => setVisible((v) => !v)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: { alignItems: 'flex-end' },
});
