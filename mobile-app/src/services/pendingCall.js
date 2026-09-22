import AsyncStorage from '@react-native-async-storage/async-storage';

// Persists the in-flight call context so the post-call "Log Call Outcome" modal can be
// reopened even when Android KILLS the app process during the native call (aggressive
// battery/memory management on some OEMs). Without this, a cold-started app loses the
// in-memory call state and lands on the Dashboard with no modal.
const KEY = 'pending_call_v1';
const MAX_AGE_MS = 15 * 60 * 1000; // ignore anything older than 15 minutes

export const savePendingCall = async (data) => {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ ...data, savedAt: Date.now() }));
  } catch (e) { /* non-fatal */ }
};

export const getPendingCall = async () => {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const stamp = data?.savedAt || data?.startTime;
    if (!data?.startTime || !stamp || (Date.now() - stamp) > MAX_AGE_MS) {
      await AsyncStorage.removeItem(KEY);
      return null;
    }
    return data;
  } catch (e) {
    return null;
  }
};

export const clearPendingCall = async () => {
  try { await AsyncStorage.removeItem(KEY); } catch (e) { /* non-fatal */ }
};
