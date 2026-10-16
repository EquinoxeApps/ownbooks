import { create } from 'zustand';

import * as kv from '@/db/repositories/kv';
import type { Db } from '@/db/types';
import { colors, playerColors, readerThemes } from '@/ui/tokens';

import type { ReaderStyle } from './bridge';

export type ReaderThemeName = 'light' | 'sepia' | 'dark';

export type ReaderSettings = {
  /** 'auto' follows the phone's light / dark setting (spec §4.5). */
  theme: 'auto' | ReaderThemeName;
  fontSize: number;
  lineSpacing: 'tight' | 'normal' | 'loose';
  margins: 'narrow' | 'normal' | 'wide';
  /** Literata everywhere, or the fonts the book ships with. */
  font: 'literata' | 'publisher';
};

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  theme: 'auto',
  fontSize: 18,
  lineSpacing: 'normal',
  margins: 'normal',
  font: 'literata',
};

export const FONT_SIZE = { min: 14, max: 30, step: 2 } as const;
const LINE_HEIGHT = { tight: 1.35, normal: 1.6, loose: 1.85 } as const;
const LINKS: Record<ReaderThemeName, string> = { light: colors.primaryDark, sepia: colors.primaryDark, dark: playerColors.accent };

export function resolveTheme(theme: ReaderSettings['theme'], systemDark: boolean): ReaderThemeName {
  return theme === 'auto' ? (systemDark ? 'dark' : 'light') : theme;
}

export function stepFontSize(size: number, direction: 1 | -1): number {
  return Math.min(FONT_SIZE.max, Math.max(FONT_SIZE.min, size + direction * FONT_SIZE.step));
}

export function toReaderStyle(settings: ReaderSettings, systemDark: boolean): ReaderStyle {
  const name = resolveTheme(settings.theme, systemDark);
  return {
    theme: { ...readerThemes[name], link: LINKS[name], dark: name === 'dark' },
    fontSize: settings.fontSize,
    lineHeight: LINE_HEIGHT[settings.lineSpacing],
    margin: settings.margins,
    font: settings.font,
  };
}

/** Accepts only known values, so a bad or old saved value falls back to the default. */
export function sanitizeSettings(raw: unknown): ReaderSettings {
  const r = (raw ?? {}) as Partial<Record<keyof ReaderSettings, unknown>>;
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(v as T) ? (v as T) : fallback;
  const d = DEFAULT_READER_SETTINGS;
  const size = typeof r.fontSize === 'number' ? r.fontSize : d.fontSize;
  return {
    theme: pick(r.theme, ['auto', 'light', 'sepia', 'dark'], d.theme),
    fontSize: Math.min(FONT_SIZE.max, Math.max(FONT_SIZE.min, Math.round(size))),
    lineSpacing: pick(r.lineSpacing, ['tight', 'normal', 'loose'], d.lineSpacing),
    margins: pick(r.margins, ['narrow', 'normal', 'wide'], d.margins),
    font: pick(r.font, ['literata', 'publisher'], d.font),
  };
}

type SettingsState = {
  settings: ReaderSettings;
  load(db: Db, userId: string): Promise<void>;
  update(db: Db, userId: string, change: Partial<ReaderSettings>): Promise<void>;
};

const key = (userId: string) => kv.userKey(userId, 'reader.settings');

/** Reading settings, remembered per account on this device. */
export const useReaderSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULT_READER_SETTINGS,
  async load(db, userId) {
    set({ settings: sanitizeSettings(await kv.getJson(db, key(userId))) });
  },
  async update(db, userId, change) {
    const settings = sanitizeSettings({ ...get().settings, ...change });
    set({ settings });
    await kv.setJson(db, key(userId), settings);
  },
}));
