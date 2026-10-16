import { commandScript, parseEvent } from '../bridge';
import { DEFAULT_READER_SETTINGS, resolveTheme, sanitizeSettings, stepFontSize, toReaderStyle } from '../settings';

describe('reader bridge', () => {
  it('parses known events and clamps the fraction', () => {
    expect(parseEvent(JSON.stringify({ type: 'relocate', cfi: 'epubcfi(/6/4!/4)', fraction: 1.2, chapter: 'One' }))).toEqual({
      type: 'relocate',
      cfi: 'epubcfi(/6/4!/4)',
      fraction: 1,
      chapter: 'One',
      href: null,
    });
    expect(parseEvent(JSON.stringify({ type: 'ready', toc: [{ label: 'A', href: 'a.xhtml', depth: 0 }, { bad: 1 }] }))).toEqual({
      type: 'ready',
      toc: [{ label: 'A', href: 'a.xhtml', depth: 0 }],
    });
  });

  it('drops malformed or unknown messages', () => {
    expect(parseEvent('not json')).toBeNull();
    expect(parseEvent(JSON.stringify({ type: 'relocate', cfi: 3 }))).toBeNull();
    expect(parseEvent(JSON.stringify({ type: 'externalLink' }))).toBeNull();
    expect(parseEvent(JSON.stringify({ type: 'eval', code: 'x' }))).toBeNull();
  });

  it('passes command arguments as JSON, so book text cannot break out', () => {
    expect(commandScript({ name: 'next' })).toBe('window.ownbooks && window.ownbooks.next(); true;');
    expect(commandScript({ name: 'goTo', arg: `a.xhtml");alert("x` })).toBe(
      'window.ownbooks && window.ownbooks.goTo("a.xhtml\\");alert(\\"x"); true;',
    );
  });
});

describe('reader settings', () => {
  it('follows the system theme on auto', () => {
    expect(resolveTheme('auto', true)).toBe('dark');
    expect(resolveTheme('auto', false)).toBe('light');
    expect(resolveTheme('sepia', true)).toBe('sepia');
    expect(toReaderStyle(DEFAULT_READER_SETTINGS, true).theme.dark).toBe(true);
  });

  it('keeps the text size within range', () => {
    expect(stepFontSize(18, 1)).toBe(20);
    expect(stepFontSize(30, 1)).toBe(30);
    expect(stepFontSize(14, -1)).toBe(14);
  });

  it('falls back to defaults for missing or unknown saved values', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_READER_SETTINGS);
    expect(sanitizeSettings({ theme: 'neon', fontSize: 99, margins: 'wide' })).toEqual({
      ...DEFAULT_READER_SETTINGS,
      fontSize: 30,
      margins: 'wide',
    });
  });
});
