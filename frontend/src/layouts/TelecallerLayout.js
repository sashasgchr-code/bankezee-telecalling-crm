import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { Phone, Calendar, User, LayoutDashboard, X, PhoneOff } from 'lucide-react';
import useAuthStore from '../store/authStore';
import api from '../services/api';
import CallModal from '../components/CallModal';

const TelecallerLayout = () => {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  
  // Active call state
  const [activeCall, setActiveCall] = useState(null);
  const [callDuration, setCallDuration] = useState(0);
  const [showCallModal, setShowCallModal] = useState(false);
  const [currentLead, setCurrentLead] = useState(null);
  
  // Refs
  const callTimerRef = useRef(null);
  const wasInCallRef = useRef(false);
  const activityTimerRef = useRef(null);

  // Activity ping
  useEffect(() => {
    const sendActivityPing = async () => {
      try {
        await api.post('/activity/ping');
      } catch (error) {
        console.log('Activity ping failed');
      }
    };

    sendActivityPing();
    activityTimerRef.current = setInterval(sendActivityPing, 120000);

    return () => {
      if (activityTimerRef.current) {
        clearInterval(activityTimerRef.current);
      }
    };
  }, []);

  // Check for active call on load
  useEffect(() => {
    const checkActiveCall = async () => {
      try {
        const response = await api.get('/call-sessions/active');
        if (response.data) {
          setActiveCall(response.data);
          wasInCallRef.current = true;
        }
      } catch (error) {
        console.log('No active call');
      }
    };
    checkActiveCall();
  }, []);

  // Call timer
  useEffect(() => {
    if (activeCall) {
      const startTime = new Date(activeCall.start_time).getTime();
      
      callTimerRef.current = setInterval(() => {
        const now = Date.now();
        const duration = Math.floor((now - startTime) / 1000);
        setCallDuration(duration);
      }, 1000);
    } else {
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
        callTimerRef.current = null;
      }
      setCallDuration(0);
    }

    return () => {
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
      }
    };
  }, [activeCall]);

  // Visibility change detection for call return
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && wasInCallRef.current && activeCall) {
        // User returned to the page after making a call
        setTimeout(() => {
          setCurrentLead({
            id: activeCall.lead_id,
            name: activeCall.lead_name,
            phone: activeCall.lead_phone,
            status: 'new'
          });
          setShowCallModal(true);
        }, 500);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [activeCall]);

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleEndCall = () => {
    if (!activeCall) return;
    setCurrentLead({
      id: activeCall.lead_id,
      name: activeCall.lead_name,
      phone: activeCall.lead_phone,
      status: 'new'
    });
    setShowCallModal(true);
  };

  const handleCancelCall = async () => {
    if (window.confirm('Are you sure you want to cancel this call without logging it?')) {
      try {
        await api.post('/call-sessions/cancel');
        setActiveCall(null);
        wasInCallRef.current = false;
      } catch (error) {
        console.log('Error cancelling call');
        setActiveCall(null);
        wasInCallRef.current = false;
      }
    }
  };

  const handleCallEnded = () => {
    setActiveCall(null);
    wasInCallRef.current = false;
    setShowCallModal(false);
  };

  // Expose call functions to child routes
  const startCall = async (lead) => {
    if (activeCall) {
      alert('Please end the current call before starting a new one.');
      return;
    }

    try {
      const response = await api.post('/call-sessions/start', { lead_id: lead.id });
      setActiveCall(response.data);
      wasInCallRef.current = true;

      // Open phone dialer
      let phone = lead.phone.replace(/[^0-9+]/g, '');
      if (!phone.startsWith('+')) {
        phone = '+91' + phone;
      }
      window.location.href = `tel:${phone}`;
    } catch (error) {
      alert(error.response?.data?.detail || 'Failed to start call');
    }
  };

  const navItems = [
    { path: '/agent', icon: Phone, label: 'Data', exact: true },
    { path: '/agent/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/agent/followups', icon: Calendar, label: 'Follow-ups' },
    { path: '/agent/profile', icon: User, label: 'Profile' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-green-600">BANKEZEE</h1>
            <p className="text-xs text-gray-500 -mt-1">Connect</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium text-gray-900">{user?.name}</p>
              <p className="text-xs text-gray-500">Telecaller</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-green-600 flex items-center justify-center">
              <span className="text-white font-bold">
                {user?.name?.charAt(0).toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        {/* Active Call Banner */}
        {activeCall && (
          <div className="bg-red-500 px-4 py-3 flex items-center justify-between" data-testid="active-call-banner">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 bg-white rounded-full animate-pulse" />
              <div>
                <p className="text-xs text-white/80">Active Call</p>
                <p className="text-white font-semibold">{activeCall.lead_name}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-white font-bold text-lg font-mono">
                {formatDuration(callDuration)}
              </span>
              <button
                onClick={handleCancelCall}
                className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center hover:bg-white/30"
                data-testid="cancel-call-btn"
              >
                <X size={18} className="text-white" />
              </button>
              <button
                onClick={handleEndCall}
                className="flex items-center gap-2 bg-white/20 hover:bg-white/30 px-4 py-2 rounded-full"
                data-testid="end-call-btn"
              >
                <PhoneOff size={18} className="text-white" />
                <span className="text-white font-semibold">End</span>
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-auto pb-20">
        <Outlet context={{ startCall, activeCall }} />
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 safe-area-bottom z-40">
        <div className="flex items-center justify-around py-2">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.exact}
              className={({ isActive }) =>
                `flex flex-col items-center py-1 px-4 rounded-lg transition-colors ${
                  isActive
                    ? 'text-green-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`
              }
              data-testid={`nav-${item.label.toLowerCase()}`}
            >
              <item.icon size={22} />
              <span className="text-xs mt-0.5 font-medium">{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      {/* Call Modal */}
      <CallModal
        isOpen={showCallModal}
        onClose={() => setShowCallModal(false)}
        lead={currentLead}
        activeCall={activeCall}
        onCallEnded={handleCallEnded}
        callDuration={callDuration}
      />
    </div>
  );
};

export default TelecallerLayout;
