// Runs inside the reader WebView. Bundled with foliate-js by scripts/build-reader.mjs into
// readerHtml.generated.ts. Talks to React Native through a small typed message bridge
// (see src/features/reader/bridge.ts for the message types):
//   RN → web: window.ownbooks.<command>(args) via injectJavaScript
//   web → RN: window.ReactNativeWebView.postMessage(JSON)

import '../../../vendor/foliate-js/view.js';

const post = (message) => window.ReactNativeWebView?.postMessage(JSON.stringify(message));

const fail = (where, error) => post({ type: 'error', where, message: String(error?.message ?? error) });

/** Reads a local file:// book as a File (fetch() can't load file: URLs in Android WebView). */
const loadFile = (url) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.responseType = 'blob';
    xhr.onload = () =>
      xhr.response ? resolve(new File([xhr.response], 'book.epub')) : reject(new Error(`load failed: ${xhr.status}`));
    xhr.onerror = () => reject(new Error('load failed'));
    xhr.send();
  });

const MARGINS = { narrow: '4%', normal: '7%', wide: '11%' };
let view = null;

/**
 * Literata faces embedded in the page as base64 data blocks (not scripts, so the CSP doesn't
 * apply). Section iframes are same-origin, so they can use these blob URLs.
 */
const fontFaces = [...document.querySelectorAll('script[type="application/x-font"]')].map((el) => {
  const bytes = Uint8Array.from(atob(el.textContent.trim()), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'font/ttf' }));
  return `@font-face { font-family: 'OwnBooks Literata'; src: url(${url}); font-weight: ${el.dataset.weight}; font-style: ${el.dataset.style}; }`;
});

/** CSS injected into every section. Literata replaces the book's fonts unless "book's font" is chosen. */
function css(style) {
  const { theme, fontSize, lineHeight, font } = style;
  const literata = font === 'literata' && fontFaces.length > 0;
  return `
    @namespace epub "http://www.idpf.org/2007/ops";
    ${literata ? fontFaces.join(' ') : ''}
    html { color-scheme: ${theme.dark ? 'dark' : 'light'}; font-size: ${fontSize}px !important; }
    html, body { color: ${theme.text} !important; background: ${theme.bg} !important; }
    body * { color: inherit !important; background-color: transparent !important; border-color: ${theme.muted} !important; }
    a, a * { color: ${theme.link} !important; }
    p, li, blockquote, dd, div { line-height: ${lineHeight} !important; }
    ${literata ? `body, body *:not(pre):not(code):not(kbd):not(samp) { font-family: 'OwnBooks Literata', serif !important; }` : ''}
    p, li, blockquote, dd { text-align: justify; -webkit-hyphens: auto; hyphens: auto; widows: 2; orphans: 2; }
    [align="left"] { text-align: left; } [align="right"] { text-align: right; } [align="center"] { text-align: center; }
    pre { white-space: pre-wrap !important; }
    img, svg { max-width: 100%; height: auto; }
    aside[epub|type~="footnote"], aside[epub|type~="endnote"], aside[epub|type~="note"], aside[epub|type~="rearnote"] { display: none; }
  `;
}

function applyStyle(style) {
  document.body.style.background = style.theme.bg;
  const renderer = view?.renderer;
  if (!renderer) return;
  renderer.setAttribute('gap', MARGINS[style.margin] ?? MARGINS.normal);
  renderer.setAttribute('margin', '24px');
  renderer.setAttribute('max-inline-size', '720px');
  renderer.setStyles?.(css(style));
}

/** Flattens foliate's nested TOC for the native list. */
function flattenToc(items, depth = 0, out = []) {
  for (const item of items ?? []) {
    out.push({ label: (item.label ?? '').trim(), href: item.href ?? null, depth });
    flattenToc(item.subitems, depth + 1, out);
  }
  return out;
}

/** Left / right third of the screen turns the page; the middle is for the app's controls. */
function onTap(event) {
  if (event.defaultPrevented || event.target.closest?.('a')) return;
  if (event.view?.getSelection?.()?.toString()) return;
  const x = event.screenX / window.innerWidth;
  if (x < 0.3) view.prev();
  else if (x > 0.7) view.next();
  else post({ type: 'tap', zone: 'middle' });
}

window.ownbooks = {
  async open({ url, cfi, style }) {
    try {
      const file = await loadFile(url);
      view = document.createElement('foliate-view');
      document.body.append(view);
      view.addEventListener('load', ({ detail: { doc } }) => doc.addEventListener('click', onTap));
      view.addEventListener('relocate', ({ detail }) =>
        post({
          type: 'relocate',
          cfi: detail.cfi,
          fraction: detail.fraction ?? 0,
          chapter: detail.tocItem?.label?.trim() ?? null,
          href: detail.tocItem?.href ?? null,
        }),
      );
      view.addEventListener('external-link', (event) => {
        event.preventDefault();
        post({ type: 'externalLink', href: event.detail.href_ ?? String(event.detail.a?.href ?? '') });
      });
      await view.open(file);
      applyStyle(style);
      view.renderer.setAttribute('animated', '');
      post({ type: 'ready', toc: flattenToc(view.book.toc) });
      await view.init({ lastLocation: cfi || null, showTextStart: !cfi });
    } catch (error) {
      fail('open', error);
    }
  },
  setStyle(style) {
    try {
      applyStyle(style);
    } catch (error) {
      fail('style', error);
    }
  },
  goTo(target) {
    view?.goTo(target).catch((error) => fail('goTo', error));
  },
  next() {
    view?.next();
  },
  prev() {
    view?.prev();
  },
};

post({ type: 'loaded' });
