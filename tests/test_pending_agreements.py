import os
import tempfile
import unittest
from io import BytesIO
from unittest.mock import patch

from fastapi.testclient import TestClient


class PendingAgreementTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        db_path = os.path.join(cls.temp_dir.name, "test.db")
        data_path = os.path.join(cls.temp_dir.name, "data")
        os.environ["CONTRACT_DB"] = db_path
        os.environ["CONTRACT_DATA"] = data_path
        os.environ["AUTH_REQUIRED"] = "true"
        os.environ["ADMIN_EMAIL"] = "admin@local.com"
        os.environ["ADMIN_PASSWORD"] = "password"

        import importlib
        import app as app_module

        cls.app_module = importlib.reload(app_module)
        cls.app_module.init_db()
        cls.client = TestClient(cls.app_module.app)

    @classmethod
    def tearDownClass(cls):
        cls.temp_dir.cleanup()

    def setUp(self):
        self.client.cookies.clear()
        with self.app_module.db() as conn:
            conn.execute("DELETE FROM pending_agreement_files")
            conn.execute("DELETE FROM pending_agreement_notes")
            conn.execute("DELETE FROM pending_agreements")
            conn.execute("DELETE FROM auth_sessions")
            conn.execute("DELETE FROM auth_user_roles")
            conn.execute("DELETE FROM auth_users WHERE email NOT IN ('admin@local.com')")

    def _create_user(self, email, name, password="secret"):
        password_hash = self.app_module.hash_password(password)
        now = self.app_module.now_iso()
        with self.app_module.db() as conn:
            cur = conn.execute(
                """
                INSERT INTO auth_users
                  (name, email, password_hash, is_active, created_at, updated_at)
                VALUES (?, ?, ?, 1, ?, ?)
                """,
                (name, email, password_hash, now, now),
            )
            return cur.lastrowid

    def _login(self, client, email, password):
        res = client.post("/api/auth/login", json={"email": email, "password": password})
        self.assertEqual(res.status_code, 200)

    def test_intake_submission_creates_pending_record_without_file(self):
        self._create_user("requester@example.com", "Requester One", "secret")
        client = self.client
        self._login(client, "requester@example.com", "secret")

        with patch.object(self.app_module, "_send_email") as send_email:
            res = client.post(
                "/api/pending-agreements/intake",
                data={
                    "internal_company": "Acme LLC",
                    "team_member": "Requester One",
                    "requester_email": "requester@example.com",
                    "attorney_assigned": "legal@acme.com",
                    "matter": "Vendor NDA",
                    "status_notes": "Need review ASAP.",
                },
            )
            self.assertEqual(res.status_code, 200)
            payload = res.json()
            self.assertEqual(payload["status"], "Pending Legal Review")
            self.assertEqual(payload["matter"], "Vendor NDA")
            self.assertIsNone(payload.get("file"))
            self.assertGreaterEqual(send_email.call_count, 1)

        with self.app_module.db() as conn:
            row = conn.execute(
                "SELECT COUNT(1) AS count FROM pending_agreements"
            ).fetchone()
            self.assertEqual(row["count"], 1)

    def test_requester_can_only_see_own_submissions_and_admin_sees_all(self):
        self._create_user("user1@example.com", "User One", "secret")
        self._create_user("user2@example.com", "User Two", "secret")

        with patch.object(self.app_module, "_send_email"):
            client1 = self.client
            self._login(client1, "user1@example.com", "secret")
            client1.post(
                "/api/pending-agreements/intake",
                data={
                    "internal_company": "Entity A",
                    "team_member": "User One",
                    "requester_email": "user1@example.com",
                    "attorney_assigned": "",
                    "matter": "Lease Agreement",
                    "status_notes": "Initial draft.",
                },
            )

            client2 = TestClient(self.app_module.app)
            self._login(client2, "user2@example.com", "secret")
            client2.post(
                "/api/pending-agreements/intake",
                data={
                    "internal_company": "Entity B",
                    "team_member": "User Two",
                    "requester_email": "user2@example.com",
                    "attorney_assigned": "",
                    "matter": "Master Services Agreement",
                    "status_notes": "Please review.",
                },
            )

        res_user1 = client1.get("/api/pending-agreements")
        self.assertEqual(res_user1.status_code, 200)
        items = res_user1.json()["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["requester_email"], "user1@example.com")

        admin_client = TestClient(self.app_module.app)
        self._login(admin_client, "admin@local.com", "password")
        res_admin = admin_client.get("/api/pending-agreements")
        self.assertEqual(res_admin.status_code, 200)
        self.assertGreaterEqual(res_admin.json()["total"], 2)

    def test_file_upload_attaches_to_pending_record(self):
        self._create_user("uploader@example.com", "Uploader", "secret")
        client = self.client
        self._login(client, "uploader@example.com", "secret")

        with patch.object(self.app_module, "_send_email"):
            res = client.post(
                "/api/pending-agreements/intake",
                data={
                    "internal_company": "Entity C",
                    "team_member": "Uploader",
                    "requester_email": "uploader@example.com",
                    "attorney_assigned": "",
                    "matter": "Consulting Agreement",
                    "status_notes": "Draft attached.",
                },
            )
            agreement_id = res.json()["id"]

        file_content = BytesIO(b"draft file content")
        res_upload = client.post(
            f"/api/pending-agreements/{agreement_id}/files",
            data={"file_type": "draft"},
            files={"file": ("draft.txt", file_content, "text/plain")},
        )
        self.assertEqual(res_upload.status_code, 200)

        with self.app_module.db() as conn:
            row = conn.execute(
                "SELECT COUNT(1) AS count FROM pending_agreement_files WHERE pending_agreement_id = ?",
                (agreement_id,),
            ).fetchone()
            self.assertEqual(row["count"], 1)


if __name__ == "__main__":
    unittest.main()
