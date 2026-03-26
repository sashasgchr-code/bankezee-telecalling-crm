# BANKEZEE Connect Mobile App

Android app for telecallers with automatic call log sync functionality.

## Features

- **Automatic Call Log Sync**: Reads device call logs and syncs with backend
- **Lead Management**: View and manage assigned leads
- **Click-to-Call**: Tap to call leads directly
- **Real-time Verification**: Actual call data from phone's call log
- **Background Sync**: Automatically syncs call logs even when app is in background

## Prerequisites

- Node.js 18+
- React Native CLI
- Android Studio
- Android SDK (API Level 24+)
- JDK 17

## Setup

1. Install dependencies:
```bash
npm install
# or
yarn install
```

2. Configure API URL:
Edit `src/config.js` and set your backend URL.

3. Build and run:
```bash
npx react-native run-android
```

## Building Release APK

1. Generate a keystore (one-time):
```bash
cd android/app
keytool -genkeypair -v -storetype PKCS12 -keystore bankezee-connect.keystore -alias bankezee-connect -keyalg RSA -keysize 2048 -validity 10000
```

2. Add keystore config to `android/gradle.properties`:
```
MYAPP_UPLOAD_STORE_FILE=bankezee-connect.keystore
MYAPP_UPLOAD_KEY_ALIAS=bankezee-connect
MYAPP_UPLOAD_STORE_PASSWORD=your-password
MYAPP_UPLOAD_KEY_PASSWORD=your-password
```

3. Build release APK:
```bash
cd android
./gradlew assembleRelease
```

4. APK location: `android/app/build/outputs/apk/release/app-release.apk`

## Permissions Required

The app requires these Android permissions:
- `READ_CALL_LOG` - Read phone call history
- `READ_PHONE_STATE` - Detect incoming calls
- `CALL_PHONE` - Make phone calls
- `INTERNET` - Sync data with backend
- `RECEIVE_BOOT_COMPLETED` - Start background sync on boot

## How Call Tracking Works

1. User clicks "Call" on a lead
2. App opens native dialer via `tel:` link
3. Background service monitors for call completion
4. App reads call log to get actual call details (number, duration, timestamp)
5. Data syncs to backend and matches with lead
6. Admin dashboard shows verified call metrics

## Distributing APK

You can share the release APK directly with telecallers:
1. Send via email, WhatsApp, or file sharing
2. Telecaller enables "Install from unknown sources" in Android settings
3. Telecaller installs the APK
4. App requests necessary permissions on first launch
