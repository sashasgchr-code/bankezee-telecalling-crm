import { PermissionsAndroid, Platform, Linking, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { syncCallLogs as apiSyncCallLogs } from './api';

// Diagnostics state - accessible from dashboard
let diagnosticsState = {
  moduleLoaded: false,
  moduleLoadError: null,
  lastPermissionCheck: null,
  readCallLogPermission: 'unknown',
  readPhoneStatePermission: 'unknown',
  callLogEntriesCount: 0,
  lastSyncResult: null,
  lastSyncError: null,
  lastSyncTime: null,
};

// Get current diagnostics state
export const getDiagnostics = () => ({ ...diagnosticsState });

// Reset diagnostics
export const resetDiagnostics = () => {
  diagnosticsState.lastSyncResult = null;
  diagnosticsState.lastSyncError = null;
};

// Check if call log module is available
let CallLogsModule = null;
let moduleLoadAttempted = false;

const loadCallLogModule = () => {
  if (moduleLoadAttempted) {
    return CallLogsModule;
  }
  
  moduleLoadAttempted = true;
  
  try {
    // First check if NativeModules has the CallLogs module
    const { NativeModules } = require('react-native');
    if (NativeModules.CallLogs) {
      console.log('✅ NativeModules.CallLogs found');
    } else {
      console.log('❌ NativeModules.CallLogs not found - native module not linked');
      console.log('Available NativeModules:', Object.keys(NativeModules || {}).join(', '));
      diagnosticsState.moduleLoaded = false;
      diagnosticsState.moduleLoadError = 'NativeModules.CallLogs not found - app needs rebuild';
      return null;
    }
    
    CallLogsModule = require('react-native-call-log').default;
    diagnosticsState.moduleLoaded = true;
    diagnosticsState.moduleLoadError = null;
    console.log('✅ react-native-call-log module loaded successfully');
    return CallLogsModule;
  } catch (error) {
    diagnosticsState.moduleLoaded = false;
    diagnosticsState.moduleLoadError = error.message;
    console.error('❌ Failed to load react-native-call-log:', error.message);
    return null;
  }
};

// Initialize module on import
loadCallLogModule();

// Request call log permission with proper UI feedback
export const requestCallLogPermission = async () => {
  if (Platform.OS !== 'android') {
    console.log('Call log access is only available on Android');
    return false;
  }

  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.READ_CALL_LOG,
      {
        title: 'Call Log Permission Required',
        message: 'BANKEZEE Connect needs to read your call history to automatically track call durations with customers. This is essential for accurate reporting.',
        buttonNeutral: 'Ask Me Later',
        buttonNegative: 'Cancel',
        buttonPositive: 'Allow',
      }
    );

    const isGranted = granted === PermissionsAndroid.RESULTS.GRANTED;
    diagnosticsState.readCallLogPermission = isGranted ? 'granted' : 'denied';
    diagnosticsState.lastPermissionCheck = new Date().toISOString();
    
    if (isGranted) {
      console.log('✅ Call log permission granted');
    } else {
      console.log('❌ Call log permission denied');
    }
    
    return isGranted;
  } catch (err) {
    console.error('Error requesting call log permission:', err);
    diagnosticsState.readCallLogPermission = 'error';
    diagnosticsState.lastPermissionCheck = new Date().toISOString();
    return false;
  }
};

// Request phone state permission
export const requestPhoneStatePermission = async () => {
  if (Platform.OS !== 'android') return true;

  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
      {
        title: 'Phone State Permission',
        message: 'BANKEZEE Connect needs to detect incoming calls from customers for accurate tracking.',
        buttonNeutral: 'Ask Me Later',
        buttonNegative: 'Cancel',
        buttonPositive: 'Allow',
      }
    );
    
    const isGranted = granted === PermissionsAndroid.RESULTS.GRANTED;
    diagnosticsState.readPhoneStatePermission = isGranted ? 'granted' : 'denied';
    
    return isGranted;
  } catch (err) {
    console.error('Error requesting phone state permission:', err);
    diagnosticsState.readPhoneStatePermission = 'error';
    return false;
  }
};

// Request phone permission (for making calls)
export const requestPhonePermission = async () => {
  if (Platform.OS !== 'android') return true;

  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.CALL_PHONE,
      {
        title: 'Phone Permission',
        message: 'BANKEZEE Connect needs permission to make phone calls.',
        buttonNeutral: 'Ask Me Later',
        buttonNegative: 'Cancel',
        buttonPositive: 'Allow',
      }
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch (err) {
    console.error('Error requesting phone permission:', err);
    return false;
  }
};

// Request all required permissions at once
export const requestAllPermissions = async () => {
  if (Platform.OS !== 'android') return { callLog: false, phone: true, phoneState: false };

  try {
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.READ_CALL_LOG,
      PermissionsAndroid.PERMISSIONS.CALL_PHONE,
      PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
    ]);

    const callLogGranted = results[PermissionsAndroid.PERMISSIONS.READ_CALL_LOG] === PermissionsAndroid.RESULTS.GRANTED;
    const phoneStateGranted = results[PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE] === PermissionsAndroid.RESULTS.GRANTED;
    
    diagnosticsState.readCallLogPermission = callLogGranted ? 'granted' : 'denied';
    diagnosticsState.readPhoneStatePermission = phoneStateGranted ? 'granted' : 'denied';
    diagnosticsState.lastPermissionCheck = new Date().toISOString();

    return {
      callLog: callLogGranted,
      phone: results[PermissionsAndroid.PERMISSIONS.CALL_PHONE] === PermissionsAndroid.RESULTS.GRANTED,
      phoneState: phoneStateGranted,
    };
  } catch (err) {
    console.error('Error requesting permissions:', err);
    return { callLog: false, phone: false, phoneState: false };
  }
};

// Check if call log permission is granted
export const hasCallLogPermission = async () => {
  if (Platform.OS !== 'android') return false;
  
  try {
    const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_CALL_LOG);
    diagnosticsState.readCallLogPermission = granted ? 'granted' : 'denied';
    return granted;
  } catch (error) {
    diagnosticsState.readCallLogPermission = 'error';
    return false;
  }
};

// Check phone state permission
export const hasPhoneStatePermission = async () => {
  if (Platform.OS !== 'android') return false;
  
  try {
    const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE);
    diagnosticsState.readPhoneStatePermission = granted ? 'granted' : 'denied';
    return granted;
  } catch (error) {
    diagnosticsState.readPhoneStatePermission = 'error';
    return false;
  }
};

// Get call logs from device - WITH VISIBLE ERROR HANDLING
export const getCallLogs = async (daysBack = 7, showErrors = false) => {
  if (Platform.OS !== 'android') {
    const msg = 'Call log access is only available on Android';
    if (showErrors) Alert.alert('Platform Error', msg);
    return { success: false, error: msg, logs: [] };
  }

  // Check module availability
  const CallLogs = loadCallLogModule();
  if (!CallLogs) {
    const errorMsg = `Call log module not available: ${diagnosticsState.moduleLoadError || 'Unknown error'}`;
    diagnosticsState.lastSyncError = errorMsg;
    if (showErrors) {
      Alert.alert(
        'Module Error',
        `The call log module failed to load. This usually means the app was not built correctly.\n\nError: ${diagnosticsState.moduleLoadError}\n\nPlease rebuild the app with EAS Build.`,
        [{ text: 'OK' }]
      );
    }
    return { success: false, error: errorMsg, logs: [] };
  }

  // Check permission
  const hasPermission = await hasCallLogPermission();
  if (!hasPermission) {
    const errorMsg = 'READ_CALL_LOG permission not granted';
    diagnosticsState.lastSyncError = errorMsg;
    if (showErrors) {
      Alert.alert(
        'Permission Required',
        'Call log permission is required to sync your calls. Please grant the permission in Settings.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Request Permission', onPress: requestCallLogPermission }
        ]
      );
    }
    return { success: false, error: errorMsg, logs: [] };
  }

  try {
    const minTimestamp = Date.now() - (daysBack * 24 * 60 * 60 * 1000);
    
    const logs = await CallLogs.load(-1, { minTimestamp });
    
    diagnosticsState.callLogEntriesCount = logs.length;
    
    // Transform call logs to our format
    const transformedLogs = logs.map(log => ({
      phone_number: log.phoneNumber,
      type: getCallType(log.type),
      duration_seconds: parseInt(log.duration, 10) || 0,
      timestamp: new Date(parseInt(log.timestamp, 10)).toISOString(),
      name: log.name || null,
      raw_type: log.type,
    }));

    console.log(`✅ Retrieved ${transformedLogs.length} call log entries`);
    return { success: true, error: null, logs: transformedLogs };
  } catch (error) {
    const errorMsg = `Error reading call logs: ${error.message}`;
    diagnosticsState.lastSyncError = errorMsg;
    console.error('❌', errorMsg);
    
    if (showErrors) {
      Alert.alert('Call Log Error', errorMsg);
    }
    
    return { success: false, error: errorMsg, logs: [] };
  }
};

// Convert call type to readable string
const getCallType = (type) => {
  switch (type) {
    case '1':
    case 'INCOMING':
      return 'incoming';
    case '2':
    case 'OUTGOING':
      return 'outgoing';
    case '3':
    case 'MISSED':
      return 'missed';
    case '5':
    case 'REJECTED':
      return 'rejected';
    default:
      return 'unknown';
  }
};

// Sync call logs with backend - WITH VISIBLE ERROR HANDLING
export const syncCallLogsWithBackend = async (leadPhoneNumbers = [], showErrors = true) => {
  diagnosticsState.lastSyncTime = new Date().toISOString();
  
  try {
    const lastSyncTime = await AsyncStorage.getItem('last_call_log_sync');
    const minTimestamp = lastSyncTime 
      ? new Date(lastSyncTime).getTime() 
      : Date.now() - (7 * 24 * 60 * 60 * 1000);

    const result = await getCallLogs(7, showErrors);
    
    if (!result.success) {
      diagnosticsState.lastSyncResult = { synced: 0, matched: 0, error: result.error };
      return { synced: 0, matched: 0, error: result.error };
    }

    const callLogs = result.logs;
    
    // Filter logs that are after last sync
    const newLogs = callLogs.filter(log => {
      const logTime = new Date(log.timestamp).getTime();
      return logTime > minTimestamp;
    });

    if (newLogs.length === 0) {
      console.log('No new call logs to sync');
      diagnosticsState.lastSyncResult = { synced: 0, matched: 0, message: 'No new logs' };
      diagnosticsState.lastSyncError = null;
      return { synced: 0, matched: 0 };
    }

    // If we have lead phone numbers, filter to only those
    let logsToSync = newLogs;
    if (leadPhoneNumbers.length > 0) {
      const normalizedLeadNumbers = leadPhoneNumbers.map(normalizePhoneNumber);
      logsToSync = newLogs.filter(log => {
        const normalizedLogNumber = normalizePhoneNumber(log.phone_number);
        return normalizedLeadNumbers.includes(normalizedLogNumber);
      });
    }

    if (logsToSync.length === 0) {
      console.log('No matching call logs to sync');
      await AsyncStorage.setItem('last_call_log_sync', new Date().toISOString());
      diagnosticsState.lastSyncResult = { synced: 0, matched: 0, message: 'No matching logs' };
      diagnosticsState.lastSyncError = null;
      return { synced: 0, matched: 0 };
    }

    // Sync with backend
    const syncResult = await apiSyncCallLogs(logsToSync);
    
    // Update last sync time
    await AsyncStorage.setItem('last_call_log_sync', new Date().toISOString());
    
    const finalResult = { synced: logsToSync.length, matched: syncResult.matched || 0 };
    diagnosticsState.lastSyncResult = finalResult;
    diagnosticsState.lastSyncError = null;
    
    console.log(`✅ Synced ${logsToSync.length} call logs, ${syncResult.matched || 0} matched to leads`);
    return finalResult;
  } catch (error) {
    const errorMsg = `Sync failed: ${error.message}`;
    diagnosticsState.lastSyncError = errorMsg;
    diagnosticsState.lastSyncResult = { synced: 0, matched: 0, error: errorMsg };
    console.error('❌', errorMsg);
    
    if (showErrors) {
      Alert.alert('Sync Error', errorMsg);
    }
    
    return { synced: 0, matched: 0, error: errorMsg };
  }
};

// Normalize phone number for comparison
export const normalizePhoneNumber = (phone) => {
  if (!phone) return '';
  // Remove all non-digit characters and handle float numbers like "9876543210.0"
  let normalized = String(phone).split('.')[0].replace(/\D/g, '');
  // Remove leading country code (91 for India)
  if (normalized.length > 10 && normalized.startsWith('91')) {
    normalized = normalized.slice(2);
  }
  // Take last 10 digits
  if (normalized.length > 10) {
    normalized = normalized.slice(-10);
  }
  return normalized;
};

// Make a phone call
export const makePhoneCall = async (phoneNumber) => {
  // Clean the phone number
  const cleanPhone = String(phoneNumber).split('.')[0].replace(/[^0-9+]/g, '');
  const url = `tel:${cleanPhone}`;
  
  try {
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      await Linking.openURL(url);
      return true;
    } else {
      console.log('Cannot open phone app');
      Alert.alert('Error', 'Cannot open phone app');
      return false;
    }
  } catch (error) {
    console.error('Error making phone call:', error);
    Alert.alert('Error', `Failed to make call: ${error.message}`);
    return false;
  }
};

// Get the most recent call for a specific number after a specific time
// This is used for post-call duration lookup
export const getRecentCallForNumber = async (phoneNumber, afterTimestamp, maxWaitMs = 5000) => {
  // Quick check if module is available
  const CallLogs = loadCallLogModule();
  if (!CallLogs) {
    console.log('Call log module not available - cannot lookup call');
    return {
      success: false,
      call: null,
      attempts: 0,
      message: 'Call log module not available',
    };
  }

  const normalizedTarget = normalizePhoneNumber(phoneNumber);
  
  // Wait a moment for the call log to be updated by Android
  const startTime = Date.now();
  let attempts = 0;
  const maxAttempts = 5;
  
  while (Date.now() - startTime < maxWaitMs && attempts < maxAttempts) {
    attempts++;
    
    const result = await getCallLogs(1, false); // Last 24 hours, don't show errors
    
    if (!result.success) {
      console.log(`Attempt ${attempts}: Call log read failed`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      continue;
    }
    
    const matchingLogs = result.logs.filter(log => {
      const normalizedLogNumber = normalizePhoneNumber(log.phone_number);
      const logTime = new Date(log.timestamp).getTime();
      return normalizedLogNumber === normalizedTarget && logTime > afterTimestamp;
    });

    if (matchingLogs.length > 0) {
      // Return the most recent matching call
      const mostRecent = matchingLogs.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )[0];
      
      console.log(`✅ Found call record after ${attempts} attempts:`, mostRecent);
      return {
        success: true,
        call: mostRecent,
        attempts,
      };
    }
    
    console.log(`Attempt ${attempts}: No matching call found yet, waiting...`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log(`❌ No matching call found after ${attempts} attempts`);
  return {
    success: false,
    call: null,
    attempts,
    message: 'Call record not found in Android call log',
  };
};

// Legacy function for backwards compatibility
export const getCallLogForNumber = async (phoneNumber, afterTimestamp) => {
  const result = await getRecentCallForNumber(phoneNumber, afterTimestamp);
  return result.success ? result.call : null;
};

// Run full diagnostics check
export const runDiagnostics = async () => {
  console.log('=== Running Call Log Diagnostics ===');
  
  // Check module
  loadCallLogModule();
  
  // Check permissions
  await hasCallLogPermission();
  await hasPhoneStatePermission();
  
  // Try to read call logs
  const result = await getCallLogs(1, false);
  
  const diagnostics = getDiagnostics();
  
  console.log('Diagnostics result:', diagnostics);
  
  return {
    ...diagnostics,
    callLogReadSuccess: result.success,
    callLogReadError: result.error,
  };
};
