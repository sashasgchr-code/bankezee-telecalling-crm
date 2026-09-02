import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import useAuthStore from "./store/authStore";
import Login from "./pages/Login";
import Register from "./pages/Register";
import AdminDashboard from "./pages/admin/Dashboard";
import AdminLeads from "./pages/admin/Leads";
import AdminUsers from "./pages/admin/Users";
import AdminReports from "./pages/admin/Reports";
import AdminSettings from "./pages/admin/Settings";
import AdminAttendance from "./pages/admin/Attendance";
import DailyTrackingSheet from "./pages/admin/DailyTrackingSheet";
import LeaveManagement from "./pages/admin/LeaveManagement";
import TelecallerDashboard from "./pages/telecaller/Dashboard";
import TelecallerLeads from "./pages/telecaller/Leads";
import TelecallerFollowUps from "./pages/telecaller/FollowUps";
import TelecallerProfile from "./pages/telecaller/Profile";
import TelecallerAttendance from "./pages/telecaller/Attendance";
import LeadDetail from "./pages/LeadDetail";
import { FilesDashboard, FileDetailsPage } from "./pages/files";
import DataMigration from "./pages/files/DataMigration";
import PolicyMaster from "./pages/files/PolicyMaster";
import { RejectedCasesReport, GrowthPartnerReport, QualityReport, SalesOpsReport } from "./pages/files/reports";
import AdminLayout from "./layouts/AdminLayout";
import TelecallerLayout from "./layouts/TelecallerLayout";
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

  // If requiredRole is 'telecaller' or 'gp', allow all GP roles, ops, and manager
  if (requiredRole === 'telecaller' && !CRM_ACCESS_ROLES.includes(userRole)) {
    return <Navigate to={userRole === 'admin' ? '/admin' : '/agent'} replace />;
  }
  
  // For admin role, strict check
  if (requiredRole === 'admin' && userRole !== 'admin') {
    // Ops and Manager can access admin routes for CRM operations
    if (userRole === 'ops' || userRole === 'manager') {
      return children; // Allow ops/manager to access admin CRM routes
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

  return (
    <BrowserRouter>
      <Routes>
        {/* Public Routes */}
        <Route path="/login" element={
          isAuthenticated ? (
            <Navigate to={user?.role === 'admin' ? '/admin' : '/agent'} replace />
          ) : (
            <Login />
          )
        } />
        <Route path="/register" element={
          isAuthenticated ? (
            <Navigate to={user?.role === 'admin' ? '/admin' : '/agent'} replace />
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
          <Route path="files/migrate" element={<DataMigration />} />
          <Route path="files/policies" element={<PolicyMaster />} />
          <Route path="files/reports/rejected" element={<RejectedCasesReport />} />
          <Route path="files/reports/growth-partner" element={<GrowthPartnerReport />} />
          <Route path="files/reports/quality" element={<QualityReport />} />
          <Route path="files/reports/sales-ops" element={<SalesOpsReport />} />
          <Route path="users" element={<AdminUsers />} />
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
          <Route path="files/policies" element={<PolicyMaster />} />
          <Route path="followups" element={<TelecallerFollowUps />} />
          <Route path="attendance" element={<TelecallerAttendance />} />
          <Route path="leave" element={<LeaveManagement />} />
          <Route path="profile" element={<TelecallerProfile />} />
        </Route>

        {/* Role-neutral File route - redirects to correct role-based route */}
        <Route path="/files/:fileId" element={
          <ProtectedRoute>
            <RoleNeutralFileRedirect />
          </ProtectedRoute>
        } />

        {/* Default redirect */}
        <Route path="*" element={
          <Navigate to={isAuthenticated ? (user?.role === 'admin' ? '/admin' : '/agent') : '/login'} replace />
        } />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
