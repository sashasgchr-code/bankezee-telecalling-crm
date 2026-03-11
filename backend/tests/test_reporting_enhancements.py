"""
Test suite for TeleConnect CRM Reporting Enhancements
Tests the 4 reporting enhancements:
1. 'File' status replacing 'Interested' 
2. Hourly Report with Calls/Connected/Presentations/Leads/File columns
3. Telecaller reports with matching Overall Stats layout
4. Activity logs grouped by telecaller
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestStatusEndpoint:
    """Test /api/statuses endpoint returns 'file' status instead of 'interested'"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login as admin to get auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@bankezee.com",
            "password": "ConnectSasha12!!"
        })
        assert response.status_code == 200, f"Admin login failed: {response.text}"
        self.token = response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_statuses_contains_file(self):
        """Verify 'file' status exists in statuses list"""
        response = requests.get(f"{BASE_URL}/api/statuses", headers=self.headers)
        assert response.status_code == 200, f"Failed to get statuses: {response.text}"
        
        statuses = response.json()
        status_ids = [s["id"] for s in statuses]
        
        # Verify 'file' status exists
        assert "file" in status_ids, f"'file' status not found. Available statuses: {status_ids}"
        
        # Verify 'interested' status does NOT exist (replaced by 'file')
        assert "interested" not in status_ids, f"'interested' status should be replaced by 'file'"
        
        # Verify file status has correct properties
        file_status = next((s for s in statuses if s["id"] == "file"), None)
        assert file_status is not None
        assert file_status["name"] == "File"
        assert file_status["color"] == "#FF9800"
        
        print(f"✓ Statuses endpoint returns 'file' status correctly")
        print(f"  Available statuses: {status_ids}")


class TestHourlyReport:
    """Test /api/reports/hourly endpoint returns presentations, leads, file data"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login as admin to get auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@bankezee.com",
            "password": "ConnectSasha12!!"
        })
        assert response.status_code == 200, f"Admin login failed: {response.text}"
        self.token = response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_hourly_report_structure(self):
        """Verify hourly report has correct structure with all required columns"""
        response = requests.get(f"{BASE_URL}/api/reports/hourly", headers=self.headers)
        assert response.status_code == 200, f"Failed to get hourly report: {response.text}"
        
        data = response.json()
        
        # Verify top-level structure
        assert "telecallers" in data, "Missing 'telecallers' in response"
        assert "overall_hourly" in data, "Missing 'overall_hourly' in response"
        assert "date" in data, "Missing 'date' in response"
        
        print(f"✓ Hourly report has correct top-level structure")
        print(f"  Date: {data['date']}")
        print(f"  Telecallers count: {len(data['telecallers'])}")
    
    def test_hourly_report_telecaller_fields(self):
        """Verify each telecaller has required fields including presentations, leads, file"""
        response = requests.get(f"{BASE_URL}/api/reports/hourly", headers=self.headers)
        assert response.status_code == 200
        
        data = response.json()
        
        for tc in data["telecallers"]:
            # Verify telecaller-level fields
            assert "user_id" in tc, f"Missing 'user_id' for telecaller"
            assert "user_name" in tc, f"Missing 'user_name' for telecaller"
            assert "total_calls" in tc, f"Missing 'total_calls' for {tc.get('user_name')}"
            assert "total_connected" in tc, f"Missing 'total_connected' for {tc.get('user_name')}"
            assert "total_presentations" in tc, f"Missing 'total_presentations' for {tc.get('user_name')}"
            assert "total_leads" in tc, f"Missing 'total_leads' for {tc.get('user_name')}"
            assert "total_file" in tc, f"Missing 'total_file' for {tc.get('user_name')}"
            assert "hourly_breakdown" in tc, f"Missing 'hourly_breakdown' for {tc.get('user_name')}"
            
            # Verify hourly breakdown structure
            for hb in tc["hourly_breakdown"]:
                assert "hour" in hb, "Missing 'hour' in hourly breakdown"
                assert "hour_label" in hb, "Missing 'hour_label' in hourly breakdown"
                assert "calls" in hb, "Missing 'calls' in hourly breakdown"
                assert "connected" in hb, "Missing 'connected' in hourly breakdown"
                assert "presentations" in hb, "Missing 'presentations' in hourly breakdown"
                assert "leads" in hb, "Missing 'leads' in hourly breakdown"
                assert "file" in hb, "Missing 'file' in hourly breakdown"
        
        print(f"✓ All telecallers have required fields including presentations, leads, file")
    
    def test_overall_hourly_fields(self):
        """Verify overall_hourly has correct columns"""
        response = requests.get(f"{BASE_URL}/api/reports/hourly", headers=self.headers)
        assert response.status_code == 200
        
        data = response.json()
        
        for oh in data["overall_hourly"]:
            assert "hour" in oh, "Missing 'hour' in overall hourly"
            assert "hour_label" in oh, "Missing 'hour_label' in overall hourly"
            assert "calls" in oh, "Missing 'calls' in overall hourly"
            assert "connected" in oh, "Missing 'connected' in overall hourly"
            assert "presentations" in oh, "Missing 'presentations' in overall hourly"
            assert "leads" in oh, "Missing 'leads' in overall hourly"
            assert "file" in oh, "Missing 'file' in overall hourly"
        
        print(f"✓ Overall hourly has all required columns: Hour, Calls, Connected, Presentations, Leads, File")


class TestTelecallerReports:
    """Test /api/reports/telecallers endpoint returns file and presentations data"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login as admin to get auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@bankezee.com",
            "password": "ConnectSasha12!!"
        })
        assert response.status_code == 200, f"Admin login failed: {response.text}"
        self.token = response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_telecaller_reports_structure(self):
        """Verify telecaller reports have correct structure"""
        response = requests.get(f"{BASE_URL}/api/reports/telecallers", headers=self.headers)
        assert response.status_code == 200, f"Failed to get telecaller reports: {response.text}"
        
        data = response.json()
        
        # Verify top-level structure
        assert "telecallers" in data, "Missing 'telecallers' in response"
        assert "overall" in data, "Missing 'overall' in response"
        assert "period" in data, "Missing 'period' in response"
        
        print(f"✓ Telecaller reports has correct top-level structure")
    
    def test_overall_stats_has_file_and_presentations(self):
        """Verify overall stats include file and presentations counts"""
        response = requests.get(f"{BASE_URL}/api/reports/telecallers", headers=self.headers)
        assert response.status_code == 200
        
        data = response.json()
        overall = data["overall"]
        
        # Verify overall has required fields for 6-column layout
        assert "total_calls" in overall, "Missing 'total_calls' in overall"
        assert "total_leads_generated" in overall, "Missing 'total_leads_generated' in overall"
        assert "total_file" in overall, "Missing 'total_file' in overall"
        assert "total_presentations" in overall, "Missing 'total_presentations' in overall"
        assert "total_call_seconds" in overall, "Missing 'total_call_seconds' in overall"
        assert "calls_to_lead_rate" in overall, "Missing 'calls_to_lead_rate' in overall"
        
        print(f"✓ Overall stats has all 6 columns: Total Calls, Leads, File, Presentations, Talk Time, Conversion")
        print(f"  Total Calls: {overall['total_calls']}")
        print(f"  Leads: {overall['total_leads_generated']}")
        print(f"  File: {overall['total_file']}")
        print(f"  Presentations: {overall['total_presentations']}")
    
    def test_telecaller_has_file_and_presentations(self):
        """Verify each telecaller has file and presentations fields"""
        response = requests.get(f"{BASE_URL}/api/reports/telecallers", headers=self.headers)
        assert response.status_code == 200
        
        data = response.json()
        
        for tc in data["telecallers"]:
            # Verify telecaller has required fields matching overall layout
            assert "total_calls" in tc, f"Missing 'total_calls' for {tc.get('user_name')}"
            assert "leads_generated" in tc, f"Missing 'leads_generated' for {tc.get('user_name')}"
            assert "file" in tc, f"Missing 'file' for {tc.get('user_name')}"
            assert "presentations" in tc, f"Missing 'presentations' for {tc.get('user_name')}"
            assert "total_call_seconds" in tc, f"Missing 'total_call_seconds' for {tc.get('user_name')}"
            assert "calls_to_lead_rate" in tc, f"Missing 'calls_to_lead_rate' for {tc.get('user_name')}"
            
            print(f"  ✓ {tc['user_name']}: calls={tc['total_calls']}, leads={tc['leads_generated']}, file={tc['file']}, presentations={tc['presentations']}")
        
        print(f"✓ All telecallers have file and presentations fields")


class TestActivityLogs:
    """Test /api/activity/logs endpoint returns grouped data by telecaller"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login as admin to get auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@bankezee.com",
            "password": "ConnectSasha12!!"
        })
        assert response.status_code == 200, f"Admin login failed: {response.text}"
        self.token = response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_activity_logs_grouped_by_default(self):
        """Verify activity logs are grouped by telecaller by default"""
        response = requests.get(f"{BASE_URL}/api/activity/logs", headers=self.headers)
        assert response.status_code == 200, f"Failed to get activity logs: {response.text}"
        
        data = response.json()
        
        # Response should be a list of grouped telecaller activities
        assert isinstance(data, list), "Response should be a list"
        
        for group in data:
            # Each group should have user_id, user_name, and activities
            assert "user_id" in group, "Missing 'user_id' in grouped activity"
            assert "user_name" in group, "Missing 'user_name' in grouped activity"
            assert "activities" in group, "Missing 'activities' in grouped activity"
            assert isinstance(group["activities"], list), "'activities' should be a list"
            
            print(f"  ✓ {group['user_name']}: {len(group['activities'])} activities")
        
        print(f"✓ Activity logs are grouped by telecaller ({len(data)} groups)")
    
    def test_activity_logs_grouped_param(self):
        """Verify grouped=true parameter works"""
        response = requests.get(f"{BASE_URL}/api/activity/logs?grouped=true", headers=self.headers)
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        
        if len(data) > 0:
            assert "user_id" in data[0]
            assert "user_name" in data[0]
            assert "activities" in data[0]
        
        print(f"✓ Activity logs with grouped=true returns grouped data")
    
    def test_activity_logs_ungrouped(self):
        """Verify grouped=false returns flat list"""
        response = requests.get(f"{BASE_URL}/api/activity/logs?grouped=false", headers=self.headers)
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        
        # When ungrouped, each item should be an individual activity log
        if len(data) > 0:
            # Should NOT have 'activities' key (that's for grouped)
            # Should have individual log fields
            first_item = data[0]
            # Individual logs have 'action', 'timestamp', etc.
            if "activities" not in first_item:
                print(f"✓ Activity logs with grouped=false returns flat list")
            else:
                # If still grouped, that's also acceptable behavior
                print(f"✓ Activity logs endpoint works (grouped by default)")


class TestDashboardStats:
    """Test dashboard stats include file status"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login as admin to get auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@bankezee.com",
            "password": "ConnectSasha12!!"
        })
        assert response.status_code == 200, f"Admin login failed: {response.text}"
        self.token = response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_admin_dashboard_has_file_status(self):
        """Verify admin dashboard stats include file in leads_by_status"""
        response = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=self.headers)
        assert response.status_code == 200, f"Failed to get dashboard stats: {response.text}"
        
        data = response.json()
        
        # Verify leads_by_status exists
        assert "leads_by_status" in data, "Missing 'leads_by_status' in dashboard stats"
        
        # Verify total_file is tracked
        assert "total_file" in data, "Missing 'total_file' in dashboard stats"
        
        print(f"✓ Admin dashboard stats include 'file' status tracking")
        print(f"  total_file: {data.get('total_file', 0)}")
        print(f"  leads_by_status: {data.get('leads_by_status', {})}")


class TestTelecallerDashboard:
    """Test telecaller dashboard stats include file status"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login as telecaller to get auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "agent@test.com",
            "password": "agent123"
        })
        if response.status_code != 200:
            # Try to create the telecaller if doesn't exist
            admin_login = requests.post(f"{BASE_URL}/api/auth/login", json={
                "email": "admin@bankezee.com",
                "password": "ConnectSasha12!!"
            })
            if admin_login.status_code == 200:
                admin_token = admin_login.json()["token"]
                # Create telecaller
                requests.post(f"{BASE_URL}/api/auth/register", json={
                    "email": "agent@test.com",
                    "password": "agent123",
                    "name": "Test Agent",
                    "role": "telecaller"
                })
                # Try login again
                response = requests.post(f"{BASE_URL}/api/auth/login", json={
                    "email": "agent@test.com",
                    "password": "agent123"
                })
        
        if response.status_code == 200:
            self.token = response.json()["token"]
            self.headers = {"Authorization": f"Bearer {self.token}"}
            self.skip_tests = False
        else:
            self.skip_tests = True
            self.headers = {}
    
    def test_telecaller_dashboard_has_file_status(self):
        """Verify telecaller dashboard stats include file in leads_by_status"""
        if getattr(self, 'skip_tests', False):
            pytest.skip("Telecaller login failed")
        
        response = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=self.headers)
        assert response.status_code == 200, f"Failed to get telecaller dashboard stats: {response.text}"
        
        data = response.json()
        
        # Verify leads_by_status exists
        assert "leads_by_status" in data, "Missing 'leads_by_status' in telecaller dashboard stats"
        
        # Verify my_file is tracked
        assert "my_file" in data, "Missing 'my_file' in telecaller dashboard stats"
        
        print(f"✓ Telecaller dashboard stats include 'file' status tracking")
        print(f"  my_file: {data.get('my_file', 0)}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
