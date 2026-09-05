// API Configuration
// IMPORTANT: Update this URL before building for production
// For EAS builds, set EXPO_PUBLIC_API_URL in your eas.json or env
// The mobile app REQUIRES EXPO_PUBLIC_API_URL to be set - no default fallback
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || '';

// Call Log Sync Settings
export const SYNC_INTERVAL_MINUTES = 5; // How often to sync call logs
export const CALL_LOG_DAYS_TO_SYNC = 7; // How many days of call history to sync

// App Settings
export const APP_NAME = 'BANKEZEE Connect';
export const APP_VERSION = '2.5.0';
