# OwnBooks

A free, open-source iOS and Android app for reading and listening to the
DRM-free ebooks (EPUB) and audiobooks (MP3, M4B, M4A) you already own.

- **Always free.** No purchases, subscriptions or ads.
- **Your files stay on your device.** Only reading/listening progress, a few
  daily totals and minimal book metadata sync between your devices.
- **Private.** Analytics are opt-in and never contain titles, authors or filenames.
- **Works offline.** The on-device database is the source of truth.

Product spec: [`docs/design/spec.md`](docs/design/spec.md) · Design mock-ups:
[`docs/design/design.html`](docs/design/design.html)

## Stack

Expo SDK 57 (React Native, TypeScript, Expo Router) · expo-sqlite · expo-audio ·
foliate-js in a WebView · Supabase (Auth + Postgres with row-level security) ·
Firebase Analytics/Crashlytics (consent-gated) · Jest · Maestro.

## Project layout

```
src/app/        Routes (Expo Router)
src/db/         SQLite schema, migrations and repositories (no SQL in components)
src/features/   auth, onboarding, library, import, player, reader, sync, …
src/ui/         Design tokens and shared components
src/lib/        Supabase client, env, i18n, files
src/locales/    Translations (en.json)
supabase/       SQL migrations, email templates, RLS tests, Edge Functions
docs/design/    Spec and design mock-ups
```

## Running your own copy

Nothing secret is committed. Forks point the app at their own backend.

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Apply the schema:
   ```sh
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
3. **Auth → Providers → Email:** enable it, and set the OTP length to 6.
4. **Auth → Email Templates:** "Magic Link" and "Confirm signup" must show the
   code, not a link. Use [`supabase/templates/email-code.html`](supabase/templates/email-code.html)
   (`{{ .Token }}`).
5. Optional providers:
   - **Google:** add the Web client ID (and the iOS client ID under "Authorized
     Client IDs"), and enable *Skip nonce checks* (required for native iOS sign-in).
   - **Apple:** add your app's bundle ID as a client ID.

### 2. Environment

```sh
cp .env.example .env   # fill in the Supabase URL and anon/publishable key
```

For EAS builds, add the same variables as
[EAS environment variables](https://docs.expo.dev/eas/environment-variables/).

Supabase's built-in email sender only manages a few emails an hour. For real use, add your own
SMTP sender under **Auth → Emails → SMTP Settings** (OwnBooks uses Resend).

### Firebase (optional: analytics and crash reports)

Create a Firebase project with Google Analytics, add Android and iOS apps with your bundle ID, and
put `google-services.json` and `GoogleService-Info.plist` in the repo root (both are gitignored).
For EAS builds, upload them as file variables:

```sh
npx eas-cli env:set --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --visibility sensitive --environment production
npx eas-cli env:set --name GOOGLE_SERVICE_INFO_PLIST --type file --value ./GoogleService-Info.plist --visibility sensitive --environment production
```

Without both files the app is built without Firebase and never asks about analytics. With them,
`firebase.json` keeps every kind of collection off until the user agrees on the consent screen.

### 3. Build and run

The app uses native modules, so it runs in a development build, not Expo Go.

```sh
npm install
npx eas-cli build --profile development --platform android   # or ios
npm start                                                     # Metro for the dev client
```

With Android Studio or Xcode installed you can build locally with
`npm run android` / `npm run ios`.

## Checks

```sh
npm run lint
npm run typecheck
npm test                 # unit tests (Node 22.5+; uses node:sqlite)
```

Row-level security tests need Docker and a local Supabase stack:

```sh
npx supabase start
npx supabase status -o env   # export API_URL, ANON_KEY, SERVICE_ROLE_KEY
npm run test:rls
```

CI runs all of these on every push (`.github/workflows/ci.yml`).

## Licence

[MIT](LICENSE)
