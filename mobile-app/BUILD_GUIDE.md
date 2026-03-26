# BANKEZEE Connect Mobile App - Complete Build Guide

This guide explains how to build and distribute the Android APK for your telecallers.

## Prerequisites

Before building, you need:
1. **Node.js 18+** - [Download](https://nodejs.org/)
2. **Java JDK 17** - [Download](https://adoptium.net/)
3. **Android Studio** (optional, for emulator testing) - [Download](https://developer.android.com/studio)
4. **Android SDK** - Can install via Android Studio or command line tools

### Quick Setup on Windows/Mac/Linux

```bash
# Install Node.js from nodejs.org
# Then verify:
node --version  # Should be 18+
npm --version

# Install React Native CLI
npm install -g react-native-cli

# Clone or copy the mobile-app folder to your computer
```

## Step 1: Install Dependencies

```bash
cd mobile-app
npm install
# or
yarn install
```

## Step 2: Configure API URL

Edit `src/config.js` and update the API URL to your production backend:

```javascript
// Change this to your production backend URL
export const API_BASE_URL = 'https://connect.bankezee.com/api';
```

## Step 3: Android SDK Setup

### Option A: Using Android Studio (Recommended)
1. Install Android Studio
2. Open Android Studio → SDK Manager
3. Install:
   - Android SDK Platform 34
   - Android SDK Build-Tools 34.0.0
   - Android Emulator (optional, for testing)

### Option B: Command Line Only
```bash
# Download Android command line tools from:
# https://developer.android.com/studio#command-tools

# Set environment variables (add to ~/.bashrc or ~/.zshrc)
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/emulator
export PATH=$PATH:$ANDROID_HOME/platform-tools
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin

# Accept licenses
sdkmanager --licenses

# Install required SDK components
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"
```

## Step 4: Build Debug APK (For Testing)

```bash
cd mobile-app

# Start Metro bundler in one terminal
npx react-native start

# In another terminal, build and install on connected device/emulator
npx react-native run-android

# Or build APK directly
cd android
./gradlew assembleDebug

# APK location:
# android/app/build/outputs/apk/debug/app-debug.apk
```

## Step 5: Build Release APK (For Distribution)

### 5.1 Generate Signing Key (One-time)

```bash
cd android/app

# Generate keystore
keytool -genkeypair -v -storetype PKCS12 \
  -keystore bankezee-connect.keystore \
  -alias bankezee-connect \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000

# You'll be prompted for:
# - Keystore password (remember this!)
# - Key password (can be same as keystore password)
# - Your name, organization, city, country
```

**⚠️ IMPORTANT: Keep the keystore file and passwords safe! You'll need them for future updates.**

### 5.2 Configure Signing

Edit `android/gradle.properties` and add:

```properties
MYAPP_UPLOAD_STORE_FILE=bankezee-connect.keystore
MYAPP_UPLOAD_KEY_ALIAS=bankezee-connect
MYAPP_UPLOAD_STORE_PASSWORD=your-keystore-password
MYAPP_UPLOAD_KEY_PASSWORD=your-key-password
```

### 5.3 Build Release APK

```bash
cd android
./gradlew assembleRelease

# Release APK location:
# android/app/build/outputs/apk/release/app-release.apk
```

## Step 6: Distribute APK to Telecallers

### Method 1: Direct Sharing (Easiest)
1. Rename `app-release.apk` to `BankezeeConnect-v1.0.apk`
2. Share via WhatsApp, Email, or Google Drive
3. Telecaller downloads and installs

### Method 2: Internal Website
1. Upload APK to your website
2. Share download link with telecallers
3. Example: `https://connect.bankezee.com/download/BankezeeConnect.apk`

### Method 3: Firebase App Distribution (Recommended for teams)
1. Sign up at [Firebase Console](https://console.firebase.google.com/)
2. Create a project and add Android app
3. Use Firebase App Distribution to manage releases
4. Telecallers get automatic update notifications

## Telecaller Installation Guide

Share these instructions with your telecallers:

### For Android Users:

1. **Download the APK** from [your distribution method]

2. **Enable Unknown Sources** (first time only):
   - Go to **Settings → Security**
   - Enable **"Install from Unknown Sources"** or
   - Enable **"Install unknown apps"** for the browser/app you're using

3. **Install the APK**:
   - Open the downloaded file
   - Tap **"Install"**
   - Wait for installation to complete

4. **Grant Permissions** (first time only):
   When you open the app, allow these permissions:
   - **Phone** - To make calls
   - **Call Logs** - To track your calls automatically
   - **Phone State** - To detect incoming calls

5. **Login** with your telecaller credentials

## App Permissions Explained

| Permission | Why It's Needed |
|------------|-----------------|
| READ_CALL_LOG | To read your call history and verify actual call durations |
| CALL_PHONE | To make phone calls when you tap "Call" on a lead |
| READ_PHONE_STATE | To detect when you receive incoming calls from leads |
| INTERNET | To sync data with the CRM backend |

## Troubleshooting

### "App not installed" error
- Make sure you've enabled "Install from Unknown Sources"
- Check if you have enough storage space
- If updating, make sure the new APK is signed with the same key

### Permissions not working
- Go to Settings → Apps → BANKEZEE Connect → Permissions
- Manually enable all permissions

### Call logs not syncing
- Check if you have internet connection
- Make sure you granted Call Log permission
- Try tapping "Sync Call Logs" button in the app
- Check if you're logged in

### App crashes on launch
- Clear app data: Settings → Apps → BANKEZEE Connect → Clear Data
- Reinstall the app

## Updating the App

When you release a new version:

1. Update `versionCode` and `versionName` in `android/app/build.gradle`
2. Build new release APK
3. Distribute to telecallers
4. They install over the existing app (data is preserved)

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-03-26 | Initial release with call log sync |

## Support

For issues or questions:
- Email: support@bankezee.com
- Phone: [Your support number]
