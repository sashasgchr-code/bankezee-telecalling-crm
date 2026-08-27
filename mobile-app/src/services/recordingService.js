import { PermissionsAndroid, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { uploadRecording as apiUploadRecording } from './api';

// We'll use a simple state machine to track recording status
let isRecording = false;
let currentRecordingPath = null;
let recordingStartTime = null;
let currentLeadInfo = null;

// Request microphone permission
export const requestAudioPermission = async () => {
  if (Platform.OS !== 'android') {
    return false;
  }

  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: 'Microphone Permission',
        message: 'BANKEZEE Connect needs access to your microphone to record calls for quality assurance.',
        buttonNeutral: 'Ask Me Later',
        buttonNegative: 'Cancel',
        buttonPositive: 'Allow',
      }
    );

    if (granted === PermissionsAndroid.RESULTS.GRANTED) {
      console.log('Microphone permission granted');
      return true;
    } else {
      console.log('Microphone permission denied');
      return false;
    }
  } catch (err) {
    console.error('Error requesting microphone permission:', err);
    return false;
  }
};

// Request write storage permission (for saving recordings)
export const requestStoragePermission = async () => {
  if (Platform.OS !== 'android') {
    return false;
  }

  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
      {
        title: 'Storage Permission',
        message: 'BANKEZEE Connect needs access to storage to save call recordings.',
        buttonNeutral: 'Ask Me Later',
        buttonNegative: 'Cancel',
        buttonPositive: 'Allow',
      }
    );

    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch (err) {
    console.error('Error requesting storage permission:', err);
    return false;
  }
};

// Request all recording permissions
export const requestRecordingPermissions = async () => {
  if (Platform.OS !== 'android') return { audio: false, storage: false };

  try {
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
      PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
    ]);

    return {
      audio: results[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED,
      storage: results[PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE] === PermissionsAndroid.RESULTS.GRANTED ||
               results[PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE] === PermissionsAndroid.RESULTS.GRANTED,
    };
  } catch (err) {
    console.error('Error requesting recording permissions:', err);
    return { audio: false, storage: false };
  }
};

// Check if audio permission is granted
export const hasAudioPermission = async () => {
  if (Platform.OS !== 'android') return false;
  
  const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  return granted;
};

// Get recording settings from storage
export const getRecordingEnabled = async () => {
  try {
    const enabled = await AsyncStorage.getItem('recording_enabled');
    return enabled === 'true';
  } catch (error) {
    console.error('Error getting recording setting:', error);
    return false;
  }
};

// Set recording enabled setting
export const setRecordingEnabled = async (enabled) => {
  try {
    await AsyncStorage.setItem('recording_enabled', enabled ? 'true' : 'false');
    return true;
  } catch (error) {
    console.error('Error setting recording setting:', error);
    return false;
  }
};

// Start recording for a call
// Note: This uses the device microphone to record. User should be on speakerphone for best results.
export const startCallRecording = async (leadInfo) => {
  if (isRecording) {
    console.log('Already recording');
    return false;
  }

  const hasPermission = await hasAudioPermission();
  if (!hasPermission) {
    console.log('No audio permission for recording');
    return false;
  }

  const recordingEnabled = await getRecordingEnabled();
  if (!recordingEnabled) {
    console.log('Recording is disabled by user');
    return false;
  }

  try {
    // Dynamic import to avoid issues if the library isn't installed
    let AudioRecorderPlayer;
    try {
      AudioRecorderPlayer = require('react-native-audio-recorder-player').default;
    } catch (moduleError) {
      console.warn('react-native-audio-recorder-player module not available:', moduleError.message);
      console.warn('Call recording requires a development build with native modules');
      return false;
    }
    
    const audioRecorderPlayer = new AudioRecorderPlayer();
    
    // Generate unique filename
    const timestamp = Date.now();
    const fileName = `call_${leadInfo.phone}_${timestamp}.mp3`;
    
    // Start recording
    const path = await audioRecorderPlayer.startRecorder(fileName);
    
    isRecording = true;
    currentRecordingPath = path;
    recordingStartTime = timestamp;
    currentLeadInfo = leadInfo;
    
    // Store recorder instance for later use
    global.audioRecorderPlayer = audioRecorderPlayer;
    
    console.log('Started recording:', path);
    return true;
  } catch (error) {
    console.error('Error starting recording:', error);
    isRecording = false;
    return false;
  }
};

// Stop recording and optionally upload
export const stopCallRecording = async (shouldUpload = true) => {
  if (!isRecording) {
    console.log('Not recording');
    return null;
  }

  try {
    const audioRecorderPlayer = global.audioRecorderPlayer;
    if (!audioRecorderPlayer) {
      console.error('No recorder instance found');
      isRecording = false;
      return null;
    }

    // Stop recording
    const result = await audioRecorderPlayer.stopRecorder();
    audioRecorderPlayer.removeRecordBackListener();
    
    const recordingInfo = {
      path: currentRecordingPath || result,
      startTime: recordingStartTime,
      endTime: Date.now(),
      duration: Date.now() - recordingStartTime,
      leadInfo: currentLeadInfo,
    };

    // Reset state
    isRecording = false;
    currentRecordingPath = null;
    recordingStartTime = null;
    const leadInfoCopy = { ...currentLeadInfo };
    currentLeadInfo = null;
    global.audioRecorderPlayer = null;

    console.log('Stopped recording:', recordingInfo);

    // Upload if requested
    if (shouldUpload && recordingInfo.path) {
      await uploadRecordingToServer(recordingInfo, leadInfoCopy);
    }

    return recordingInfo;
  } catch (error) {
    console.error('Error stopping recording:', error);
    isRecording = false;
    return null;
  }
};

// Upload recording to server
export const uploadRecordingToServer = async (recordingInfo, leadInfo) => {
  try {
    // Dynamic import RNFS
    let RNFS;
    try {
      RNFS = require('react-native-fs');
    } catch (moduleError) {
      console.warn('react-native-fs module not available:', moduleError.message);
      return null;
    }
    
    const fileExists = await RNFS.exists(recordingInfo.path);
    
    if (!fileExists) {
      console.error('Recording file not found:', recordingInfo.path);
      return null;
    }

    const fileData = await RNFS.readFile(recordingInfo.path, 'base64');
    const fileStat = await RNFS.stat(recordingInfo.path);

    const uploadData = {
      lead_id: leadInfo.id,
      lead_name: leadInfo.name,
      lead_phone: leadInfo.phone,
      recording_base64: fileData,
      duration_seconds: Math.round(recordingInfo.duration / 1000),
      recorded_at: new Date(recordingInfo.startTime).toISOString(),
      file_size_bytes: fileStat.size,
    };

    const result = await apiUploadRecording(uploadData);
    
    // Delete local file after successful upload
    await RNFS.unlink(recordingInfo.path);
    
    console.log('Recording uploaded successfully:', result);
    return result;
  } catch (error) {
    console.error('Error uploading recording:', error);
    // Store for later retry
    await queueRecordingForUpload(recordingInfo, leadInfo);
    return null;
  }
};

// Queue recording for later upload (if upload fails)
export const queueRecordingForUpload = async (recordingInfo, leadInfo) => {
  try {
    const pendingUploads = await AsyncStorage.getItem('pending_recording_uploads');
    const queue = pendingUploads ? JSON.parse(pendingUploads) : [];
    
    queue.push({
      recordingInfo,
      leadInfo,
      queuedAt: Date.now(),
    });

    await AsyncStorage.setItem('pending_recording_uploads', JSON.stringify(queue));
    console.log('Recording queued for later upload');
  } catch (error) {
    console.error('Error queuing recording:', error);
  }
};

// Process pending uploads
export const processPendingUploads = async () => {
  try {
    const pendingUploads = await AsyncStorage.getItem('pending_recording_uploads');
    if (!pendingUploads) return;

    const queue = JSON.parse(pendingUploads);
    if (queue.length === 0) return;

    const remainingQueue = [];

    for (const item of queue) {
      const result = await uploadRecordingToServer(item.recordingInfo, item.leadInfo);
      if (!result) {
        // Keep in queue if upload fails
        remainingQueue.push(item);
      }
    }

    await AsyncStorage.setItem('pending_recording_uploads', JSON.stringify(remainingQueue));
    console.log(`Processed ${queue.length - remainingQueue.length} pending uploads`);
  } catch (error) {
    console.error('Error processing pending uploads:', error);
  }
};

// Check if currently recording
export const isCurrentlyRecording = () => {
  return isRecording;
};

// Get current recording info
export const getCurrentRecordingInfo = () => {
  if (!isRecording) return null;
  
  return {
    isRecording: true,
    startTime: recordingStartTime,
    duration: Date.now() - recordingStartTime,
    leadInfo: currentLeadInfo,
  };
};
