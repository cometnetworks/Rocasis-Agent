export interface Env {
  DB: D1Database;
  RESEND_API_KEY: string;
  CAL_API_KEY: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  CAL_WEBHOOK_SECRET?: string;
  ADMIN_SECRET?: string;
  CAL_LINK: string;
  CAL_API_VERSION: string;
  TARGET_MEETINGS: string;
  FROM_EMAIL: string;
  REPLY_TO: string;
  MAX_FOLLOWUPS_PER_RUN: string;
}

type TrackerRow = {
  email: string;
  prospect: string;
  company: string;
  sector: string;
  status: string;
  sent_at: string;
  followup_1_at: string;
  followup_2_at: string;
  closed_at: string;
  resend_id: string;
  resend_status: string;
  resend_last_checked_at: string;
  booking_uid: string;
  meeting_start: string;
  meeting_confirmed_at: string;
  notes: string;
};

type Booking = {
  uid?: string;
  start?: string;
  status?: string;
  title?: string;
  attendees?: Array<{ email?: string; name?: string }>;
  guests?: string[];
};

const USER_AGENT = "rocasis-sales-agent/1.0 (+https://www.rocasis.com/)";
const ACTIVE_STATUSES = new Set(["sent", "followup_1", "followup_2"]);
const RESEND_UNCONTACTABLE_STATUSES = new Set(["bounced", "suppressed", "complained", "failed", "rejected"]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "rocasis-agent" });
    }

    if (request.method === "GET" && url.pathname === "/status") {
      return json(await status(env));
    }

    if (request.method === "POST" && url.pathname === "/cal-webhook") {
      return handleCalWebhook(request, env);
    }

    if (request.method === "POST" && url.pathname === "/admin/run") {
      if (!isAdminAuthorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
      const task = url.searchParams.get("task") || "all";
      return json(await runTask(task, env));
    }

    return json({ ok: false, error: "not_found" }, 404);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === "*/15 * * * *") {
      ctx.waitUntil(runTask("sync-cal", env));
      return;
    }
    if (event.cron === "7 * * * *") {
      ctx.waitUntil(runTask("sync-resend", env));
      return;
    }
    if (event.cron === "20 15 * * *") {
      ctx.waitUntil(runTask("followups", env));
    }
  },
};

async function runTask(task: string, env: Env) {
  const results: Record<string, unknown> = {};

  if (task === "all" || task === "sync-cal") {
    results.syncCal = await logged(env, "sync-cal", () => syncCal(env));
  }
  if (task === "all" || task === "sync-resend") {
    results.syncResend = await logged(env, "sync-resend", () => syncResend(env));
  }
  if (task === "all" || task === "followups") {
    results.followups = await logged(env, "followups", () => sendDueFollowups(env));
  }

  return { ok: true, task, results };
}

async function logged<T>(env: Env, task: string, fn: () => Promise<T>): Promise<T> {
  try {
    const result = await fn();
    await insertRunLog(env, task, true, JSON.stringify(result).slice(0, 1000));
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await insertRunLog(env, task, false, message.slice(0, 1000));
    await notify(env, `Rocasis agent error in ${task}: ${message}`);
    throw error;
  }
}

async function status(env: Env) {
  const rows = await env.DB.prepare("SELECT status, sent_at, followup_1_at, followup_2_at FROM outreach_tracker").all<TrackerRow>();
  const summary = {
    targetMeetings: Number(env.TARGET_MEETINGS || "4"),
    confirmed: 0,
    sentAwaiting: 0,
    followup1Active: 0,
    followup2Active: 0,
    followupsDue: 0,
  };

  for (const row of rows.results || []) {
    if (row.status === "confirmed") summary.confirmed += 1;
    if (row.status === "sent") summary.sentAwaiting += 1;
    if (row.status === "followup_1") summary.followup1Active += 1;
    if (row.status === "followup_2") summary.followup2Active += 1;
    if (nextFollowupStep(row)) summary.followupsDue += 1;
  }

  return { ...summary, remaining: Math.max(0, summary.targetMeetings - summary.confirmed) };
}

async function syncCal(env: Env) {
  const bookings = await fetchCalBookings(env, ["upcoming"]);
  let matched = 0;
  const matchedUids = new Set<string>();

  for (const booking of bookings) {
    const count = await markBookingConfirmed(env, booking, "Synced from Cal.com bookings API");
    matched += count;
    if (count && booking.uid) matchedUids.add(compact(booking.uid));
  }

  let unmatched = 0;
  for (const booking of bookings) {
    const uid = compact(booking.uid);
    if (!uid || matchedUids.has(uid)) continue;
    unmatched += 1;
    await env.DB.prepare(
      `INSERT INTO cal_unmatched_bookings
       (booking_uid, start, status, attendee_emails, attendee_names, title, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(booking_uid) DO UPDATE SET
        start = excluded.start,
        status = excluded.status,
        attendee_emails = excluded.attendee_emails,
        attendee_names = excluded.attendee_names,
        title = excluded.title,
        last_seen_at = excluded.last_seen_at`
    )
      .bind(
        uid,
        compact(booking.start),
        compact(booking.status),
        [...attendeeEmails(booking)].sort().join(", "),
        attendeeNames(booking).join(", "),
        compact(booking.title),
        nowIso(),
      )
      .run();
  }

  if (matched) await notify(env, `Cal.com sync: ${matched} booking(s) matched for Rocasis.`);
  return { fetched: bookings.length, matched, unmatched };
}

async function syncResend(env: Env) {
  const rows = await env.DB.prepare("SELECT email, status, notes, resend_id FROM outreach_tracker WHERE resend_id != ''").all<TrackerRow>();
  let checked = 0;
  let failed = 0;

  for (const row of rows.results || []) {
    try {
      const payload = await requestJson(`https://api.resend.com/emails/${encodeURIComponent(row.resend_id)}`, {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
      });
      const resendStatus = extractResendStatus(payload);
      const statusUpdate = RESEND_UNCONTACTABLE_STATUSES.has(resendStatus) ? "do_not_contact" : row.status;
      const note = RESEND_UNCONTACTABLE_STATUSES.has(resendStatus)
        ? [row.notes, `Marked do_not_contact after Resend status: ${resendStatus}`].filter(Boolean).join("; ")
        : row.notes;
      await env.DB.prepare(
        `UPDATE outreach_tracker
         SET status = ?, resend_status = ?, resend_last_checked_at = ?, notes = ?, updated_at = ?
         WHERE email = ?`
      ).bind(statusUpdate, resendStatus, nowIso(), note, nowIso(), row.email).run();
      checked += 1;
    } catch (_error) {
      failed += 1;
    }
  }

  return { checked, failed };
}

async function sendDueFollowups(env: Env) {
  const rows = await env.DB.prepare("SELECT * FROM outreach_tracker WHERE status IN ('sent', 'followup_1', 'followup_2')").all<TrackerRow>();
  let sent = 0;
  let closed = 0;
  const max = Math.max(1, Number(env.MAX_FOLLOWUPS_PER_RUN || "10"));

  for (const row of rows.results || []) {
    if (sent >= max) break;
    const step = nextFollowupStep(row);
    if (!step) continue;

    if (step === "closed") {
      await env.DB.prepare("UPDATE outreach_tracker SET status = 'closed', closed_at = ?, updated_at = ? WHERE email = ?")
        .bind(nowIso(), nowIso(), row.email)
        .run();
      closed += 1;
      continue;
    }

    const subject = followupSubject(row, step);
    const body = followupBody(row, step, env.CAL_LINK);
    const resendId = await sendResend(env, row.email, subject, body, `rocasis-calcom-${step}`, await idempotencyKey(step, row.email, subject));

    await env.DB.prepare(
      `UPDATE outreach_tracker
       SET status = ?, ${step === "followup_1" ? "followup_1_at" : "followup_2_at"} = ?, resend_id = ?, updated_at = ?
       WHERE email = ?`
    ).bind(step, nowIso(), resendId, nowIso(), row.email).run();
    sent += 1;
  }

  if (sent || closed) await notify(env, `Rocasis follow-ups: ${sent} sent, ${closed} closed.`);
  return { sent, closed };
}

async function handleCalWebhook(request: Request, env: Env): Promise<Response> {
  if (!isCalWebhookAuthorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  const payload = await request.json<Record<string, unknown>>();
  const booking = extractBooking(payload);
  const matched = await markBookingConfirmed(env, booking, "Confirmed from Cal.com webhook");
  if (matched) await notify(env, `Cal.com webhook: ${matched} Rocasis booking(s) confirmed.`);
  return json({ ok: true, matched });
}

async function markBookingConfirmed(env: Env, booking: Booking, note: string): Promise<number> {
  let matched = 0;
  for (const email of attendeeEmails(booking)) {
    const existing = await env.DB.prepare("SELECT email FROM outreach_tracker WHERE email = ?").bind(email).first<{ email: string }>();
    if (!existing) continue;
    await env.DB.prepare(
      `UPDATE outreach_tracker
       SET status = 'confirmed', booking_uid = ?, meeting_start = ?, meeting_confirmed_at = ?, notes = COALESCE(NULLIF(notes, ''), ?), updated_at = ?
       WHERE email = ?`
    ).bind(compact(booking.uid), compact(booking.start), nowIso(), note, nowIso(), email).run();
    matched += 1;
  }
  return matched;
}

async function fetchCalBookings(env: Env, statuses: string[]): Promise<Booking[]> {
  const bookings: Booking[] = [];
  for (const status of statuses) {
    let cursor = "";
    do {
      const url = new URL("https://api.cal.com/v2/bookings");
      url.searchParams.set("status", status);
      if (cursor) url.searchParams.set("cursor", cursor);
      const payload = await requestJson(url.toString(), {
        Authorization: `Bearer ${env.CAL_API_KEY}`,
        "cal-api-version": env.CAL_API_VERSION,
      });
      bookings.push(...((payload.data as Booking[] | undefined) || []));
      const pagination = payload.pagination as { hasMore?: boolean; nextCursor?: string } | undefined;
      cursor = pagination?.hasMore && pagination.nextCursor ? String(pagination.nextCursor) : "";
    } while (cursor);
  }
  return bookings;
}

async function requestJson(url: string, headers: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, ...headers } });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

async function sendResend(env: Env, to: string, subject: string, body: string, campaign: string, key: string): Promise<string> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      "Idempotency-Key": key,
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: [to],
      reply_to: env.REPLY_TO,
      subject,
      text: body,
      html: textToHtml(body),
      headers: { "X-Campaign": campaign },
    }),
  });

  if (!response.ok) throw new Error(`Resend HTTP ${response.status}: ${await response.text()}`);
  const payload = await response.json<{ id?: string }>();
  return payload.id || "";
}

async function notify(env: Env, text: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${encodeURIComponent(env.TELEGRAM_BOT_TOKEN)}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
  });
}

async function insertRunLog(env: Env, task: string, ok: boolean, message: string): Promise<void> {
  await env.DB.prepare("INSERT INTO run_log (task, ok, message, created_at) VALUES (?, ?, ?, ?)")
    .bind(task, ok ? 1 : 0, message, nowIso())
    .run();
}

function nextFollowupStep(row: TrackerRow): "" | "followup_1" | "followup_2" | "closed" {
  const today = new Date();
  if (row.status === "sent" && daysSince(row.sent_at, today) >= 2) return "followup_1";
  if (row.status === "followup_1" && daysSince(row.followup_1_at, today) >= 3) return "followup_2";
  if (row.status === "followup_2" && daysSince(row.followup_2_at, today) >= 5) return "closed";
  return "";
}

function daysSince(value: string, today: Date): number {
  if (!value) return -1;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return -1;
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const dateUtc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((todayUtc - dateUtc) / 86_400_000);
}

function followupSubject(row: TrackerRow, step: string): string {
  const company = row.company || "tu empresa";
  if (step === "followup_1") return `Re: ${company}: integracion de sistemas`;
  if (step === "followup_2") return `Cierro el ciclo por ahora, ${company}`;
  return `${company}: seguimiento`;
}

function followupBody(row: TrackerRow, step: string, calLink: string): string {
  const name = firstName(row.prospect);
  const company = row.company || "tu empresa";
  if (step === "followup_1") {
    return `Hola ${name},

Retomo mi mensaje anterior. La razon de contactarte es revisar si en ${company} hay fricciones entre ERP, CRM, e-commerce, inventario, facturacion u otros sistemas criticos que esten generando reprocesos o poca visibilidad operativa.

En Roca Sistemas usamos Magic xpi para integrar aplicaciones empresariales y automatizar flujos sin redisenar toda la arquitectura actual.

Si te hace sentido, puedes agendar una sesion de 30 minutos aqui:
${calLink}

Si no lo ves contigo, ¿quien lleva integraciones, automatizacion o arquitectura de aplicaciones?

Saludos,
Miguel Cedillo`;
  }

  return `Hola ${name},

Cierro el ciclo por ahora para no insistir de mas. Si en ${company} estan revisando integracion de sistemas, automatizacion de procesos o conectividad entre ERP/CRM/e-commerce/SAP, aqui dejo el enlace para una sesion breve:

${calLink}

Si no eres la persona correcta o prefieres no recibir mas mensajes, respondeme "baja" y lo retiro de seguimiento.

Saludos,
Miguel Cedillo`;
}

function extractBooking(payload: Record<string, unknown>): Booking {
  const data = isObject(payload.data) ? payload.data : payload;
  const booking = isObject(data.booking) ? data.booking : data;
  return booking as Booking;
}

function attendeeEmails(booking: Booking): Set<string> {
  const emails = new Set<string>();
  for (const attendee of booking.attendees || []) {
    const email = compact(attendee.email).toLowerCase();
    if (email) emails.add(email);
  }
  for (const guest of booking.guests || []) {
    const email = compact(guest).toLowerCase();
    if (email) emails.add(email);
  }
  return emails;
}

function attendeeNames(booking: Booking): string[] {
  return (booking.attendees || []).map((attendee) => compact(attendee.name)).filter(Boolean);
}

function extractResendStatus(payload: Record<string, unknown>): string {
  for (const key of ["last_event", "status", "state"]) {
    const value = payload[key];
    if (value) return compact(String(value)).toLowerCase();
  }
  const events = payload.events;
  if (Array.isArray(events) && events.length) {
    const latest = events[events.length - 1];
    if (isObject(latest)) return compact(String(latest.type || latest.event || latest.name || "")).toLowerCase();
    return compact(String(latest)).toLowerCase();
  }
  return "unknown";
}

function isCalWebhookAuthorized(request: Request, env: Env): boolean {
  if (!env.CAL_WEBHOOK_SECRET) return true;
  const url = new URL(request.url);
  return (
    url.searchParams.get("secret") === env.CAL_WEBHOOK_SECRET ||
    request.headers.get("x-rocasis-webhook-secret") === env.CAL_WEBHOOK_SECRET
  );
}

function isAdminAuthorized(request: Request, env: Env): boolean {
  if (!env.ADMIN_SECRET) return false;
  const url = new URL(request.url);
  return (
    url.searchParams.get("secret") === env.ADMIN_SECRET ||
    request.headers.get("x-rocasis-admin-secret") === env.ADMIN_SECRET
  );
}

async function idempotencyKey(...parts: string[]): Promise<string> {
  const source = parts.map((part) => compact(part).toLowerCase()).join("|");
  return `rocasis-${(await sha256(source)).slice(0, 48)}`;
}

async function sha256(source: string): Promise<string> {
  const bytes = new TextEncoder().encode(source);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function textToHtml(body: string): string {
  return body.split("\n\n").map((part) => `<p>${escapeHtml(part).replaceAll("\n", "<br>")}</p>`).join("\n");
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function firstName(name: string): string {
  return (name.trim().split(/\s+/)[0] || "").trim();
}

function compact(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function nowIso(): string {
  return new Date().toISOString();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function json(payload: unknown, statusCode = 200): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status: statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
