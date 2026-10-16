import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { useReaderStore } from '@/features/reader/store';
import { colors, fonts, Text } from '@/ui';

/** Fixed, so the list can open scrolled to the current chapter (initialScrollIndex needs getItemLayout). */
const ROW_HEIGHT = 64;

/** Table of contents sheet, opened from the reader. */
export default function Contents() {
  const { t } = useTranslation();
  const toc = useReaderStore((s) => s.toc);
  const currentHref = useReaderStore((s) => s.location?.href ?? null);
  const send = useReaderStore((s) => s.send);
  const currentIndex = Math.max(0, toc.findIndex((item) => item.href === currentHref));

  const choose = (href: string) => {
    send?.({ name: 'goTo', arg: href });
    if (router.canGoBack()) router.back();
  };

  return (
    <View style={styles.root}>
      <Text variant="h2" style={styles.heading} accessibilityRole="header">
        {t('reader.contents')}
      </Text>
      {toc.length === 0 ? (
        <Text variant="meta" style={styles.empty}>
          {t('reader.noContents')}
        </Text>
      ) : (
        <FlatList
          data={toc}
          // Android sheets only let a list scroll when it supports nested scrolling;
          // otherwise the drag moves the sheet.
          nestedScrollEnabled
          keyExtractor={(item, index) => `${index}:${item.href}`}
          getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
          initialScrollIndex={Math.max(0, currentIndex - 2)}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const current = item.href !== null && item.href === currentHref;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: current, disabled: !item.href }}
                disabled={!item.href}
                onPress={() => item.href && choose(item.href)}
                style={({ pressed }) => [styles.row, { paddingLeft: 20 + item.depth * 16 }, pressed && styles.pressed]}>
                <Text style={[styles.label, current && styles.current]} numberOfLines={2}>
                  {item.label || '—'}
                </Text>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  heading: { paddingHorizontal: 20, paddingTop: 28, paddingBottom: 12 },
  empty: { paddingHorizontal: 20 },
  list: { paddingBottom: 32 },
  row: {
    height: ROW_HEIGHT,
    justifyContent: 'center',
    paddingRight: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  pressed: { backgroundColor: colors.surface },
  label: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 21 },
  current: { fontFamily: fonts.bold, color: colors.primaryDark },
});
