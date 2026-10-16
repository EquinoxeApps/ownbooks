# OwnBooks: Progress

Last updated: 2026-10-16

Source of truth for scope: [`docs/design/spec.md`](docs/design/spec.md), plus the
interview decisions in the build plan (summarised in "Decisions" below).
Each milestone ends with a build running on a real device and a review before the
next one starts.

## MVP scope (decided 2026-10-16)

The MVP delivers the whole product promise: import, play **and read** your own DRM-free
audiobooks and ebooks, with progress synced across devices. It is the spec's v1 minus the
items under "After the MVP" below. iPhone is out of scope for the MVP (blocked on the Apple
account) but stays required before an App Store release.

**Done when:** every acceptance criterion in spec §8 passes on Android and is recorded here, the
store requirements in Milestone 6 are met, and the app is live in a Google Play closed testing
track.

## Status at a glance

| # | Milestone | Status |
|---|---|---|
| 0 | Prerequisites (accounts, MCP servers, backend projects) | ✅ Done (Apple / Play Console pending) |
| 1 | Foundation | ✅ Done on Android (iPhone waits for the Apple account) |
| 2 | Single-file audio + audio risk spike | ✅ Done on Android (iPhone waits for the Apple account) |
| 3 | Full audio | 🔨 Partly done (tags, covers, chapters pulled forward) |
| 4 | Ebooks | ⬜ Not started |
| 5 | Sync | ⬜ Not started |
| 6 | Analytics, polish, release prep | ⬜ Not started |

## Infrastructure

| What | Where |
|---|---|
| Repo | https://github.com/EquinoxeStudios/ownbooks (public, MIT) |
| CI | GitHub Actions: lint, typecheck, Jest, RLS tests against local Supabase (all green) |
| Supabase | Project `ownbooks` (`ukqhhjlrthzlulxniqqu`), Equinoxe Studios org (Pro), eu-central-1 |
| Supabase auth | Email 6-digit OTP (custom templates), Google (web + iOS client IDs, skip nonce on) |
| Firebase | Project `ownbooksapp`; Android + iOS apps registered for `dev.ownbooks.app`; Android SHA-1 added |
| Google OAuth | Project `ownbooksapp`: consent screen in Testing mode, web, iOS and Android clients |
| EAS | `@agencyequinox/ownbooks`; env vars set for development / preview / production |
| Android signing | EAS-managed keystore (SHA-1 `6B:AD:D3:3D:0D:84:4F:24:DE:58:51:0D:89:B5:0D:D5:B7:91:5C:E8`) |
| Latest Android preview build | https://expo.dev/accounts/agencyequinox/projects/ownbooks/builds/4af6d2f1-69f9-4303-9891-2433309dc93a (`1d83fb3`) |
| MCP servers (local) | supabase, firebase, expo (the github MCP token is broken; use the `gh` CLI) |

## Milestone 1: Foundation ✅

Done:
- Expo SDK 57 project (TypeScript strict, Expo Router, React Compiler), portrait only,
  placeholder bundle ID `dev.ownbooks.app`, Android minSdk 29.
- Design system from `docs/design/design.html`: tokens, Rubik + Literata fonts, Button,
  Card, Chip/Tag, Icon (design SVGs), IconButton, ProgressBar, TextField, BackHeader,
  TabBar, GeneratedCover.
- Onboarding: Welcome → Nothing gets uploaded → Never lose your place → What will you
  bring first? (stored; sets the default library filter and the empty-state copy).
- Sign-in: Apple (iOS only), Google, email 6-digit code with resend cooldown, Terms/Privacy links.
- Local-first auth state: the account is remembered in SQLite, so the app works offline
  with an expired session. Sign-out keeps files and hides the library. A different
  account signing in gets a prompt to remove the other account's local data.
- SQLite schema v1 with versioned migrations, repositories (kv, books, accounts),
  live queries via change listeners, exclusive transactions.
- Supabase schema: devices, books (with tombstone), progress, activity_days; RLS on
  every table; stale-write rejection; server-side pull cursors; indexed FKs.
- Tabs: Library (empty state + basic list), Activity (placeholder), Profile (account,
  Privacy/Terms, sign out, version).
- i18n: every string in `src/locales/en.json`.
- Startup diagnostics: an error boundary and a stall screen with boot breadcrumbs.
- Tests: 28 unit tests (node:sqlite), 17 RLS tests in CI.
- Fixed: launch hang caused by unstable `SQLiteProvider` props in suspense mode.

Verified on device (Android, build 63590f53, 2026-10-16):
- [x] Onboarding, Google sign-in
- [x] Email code sign-in (6-digit code, resend cooldown, wrong-code error)
- [x] Profile → sign out → "Welcome back." → sign back in, books still there
- [x] Offline relaunch (airplane mode) stays signed in
- [x] Account switch prompt (second account, keep hidden, books return to the first account)

Still open:
- [ ] iPhone build: blocked on the Apple Developer account

## Milestone 2: Single-file audio + risk spike ✅

Done (code, tests green):
- [x] Import via `expo-document-picker` (multi-select). Files are copied with the native
      async copy (progress by polling the destination size; a cancel cleans up when the copy
      returns) into `books/.import-<id>/`, then renamed to `books/<bookId>/` together with the
      DB insert. Failure or cancel leaves nothing behind; stale temp folders are cleaned on launch.
- [x] Grouping: several MP3/M4A → one book (natural sort); each M4B its own book; DRM/unsupported rejected
- [x] Duration probe (also proves the file plays), fingerprint (size + first/last 1 MiB, SHA-256),
      duplicate detection, free-space check
- [x] Import screen ("We found your audiobook", edit title/author, copy progress) + success screen
- [x] Player controller: one `AudioPlayer` for every book, multi-file track switching,
      position saved every 5 s and on pause/seek/track change/background/unload,
      restored on reopen, speed remembered per book
- [x] Player screen as designed (cover, seek bar with screen-reader support, −30/+30, prev/next track)
- [x] Mini-player above the tab bar; library rows open the player
- [x] Lock screen / notification controls (book title, then chapter or author)
- [x] Playback stops and lock-screen controls clear on sign-out / account switch

Audio findings (expo-audio 57):
- `AudioPlaylist` has no lock-screen support, and Android stops background audio after ~3 min
  without it, so books use a single `AudioPlayer` and switch files on track end.
- Lock-screen skip was hardcoded to 10 s and Android didn't pause on unplugged headphones.
  Fixed with `patches/expo-audio+57.0.5.patch` (patch-package): lock screen −30 s / +30 s
  on both platforms (Android icons too: `ICON_SKIP_BACK_30` / `ICON_SKIP_FORWARD_30`),
  `setHandleAudioBecomingNoisy(true)` on Android, and the Android notification clears the
  previous book's cover when the next book has none. **Re-check this patch on every Expo SDK
  upgrade.** Lock-screen intervals stay fixed even when in-app skip intervals become
  configurable (milestone 3).
- **Prebuilt Expo modules ignore patches.** Expo ships expo-audio as a precompiled AAR (📦 in the
  Gradle log), so until 2026-10-16 none of the Android patch was in the app: the lock screen
  jumped 10 s and unplugging didn't pause (a device log showed the system sending
  `ACTION_AUDIO_BECOMING_NOISY` and the app ignoring it). `package.json` now sets
  `expo.autolinking.{android,ios}.buildFromSource: ["expo-audio"]`, and
  `test/patches.test.ts` fails if any patched package is missing from that list.
- Android's lock screen shows only title and artist (not album), so the title is the book and
  the artist is the chapter (or the author when the book has a single chapter).
- Android doesn't take audio focus for a call that only vibrates, so playback keeps going until
  the call is answered. Pausing on a silent ring would need the phone-state permission; not done.
- expo-file-system 57: reading a picked `content://` file through `FileHandle` fails on Android
  with "Bad file descriptor" (the ParcelFileDescriptor is garbage-collected), so imports use the
  native copy instead of chunked JS reads. Worth reporting upstream.
- Lock-screen artwork: the cover from the file's tags (a `file://` URL; expo-audio loads it on both
  platforms). Books without cover art show none, because generated covers aren't images.

Device checks (spec §6.1), run on builds 63590f53 and 4af6d2f1 (2026-10-16). Stop and reassess the audio
library if any fail:
- [x] Position writes keep working with the screen locked for 30+ min
- [x] Lock screen shows skip buttons (not previous/next track). On 63590f53 they jumped 10 s
      (patch not compiled in, see findings), the book title was missing, and a book without a
      cover showed the previous book's cover. All fixed and verified on 4af6d2f1: 30 s icons and
      jumps, book title then chapter, no stale cover
- [x] Multi-file book plays across file boundaries without an audible gap or stall
- [x] Resumes correctly after a phone call (a vibrate-only ring doesn't pause; see findings)
- [x] Pauses on Bluetooth disconnect / unplugged headphones. On 63590f53, unplugging USB-C
      earphones kept playing on the speaker (the noisy handling in our patch was never compiled
      in). Verified on 4af6d2f1: unplugging pauses; Bluetooth headset off pauses while playing
      and stays paused when already paused
- [x] Force-quit during playback loses ≤ 5 s; reboot resumes at the saved position
- [x] Large file (500 MB M4B) imports with visible progress and without freezing
- [ ] Sleep timer under lock: moved to milestone 3 together with the sleep timer itself

## Milestone 3: Full audio 🔨

Pulled forward after testing a 40-file MP3 book (2026-10-09):
- [x] Tag reader in TypeScript, no dependency (`src/features/import/tags`): ID3v2.2–2.4 + ID3v1
      (title, album, artist, album artist, composer, track/disc, front cover, CHAP chapters) and
      MP4 (`ilst` tags, `covr`, Nero `chpl` and QuickTime chapter tracks). Reads only the
      metadata boxes/frames, never the audio. Bad tags never fail an import.
      Tested against real ffmpeg-made files (`scripts/make-tag-fixtures.mjs`).
      `music-metadata` was not used: ESM/Node streams, and Hermes lacks the needed TextDecoders.
- [x] Book title = album shared by the files (single file: its title tag), author = album artist /
      artist / composer; filename rules only as a fallback. Track order by disc/track number when
      every file is numbered; track titles from tags or the filename without its numbering.
- [x] Cover art saved as `books/<id>/cover.jpg|png`; shown in library, mini-player, player,
      import screens and the lock screen.
- [x] Chapters: embedded chapters, or one per file. The player shows "Chapter X of N", the
      seek bar spans the current chapter, prev/next chapter, and a Chapters sheet to jump.
- [x] Existing books are repaired once on launch (migration v2 `tags_read`): cover, chapters and
      track names are added; the title/author change only if they were never edited.
- [x] Device checks: the 40-file book renames itself and lists its tracks; the 460 MB M4B
      shows its chapters and cover; lock-screen artwork and chapter name

Still to do for the MVP:
- [ ] Speed sheet 0.5–3.0× (stored per book already)
- [ ] Sleep timer (durations + end of chapter), verified with the screen locked (last §6.1 check)
- [ ] Library: Continue card, sort sheet (recent / title / author / date added), filter All / Audio / Ebooks
- [ ] Book detail: edit title/author, delete with confirmation, mark as finished

## Milestone 4: Ebooks ⬜

- [ ] foliate-js spike in a WebView (fallback: epub.js); vendored at a pinned commit
- [ ] EPUB import + DRM detection (`META-INF/encryption.xml`)
- [ ] Reader: paginated, tap/swipe, themes light/sepia/dark (follow system), text size,
      line spacing, margins, Literata + publisher-font toggle
- [ ] TOC, CFI persistence, font-size change keeps the passage, link handling (confirm external)
- [ ] EPUB fingerprint at import; remove the "Ebooks arrive in the next update" import error

## Milestone 5: Sync ⬜

- [x] Fingerprints (SHA-256 of size + first 1 MB + last 1 MB; multi-file = hash of track hashes):
      computed at audio import since milestone 2
- [ ] Sync engine: device upsert, push dirty rows / pending ops, pull since cursor, last write wins
- [ ] Triggers: foreground, book open/close, pause, ~60 s during playback, reconnect
- [ ] "Not on this device" placeholders + adoption on import
- [ ] Conflict sheet ("You're further ahead on your iPad")
- [ ] Remove from all devices (tombstone)
- [ ] Profile: "In sync" status
- [ ] Delete account: Edge Function + in-app confirmation + web deletion page

## Milestone 6: Analytics, polish, release prep ⬜

- [ ] Consent screen (equal-weight Accept/Decline) + Settings toggle
- [ ] Firebase Analytics (consent mode defaults to denied, ad ID off) + Crashlytics, both consent-gated
- [ ] Event wrapper that rejects any book data; events from the spec + onboarding property
- [ ] Storage screen (per book + total)
- [ ] Empty and error states, accessibility pass (VoiceOver / TalkBack)
- [ ] GitHub Pages `/site`: privacy policy, terms, account deletion page
- [ ] Production email sender in Supabase (e.g. Resend)
- [ ] Final bundle ID and legal entity; Google OAuth consent screen → In production
- [ ] Play Console: store listing, data-safety form (email, usage data, diagnostics), closed testing
      track. New personal developer accounts need a closed test with 12+ testers for 14 days
      before production access

## After the MVP

Deferred on 2026-10-16 to reach the MVP sooner:
- Review step for mixed selections (reorder / split / merge); automatic grouping stays
- Configurable skip intervals (fixed at −30 / +30 for now)
- Listening and reading activity: local daily totals (2-minute idle cut-off for reading), the
  Activity tab (this week, listening vs reading, books finished, days with books) and History
- Profile: "Your devices" list
- Maestro end-to-end flows (manual device checklists per milestone until then)
- iPhone build, Sign in with Apple and the App Store listing (needs the Apple Developer account)

## Open items / waiting on

- **Apple Developer account** ($99/yr): needed for any iPhone build and Sign in with Apple.
- **Google Play Console** ($25): needed for release (Milestone 6).
- **Production email sender** (e.g. Resend or Postmark): Supabase's built-in sender is for testing only.
- **Final bundle ID + publishing entity**: placeholder is `dev.ownbooks.app`.

## Decisions (from the planning interview)

Synced daily Activity totals (no link to any book) · devices table · light-only app
chrome (dark player, themed reader) · email OTP (no magic links) · phones, portrait only ·
English, i18n-ready · multi-file audiobooks in v1 · Literata + publisher-font toggle ·
MIT · GitHub Pages for the legal and deletion pages · Crashlytics behind consent ·
stop for review after each milestone · Expo SDK 57 (the plan said 56; 57 is current) ·
skip −30 s / +30 s in the app and on the lock screen (the spec said −15 / +30; changed 2026-10-16).
