import fs from "node:fs";
import path from "node:path";

const [inputPath, outputPath] = process.argv.slice(2);

if (!inputPath || !outputPath) {
  console.error("Usage: node scripts/tracker-csv-to-d1-sql.mjs <tracker.csv> <out.sql>");
  process.exit(2);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

function sql(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

const text = fs.readFileSync(inputPath, "utf8");
const [header, ...records] = parseCsv(text);
const fields = header || [];
const now = new Date().toISOString();
const statements = ["DELETE FROM outreach_tracker;"];

for (const record of records) {
  if (!record.length || record.every((cell) => !cell.trim())) continue;
  const row = Object.fromEntries(fields.map((field, index) => [field, record[index] || ""]));
  if (!row.email || row.email === "email") continue;
  statements.push(`INSERT INTO outreach_tracker (
    email, prospect, company, sector, status, sent_at, followup_1_at, followup_2_at,
    closed_at, resend_id, resend_status, resend_last_checked_at, booking_uid,
    meeting_start, meeting_confirmed_at, notes, updated_at
  ) VALUES (
    ${sql(row.email.toLowerCase())}, ${sql(row.prospect)}, ${sql(row.company)}, ${sql(row.sector)},
    ${sql(row.status)}, ${sql(row.sent_at)}, ${sql(row.followup_1_at)}, ${sql(row.followup_2_at)},
    ${sql(row.closed_at)}, ${sql(row.resend_id)}, ${sql(row.resend_status)},
    ${sql(row.resend_last_checked_at)}, ${sql(row.booking_uid)}, ${sql(row.meeting_start)},
    ${sql(row.meeting_confirmed_at)}, ${sql(row.notes)}, ${sql(now)}
  )
  ON CONFLICT(email) DO UPDATE SET
    prospect = excluded.prospect,
    company = excluded.company,
    sector = excluded.sector,
    status = excluded.status,
    sent_at = excluded.sent_at,
    followup_1_at = excluded.followup_1_at,
    followup_2_at = excluded.followup_2_at,
    closed_at = excluded.closed_at,
    resend_id = excluded.resend_id,
    resend_status = excluded.resend_status,
    resend_last_checked_at = excluded.resend_last_checked_at,
    booking_uid = excluded.booking_uid,
    meeting_start = excluded.meeting_start,
    meeting_confirmed_at = excluded.meeting_confirmed_at,
    notes = excluded.notes,
    updated_at = excluded.updated_at;`);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${statements.join("\n")}\n`, "utf8");
console.log(`Wrote ${outputPath}`);
