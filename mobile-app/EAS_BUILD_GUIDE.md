# BANKEZEE Connect - Easy APK Build Guide (EAS Build)

## Overview
This guide uses **EAS Build** (Expo's cloud service) to build your APK. No local Android SDK setup required!

**Time Required:** ~15-20 minutes (mostly waiting for cloud build)

**Important:** This project is already linked to EAS Project ID `8f937251-101a-4ee2-9b24-c54e7181a31e`. Do NOT create a new project - this would break signing credentials.

---

## Step 1: Create Free Expo Account (2 minutes)

1. Go to **https://expo.dev/signup**
2. Sign up with email or GitHub
3. Verify your email

---

## Step 2: Install EAS CLI (2 minutes)

Open terminal/command prompt and run:

```bash
npm install -g eas-cli
```

Then login to your Expo account:

```bash
eas login
```

Enter your Expo username and password when prompted.

---

## Step 3: Download & Prepare the App (3 minutes)

1. Download the `mobile-app` folder from Emergent platform
2. Open terminal in the `mobile-app` folder
3. Install dependencies:

```bash
npm install
```

4. Fix any Expo SDK compatibility issues:

```bash
npx expo install --fix
```

---

## Step 4: Configure Your API URL (1 minute)

Edit `src/config.js` and verify the API URL:

```javascript
// For production:
export const API_BASE_URL = 'https://connect.bankezee.com/api';

// For testing with preview:
// export const API_BASE_URL = 'https://responsive-crm-app-1.preview.emergentagent.com/api';
```

---

## Step 5: Build APK (10-15 minutes)

Run the build command:

```bash
eas build --platform android --profile preview
```

**What happens:**
1. Your code is uploaded to Expo's cloud servers
2. The APK is built in the cloud
3. You get a download link when complete

**First time only:** You'll be asked to generate a new Android keystore. Select **Yes**.

**Important:** The keystore is stored in your Expo account. Future builds will use the same signing credentials automatically.

---

## Step 7: Download Your APK

When the build completes, you'll see:

```
✔ Build finished
🤖 Android build: https://expo.dev/artifacts/eas/xxxxx.apk
```

Click the link or copy-paste it to download your APK!

---

## Step 8: Distribute to Telecallers

### Option A: Share via Google Drive
1. Upload APK to Google Drive
2. Get shareable link
3. Send link to telecallers via WhatsApp/email

### Option B: Share via WhatsApp
1. Rename file to `bankezee-connect.apk`
2. Send directly via WhatsApp (may need to compress as zip)

### Option C: Host on your website
1. Upload to your web server
2. Share download link

---

## Installing on Telecaller Phones

Telecallers need to:

1. **Enable "Install from Unknown Sources"**
   - Go to Settings → Security
   - Enable "Unknown sources" or "Install unknown apps"

2. **Download and open the APK**

3. **Tap Install**

4. **Grant Permissions** when the app asks for:
   - Call log access
   - Phone permission
   - Microphone (for recording)
   - Storage

5. **Login** with their telecaller credentials

6. **Enable Call Recording** (optional)
   - Toggle the "🎙️ Call Recording" switch
   - Use speakerphone for best audio quality

---

## Updating the App

When you make changes:

1. Update version in `package.json` and `app.json`
2. Run `eas build --platform android --profile preview` again
3. Share new APK with telecallers
4. They install over the old version (data is preserved)

---

## Troubleshooting

### "eas: command not found"
Run: `npm install -g eas-cli`

### Build fails with dependency errors
Run:
```bash
rm -rf node_modules
npm install
```
Then try building again.

### "Not logged in"
Run: `eas login`

### Build stuck or failed
- Check build logs at https://expo.dev (your dashboard)
- Try running `eas build` again

---

## Quick Reference Commands

| Action | Command |
|--------|---------|
| Login to Expo | `eas login` |
| Build APK | `eas build --platform android --profile preview` |
| Check build status | `eas build:list` |
| View build logs | Visit https://expo.dev |

---

## Need Help?

- **Expo Docs:** https://docs.expo.dev/build/introduction/
- **EAS Build Guide:** https://docs.expo.dev/build/setup/

---

## App Features Summary

After installation, telecallers can:

✅ **View assigned leads** with contact details
✅ **Make calls** directly from the app
✅ **Auto-sync call logs** to the CRM
✅ **Record calls** (optional, toggle in app)
✅ **Background sync** every 5 minutes

Admins can:
✅ **View verified call stats** in dashboard
✅ **Play back recordings** in Reports → Recordings tab
✅ **Track call verification scores** per telecaller
