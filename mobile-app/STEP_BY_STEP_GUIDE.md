# BANKEZEE Connect Mobile App - Step-by-Step Build & Distribution Guide

## Overview

This mobile app provides:
1. **Automatic Call Log Sync** - Syncs all outgoing/incoming calls to matched leads
2. **Call Recording** - Records calls using speakerphone for quality assurance
3. **Background Sync** - Periodically syncs data even when app is closed

## Prerequisites (Install Once)

### Step 1: Install Node.js
1. Go to https://nodejs.org/
2. Download **Node.js 18 LTS** or higher
3. Run the installer and follow prompts
4. Verify installation:
   ```bash
   node --version   # Should show v18.x.x or higher
   npm --version    # Should show 9.x.x or higher
   ```

### Step 2: Install Java JDK 17
1. Go to https://adoptium.net/
2. Download **Temurin JDK 17**
3. Run installer and follow prompts
4. Verify:
   ```bash
   java --version   # Should show OpenJDK 17
   ```

### Step 3: Install Android SDK (Without Android Studio)
**Option A: Command Line Tools Only (Lighter)**
1. Download from: https://developer.android.com/studio#command-tools
2. Extract to a folder (e.g., `C:\Android\cmdline-tools\latest\` on Windows)
3. Set environment variables:
   
   **Windows (PowerShell as Admin):**
   ```powershell
   [Environment]::SetEnvironmentVariable("ANDROID_HOME", "C:\Android", "User")
   [Environment]::SetEnvironmentVariable("Path", $env:Path + ";C:\Android\cmdline-tools\latest\bin;C:\Android\platform-tools", "User")
   ```
   
   **Mac/Linux (add to ~/.bashrc or ~/.zshrc):**
   ```bash
   export ANDROID_HOME=$HOME/Android/Sdk
   export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin
   export PATH=$PATH:$ANDROID_HOME/platform-tools
   ```

4. Install required SDK components:
   ```bash
   sdkmanager --licenses
   sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"
   ```

**Option B: Install Android Studio (Easier but Heavier)**
1. Download from https://developer.android.com/studio
2. Install and run Android Studio
3. Go to Settings → SDK Manager
4. Install Android SDK 34 and Build Tools 34.0.0

---

## Building the APK

### Step 4: Download the Mobile App Code
Copy the `/app/mobile-app/` folder from this project to your computer.

### Step 5: Configure API URL
Edit `mobile-app/src/config.js`:
```javascript
// Change this to your production backend URL
export const API_BASE_URL = 'https://connect.bankezee.com/api';
```

### Step 6: Install Dependencies
```bash
cd mobile-app
npm install
```

### Step 7: Build Debug APK (For Testing)
```bash
cd android
./gradlew assembleDebug
```
**APK Location:** `android/app/build/outputs/apk/debug/app-debug.apk`

### Step 8: Build Release APK (For Distribution)

#### 8a. Generate Signing Key (First Time Only)
```bash
cd android/app
keytool -genkeypair -v -storetype PKCS12 \
  -keystore bankezee-connect.keystore \
  -alias bankezee-connect \
  -keyalg RSA -keysize 2048 -validity 10000
```
Enter details when prompted:
- Keystore password: **Save this securely!**
- Your name, organization, city, state, country

#### 8b. Configure Signing
Edit `android/gradle.properties`:
```properties
MYAPP_UPLOAD_STORE_FILE=bankezee-connect.keystore
MYAPP_UPLOAD_KEY_ALIAS=bankezee-connect
MYAPP_UPLOAD_STORE_PASSWORD=your-password-here
MYAPP_UPLOAD_KEY_PASSWORD=your-password-here
```

#### 8c. Build Release APK
```bash
cd android
./gradlew assembleRelease
```
**APK Location:** `android/app/build/outputs/apk/release/app-release.apk`

---

## Distributing the APK

### Step 9: Rename the APK
```bash
mv app-release.apk BankezeeConnect-v1.0.apk
```

### Step 10: Share with Telecallers

**Option A: WhatsApp/Email (Easiest)**
1. Share the APK file directly via WhatsApp or Email
2. Telecaller downloads on their Android phone
3. Tap to install

**Option B: Google Drive**
1. Upload APK to Google Drive
2. Share link with telecallers
3. They open link on Android and download

**Option C: Company Website**
1. Upload APK to your server
2. Add download link: `https://connect.bankezee.com/download/BankezeeConnect.apk`

---

## Telecaller Installation Instructions

Send these instructions to your telecallers:

### How to Install BANKEZEE Connect App

1. **Download** the APK file from [your distribution method]

2. **Enable Unknown Sources** (First Time Only)
   - Open **Settings** → **Security** (or **Privacy**)
   - Find **"Install unknown apps"** or **"Unknown sources"**
   - Enable for your browser/file manager

3. **Install the App**
   - Open the downloaded APK file
   - Tap **"Install"**
   - Wait for installation

4. **Grant Permissions**
   When you open the app, tap **"Allow"** for:
   - **Phone** - To make calls
   - **Call Logs** - To verify your calls automatically
   - **Phone State** - To track incoming calls

5. **Login** with your existing credentials

6. **Start Making Calls**
   - Your leads appear in the app
   - Tap a lead → Tap "Call"
   - After the call, your call log syncs automatically!

---

## Troubleshooting

### "App not installed" Error
- Check if "Unknown sources" is enabled
- Make sure you have enough storage space
- Try uninstalling any previous version first

### Permissions Not Working
- Go to Settings → Apps → BANKEZEE Connect → Permissions
- Manually enable all permissions

### Call Logs Not Syncing
- Make sure Call Log permission is granted
- Check your internet connection
- Tap the "Sync" button in the app
- Make sure you're logged in

### App Crashes
- Clear app data: Settings → Apps → BANKEZEE Connect → Clear Data
- Reinstall the app

---

## Updating the App

When you release a new version:

1. Update version in `android/app/build.gradle`:
   ```gradle
   versionCode 2
   versionName "1.1.0"
   ```

2. Build new release APK

3. Distribute to telecallers (they install over existing app)

---

## Summary Checklist

| Step | Task | Status |
|------|------|--------|
| 1 | Install Node.js 18+ | ⬜ |
| 2 | Install Java JDK 17 | ⬜ |
| 3 | Install Android SDK | ⬜ |
| 4 | Download mobile-app code | ⬜ |
| 5 | Configure API URL | ⬜ |
| 6 | Run `npm install` | ⬜ |
| 7 | Build debug APK (test) | ⬜ |
| 8 | Generate signing key | ⬜ |
| 9 | Build release APK | ⬜ |
| 10 | Distribute to telecallers | ⬜ |
| 11 | Verify call logs syncing | ⬜ |
| 12 | Enable call recording | ⬜ |

---

## Using the App - For Telecallers

### Enabling Call Recording
1. Open the BANKEZEE Connect app
2. Find the **"🎙️ Call Recording"** toggle at the top
3. Turn it ON
4. Grant microphone permission when prompted
5. **Important:** For best audio quality, use **SPEAKERPHONE** during calls

### How Call Recording Works
- When you tap "Call" on a lead, the app will:
  1. Start recording from the microphone
  2. Open the phone dialer
  3. After the call ends and you return to the app:
     - Recording is saved locally
     - Recording is automatically uploaded to the server
- Recordings appear in **Admin Reports → Recordings** tab
- Admins can play back and review all recordings

### Tips for Best Recording Quality
- Always use speakerphone mode during calls
- Stay in a quiet environment
- Hold phone at a comfortable distance
- Recording stops automatically when you return to the app

---

## Need Help?

If you encounter issues:
1. Check the error message carefully
2. Search for the error online
3. Make sure all prerequisites are installed correctly
4. Verify ANDROID_HOME environment variable is set

**Estimated Total Time:** 30-60 minutes (first time setup)
**Subsequent Builds:** 5 minutes
