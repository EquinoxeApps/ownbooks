import { forwardRef, useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { useAnnounce } from '../announce';
import { colors, fonts, radius } from '../tokens';
import { Text } from './Text';

type TextFieldProps = TextInputProps & { label: string; error?: string | null };

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, style, onFocus, onBlur, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrap}>
      <Text variant="meta" style={styles.label}>
        {label}
      </Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={colors.dashed}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          styles.input,
          focused && styles.focused,
          error ? styles.invalid : null,
          style,
        ]}
        {...rest}
      />
      {error ? <ErrorText message={error} /> : null}
    </View>
  );
});

export function ErrorText({ message }: { message: string }) {
  useAnnounce(message);
  return (
    <Text
      variant="meta"
      color={colors.danger}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite">
      {message}
    </Text>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  label: { fontFamily: fonts.medium },
  input: {
    height: 60,
    borderRadius: radius.button,
    borderWidth: 2,
    borderBottomWidth: 4,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 18,
    fontFamily: fonts.medium,
    fontSize: 18,
    color: colors.ink,
  },
  focused: { borderColor: colors.primary },
  invalid: { borderColor: colors.danger },
});
