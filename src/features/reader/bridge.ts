/**
 * Messages between the reader screen and the WebView (src/features/reader/web/bridge.js).
 * Commands run as window.ownbooks.<name>(arg); events arrive through onMessage.
 */

export type ReaderTheme = { bg: string; text: string; muted: string; link: string; dark: boolean };

export type ReaderStyle = {
  theme: ReaderTheme;
  fontSize: number;
  lineHeight: number;
  margin: 'narrow' | 'normal' | 'wide';
  font: 'literata' | 'publisher';
};

export type TocItem = { label: string; href: string | null; depth: number };

export type ReaderEvent =
  | { type: 'loaded' }
  | { type: 'ready'; toc: TocItem[] }
  | { type: 'relocate'; cfi: string; fraction: number; chapter: string | null; href: string | null }
  | { type: 'tap'; zone: 'middle' }
  | { type: 'externalLink'; href: string }
  | { type: 'error'; where: string; message: string };

export type ReaderCommand =
  | { name: 'open'; arg: { url: string; cfi: string | null; style: ReaderStyle } }
  | { name: 'setStyle'; arg: ReaderStyle }
  | { name: 'goTo'; arg: string }
  | { name: 'next' }
  | { name: 'prev' };

/** JavaScript for WebView.injectJavaScript. Arguments go through JSON, so text can't break out. */
export function commandScript(command: ReaderCommand): string {
  const arg = 'arg' in command ? JSON.stringify(command.arg) : '';
  return `window.ownbooks && window.ownbooks.${command.name}(${arg}); true;`;
}

const str = (v: unknown): v is string => typeof v === 'string';

/** Parses a WebView message, dropping anything that doesn't match the protocol. */
export function parseEvent(data: string): ReaderEvent | null {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(data);
  } catch {
    return null;
  }
  switch (m?.type) {
    case 'loaded':
      return { type: 'loaded' };
    case 'ready':
      return Array.isArray(m.toc)
        ? {
            type: 'ready',
            toc: m.toc
              .filter((i): i is TocItem => !!i && str(i.label) && typeof i.depth === 'number')
              .map((i) => ({ label: i.label, href: str(i.href) ? i.href : null, depth: i.depth })),
          }
        : null;
    case 'relocate':
      return str(m.cfi) && typeof m.fraction === 'number'
        ? {
            type: 'relocate',
            cfi: m.cfi,
            fraction: Math.min(1, Math.max(0, m.fraction)),
            chapter: str(m.chapter) ? m.chapter : null,
            href: str(m.href) ? m.href : null,
          }
        : null;
    case 'tap':
      return { type: 'tap', zone: 'middle' };
    case 'externalLink':
      return str(m.href) ? { type: 'externalLink', href: m.href } : null;
    case 'error':
      return { type: 'error', where: str(m.where) ? m.where : '', message: str(m.message) ? m.message : '' };
    default:
      return null;
  }
}
