import json
import argparse
import contextlib
import io
import os
import tempfile
import unittest
import datetime as dt
from pathlib import Path
from unittest import mock

import agent


class AgentTests(unittest.TestCase):
    def test_qualify_filters_rocasis_target_decision_makers(self):
        prospects = [
            agent.Prospect(
                name="A",
                company="Retail Co Mexico",
                role="CIO",
                email="a@example.com.mx",
                industry="Retail",
                project="Rocasis",
                score="Alta",
            ),
            agent.Prospect(
                name="B",
                company="Other Co",
                role="Analyst",
                email="b@example.com",
                industry="Retail",
                project="Rocasis",
            ),
            agent.Prospect(
                name="C",
                company="Bank Co",
                role="CIO",
                email="c@example.com",
                industry="Financiero",
                project="Nemaris",
            ),
        ]
        qualified = agent.qualify(prospects)
        self.assertEqual([p.email for p in qualified], ["a@example.com.mx"])
        self.assertEqual(qualified[0].sectors, ["retail"])

    def test_qualify_dedupes_same_person_company_preferring_stronger_role(self):
        prospects = [
            agent.Prospect(
                name="Cesar Guzman",
                company="Liverpool",
                role="Head of Software Engineering",
                email="head@liverpool.com.mx",
                industry="Retail",
                project="Rocasis",
            ),
            agent.Prospect(
                name="César Guzmán",
                company="Liverpool",
                role="IT Digital Innovation Technology Director",
                email="director@liverpool.com.mx",
                industry="Retail",
                project="Rocasis",
            ),
        ]
        qualified = agent.qualify(prospects)
        self.assertEqual(len(qualified), 1)
        self.assertEqual(qualified[0].email, "director@liverpool.com.mx")

    def test_html_loader_and_cal_cta(self):
        data = [
            {
                "name": "Ana Lopez",
                "company": "Banco Demo",
                "role": "CIO",
                "email": "ana@example.com",
                "industry": "Financiero",
                "project": "Rocasis",
                "score": "Alta",
                "email_body": "Hola Ana,\n\nRevisemos integraciones.\n\nSaludos,\nMiguel",
            }
        ]
        html = "const DATA = " + json.dumps(data) + ";\nfunction esc(s){}"
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "source.html"
            path.write_text(html, encoding="utf-8")
            prospects = agent.load_html_dataset(path)
        body = agent.generate_body(prospects[0])
        self.assertIn(agent.CAL_LINK, body)
        self.assertIn("baja", body.lower())

    def test_next_followup_step(self):
        today = dt.date(2026, 6, 4)
        self.assertEqual(
            agent.next_followup_step(
                {"status": "sent", "sent_at": "2026-06-02T10:00:00+00:00"},
                today=today,
            ),
            "followup_1",
        )
        self.assertEqual(
            agent.next_followup_step(
                {
                    "status": "followup_1",
                    "followup_1_at": "2026-06-01T10:00:00+00:00",
                },
                today=today,
            ),
            "followup_2",
        )

    def test_attendee_emails(self):
        booking = {
            "attendees": [{"email": "Ana@Example.com", "name": "Ana"}],
            "guests": ["it@example.com"],
        }
        self.assertEqual(agent.attendee_emails(booking), {"ana@example.com", "it@example.com"})
        self.assertEqual(agent.attendee_names(booking), ["Ana"])

    def test_role_matching_excludes_non_technical_general_directors(self):
        self.assertFalse(
            agent.is_decision_maker(
                agent.Prospect("A", "Banco Demo", "Director General", "a@banco.com.mx")
            )
        )
        self.assertFalse(
            agent.is_decision_maker(
                agent.Prospect("B", "Banco Demo", "Project Manager & IT Business Analyst Coordinator", "b@banco.com.mx")
            )
        )
        self.assertTrue(
            agent.is_decision_maker(
                agent.Prospect("C", "Banco Demo", "Director de TI", "c@banco.com.mx")
            )
        )
        self.assertTrue(
            agent.is_decision_maker(
                agent.Prospect("D", "Liverpool", "Head of Software Engineering", "d@liverpool.com.mx")
            )
        )

    def test_idempotency_key_is_stable(self):
        first = agent.idempotency_key("initial", "ana@example.com", "Subject")
        second = agent.idempotency_key(" initial ", "ANA@example.com", "subject")
        self.assertEqual(first, second)
        self.assertTrue(first.startswith("rocasis-"))

    def test_resend_key_validation(self):
        self.assertTrue(agent.validate_resend_api_key("re_1234567890"))
        self.assertFalse(agent.validate_resend_api_key("not-a-resend-api-key"))

    def test_default_reply_to_is_marketing_inbox(self):
        self.assertEqual(agent.DEFAULT_REPLY_TO, "marketing.voxmedia@gmail.com")

    def test_mark_booking_confirmed_matches_attendee(self):
        prospect = agent.Prospect(
            "Ana Lopez",
            "Banco Demo",
            "CIO",
            "ana@banco.com.mx",
            industry="Financiero",
            sectors=["financiero"],
        )
        rows = []
        booking = {
            "uid": "booking_123",
            "start": "2026-06-05T15:00:00Z",
            "attendees": [{"email": "ana@banco.com.mx"}],
        }
        matched = agent.mark_booking_confirmed(rows, {prospect.key: prospect}, booking, "test")
        self.assertEqual(matched, 1)
        self.assertEqual(rows[0]["status"], "confirmed")
        self.assertEqual(rows[0]["booking_uid"], "booking_123")

    def test_doctor_report_flags_missing_resend_key(self):
        data = [
            {
                "name": "Ana Lopez",
                "company": "Banco Demo México",
                "role": "CIO",
                "email": "ana@bancodemo.com.mx",
                "industry": "Financiero",
                "project": "Rocasis",
                "score": "Alta",
            },
            {
                "name": "Luis Perez",
                "company": "Retail Demo México",
                "role": "Director de TI",
                "email": "luis@retaildemo.com.mx",
                "industry": "Retail",
                "project": "Rocasis",
                "score": "Alta",
            },
            {
                "name": "Mara Soto",
                "company": "Manufactura Demo México",
                "role": "Gerente de TI",
                "email": "mara@manufacturademo.com.mx",
                "industry": "Manufactura",
                "project": "Rocasis",
                "score": "Alta",
            },
            {
                "name": "Ivan Ruiz",
                "company": "Banco Segundo México",
                "role": "CTO",
                "email": "ivan@bancosegundo.com.mx",
                "industry": "Financiero",
                "project": "Rocasis",
                "score": "Alta",
            },
        ]
        html = "const DATA = " + json.dumps(data) + ";\nfunction esc(s){}"
        with tempfile.TemporaryDirectory() as tmp:
            html_path = Path(tmp) / "source.html"
            tracker_path = Path(tmp) / "tracker.csv"
            outbox_path = Path(tmp) / "outbox"
            html_path.write_text(html, encoding="utf-8")
            args = argparse.Namespace(
                html_source=str(html_path),
                xlsx_source=str(Path(tmp) / "missing.xlsx"),
                tracker=str(tracker_path),
                outbox=str(outbox_path),
            )
            report = agent.build_doctor_report(args)
        self.assertEqual(report["checks"]["qualified_prospects"], 4)
        self.assertIn("RESEND_API_KEY is missing.", report["blockers"])

    def test_validate_resend_live_success(self):
        domains = [
            {
                "name": "rocasis.mx",
                "status": "verified",
                "capabilities": {"sending": "enabled"},
            }
        ]
        with mock.patch("agent.fetch_resend_domains", return_value=domains):
            result = agent.validate_resend_live("re_1234567890", "Miguel <ventas@rocasis.mx>")
        self.assertTrue(result["ok"])
        self.assertEqual(result["enabled_domains"], ["rocasis.mx"])

    def test_validate_resend_live_api_error(self):
        with mock.patch("agent.fetch_resend_domains", side_effect=agent.ApiRequestError(400, "invalid key")):
            result = agent.validate_resend_live("re_1234567890", "Miguel <ventas@rocasis.mx>")
        self.assertFalse(result["ok"])
        self.assertIn("HTTP 400", result["error"])

    def test_send_notification_missing_config(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertFalse(agent.send_notification("test"))

    def test_simulate_booking_commit_writes_tracker(self):
        data = [
            {
                "name": "Ana Lopez",
                "company": "Banco Demo México",
                "role": "CIO",
                "email": "ana@bancodemo.com.mx",
                "industry": "Financiero",
                "project": "Rocasis",
                "score": "Alta",
            }
        ]
        html = "const DATA = " + json.dumps(data) + ";\nfunction esc(s){}"
        with tempfile.TemporaryDirectory() as tmp:
            html_path = Path(tmp) / "source.html"
            tracker_path = Path(tmp) / "tracker.csv"
            html_path.write_text(html, encoding="utf-8")
            args = argparse.Namespace(
                html_source=str(html_path),
                xlsx_source=str(Path(tmp) / "missing.xlsx"),
                tracker=str(tracker_path),
                outbox=str(Path(tmp) / "outbox"),
                limit=20,
                email="ana@bancodemo.com.mx",
                name="Ana Lopez",
                start="2026-06-05T15:00:00Z",
                booking_uid="booking_sim",
                commit=True,
            )
            with contextlib.redirect_stdout(io.StringIO()):
                code = agent.cmd_simulate_booking(args)
            rows = agent.tracker_rows(tracker_path)
        self.assertEqual(code, 0)
        self.assertEqual(rows[0]["status"], "confirmed")
        self.assertEqual(rows[0]["booking_uid"], "booking_sim")

    def test_extract_resend_status(self):
        self.assertEqual(agent.extract_resend_status({"last_event": "delivered"}), "delivered")
        self.assertEqual(agent.extract_resend_status({"status": "queued"}), "queued")
        self.assertEqual(agent.extract_resend_status({"events": [{"type": "sent"}, {"type": "delivered"}]}), "delivered")
        self.assertEqual(agent.extract_resend_status({}), "unknown")

    def test_apply_resend_status_marks_uncontactable(self):
        row = {"status": "sent", "notes": ""}
        agent.apply_resend_status(row, "bounced")
        self.assertEqual(row["status"], "do_not_contact")
        self.assertEqual(row["resend_status"], "bounced")
        self.assertIn("bounced", row["notes"])

    def test_unmatched_booking_rows_excludes_matched_uid(self):
        bookings = [
            {"uid": "a", "start": "2026-06-05T15:00:00Z", "attendees": [{"email": "a@example.com"}]},
            {"uid": "b", "start": "2026-06-06T15:00:00Z", "attendees": [{"email": "b@example.com"}]},
        ]
        rows = agent.unmatched_booking_rows(bookings, {"a"})
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["booking_uid"], "b")


if __name__ == "__main__":
    unittest.main()
