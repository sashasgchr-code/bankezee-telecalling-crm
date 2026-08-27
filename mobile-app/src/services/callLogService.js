import { PermissionsAndroid, Platform, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { syncCallLogs as apiSyncCallLogs } from './api';

// Request call log permission
export const requestCallLogPermission = async () => {
  if (Platform.OS !== 'android') {
    console.log('Call log access is only available on Android');
    return false;
  }

  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.READ_CALL_LOG,
      {
        title: 'Call Log Permission',
        message: 'BANKEZEE Connect needs access to your call history to automatically track your calls with customers.',
        buttonNeutral: 'Ask Me Later',
        buttonNegative: 'Cancel',
        buttonPositive: 'Allow',
      }
    );

    if (granted === PermissionsAndroid.RESULTS.GRANTED) {
      console.log('Call log permission granted');
      return true;
    } else {
      console.log('Call log permission denied');
      return false;
    }
  } catch (err) {
    console.error('Error requesting call log permission:', err);
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

// Request phone state permission (for detecting incoming calls)
export const requestPhoneStatePermission = async () => {
  if (Platform.OS !== 'android') return true;

  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
      {
        title: 'Phone State Permission',
        message: 'BANKEZEE Connect needs to know your phone state to detect incoming calls from customers.',
        buttonNeutral: 'Ask Me Later',
        buttonNegative: 'Cancel',
        buttonPositive: 'Allow',
      }
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch (err) {
    console.error('Error requesting phone state permission:', err);
    return false;
  }
};

// Request all required permissions
export const requestAllPermissions = async () => {
  if (Platform.OS !== 'android') return { callLog: false, phone: true, phoneState: false };

  try {
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.READ_CALL_LOG,
      PermissionsAndroid.PERMISSIONS.CALL_PHONE,
      PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
    ]);

    return {
      callLog: results[PermissionsAndroid.PERMISSIONS.READ_CALL_LOG] === PermissionsAndroid.RESULTS.GRANTED,
      phone: results[PermissionsAndroid.PERMISSIONS.CALL_PHONE] === PermissionsAndroid.RESULTS.GRANTED,
      phoneState: results[PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE] === PermissionsAndroid.RESULTS.GRANTED,
    };
  } catch (err) {
    console.error('Error requesting permissions:', err);
    return { callLog: false, phone: false, phoneState: false };
  }
};

// Check if call log permission is granted
export const hasCallLogPermission = async () => {
  if (Platform.OS !== 'android') return false;
  
  const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_CALL_LOG);
  return granted;
};

// Get call logs from device
export const getCallLogs = async (daysBack = 7) => {
  if (Platform.OS !== 'android') {
    return [];
  }

  const hasPermission = await hasCallLogPermission();
  if (!hasPermission) {
    console.log('No call log permission');
    return [];
  }

  try {
    // Dynamic import to avoid issues on iOS or if module not available
    let CallLogs;
    try {
      CallLogs = require('react-native-call-log').default;
    } catch (moduleError) {
      console.warn('react-native-call-log module not available:', moduleError.message);
      console.warn('Call log sync requires a development build with native modules');
      return [];
    }
    
    const minTimestamp = Date.now() - (daysBack * 24 * 60 * 60 * 1000);
    
    const logs = await CallLogs.load(-1, {
      minTimestamp,
    });

    // Transform call logs to our format
    return logs.map(log => ({
      phone_number: log.phoneNumber,
      type: getCallType(log.type),
      duration_seconds: parseInt(log.duration, 10) || 0,
      timestamp: new Date(parseInt(log.timestamp, 10)).toISOString(),
      name: log.name || null,
      raw_type: log.type,
    }));
  } catch (error) {
    console.error('Error reading call logs:', error);
    return [];
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

// Sync call logs with backend
export const syncCallLogsWithBackend = async (leadPhoneNumbers = []) => {
  try {
    const lastSyncTime = await AsyncStorage.getItem('last_call_log_sync');
    const minTimestamp = lastSyncTime 
      ? new Date(lastSyncTime).getTime() 
      : Date.now() - (7 * 24 * 60 * 60 * 1000); // Default 7 days

    const callLogs = await getCallLogs(7);
    
    // Filter logs that are after last sync
    const newLogs = callLogs.filter(log => {
      const logTime = new Date(log.timestamp).getTime();
      return logTime > minTimestamp;
    });

    if (newLogs.length === 0) {
      console.log('No new call logs to sync');
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
      return { synced: 0, matched: 0 };
    }

    // Sync with backend
    const result = await apiSyncCallLogs(logsToSync);
    
    // Update last sync time
    await AsyncStorage.setItem('last_call_log_sync', new Date().toISOString());
    
    console.log(`Synced ${logsToSync.length} call logs, ${result.matched || 0} matched to leads`);
    return { synced: logsToSync.length, matched: result.matched || 0 };
  } catch (error) {
    console.error('Error syncing call logs:', error);
    return { synced: 0, matched: 0, error: error.message };
  }
};

// Normalize phone number for comparison
export const normalizePhoneNumber = (phone) => {
  if (!phone) return '';
  // Remove all non-digit characters and country code
  let normalized = phone.replace(/\D/g, '');
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
  const url = `tel:${phoneNumber}`;
  
  try {
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      await Linking.openURL(url);
      return true;
    } else {
      console.log('Cannot open phone app');
      return false;
    }
  } catch (error) {
    console.error('Error making phone call:', error);
    return false;
  }
};

// Get call log for a specific number after a specific time
export const getCallLogForNumber = async (phoneNumber, afterTimestamp) => {
  const normalizedTarget = normalizePhoneNumber(phoneNumber);
  const callLogs = await getCallLogs(1); // Last 24 hours
  
  const matchingLogs = callLogs.filter(log => {
    const normalizedLogNumber = normalizePhoneNumber(log.phone_number);
    const logTime = new Date(log.timestamp).getTime();
    return normalizedLogNumber === normalizedTarget && logTime > afterTimestamp;
  });

  // Return the most recent matching call
  if (matchingLogs.length > 0) {
    return matchingLogs.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )[0];
  }
  
  return null;
};
