import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { Phone, Calendar, User, LayoutDashboard, X, PhoneOff, Coffee, LogOut, FileText, CalendarDays, MoreHorizontal, Clock, Users, Database, PhoneCall, BarChart3 } from 'lucide-react';
import useAuthStore from '../store/authStore';
import api from '../services/api';
import CallModal from '../components/CallModal';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '../components/ui/sheet';

const TelecallerLayout = () => {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  
  // Active call state
  const [activeCall, setActiveCall] = useState(null);
  const [callDuration, setCallDuration] = useState(0);
  const [showCallModal, setShowCallModal] = useState(false);
  const [currentLead, setCurrentLead] = useState(null);
  
  // Break state
  const [onBreak, setOnBreak] = useState(false);
  const [sessionInfo, setSessionInfo] = useState(null);
  
  // Refs
  const callTimerRef = useRef(null);
  const wasInCallRef = useRef(false);
  const activityTimerRef = useRef(null);

  // Fetch session info
  const fetchSessionInfo = useCallback(async () => {
    try {
      const response = await api.get('/activity/my-session');
      setSessionInfo(response.data);
      setOnBreak(response.data.on_break || false);
    } catch (error) {
      console.log('Failed to fetch session info');
    }
  }, []);

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
    fetchSessionInfo();
    activityTimerRef.current = setInterval(sendActivityPing, 120000);

    return () => {
      if (activityTimerRef.current) {
        clearInterval(activityTimerRef.current);
      }
    };
  }, [fetchSessionInfo]);

  // Handle break toggle
  const handleBreakToggle = async () => {
    try {
      const action = onBreak ? 'end' : 'start';
      await api.post('/activity/break', { action });
      setOnBreak(!onBreak);
      fetchSessionInfo();
    } catch (error) {
      console.error('Failed to toggle break:', error);
    }
  };

  // Handle logout
  const handleLogout = async () => {
    try {
      await api.post('/auth/logout');
    } catch (error) {
      console.log('Logout API call failed');
    }
    logout();
    navigate('/login');
  };

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

  // Primary nav items - 5 items max for mobile: Dashboard, Data, Files, Follow-ups, More
  const primaryNavItems = [
    { path: '/agent', icon: Phone, label: 'Data', exact: true },
    { path: '/agent/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/agent/files', icon: FileText, label: 'Files' },
    { path: '/agent/followups', icon: Calendar, label: 'Follow-ups' },
  ];
  
  // More menu items - overflow
  const moreNavItems = [
    { path: '/agent/reports', icon: BarChart3, label: 'Reports' },
    { path: '/agent/attendance', icon: Clock, label: 'Attendance' },
    { path: '/agent/leave', icon: CalendarDays, label: 'Leave' },
    { path: '/agent/profile', icon: User, label: 'Profile' },
  ];

  // Team menu items - only visible for Team Leads (is_tl = true)
  const teamNavItems = user?.is_tl ? [
    { path: '/agent/team', icon: Users, label: 'My Team' },
    { path: '/agent/team/data', icon: Database, label: 'Team Data' },
    { path: '/agent/team/files', icon: FileText, label: 'Team Files' },
    { path: '/agent/team/calls', icon: PhoneCall, label: 'Team Calls' },
  ] : [];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-green-600">BANKEZEE</h1>
            <p className="text-xs text-gray-500 -mt-1">Connect</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Break Button */}
            <button
              onClick={handleBreakToggle}
              disabled={activeCall}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                onBreak
                  ? 'bg-orange-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              } ${activeCall ? 'opacity-50 cursor-not-allowed' : ''}`}
              data-testid="break-btn"
            >
              <Coffee size={14} />
              {onBreak ? 'End Break' : 'Break'}
            </button>
            
            {/* Logout Button */}
            <button
              onClick={handleLogout}
              className="p-2 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
              data-testid="logout-btn"
            >
              <LogOut size={16} />
            </button>
            
            <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">
                {user?.name?.charAt(0).toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        {/* Break Banner */}
        {onBreak && (
          <div className="bg-orange-500 px-4 py-2 flex items-center justify-center gap-2">
            <Coffee size={16} className="text-white" />
            <span className="text-white text-sm font-medium">You are on break</span>
            <button
              onClick={handleBreakToggle}
              className="ml-2 px-3 py-1 bg-white/20 hover:bg-white/30 rounded-full text-white text-xs font-medium"
            >
              End Break
            </button>
          </div>
        )}

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

      {/* Bottom Navigation - 5 items: Data, Dashboard, Files, Follow-ups, More */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 safe-area-bottom z-40">
        <div className="flex items-center justify-around py-2">
          {primaryNavItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.exact}
              className={({ isActive }) =>
                `flex flex-col items-center py-1 px-2 rounded-lg transition-colors ${
                  isActive
                    ? 'text-green-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`
              }
              data-testid={`nav-${item.label.toLowerCase().replace('-', '')}`}
            >
              <item.icon size={22} />
              <span className="text-xs mt-0.5 font-medium">{item.label}</span>
            </NavLink>
          ))}
          
          {/* More Menu Drawer */}
          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetTrigger asChild>
              <button
                className={`flex flex-col items-center py-1 px-2 rounded-lg transition-colors ${
                  moreOpen ? 'text-green-600' : 'text-gray-500 hover:text-gray-700'
                }`}
                data-testid="nav-more"
              >
                <MoreHorizontal size={22} />
                <span className="text-xs mt-0.5 font-medium">More</span>
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="h-auto max-h-[70vh] rounded-t-2xl">
              <SheetHeader className="pb-4">
                <SheetTitle className="text-left">More Options</SheetTitle>
              </SheetHeader>
              <div className="grid grid-cols-3 gap-4 pb-6">
                {moreNavItems.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onClick={() => setMoreOpen(false)}
                    className={({ isActive }) =>
                      `flex flex-col items-center py-3 px-2 rounded-xl transition-colors ${
                        isActive
                          ? 'bg-green-50 text-green-600'
                          : 'text-gray-600 hover:bg-gray-50'
                      }`
                    }
                    data-testid={`more-${item.label.toLowerCase()}`}
                  >
                    <item.icon size={24} />
                    <span className="text-xs mt-1.5 font-medium">{item.label}</span>
                  </NavLink>
                ))}
              </div>

              {/* Team Section - Only visible for Team Leads */}
              {teamNavItems.length > 0 && (
                <>
                  <div className="border-t border-gray-200 pt-4 pb-2">
                    <h3 className="text-sm font-semibold text-gray-500 px-2 mb-3 flex items-center gap-2">
                      <Users size={16} />
                      Team Lead View
                    </h3>
                    <div className="grid grid-cols-4 gap-2">
                      {teamNavItems.map((item) => (
                        <NavLink
                          key={item.path}
                          to={item.path}
                          onClick={() => setMoreOpen(false)}
                          className={({ isActive }) =>
                            `flex flex-col items-center py-2.5 px-1 rounded-xl transition-colors ${
                              isActive
                                ? 'bg-blue-50 text-blue-600'
                                : 'text-gray-600 hover:bg-gray-50'
                            }`
                          }
                          data-testid={`team-nav-${item.label.toLowerCase().replace(' ', '-')}`}
                        >
                          <item.icon size={20} />
                          <span className="text-[10px] mt-1 font-medium text-center leading-tight">{item.label}</span>
                        </NavLink>
                      ))}
                    </div>
                  </div>
                </>
              )}
              
              {/* Break & Logout in More menu */}
              <div className="border-t border-gray-200 pt-4 space-y-2">
                <button
                  onClick={() => { setMoreOpen(false); handleBreakToggle(); }}
                  disabled={activeCall}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${
                    onBreak
                      ? 'bg-orange-100 text-orange-700'
                      : 'text-gray-600 hover:bg-gray-50'
                  } ${activeCall ? 'opacity-50 cursor-not-allowed' : ''}`}
                  data-testid="more-break"
                >
                  <Coffee size={20} />
                  <span className="font-medium">{onBreak ? 'End Break' : 'Take a Break'}</span>
                </button>
                <button
                  onClick={() => { setMoreOpen(false); handleLogout(); }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-red-600 hover:bg-red-50 rounded-xl transition-colors"
                  data-testid="more-logout"
                >
                  <LogOut size={20} />
                  <span className="font-medium">Logout</span>
                </button>
              </div>
            </SheetContent>
          </Sheet>
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
