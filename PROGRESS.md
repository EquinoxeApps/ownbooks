# OwnBooks: Progress

Last updated: 2026-10-26 (first iOS build)

Source of truth for scope: [`docs/design/spec.md`](docs/design/spec.md), plus the
interview decisions in the build plan (summarised in "Decisions" below).
Each milestone ends with a build running on a real device and a review before the
next one starts.

## MVP scope (decided 2026-10-16)

The MVP delivers the whole product promise: import, play **and read** your own DRM-free
audiobooks and ebooks, with progress synced across devices. It is the spec's v1 minus the
items under "After the MVP" below. iPhone is part of the MVP (decided 2026-10-23, once the Apple
Developer account was approved; until then the MVP was Android only).

**Done when:** every acceptance criterion in spec §8 passes on Android and iPhone and is recorded
here, the store requirements in Milestone 6 are met, and the app is live in a Google Play closed
testing track and on TestFlight.

## Status at a glance

| # | Milestone | Status |
|---|---|---|
| 0 | Prerequisites (accounts, MCP servers, backend projects) | ✅ Done (Apple Developer and Play Console accounts exist) |
| 1 | Foundation | ✅ Done on Android (iPhone build and device check still to do) |
| 2 | Single-file audio + audio risk spike | ✅ Done on Android (iPhone still to do) |
| 3 | Full audio | ✅ MVP items done on Android (deferred items listed under "After the MVP") |
| 4 | Ebooks | ✅ Done on Android (DRM / damaged-file import still to try on a device) |
| 5 | Sync | ✅ Done on Android (web deletion page moved to 6; activity sync after the MVP) |
| 6 | Analytics, polish, release prep | 🟡 Code written (not yet on a device); store setup in progress |

## Infrastructure

| What | Where |
|---|---|
| Publisher | AB Equinoxe Marketing Oy (Business ID 3564918-4, D-U-N-S 369262372), Aurantie 2B, 45100 Kouvola, Finland. Shown in the stores as **Equinoxe Apps**. Data controller contact privacy@equinoxe.app, support support@equinoxe.app |
| App ID | `app.equinoxe.ownbooks` (Android package and iOS bundle ID; replaced the placeholder `dev.ownbooks.app` on 2026-10-23, before anything was published) |
| Repo | https://github.com/EquinoxeApps/ownbooks (public, MIT) |
| CI | GitHub Actions: lint, typecheck, Jest, RLS tests against local Supabase (all green) |
| Supabase | Project `ownbooks` (`ukqhhjlrthzlulxniqqu`), Equinoxe Apps org (Pro), eu-central-1 |
| Supabase auth | Email + password with 6-digit codes for confirming and resetting (custom templates), Google (web + iOS client IDs, skip nonce on), Facebook (SDK, pending Meta app), Apple (iPhone native; Android web, pending Services ID) |
| Firebase | Project `ownbooksapp`; Android (`1:469680403831:android:a59794aea3d32607e39d72`, SHA-1 added) and iOS (`1:469680403831:ios:631a9f85c3ec9a66e39d72`) apps for `app.equinoxe.ownbooks` |
| Google OAuth | Project `ownbooksapp`: consent screen in Testing mode; web client "OwnBooks (Supabase)" (`…v75u`), Android (`…0oqq`, package + SHA-1) and iOS (`…a7nl`) clients for `app.equinoxe.ownbooks` |
| EAS | `@equinoxe-apps/ownbooks` (the personal account `agencyequinox` was renamed to `equinoxe-apps` on 2026-10-23; same account, keystore and env vars); env vars set for development / preview / production |
| Google Play Console | Organization account; ownership moving to stores@equinoxe.app |
| Apple Developer | Organization account approved (2026-10-23), AB Equinoxe Marketing Oy |
| Android signing | EAS-managed keystore (SHA-1 `6B:AD:D3:3D:0D:84:4F:24:DE:58:51:0D:89:B5:0D:D5:B7:91:5C:E8`) |
| Latest Android preview build | https://expo.dev/accounts/equinoxe-apps/projects/ownbooks/builds/64855f6d-5436-4ef5-8c0a-01060c85a181 (`885cfc4`, milestone 6; APK checked: Firebase `ownbooksapp` config and Crashlytics in, no `AD_ID`) |
| Latest iOS build | https://expo.dev/accounts/equinoxe-apps/projects/ownbooks/builds/ea7c80b7-9e09-4d48-8dbc-8cf737845109 (`885cfc4`, production profile, build number 1; not yet on TestFlight) |
| iOS signing | EAS-managed distribution certificate (serial `7354…E5D6`) and App Store provisioning profile `2A3G87VS46`, both expire 2027-10-26 |
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
- [x] iPhone build: credentials created with the user's Apple login (2026-10-26); first build
      ea7c80b7 (production profile) compiled with Firebase dynamic frameworks, Facebook / Google
      sign-in and the expo-audio patch. `--auto-submit` failed to create the App Store Connect app
      ("OwnBooks" is taken; Apple wanted a company name), so the record is being made by hand
- [ ] Every milestone's device checks on an iPhone (via TestFlight)

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

## Milestone 3: Full audio ✅

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
- [x] Speed sheet 0.5–3.0×: − / + in 0.05 steps and presets, stored per book. expo-audio capped
      speed at 2.0× on both platforms; the patch raises it to 3.0×
- [x] Sleep timer: 5 / 15 / 30 / 45 / 60 min (counts only while playing, fades out over the last
      10 s) and end of chapter (stops at the next chapter's start, follows seeks, works across
      file boundaries). Driven by the player's status updates, which keep coming under lock
- [x] Device check (build 33196960): speed up to 3× sounds right; a 5-minute timer stops with
      the screen locked (last §6.1 check)
- [x] End of chapter at a file boundary: failed on 33196960 (the next file started anyway:
      expo-audio's replace() keeps ExoPlayer's playWhenReady). Fixed by pausing before replace()
      when the next file shouldn't autoplay; verified on dc8c7d5c
- [x] Library: Continue card (most recently opened unfinished book, time left, play button), sort
      sheet (recent / title / author / date added, remembered per account), filter All / Audio / Ebooks
- [x] Book detail (⋯ on a row, or long-press): edit title/author, mark as finished / start again,
      delete from this phone with confirmation. Playing to the end also marks a book finished.
      Delete removes the rows entirely for now; milestone 5 decides how a deleted book appears
      once sync knows about it (spec: delete is per device, "Remove from all devices" is separate)
- [x] Device check (build 33196960): Continue card, sort, filter, rename, finished / start again
- [x] Delete a book while it's in the mini-player: failed on dc8c7d5c (book left the library and
      the mini-player closed, but audio kept playing with no controls). expo-audio's remove() only
      drops its registry entry; the native player stops on release(), which otherwise waits for
      garbage collection. unload() now pauses and releases. Verified on d60b3c42, along with
      switching books and signing out while playing (opening another book's player stops the
      current one: one book is loaded at a time)

## Milestone 4: Ebooks ✅

- [x] foliate-js vendored at `78914ae` in `src/vendor/foliate-js` (EPUB files only; other formats
      stubbed). `npm run build:reader` bundles it with `src/features/reader/web/bridge.js` (esbuild)
      into one page with Literata embedded and a CSP that allows only that script by hash. Section
      frames are blob: documents and inherit the CSP, so scripts inside EPUBs never run and nothing
      loads from the network
- [x] Spike in desktop Chromium (headless, 24 MB illustrated Gutenberg EPUB): renders, TOC (63
      items), page turns, CFI restore exact, 18 → 24 px keeps the passage, dark + book's font. No
      CSP violations
- [x] EPUB import: ranged ZIP reader (fflate inflate) + small XML parser; title, author (EPUB 3
      refines / EPUB 2 opf:role), cover (cover-image / meta cover); DRM = rights.xml, sinf.xml or
      encryption.xml with anything but font obfuscation; damaged EPUBs get their own message;
      fingerprint like single audio files
- [x] Reader: paginated, swipe or tap the left / right third, top bar (back, "Title · 68%",
      Aa, contents), settings sheet (theme Auto / Light / Sepia / Dark, text size 14–30, line
      spacing, margins, Literata / book's font) remembered per account, contents sheet, CFI saved
      800 ms after page turns and on background, external links confirmed then opened in the browser
- [x] `userInterfaceStyle` is now `automatic` so Auto can follow the phone; app chrome stays
      light because every screen sets its own colours
- [x] Library, Continue card and book detail open ebooks ("Continue reading", "% read")
- [x] Device check on build 0f647c5b: import (title, author, cover), settings, contents jump,
      position restore after force-quit, Continue card "% read", Auto follows dark mode, external
      link confirmation
- [x] Page turns were unreliable on 0f647c5b: foliate's swipe snaps by the speed of the last
      movement, so short or slowing swipes snapped back, and the tap zones used the wrong
      coordinates. The bridge now handles touches itself before foliate (window capture): any
      sideways swipe ≥ 40 px or a tap on the left / right third turns the page. Checked with
      simulated touches in headless Chrome; smooth on the phone with d86811f3
- [x] Contents (and the player's Chapters) sheet dragged the sheet instead of scrolling the list:
      Android sheets need nestedScrollEnabled on the list (Chapters fixed on d86811f3). Contents
      still couldn't scroll up: it used initialScrollIndex without getItemLayout, so the rows above
      the current chapter were never laid out. Rows now have a fixed height; verified on 6016ea88
- [ ] Not yet tried on a device: a DRM-protected EPUB, a damaged file (both covered by unit tests;
      try when one is at hand)

## Sign-in methods (changed 2026-10-17)

Google, Facebook, Apple, or email + password, for both signing in and creating an account. The
passwordless email code is gone; codes now only confirm a new account and reset a password.
- [x] Email + password: sign in, create account (6-digit confirmation code), forgot / reset password
      (code + new password; the PASSWORD_RECOVERY event is ignored so the user is signed in only once
      the new password is saved). Minimum 8 characters; wrong password, unconfirmed email, existing
      account, short / leaked / weak password each get their own message. Unit-tested with a mocked client
- [x] Facebook through react-native-fbsdk-next. signInWithIdToken failed on the device ("oidc: malformed
      jwt"): Supabase only accepts Facebook Limited Login JWTs, which exist on iOS only. So the access
      token goes to the `facebook-sign-in` Edge Function (verify_jwt off; publishable keys are not JWTs):
      debug_token must be valid for our App ID, /me with appsecret_proof gives id + email, then
      find-or-create the user and return a magic-link token hash the app redeems with verifyOtp.
      Accounts get app_metadata.signed_up_with = facebook. Needs FACEBOOK_APP_ID / FACEBOOK_APP_SECRET
      function secrets. Checks unit-tested (test/facebook-sign-in.test.ts). SDK starts only on
      tap, no app events, no advertising ID, logged out after sign-in. Blocked permissions the SDK
      adds (found in build c4103406's manifest): AD_ID, ACCESS_ADSERVICES_* (Privacy Sandbox ads) and
      the Play install-referrer binding; takes effect from the next build.
      Button hidden until EXPO_PUBLIC_FACEBOOK_APP_ID is set
- [x] PKCE: React Native lacks crypto.getRandomValues / crypto.subtle, so supabase-js fell back to
      Math.random and a "plain" challenge; src/lib/cryptoPolyfill.ts fills them in with expo-crypto
- [x] Apple on Android through Apple's web sign-in (PKCE, ownbooks://auth/callback), hidden until
      EXPO_PUBLIC_APPLE_WEB_SIGN_IN=1. Supabase client now uses flowType pkce
- [x] Hosted Supabase settings applied 2026-10-17 (Management API): email confirmations on,
      minimum password 8, leaked-password check, confirmation + recovery templates
      (`supabase/templates/signup-code.html`, `reset-code.html`), redirect URL ownbooks://auth/callback.
      Still to do: the Facebook provider (App ID + secret, entered by the user in the dashboard)
- [x] Meta app 1419717433706997 (Development mode): Consumer type, Facebook Login, email permission, Android package dev.ownbooks.app,
      key hash `a63TPQ2ETyTeWFENibUN1beRXOg=` (EAS keystore), privacy policy + data deletion URLs;
      App ID + client token as EAS env vars; Facebook provider enabled in Supabase (checked 2026-10-17)
- [x] Apple App ID `app.equinoxe.ownbooks` (Sign in with Apple, primary) and Services ID
      `app.equinoxe.ownbooks.signin` (domain `ukqhhjlrthzlulxniqqu.supabase.co`, return URL
      `…/auth/v1/callback`) registered 2026-10-23; Team ID `K447M735N4`
- [x] Sign in with Apple key `99KQU36XP2` (.p8 kept in the password manager) → client secret with
      `node scripts/apple-client-secret.mjs --key-id 99KQU36XP2 --p8 <file>` → Supabase Apple provider
      on (client IDs `app.equinoxe.ownbooks.signin,app.equinoxe.ownbooks`); EXPO_PUBLIC_APPLE_WEB_SIGN_IN=1
      in the three EAS environments (2026-10-23). Apple's authorize page accepts the Services ID.
      **The secret expires on 2027-04-20: generate a new one and paste it into Supabase before then**
- [x] Device check: Apple sign-in on Android (web flow) lands in the library (build 4dcb919d, S25+,
      2026-10-23). "Share My Email" with the same address linked Apple to the existing Google
      account. Found and fixed on the way:
  - The return link `ownbooks://auth/callback?code=…` also reached Expo Router, which showed
    "Unmatched route"; `src/app/+native-intent.tsx` now keeps the current screen (de7c80b)
  - The profile said "Signed in with Google" after an Apple sign-in: it read the provider the
    account was created with; it now uses the identity signed in with most recently (577a6eb,
    in the next build)
- [x] Device checks (builds c4103406 and d6f98a33, 2026-10-17): breached password refused with its own
      message; create account → code → library; sign in and wrong-password message; forgot password
      (code + new password); Facebook via the SDK and the Edge Function → library
- [ ] Still to try: Google and email/password on the same address land on one account

## Milestone 5: Sync ✅

Built 2026-10-20 (lint, typecheck, 165 unit tests green). No server migration was needed: the
milestone 1 schema already had tombstones, stale-write rejection and server change times.
- [x] Fingerprints (SHA-256 of size + first 1 MB + last 1 MB; multi-file = hash of track hashes):
      computed at audio import since milestone 2
- [x] Sync engine (`src/features/sync/engine.ts`): upsert this device, push queued removals, dirty
      books and dirty positions, then pull books and positions since per-account cursors. Last write
      wins by client timestamp (the server drops older writes). The pull cursor is the server change
      time with a fingerprint tiebreak, re-reading a 5 s overlap (merging is idempotent). Rows are
      marked clean only if unchanged since they were read. Device ids are per account (a device row
      belongs to one user). Only `remote.ts` touches Supabase tables
- [x] Runner (`service.ts`): one pass at a time, requests coalesced, silent retries with backoff
      (5 s → 5 min), skipped offline. Triggers (`useSync.ts`): start, foreground / background,
      reconnect, book loaded or closed, pause, every 60 s while playing, reader closed, rename /
      finish / import / remove, and a short wait (≤ 1.5 s) for a fresh pull before a book opens
- [x] Fixed a last-write-wins hazard: the player re-saved an unchanged position on every
      backgrounding with a new timestamp, which would have beaten a newer position from another
      device. The player and the reader now save only positions that changed
- [x] "Not on this device" placeholders (design: dashed cover, "Last read on <device> · 33%",
      Import). Tapping one opens book detail, which explains and offers Import / Remove from all
      devices. Importing the same file adopts the placeholder (same id, keeps the synced place)
- [x] Delete from this phone now leaves a placeholder (files gone, place kept); without a backend
      configured it removes the book entirely as before
- [x] Conflict sheet (design: sync conflict): a newer position from another device that's more
      than 30 s (audio) or ~0.2% of the book (ebook) away is held in `remote_progress` and offered
      when the book is opened (library, Continue card, book detail, mini-player). "Continue from
      <device>" or "Keep this phone's position" (re-stamped so it wins everywhere). Small
      differences, or a book this phone hasn't moved, update silently
- [x] Remove from all devices (book detail): queued op → tombstone + position deleted on the
      server; other devices delete their copy when they sync. A later import brings it back
- [x] Profile: Sync section ("In sync", "Syncing…", "Waiting to sync", "Offline", "Couldn't sync")
      with the last sync time; tapping it syncs now. Sign-out first tries a final push (≤ 3 s)
- [x] Delete account: `delete-account` Edge Function (verifies the session token, deletes the auth
      user; all rows cascade), deployed 2026-10-20 with verify_jwt off because it checks the token
      itself (missing / forged tokens get 401). In-app confirmation screen from Profile; the phone's
      books and rows are removed only after the server deletion succeeds
- [x] Tests: merge rules, and a two-device simulation against an in-memory server (placeholders,
      adoption, conflict hold / keep / take, LWW, renames, remove everywhere and re-import, ebooks,
      failed pass, overlap idempotency). `supabase/tests/sync-remote.test.ts` runs the real adapter
      against local Supabase in CI (keyset paging, stale writes, tombstones, isolation)
- [x] `sync-remote.test.ts` passes in CI against local Supabase (run 39476648082, commit 57ef108)

Device checks, 2026-10-20 on builds f881f3bf, 34f7cf3d and 29944e26. With one phone, the "other device"
("Test iPad") was simulated by writing newer positions for the same book into Supabase:
- [x] First sync pushed the existing library (3 books, 3 positions, the device row)
- [x] Conflict: a newer, distant position showed the sheet on open; "Continue from Test iPad"
      landed at the right place (21:31 = Chapter 5, 17:04 in); "Keep this phone's position"
      re-stamped the phone's position so it won on the server; a 15 s difference updated silently.
      From the mini-player's play button too (34f7cf3d)
- [x] Airplane mode: played and read offline; both positions reached the server on reconnecting
- [x] Delete from this phone → placeholder (dashed cover, Import); importing the EPUB adopted it at 89%
- [x] Remove from all devices: tombstone and position deletion on the server within a second;
      re-importing brought it back at 0%; a removal from "another device" removed it on the phone
- [x] Delete account (throwaway account): auth user, device, book and position rows all gone;
      the main account untouched
- Found on the device and fixed:
  - A paused, loaded book ignored a position sync took silently, so play resumed from the old
    spot and overwrote it; the mini-player's play button skipped the conflict check (7825a83)
  - The player reported a seek target 0.4 s off, so a paused book re-saved on unload with a new
    timestamp (7b5e491)
  - Android pauses JS timers in the background, so a pause from the lock screen / notification
    only synced when the app was reopened, and the once-a-minute sync stopped with the screen
    locked (328f2d9)
- [x] Re-checked on 29944e26: a media-key pause with the app in the background reached the
      server 0.3 s later
- Known limitation: play from the lock screen, notification or a headset resumes this phone's
  position without offering a newer one (there's no screen to ask on); that position then wins

Deferred with the Activity tab ("After the MVP"): activity sync. Moved to milestone 6 with the
rest of `/site`: the web account-deletion page (needed for the Play listing).

## Milestone 6: Analytics, polish, release prep ⬜

Code written 2026-10-23 (lint, typecheck, 186 unit tests green; not yet in a build):
- [x] Consent screen (`src/app/(app)/consent.tsx`): asked once per account after sign-in (after any
      account-switch prompt), "Don't share" and "Share" as two identical buttons side by side, privacy
      policy link. "Share anonymous usage" toggle in Profile → Settings changes the same choice.
      The choice is stored per account (`user.<id>.analytics.consent`)
- [x] Firebase Analytics + Crashlytics (`@react-native-firebase/*` 27): `firebase.json` turns every
      default off (analytics and Crashlytics collection, all consent-mode types, advertising ID, SSAID,
      IDFV, automatic screen reporting, ad-network registration); iOS built without Ad ID support;
      `useFrameworks: 'dynamic'` on iOS (Firebase's Apple SDK is SPM-only). Plugins are added only
      when both config files exist; the files are EAS file variables `GOOGLE_SERVICES_JSON` /
      `GOOGLE_SERVICE_INFO_PLIST` (all three environments) and gitignored locally
- [x] `src/features/analytics`: the only code that touches Firebase. `track()` takes the spec's
      events only, each parameter a fixed list of values or a bounded whole number; anything else
      drops the event. Events wait in memory until the account answers (so the sign-in itself is
      counted after a yes), are dropped after a no; a no or a withdrawal also resets the Analytics
      data and deletes unsent crash reports. Onboarding answer as the `bring_first` user property.
      Events: sign_up / login (method), import_started / completed (type, format, size bucket, track
      count) / failed (reason), playback_started, playback_session (duration bucket; a pause under 5 s
      such as a file boundary continues the session), reader_opened, book_finished, sync_conflict_shown,
      account_deleted. Unit tests check that book data is refused and nothing is sent before a yes
- [x] Storage screen (`src/app/(app)/storage.tsx`, Profile → Storage "N books on this phone"):
      total, free space, books largest first; a row opens book detail (to delete)
- [x] Accessibility / error-state pass (code review, not yet tried with TalkBack or VoiceOver):
      errors are announced on iOS too (`useAnnounce`; VoiceOver has no live regions); the reader shows
      Previous / Next page buttons while a screen reader is on (swipes and taps don't reach the page);
      the player shows a loading or error state instead of an empty screen; opening a book never fails
      silently (a failed sync check just opens it); error states for the library, book detail actions,
      storage, reader and conflict sheet; a library filter with no books says so; live regions for
      import progress and sync status
- [ ] Device checks: consent screen once per account; toggle off / on; DebugView shows events only
      after a yes and none of them carries book data; no Firebase requests after a no (spec §8);
      Storage numbers; TalkBack and VoiceOver through sign-in, library, player and reader
- [ ] Google Analytics linked to the Firebase project `ownbooksapp` (check Project settings →
      Integrations; events need a GA4 property)
- [x] GitHub Pages `/site`: privacy policy, terms, account deletion page (sign in, then call the
      already deployed `delete-account` Edge Function)
  - [x] Pages written (2026-10-23): `site/privacy`, `site/terms`, `site/delete-account` (email +
        password and whichever OAuth providers Supabase has on; email fallback), no cookies or
        third-party requests (supabase-js vendored); `.github/workflows/pages.yml` deploys `site/`
  - [x] `delete-account` answers CORS for `https://equinoxeapps.github.io` (`WEB_ORIGINS` secret
        for forks)
  - [x] Texts approved by the user; live at https://equinoxeapps.github.io/ownbooks/ (Pages from the
        workflow, 2026-10-23); `delete-account` v2 deployed (CORS checked: site origin allowed,
        others not, no session → 401); deletion page added to Supabase's redirect URLs; Site URL set to the site (was localhost:3000)
  - [x] Meta app: privacy policy, terms and data deletion URLs point at the pages; app icon,
        category Entertainment, contact email updated by the user (checked 2026-10-23)
  - [x] Deletion on the web page with a throwaway email + password account (2026-10-23): web
        sign-in, function deleted the user (Supabase log `user_deleted`, referer the site); no
        auth, identity, device, book, progress or activity rows left
  - [ ] Later: password reset by code on the deletion page (today: reset in the app, or the email
        fallback)
- [ ] Production email sender in Supabase: Resend, sending domain `mail.equinoxe.app` (a subdomain,
      so the root domain's Google Workspace mail records stay as they are; DNS on Cloudflare).
      Resend MCP added for this project (local scope, OAuth) on 2026-10-23; waiting on its login
- [ ] App Store Connect app record (bundle ID `app.equinoxe.ownbooks`, SKU `ownbooks-ios`): being
      created by hand (the App Store name "OwnBooks" is taken); then `ascAppId` in `eas.json` and
      submit ea7c80b7 to TestFlight
- [ ] Before the Play upload: find where `USE_BIOMETRIC` and `SYSTEM_ALERT_WINDOW` in the APK
      manifest come from (not in our config or any React Native package)
- [x] Publisher and app ID decided (2026-10-23): AB Equinoxe Marketing Oy as "Equinoxe Apps",
      `app.equinoxe.ownbooks`; the app config default switched
- [ ] Move to `app.equinoxe.ownbooks` before the first upload:
  - [x] Expo account renamed `agencyequinox` → `equinoxe-apps` (no transfer needed), `owner` in
        `app.config.ts` updated
  - [x] EAS Android build credentials for the new package use the existing keystore (same SHA-1;
        keystore `3e80a836…` attached as the default on 2026-10-23)
  - [x] Firebase `ownbooksapp`: Android app (+ SHA-1) and iOS app for the new ID (Firebase did not
        create OAuth clients for them)
  - [x] Google Cloud: Android (`469680403831-0oqq…`, package + same SHA-1) and iOS
        (`469680403831-a7nl…`) OAuth clients for the new ID (2026-10-23)
  - [x] New iOS client ID and URL scheme in `.env` and the three EAS environments
  - [x] New iOS client ID added to Supabase's Google provider (authorized client IDs, after the
        web and old iOS clients)
  - [x] Meta app ("audioread"): package `app.equinoxe.ownbooks` added next to `dev.ownbooks.app`,
        class name `app.equinoxe.ownbooks.MainActivity`, key hash unchanged (2026-10-23). Remove the
        old package once a build of the new ID signs in
  - [x] Device check: Google and Facebook sign-in on a build of the new package (build 707af67f,
        Galaxy S25+, 2026-10-23)
  - [x] `dev.ownbooks.app` leftovers removed on 2026-10-23: old app uninstalled from the S25+, old
        package dropped from the Meta app, old iOS client ID dropped from Supabase's Google provider,
        old Google OAuth clients (`j53r…`, `l1mm…`) and old Firebase apps deleted
- [ ] After the first Play upload: add Play App Signing's SHA-1 to the Firebase / Google Android
      client and its key hash to the Meta app (apps installed from Play are signed with Google's key)
- [ ] Google OAuth consent screen → In production
- [ ] Meta app (ID 1419717433706997) → Live: privacy policy URL, data deletion URL (the account
      deletion page), icon, category; business verification if Meta asks. Until then only accounts
      with an app role can use Facebook sign-in
- [ ] Play Console: store listing, data-safety form (email, usage data, diagnostics; the Facebook SDK
      is in the app for sign-in only, with app events and the advertising ID off), closed testing
      track. The account is an organization account, so the 12-tester / 14-day closed test
      required of new personal accounts does not apply

## After the MVP

Deferred on 2026-10-16 to reach the MVP sooner:
- Review step for mixed selections (reorder / split / merge); automatic grouping stays
- Configurable skip intervals (fixed at −30 / +30 for now)
- Listening and reading activity: local daily totals (2-minute idle cut-off for reading), the
  Activity tab (this week, listening vs reading, books finished, days with books) and History
- Profile: "Your devices" list
- Maestro end-to-end flows (manual device checklists per milestone until then)

## Open items / waiting on

- **Production email sender** (e.g. Resend or Postmark): Supabase's built-in sender is for testing only,
  and only sends a few emails an hour; sign-up and reset codes make this more pressing.
- **Play Console ownership** move to stores@equinoxe.app.

## Decisions (from the planning interview)

Synced daily Activity totals (no link to any book) · devices table · light-only app
chrome (dark player, themed reader) · sign-in with Google, Facebook (SDK), Apple (iPhone native, Android web) or email + password, codes to confirm and reset (2026-10-17; replaced passwordless email OTP) · phones, portrait only ·
English, i18n-ready · multi-file audiobooks in v1 · Literata + publisher-font toggle ·
MIT · GitHub Pages for the legal and deletion pages · Crashlytics behind consent ·
stop for review after each milestone · Expo SDK 57 (the plan said 56; 57 is current) ·
skip −30 s / +30 s in the app and on the lock screen (the spec said −15 / +30; changed 2026-10-16) ·
published by AB Equinoxe Marketing Oy as "Equinoxe Apps", app ID `app.equinoxe.ownbooks` (2026-10-23).
