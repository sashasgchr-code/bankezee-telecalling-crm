import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import useAuthStore from "./store/authStore";
import Login from "./pages/Login";
import Register from "./pages/Register";
import AdminDashboard from "./pages/admin/Dashboard";
import AdminLeads from "./pages/admin/Leads";
import AdminUsers from "./pages/admin/Users";
import AdminApprovals from "./pages/admin/Approvals";
import AdminReports from "./pages/admin/Reports";
import AdminSettings from "./pages/admin/Settings";
import AdminAttendance from "./pages/admin/Attendance";
import DailyTrackingSheet from "./pages/admin/DailyTrackingSheet";
import LeaveManagement from "./pages/admin/LeaveManagement";
import LegacyUserMapping from "./pages/admin/LegacyUserMapping";
import TelecallerDashboard from "./pages/telecaller/Dashboard";
import TelecallerLeads from "./pages/telecaller/Leads";
import TelecallerFollowUps from "./pages/telecaller/FollowUps";
import TelecallerProfile from "./pages/telecaller/Profile";
import TelecallerAttendance from "./pages/telecaller/Attendance";
import { TeamMembers, TeamData, TeamFiles, TeamCalls } from "./pages/telecaller/team";
import LeadDetail from "./pages/LeadDetail";
import { FilesDashboard, FileDetailsPage } from "./pages/files";
import BankEligibilityAnalysis from "./pages/files/BankEligibilityAnalysis";
import EligibilityCheck from "./pages/files/EligibilityCheck";
import DataMigration from "./pages/files/DataMigration";
import PolicyMaster from "./pages/files/PolicyMaster";
import BankPolicyMaster from "./pages/admin/BankPolicyMaster";
import { RejectedCasesReport, GrowthPartnerReport, QualityReport, SalesOpsReport } from "./pages/files/reports";
import AdminLayout from "./layouts/AdminLayout";
import TelecallerLayout from "./layouts/TelecallerLayout";
import ManagerLayout from "./layouts/ManagerLayout";
import ManagerDashboard from "./pages/manager/ManagerDashboard";
import ManagerTeam from "./pages/manager/ManagerTeam";
import LoadingScreen from "./components/LoadingScreen";
import "./App.css";

// Role-neutral File redirect component
const RoleNeutralFileRedirect = () => {
  const { user } = useAuthStore();
  const baseRoute = user?.role === 'admin' ? '/admin' : '/agent';
  // Get the file ID from URL
  const fileId = window.location.pathname.split('/files/')[1];
  return <Navigate to={`${baseRoute}/files/${fileId}`} replace />;
};

// Growth Partner roles (includes legacy role names)
const GP_ROLES = ['growth_partner', 'telecaller', 'sales_agent', 'team_leader', 'partner'];

// Roles with CRM operational access
const CRM_ACCESS_ROLES = ['admin', 'ops', 'manager', ...GP_ROLES];

// HR role - limited to attendance/leave
const HR_ROLE = 'hr';

const ProtectedRoute = ({ children, requiredRole }) => {
  const { isAuthenticated, user, isLoading } = useAuthStore();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const userRole = user?.role;
  
  // HR users go to a limited view
  if (userRole === HR_ROLE) {
    // HR can only access attendance/leave routes
    return <Navigate to="/agent/attendance" replace />;
  }

  // Manager role gets its own route set
  if (requiredRole === 'manager' && userRole !== 'manager' && userRole !== 'admin') {
    return <Navigate to={userRole === 'admin' ? '/admin' : '/agent'} replace />;
  }

  // If requiredRole is 'telecaller' or 'gp', allow all GP roles, ops, and manager
  if (requiredRole === 'telecaller' && !CRM_ACCESS_ROLES.includes(userRole)) {
    return <Navigate to={userRole === 'admin' ? '/admin' : (userRole === 'manager' ? '/manager' : '/agent')} replace />;
  }
  
  // For admin role, strict check
  if (requiredRole === 'admin' && userRole !== 'admin') {
    // Ops can access admin routes for CRM operations
    if (userRole === 'ops') {
      return children; // Allow ops to access admin CRM routes
    }
    // Managers now have their own dedicated routes
    if (userRole === 'manager') {
      return <Navigate to="/manager" replace />;
    }
    return <Navigate to="/agent" replace />;
  }

  return children;
};

function App() {
  const { loadAuth, isLoading, isAuthenticated, user } = useAuthStore();

  useEffect(() => {
    loadAuth();
  }, []);

  if (isLoading) {
    return <LoadingScreen />;
  }

  // Determine the correct base route based on user role
  const getBaseRoute = () => {
    if (!user) return '/login';
    if (user.role === 'admin') return '/admin';
    if (user.role === 'manager') return '/manager';
    return '/agent';
  };

  return (
    <BrowserRouter>
      <Routes>
        {/* Public Routes */}
        <Route path="/login" element={
          isAuthenticated ? (
            <Navigate to={getBaseRoute()} replace />
          ) : (
            <Login />
          )
        } />
        <Route path="/register" element={
          isAuthenticated ? (
            <Navigate to={getBaseRoute()} replace />
          ) : (
            <Register />
          )
        } />

        {/* Admin Routes */}
        <Route path="/admin" element={
          <ProtectedRoute requiredRole="admin">
            <AdminLayout />
          </ProtectedRoute>
        }>
          <Route index element={<AdminDashboard />} />
          <Route path="leads" element={<AdminLeads />} />
          <Route path="leads/:id" element={<LeadDetail />} />
          <Route path="files" element={<FilesDashboard />} />
          <Route path="files/:fileId" element={<FileDetailsPage />} />
          <Route path="files/:fileId/eligibility" element={<BankEligibilityAnalysis />} />
          <Route path="files/:fileId/check-eligibility" element={<EligibilityCheck />} />
          <Route path="files/migrate" element={<DataMigration />} />
          <Route path="files/policies" element={<PolicyMaster />} />
          <Route path="files/bank-policies" element={<BankPolicyMaster />} />
          <Route path="files/reports/rejected" element={<RejectedCasesReport />} />
          <Route path="files/reports/growth-partner" element={<GrowthPartnerReport />} />
          <Route path="files/reports/quality" element={<QualityReport />} />
          <Route path="files/reports/sales-ops" element={<SalesOpsReport />} />
          <Route path="approvals" element={<AdminApprovals />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="users/legacy-mapping" element={<LegacyUserMapping />} />
          <Route path="reports" element={<AdminReports />} />
          <Route path="tracking" element={<DailyTrackingSheet />} />
          <Route path="attendance" element={<AdminAttendance />} />
          <Route path="leave" element={<LeaveManagement />} />
          <Route path="settings" element={<AdminSettings />} />
        </Route>

        {/* Telecaller/Agent Routes */}
        <Route path="/agent" element={
          <ProtectedRoute requiredRole="telecaller">
            <TelecallerLayout />
          </ProtectedRoute>
        }>
          <Route index element={<TelecallerLeads />} />
          <Route path="dashboard" element={<TelecallerDashboard />} />
          <Route path="leads" element={<TelecallerLeads />} />
          <Route path="leads/:id" element={<LeadDetail />} />
          <Route path="files" element={<FilesDashboard />} />
          <Route path="files/:fileId" element={<FileDetailsPage />} />
          <Route path="files/:fileId/eligibility" element={<BankEligibilityAnalysis />} />
          <Route path="files/:fileId/check-eligibility" element={<EligibilityCheck />} />
          <Route path="files/policies" element={<PolicyMaster />} />
          <Route path="followups" element={<TelecallerFollowUps />} />
          <Route path="attendance" element={<TelecallerAttendance />} />
          <Route path="leave" element={<LeaveManagement />} />
          <Route path="profile" element={<TelecallerProfile />} />
          <Route path="team" element={<TeamMembers />} />
          <Route path="team/data" element={<TeamData />} />
          <Route path="team/files" element={<TeamFiles />} />
          <Route path="team/calls" element={<TeamCalls />} />
          <Route path="reports" element={<AdminReports />} />
        </Route>

        {/* Manager Routes - Admin-like access without User Management */}
        <Route path="/manager" element={
          <ProtectedRoute requiredRole="manager">
            <ManagerLayout />
          </ProtectedRoute>
        }>
          <Route index element={<ManagerDashboard />} />
          <Route path="files" element={<FilesDashboard />} />
          <Route path="files/:fileId" element={<FileDetailsPage />} />
          <Route path="files/:fileId/eligibility" element={<BankEligibilityAnalysis />} />
          <Route path="files/:fileId/check-eligibility" element={<EligibilityCheck />} />
          <Route path="files/policies" element={<PolicyMaster />} />
          <Route path="files/bank-policies" element={<BankPolicyMaster />} />
          <Route path="files/reports/rejected" element={<RejectedCasesReport />} />
          <Route path="files/reports/growth-partner" element={<GrowthPartnerReport />} />
          <Route path="files/reports/quality" element={<QualityReport />} />
          <Route path="files/reports/sales-ops" element={<SalesOpsReport />} />
          <Route path="reports" element={<AdminReports />} />
          <Route path="tracking" element={<DailyTrackingSheet />} />
          <Route path="attendance" element={<AdminAttendance />} />
          <Route path="leave" element={<LeaveManagement />} />
          <Route path="team" element={<ManagerTeam />} />
          <Route path="team/calls" element={<TeamCalls />} />
        </Route>

        {/* Role-neutral File route - redirects to correct role-based route */}
        <Route path="/files/:fileId" element={
          <ProtectedRoute>
            <RoleNeutralFileRedirect />
          </ProtectedRoute>
        } />

        {/* Default redirect */}
        <Route path="*" element={
          <Navigate to={isAuthenticated ? getBaseRoute() : '/login'} replace />
        } />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
