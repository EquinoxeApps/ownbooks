import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { useDb } from '@/db/provider';
import type { LibrarySort } from '@/db/repositories/books';
import { useAuthStore } from '@/features/auth/store';
import { SORTS, useLibraryPrefs } from '@/features/library/store';
import { colors, fonts, Icon, Text } from '@/ui';

/** Library sort sheet, opened from "Sort" above the book list. */
export default function Sort() {
  const { t } = useTranslation();
  const db = useDb();
  const userId = useAuthStore((s) => s.account?.id ?? '');
  const current = useLibraryPrefs((s) => s.sort);
  const setSort = useLibraryPrefs((s) => s.setSort);

  const choose = (sort: LibrarySort) => {
    void setSort(db, userId, sort);
    if (router.canGoBack()) router.back();
  };

  return (
    <View style={styles.root}>
      <Text variant="h2" style={styles.heading} accessibilityRole="header">
        {t('library.sortBy')}
      </Text>
      {SORTS.map((sort) => {
        const selected = sort === current;
        return (
          <Pressable
            key={sort}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            onPress={() => choose(sort)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
            <Text style={[styles.label, selected && styles.selected]}>{t(`library.sorts.${sort}`)}</Text>
            {selected ? <Icon name="check" color={colors.primaryDark} strokeWidth={2.6} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.bg, paddingTop: 28, paddingBottom: 32 },
  heading: { paddingHorizontal: 20, paddingBottom: 12 },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.surface },
  label: { fontFamily: fonts.medium, fontSize: 17 },
  selected: { fontFamily: fonts.bold, color: colors.primaryDark },
});
