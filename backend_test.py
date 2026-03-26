#!/usr/bin/env python3

import requests
import sys
import json
from datetime import datetime
import time

class CRMAPITester:
    def __init__(self, base_url="https://responsive-crm-app-1.preview.emergentagent.com"):
        self.base_url = base_url
        self.token = None
        self.admin_token = None
        self.telecaller_token = None
        self.tests_run = 0
        self.tests_passed = 0
        self.admin_user_id = None
        self.telecaller_user_id = None
        self.test_lead_id = None

    def log(self, message):
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {message}")

    def run_test(self, name, method, endpoint, expected_status, data=None, headers=None, use_admin=False):
        """Run a single API test"""
        url = f"{self.base_url}/api/{endpoint}"
        test_headers = {'Content-Type': 'application/json'}
        
        if headers:
            test_headers.update(headers)
            
        if use_admin and self.admin_token:
            test_headers['Authorization'] = f'Bearer {self.admin_token}'
        elif self.token:
            test_headers['Authorization'] = f'Bearer {self.token}'

        self.tests_run += 1
        self.log(f"🔍 Testing {name}...")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=test_headers, timeout=10)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=test_headers, timeout=10)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=test_headers, timeout=10)
            elif method == 'DELETE':
                response = requests.delete(url, headers=test_headers, timeout=10)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                self.log(f"✅ {name} - Status: {response.status_code}")
                try:
                    return True, response.json() if response.content else {}
                except:
                    return True, {}
            else:
                self.log(f"❌ {name} - Expected {expected_status}, got {response.status_code}")
                try:
                    error_detail = response.json()
                    self.log(f"   Error: {error_detail}")
                except:
                    self.log(f"   Response: {response.text[:200]}")
                return False, {}

        except Exception as e:
            self.log(f"❌ {name} - Error: {str(e)}")
            return False, {}

    def test_health_check(self):
        """Test API health check"""
        return self.run_test("Health Check", "GET", "health", 200)

    def test_admin_registration(self):
        """Test admin user registration"""
        admin_data = {
            "email": f"admin_{int(time.time())}@test.com",
            "password": "admin123",
            "name": "Test Admin",
            "role": "admin"
        }
        
        success, response = self.run_test("Admin Registration", "POST", "auth/register", 200, admin_data)
        if success and 'token' in response:
            self.admin_token = response['token']
            self.admin_user_id = response['user']['id']
            self.log(f"   Admin registered with ID: {self.admin_user_id}")
        return success

    def test_telecaller_registration(self):
        """Test telecaller user registration"""
        telecaller_data = {
            "email": f"telecaller_{int(time.time())}@test.com",
            "password": "telecaller123",
            "name": "Test Telecaller",
            "role": "telecaller"
        }
        
        success, response = self.run_test("Telecaller Registration", "POST", "auth/register", 200, telecaller_data)
        if success and 'token' in response:
            self.telecaller_token = response['token']
            self.telecaller_user_id = response['user']['id']
            self.token = self.telecaller_token  # Set default token
            self.log(f"   Telecaller registered with ID: {self.telecaller_user_id}")
        return success

    def test_admin_login(self):
        """Test admin login"""
        login_data = {
            "email": f"admin_{int(time.time()-1)}@test.com",
            "password": "admin123"
        }
        
        success, response = self.run_test("Admin Login", "POST", "auth/login", 200, login_data)
        if success and 'token' in response:
            self.admin_token = response['token']
        return success

    def test_get_current_user(self):
        """Test getting current user info"""
        return self.run_test("Get Current User", "GET", "auth/me", 200)

    def test_create_lead(self):
        """Test creating a new lead (admin only)"""
        lead_data = {
            "name": "Test Lead",
            "phone": "+919876543210",
            "email": "testlead@example.com",
            "city": "Mumbai",
            "source": "Website",
            "notes": "Test lead for API testing"
        }
        
        success, response = self.run_test("Create Lead", "POST", "leads", 200, lead_data, use_admin=True)
        if success and 'id' in response:
            self.test_lead_id = response['id']
            self.log(f"   Lead created with ID: {self.test_lead_id}")
        return success

    def test_list_leads(self):
        """Test listing leads"""
        return self.run_test("List Leads", "GET", "leads", 200)

    def test_get_lead_detail(self):
        """Test getting lead details"""
        if not self.test_lead_id:
            self.log("❌ Get Lead Detail - No test lead ID available")
            return False
        return self.run_test("Get Lead Detail", "GET", f"leads/{self.test_lead_id}", 200)

    def test_update_lead(self):
        """Test updating a lead"""
        if not self.test_lead_id:
            self.log("❌ Update Lead - No test lead ID available")
            return False
            
        update_data = {
            "status": "contacted",
            "notes": "Updated via API test"
        }
        return self.run_test("Update Lead", "PUT", f"leads/{self.test_lead_id}", 200, update_data)

    def test_assign_lead(self):
        """Test assigning leads to telecaller (admin only)"""
        if not self.test_lead_id or not self.telecaller_user_id:
            self.log("❌ Assign Lead - Missing lead ID or telecaller ID")
            return False
            
        assign_data = {
            "lead_ids": [self.test_lead_id],
            "user_id": self.telecaller_user_id
        }
        return self.run_test("Assign Lead", "POST", "leads/assign", 200, assign_data, use_admin=True)

    def test_list_users(self):
        """Test listing users (admin only)"""
        return self.run_test("List Users", "GET", "users", 200, use_admin=True)

    def test_list_telecallers(self):
        """Test listing telecallers"""
        return self.run_test("List Telecallers", "GET", "users/telecallers", 200)

    def test_dashboard_stats(self):
        """Test dashboard statistics"""
        return self.run_test("Dashboard Stats", "GET", "dashboard/stats", 200)

    def test_activity_ping(self):
        """Test activity ping"""
        return self.run_test("Activity Ping", "POST", "activity/ping", 200, {})

    def test_get_activity_stats(self):
        """Test getting activity stats"""
        return self.run_test("Get Activity Stats", "GET", "activity/my-stats", 200)

    def test_start_call_session(self):
        """Test starting a call session"""
        if not self.test_lead_id:
            self.log("❌ Start Call Session - No test lead ID available")
            return False
            
        call_data = {"lead_id": self.test_lead_id}
        return self.run_test("Start Call Session", "POST", "call-sessions/start", 200, call_data)

    def test_get_active_call_session(self):
        """Test getting active call session"""
        return self.run_test("Get Active Call Session", "GET", "call-sessions/active", 200)

    def test_cancel_call_session(self):
        """Test cancelling call session"""
        return self.run_test("Cancel Call Session", "POST", "call-sessions/cancel", 200, {})

    def test_get_statuses(self):
        """Test getting available statuses"""
        return self.run_test("Get Statuses", "GET", "statuses", 200)

    def test_create_follow_up(self):
        """Test creating a follow-up"""
        if not self.test_lead_id:
            self.log("❌ Create Follow-up - No test lead ID available")
            return False
            
        follow_up_data = {
            "lead_id": self.test_lead_id,
            "scheduled_at": "2025-01-20T10:00:00Z",
            "notes": "Follow up call scheduled"
        }
        return self.run_test("Create Follow-up", "POST", "follow-ups", 200, follow_up_data)

    def test_list_follow_ups(self):
        """Test listing follow-ups"""
        return self.run_test("List Follow-ups", "GET", "follow-ups", 200)

    def test_telecaller_reports(self):
        """Test telecaller reports (admin only)"""
        return self.run_test("Telecaller Reports", "GET", "reports/telecallers", 200, use_admin=True)

def main():
    print("🚀 Starting CRM API Testing...")
    print("=" * 60)
    
    tester = CRMAPITester()
    
    # Test sequence
    tests = [
        # Basic health and auth tests
        ("Health Check", tester.test_health_check),
        ("Admin Registration", tester.test_admin_registration),
        ("Telecaller Registration", tester.test_telecaller_registration),
        ("Get Current User", tester.test_get_current_user),
        
        # Lead management tests
        ("Create Lead", tester.test_create_lead),
        ("List Leads", tester.test_list_leads),
        ("Get Lead Detail", tester.test_get_lead_detail),
        ("Update Lead", tester.test_update_lead),
        ("Assign Lead", tester.test_assign_lead),
        
        # User management tests
        ("List Users", tester.test_list_users),
        ("List Telecallers", tester.test_list_telecallers),
        
        # Dashboard and activity tests
        ("Dashboard Stats", tester.test_dashboard_stats),
        ("Activity Ping", tester.test_activity_ping),
        ("Get Activity Stats", tester.test_get_activity_stats),
        
        # Call session tests
        ("Start Call Session", tester.test_start_call_session),
        ("Get Active Call Session", tester.test_get_active_call_session),
        ("Cancel Call Session", tester.test_cancel_call_session),
        
        # Other features
        ("Get Statuses", tester.test_get_statuses),
        ("Create Follow-up", tester.test_create_follow_up),
        ("List Follow-ups", tester.test_list_follow_ups),
        ("Telecaller Reports", tester.test_telecaller_reports),
    ]
    
    failed_tests = []
    
    for test_name, test_func in tests:
        try:
            success = test_func()
            if not success:
                failed_tests.append(test_name)
        except Exception as e:
            tester.log(f"❌ {test_name} - Exception: {str(e)}")
            failed_tests.append(test_name)
        
        # Small delay between tests
        time.sleep(0.5)
    
    # Print results
    print("\n" + "=" * 60)
    print("📊 TEST RESULTS")
    print("=" * 60)
    print(f"Total Tests: {tester.tests_run}")
    print(f"Passed: {tester.tests_passed}")
    print(f"Failed: {tester.tests_run - tester.tests_passed}")
    print(f"Success Rate: {(tester.tests_passed / tester.tests_run * 100):.1f}%")
    
    if failed_tests:
        print(f"\n❌ Failed Tests ({len(failed_tests)}):")
        for test in failed_tests:
            print(f"   • {test}")
    else:
        print("\n🎉 All tests passed!")
    
    return 0 if len(failed_tests) == 0 else 1

if __name__ == "__main__":
    sys.exit(main())