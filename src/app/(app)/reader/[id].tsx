import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, AppState, Linking, Pressable, StyleSheet, useColorScheme, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { useDb } from '@/db/provider';
import { getEbookFilePath, getLibraryItem, markOpened } from '@/db/repositories/books';
import { getProgress, saveEbookPosition } from '@/db/repositories/progress';
import { useAuthStore } from '@/features/auth/store';
import { commandScript, parseEvent, type ReaderCommand } from '@/features/reader/bridge';
import { toReaderStyle, useReaderSettings } from '@/features/reader/settings';
import { emptyReaderState, useReaderStore, type ReaderLocation } from '@/features/reader/store';
import { READER_HTML } from '@/features/reader/web/readerHtml.generated';
import { requestSync } from '@/features/sync/service';
import { fileUri } from '@/lib/files';
import { fonts, IconButton, Text } from '@/ui';

/** Positions are written at most this often while turning pages (spec §4.6: debounced). */
const SAVE_DEBOUNCE_MS = 800;

type Opened = { url: string; cfi: string | null; title: string };

/** EPUB reader: foliate-js in a WebView, positions saved as CFIs. */
export default function Reader() {
  const { t } = useTranslation();
  const db = useDb();
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = useAuthStore((s) => s.account?.id ?? '');
  const settings = useReaderSettings((s) => s.settings);
  const loadSettings = useReaderSettings((s) => s.load);
  const systemDark = useColorScheme() === 'dark';
  const style = useMemo(() => toReaderStyle(settings, systemDark), [settings, systemDark]);
  const location = useReaderStore((s) => s.location);

  const web = useRef<WebView>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [error, setError] = useState<'missingFile' | 'openFailed' | null>(null);
  const [rendered, setRendered] = useState(false);
  const pending = useRef<ReaderLocation | null>(null);
  // Re-saving the same CFI (e.g. the restore on open) would only give it a newer sync timestamp.
  const savedCfi = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The style at the moment the page asks to open; later changes go through setStyle.
  const styleRef = useRef(style);
  useEffect(() => {
    styleRef.current = style;
  }, [style]);

  const send = useCallback((command: ReaderCommand) => web.current?.injectJavaScript(commandScript(command)), []);

  const flush = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const loc = pending.current;
    pending.current = null;
    if (!loc || loc.cfi === savedCfi.current) return;
    savedCfi.current = loc.cfi;
    void saveEbookPosition(db, { bookId: id, cfi: loc.cfi, fraction: loc.fraction, at: Date.now() });
  }, [db, id]);

  useEffect(() => {
    if (userId) void loadSettings(db, userId);
  }, [db, userId, loadSettings]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [book, path, progress] = await Promise.all([getLibraryItem(db, id), getEbookFilePath(db, id), getProgress(db, id)]);
      const url = fileUri(path);
      if (cancelled) return;
      if (!book || !url) {
        setError('missingFile');
        return;
      }
      await markOpened(db, id, Date.now());
      savedCfi.current = progress?.cfi ?? null;
      setOpened({ url, cfi: progress?.cfi ?? null, title: book.title });
    })();
    useReaderStore.setState({ ...emptyReaderState, bookId: id, send });
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') flush();
    });
    return () => {
      cancelled = true;
      sub.remove();
      flush();
      requestSync();
      useReaderStore.setState(emptyReaderState);
    };
  }, [db, id, send, flush]);

  // Theme, size and spacing changes apply live; foliate keeps the reader on the same passage.
  useEffect(() => {
    if (rendered) send({ name: 'setStyle', arg: style });
  }, [rendered, send, style]);

  const onMessage = (event: WebViewMessageEvent) => {
    const message = parseEvent(event.nativeEvent.data);
    if (!message) return;
    switch (message.type) {
      case 'loaded':
        if (opened) send({ name: 'open', arg: { url: opened.url, cfi: opened.cfi, style: styleRef.current } });
        break;
      case 'ready':
        useReaderStore.setState({ toc: message.toc });
        break;
      case 'relocate': {
        const loc = { cfi: message.cfi, fraction: message.fraction, chapter: message.chapter, href: message.href };
        useReaderStore.setState({ location: loc });
        setRendered(true);
        pending.current = loc;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
        break;
      }
      case 'externalLink':
        Alert.alert(t('reader.externalTitle'), t('reader.externalBody', { href: message.href }), [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('reader.open'), onPress: () => void Linking.openURL(message.href) },
        ]);
        break;
      case 'error':
        console.warn('Reader error', message.where, message.message);
        if (message.where === 'open') setError('openFailed');
        break;
    }
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace('/library'));
  const { theme } = style;
  const percent = Math.round((location?.fraction ?? 0) * 100);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.bg }]} edges={['top', 'bottom']}>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <View style={styles.topBar}>
        <IconButton icon="back" accessibilityLabel={t('reader.back')} color={theme.text} strokeWidth={2.6} onPress={close} />
        <Text style={styles.topLabel} color={theme.muted} numberOfLines={1}>
          {opened ? t('reader.progress', { title: opened.title, percent }) : ''}
        </Text>
        <View style={styles.topActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('reader.settings')}
            hitSlop={4}
            onPress={() => router.push('/reader-settings')}
            style={styles.aa}>
            <Text style={styles.aaLabel} color={theme.text}>
              {t('reader.settingsShort')}
            </Text>
          </Pressable>
          <IconButton
            icon="list"
            accessibilityLabel={t('reader.contents')}
            color={theme.text}
            strokeWidth={2.4}
            onPress={() => router.push('/contents')}
          />
        </View>
      </View>

      {error ? (
        <View style={styles.center}>
          <Text variant="lead" color={theme.text} style={styles.centerText} accessibilityRole="alert">
            {t(`reader.${error}`)}
          </Text>
        </View>
      ) : opened ? (
        <View style={styles.page}>
          <WebView
            ref={web}
            source={{ html: READER_HTML, baseUrl: 'file:///' }}
            onMessage={onMessage}
            style={{ backgroundColor: theme.bg }}
            containerStyle={{ backgroundColor: theme.bg }}
            // The page reads the book with a file:// request; nothing loads from the network.
            originWhitelist={['file://*', 'about:*', 'blob:*', 'data:*']}
            onShouldStartLoadWithRequest={(req) => /^(file|about|blob|data):/.test(req.url)}
            allowFileAccess
            allowFileAccessFromFileURLs
            allowUniversalAccessFromFileURLs={false}
            allowingReadAccessToURL={opened.url.replace(/[^/]+$/, '')}
            javaScriptEnabled
            domStorageEnabled={false}
            cacheEnabled={false}
            mixedContentMode="never"
            setSupportMultipleWindows={false}
            textZoom={100}
            forceDarkOn={false}
            overScrollMode="never"
            bounces={false}
            scrollEnabled={false}
            webviewDebuggingEnabled={__DEV__}
            onContentProcessDidTerminate={() => web.current?.reload()}
            onRenderProcessGone={() => web.current?.reload()}
          />
          {!rendered ? (
            <View style={[styles.loading, { backgroundColor: theme.bg }]} accessibilityLabel={t('reader.loading')}>
              <ActivityIndicator color={theme.muted} />
            </View>
          ) : null}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: { height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, gap: 4 },
  topLabel: { flex: 1, textAlign: 'center', fontFamily: fonts.medium, fontSize: 15 },
  topActions: { flexDirection: 'row', alignItems: 'center' },
  aa: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  aaLabel: { fontFamily: fonts.bold, fontSize: 17 },
  page: { flex: 1 },
  loading: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  centerText: { textAlign: 'center' },
});
