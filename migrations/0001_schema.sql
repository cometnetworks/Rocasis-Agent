CREATE TABLE IF NOT EXISTS outreach_tracker (
  email TEXT PRIMARY KEY,
  prospect TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  sector TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  sent_at TEXT NOT NULL DEFAULT '',
  followup_1_at TEXT NOT NULL DEFAULT '',
  followup_2_at TEXT NOT NULL DEFAULT '',
  closed_at TEXT NOT NULL DEFAULT '',
  resend_id TEXT NOT NULL DEFAULT '',
  resend_status TEXT NOT NULL DEFAULT '',
  resend_last_checked_at TEXT NOT NULL DEFAULT '',
  booking_uid TEXT NOT NULL DEFAULT '',
  meeting_start TEXT NOT NULL DEFAULT '',
  meeting_confirmed_at TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_outreach_tracker_status ON outreach_tracker(status);
CREATE INDEX IF NOT EXISTS idx_outreach_tracker_resend_id ON outreach_tracker(resend_id);
CREATE INDEX IF NOT EXISTS idx_outreach_tracker_booking_uid ON outreach_tracker(booking_uid);

CREATE TABLE IF NOT EXISTS cal_unmatched_bookings (
  booking_uid TEXT PRIMARY KEY,
  start TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  attendee_emails TEXT NOT NULL DEFAULT '',
  attendee_names TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  last_seen_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS run_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task TEXT NOT NULL,
  ok INTEGER NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
