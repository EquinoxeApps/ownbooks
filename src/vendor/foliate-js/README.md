# foliate-js (vendored)

EPUB renderer used by the reader WebView. Upstream: https://github.com/johnfactotum/foliate-js
(MIT, see LICENSE). foliate-js has no npm releases, so it is vendored at a pinned commit:

    78914aef4466eb960965702401634c2cb348e9b1 (2026-05-01)

Only the files needed for EPUB are copied (no PDF.js, MOBI, FB2, comics, TTS or search).
The other formats that `view.js` imports dynamically are stubbed out when bundling.
Files are unmodified. To update: copy the same files from a newer commit, update the hash
above, run `npm run build:reader`, and re-test the reader on a device.
