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
import LeadDetail from "./pages/LeadDetail";
import { FilesDashboard, FileDetailsPage } from "./pages/files";
import DataMigration from "./pages/files/DataMigration";
import PolicyMaster from "./pages/files/PolicyMaster";
import AdminLayout from "./layouts/AdminLayout";
import TelecallerLayout from "./layouts/TelecallerLayout";
import LoadingScreen from "./components/LoadingScreen";
import "./App.css";

const ProtectedRoute = ({ children, requiredRole }) => {
  const { isAuthenticated, user, isLoading } = useAuthStore();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (requiredRole && user?.role !== requiredRole) {
    return <Navigate to={user?.role === 'admin' ? '/admin' : '/agent'} replace />;
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
          <Route path="profile" element={<TelecallerProfile />} />
        </Route>

        {/* Default redirect */}
        <Route path="*" element={
          <Navigate to={isAuthenticated ? (user?.role === 'admin' ? '/admin' : '/agent') : '/login'} replace />
        } />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
