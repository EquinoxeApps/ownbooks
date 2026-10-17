import type { ConfigContext, ExpoConfig } from 'expo/config';

// Everything project-specific comes from the environment so forks can point the
// app at their own backend. See .env.example.
const BUNDLE_ID = process.env.OWNBOOKS_BUNDLE_ID || 'dev.ownbooks.app';
const GOOGLE_IOS_URL_SCHEME = process.env.GOOGLE_IOS_URL_SCHEME;
// Facebook App ID and client token are public values (Meta for Developers → Settings).
const FACEBOOK_APP_ID = process.env.EXPO_PUBLIC_FACEBOOK_APP_ID;
const FACEBOOK_CLIENT_TOKEN = process.env.EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'OwnBooks',
  slug: 'ownbooks',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'ownbooks',
  // 'automatic' so the reader can follow the system theme; app chrome stays light by its own colours.
  userInterfaceStyle: 'automatic',
  backgroundColor: '#F7F9F6',
  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: false,
    usesAppleSignIn: true,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: BUNDLE_ID,
    adaptiveIcon: {
      backgroundColor: '#DFF5EC',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // No broad storage permissions: files arrive through the system picker.
    blockedPermissions: [
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.READ_MEDIA_AUDIO',
      // The Facebook SDK declares these ad, attribution and install-referrer permissions. Sign-in
      // needs none of them and OwnBooks never tracks or advertises (checked in the built APK's manifest).
      'com.google.android.gms.permission.AD_ID',
      'android.permission.ACCESS_ADSERVICES_AD_ID',
      'android.permission.ACCESS_ADSERVICES_ATTRIBUTION',
      'android.permission.ACCESS_ADSERVICES_CUSTOM_AUDIENCE',
      'android.permission.ACCESS_ADSERVICES_TOPICS',
      'com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE',
    ],
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#F7F9F6',
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
      },
    ],
    'expo-sqlite',
    'expo-secure-store',
    'expo-localization',
    'expo-apple-authentication',
    [
      'expo-audio',
      {
        // Playback only: no microphone permission, background audio on.
        microphonePermission: false,
        recordAudioAndroid: false,
        enableBackgroundPlayback: true,
      },
    ],
    [
      'expo-build-properties',
      {
        android: { minSdkVersion: 29 },
      },
    ],
    // The Google Sign-In plugin refuses to run without an iOS URL scheme, so it
    // is only added once one is configured.
    ...(GOOGLE_IOS_URL_SCHEME
      ? [
          [
            '@react-native-google-signin/google-signin',
            { iosUrlScheme: GOOGLE_IOS_URL_SCHEME },
          ] as [string, Record<string, string>],
        ]
      : []),
    // Facebook sign-in, only when configured. No app events, no advertising ID, no auto-start:
    // the SDK is initialised when someone taps "Continue with Facebook".
    ...(FACEBOOK_APP_ID && FACEBOOK_CLIENT_TOKEN
      ? [
          [
            'react-native-fbsdk-next',
            {
              appID: FACEBOOK_APP_ID,
              clientToken: FACEBOOK_CLIENT_TOKEN,
              displayName: 'OwnBooks',
              scheme: `fb${FACEBOOK_APP_ID}`,
              isAutoInitEnabled: false,
              autoLogAppEventsEnabled: false,
              advertiserIDCollectionEnabled: false,
              iosUserTrackingPermission: false,
            },
          ] as [string, Record<string, unknown>],
        ]
      : []),
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  // Forks: set EAS_OWNER / EAS_PROJECT_ID (from `npx eas-cli init`) to use your own project.
  owner: process.env.EAS_OWNER || 'agencyequinox',
  extra: {
    eas: { projectId: process.env.EAS_PROJECT_ID || '53b114f3-80af-48cd-8934-f5d0cb74b495' },
  },
});
