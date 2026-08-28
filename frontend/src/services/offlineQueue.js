/**
 * Offline Queue Service
 * Handles call log queueing when offline and auto-sync when connection returns
 */
import api from './api';

const QUEUE_KEY = 'offline_call_queue';
const SYNC_INTERVAL = 30000; // Check every 30 seconds

// In-memory state
let syncInterval = null;
let isSyncing = false;
let syncListeners = [];

/**
 * Check if browser is online
 */
export const isOnline = () => {
  return navigator.onLine;
};

/**
 * Get queued items from localStorage
 */
export const getQueuedItems = () => {
  try {
    const items = localStorage.getItem(QUEUE_KEY);
    return items ? JSON.parse(items) : [];
  } catch (error) {
    console.error('Error reading offline queue:', error);
    return [];
  }
};

/**
 * Save queue to localStorage
 */
const saveQueue = (items) => {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  } catch (error) {
    console.error('Error saving offline queue:', error);
  }
};

/**
 * Get count of pending items
 */
export const getPendingCount = () => {
  return getQueuedItems().length;
};

/**
 * Queue a call log for later sync
 */
export const queueCallLog = async (callLogData, statusUpdateData, leadId) => {
  const queue = getQueuedItems();
  
  const queueItem = {
    id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    type: 'call_log',
    callLogData,
    statusUpdateData,
    leadId,
    queuedAt: new Date().toISOString(),
    retryCount: 0,
  };
  
  queue.push(queueItem);
  saveQueue(queue);
  
  console.log('📝 Queued call log for offline sync:', queueItem.id);
  notifyListeners();
  
  return queueItem;
};

/**
 * Queue a follow-up for later sync
 */
export const queueFollowUp = async (followUpData) => {
  const queue = getQueuedItems();
  
  const queueItem = {
    id: `followup_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    type: 'follow_up',
    followUpData,
    queuedAt: new Date().toISOString(),
    retryCount: 0,
  };
  
  queue.push(queueItem);
  saveQueue(queue);
  
  console.log('📝 Queued follow-up for offline sync:', queueItem.id);
  notifyListeners();
  
  return queueItem;
};

/**
 * Remove an item from the queue
 */
const removeFromQueue = (itemId) => {
  const queue = getQueuedItems();
  const filtered = queue.filter(item => item.id !== itemId);
  saveQueue(filtered);
};

/**
 * Process a single queue item
 */
const processQueueItem = async (item) => {
  try {
    switch (item.type) {
      case 'call_log':
        // Log the call
        await api.post('/call-logs', item.callLogData);
        
        // Update lead status if needed
        if (item.statusUpdateData && item.leadId) {
          await api.put(`/leads/${item.leadId}`, item.statusUpdateData);
        }
        break;
        
      case 'follow_up':
        await api.post('/follow-ups', item.followUpData);
        break;
        
      default:
        console.warn('Unknown queue item type:', item.type);
    }
    
    return true;
  } catch (error) {
    console.error(`Failed to process queue item ${item.id}:`, error);
    
    // If it's a client error (4xx), don't retry
    if (error.response && error.response.status >= 400 && error.response.status < 500) {
      console.log('Client error, removing item from queue');
      return true; // Return true to remove from queue
    }
    
    return false;
  }
};

/**
 * Sync all queued items
 */
export const syncQueue = async () => {
  if (isSyncing || !isOnline()) {
    return { synced: 0, failed: 0, pending: getPendingCount() };
  }
  
  isSyncing = true;
  const queue = getQueuedItems();
  
  if (queue.length === 0) {
    isSyncing = false;
    return { synced: 0, failed: 0, pending: 0 };
  }
  
  console.log(`🔄 Syncing ${queue.length} queued items...`);
  
  let synced = 0;
  let failed = 0;
  
  for (const item of queue) {
    const success = await processQueueItem(item);
    
    if (success) {
      removeFromQueue(item.id);
      synced++;
      console.log(`✅ Synced: ${item.id}`);
    } else {
      // Increment retry count
      item.retryCount = (item.retryCount || 0) + 1;
      
      // Remove if too many retries
      if (item.retryCount >= 5) {
        removeFromQueue(item.id);
        failed++;
        console.log(`❌ Failed after 5 retries: ${item.id}`);
      } else {
        // Update retry count in queue
        const currentQueue = getQueuedItems();
        const updatedQueue = currentQueue.map(q => 
          q.id === item.id ? { ...q, retryCount: item.retryCount } : q
        );
        saveQueue(updatedQueue);
        failed++;
      }
    }
  }
  
  isSyncing = false;
  notifyListeners();
  
  const result = { synced, failed, pending: getPendingCount() };
  console.log('📊 Sync result:', result);
  
  return result;
};

/**
 * Add a listener for queue changes
 */
export const addSyncListener = (callback) => {
  syncListeners.push(callback);
  return () => {
    syncListeners = syncListeners.filter(l => l !== callback);
  };
};

/**
 * Notify all listeners of queue changes
 */
const notifyListeners = () => {
  const count = getPendingCount();
  syncListeners.forEach(listener => {
    try {
      listener(count);
    } catch (error) {
      console.error('Error in sync listener:', error);
    }
  });
};

/**
 * Start auto-sync when online
 */
export const startAutoSync = () => {
  if (syncInterval) return;
  
  // Initial sync when starting
  if (isOnline() && getPendingCount() > 0) {
    syncQueue();
  }
  
  // Set up interval
  syncInterval = setInterval(() => {
    if (isOnline() && getPendingCount() > 0) {
      syncQueue();
    }
  }, SYNC_INTERVAL);
  
  // Listen for online event
  window.addEventListener('online', handleOnline);
  
  console.log('🚀 Offline queue auto-sync started');
};

/**
 * Stop auto-sync
 */
export const stopAutoSync = () => {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
  window.removeEventListener('online', handleOnline);
  console.log('🛑 Offline queue auto-sync stopped');
};

/**
 * Handle coming online
 */
const handleOnline = () => {
  console.log('📶 Back online, syncing queue...');
  syncQueue();
};

/**
 * Clear all queued items (for debugging/testing)
 */
export const clearQueue = () => {
  saveQueue([]);
  notifyListeners();
  console.log('🗑️ Queue cleared');
};

// Auto-start sync when module loads
if (typeof window !== 'undefined') {
  startAutoSync();
}
