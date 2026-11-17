"""Generates the n8n workflow JSON in n8n/workflows/. Kept so the exports are reproducible and reviewable.
No secret values appear in the output: secrets are read from env at runtime ($env.*)."""
import json, pathlib

OUT = pathlib.Path(__file__).resolve().parent.parent / "n8n" / "workflows"
OUT.mkdir(parents=True, exist_ok=True)

SIGN_HELPER = """const crypto = require('crypto');
const secret = $env.LENDLOOP_HMAC_SECRET;
if (!secret) throw new Error('LENDLOOP_HMAC_SECRET is not set in the n8n environment');
const sign = (ts, body) => crypto.createHmac('sha256', secret).update(ts + '.' + body).digest('hex');
"""

def node(name, type_, params, pos, version=1, **extra):
    n = {"parameters": params, "name": name, "type": type_, "typeVersion": version, "position": pos}
    n.update(extra)
    return n

RETRY = {"retryOnFail": True, "maxTries": 3, "waitBetweenTries": 2000}

def conn(*pairs):
    c = {}
    for src, dst, idx in pairs:
        c.setdefault(src, {"main": []})
        while len(c[src]["main"]) <= idx:
            c[src]["main"].append([])
        c[src]["main"][idx].append({"node": dst, "type": "main", "index": 0})
    return c

# ---------- Workflow 1: request notification ----------
verify_js = SIGN_HELPER + """
const MAX_SKEW = 300;
const item = $input.first();
const headers = item.json.headers || {};
const ts = headers['x-lendloop-timestamp'];
const sig = headers['x-lendloop-signature'];
const raw = (await this.helpers.getBinaryDataBuffer(0, 'data')).toString('utf8');

const fresh = ts && Math.abs(Date.now() / 1000 - Number(ts)) <= MAX_SKEW;
let valid = false;
if (fresh && sig) {
  const expected = sign(ts, raw);
  const a = Buffer.from(expected), b = Buffer.from(String(sig).toLowerCase());
  valid = a.length === b.length && crypto.timingSafeEqual(a, b);
}
if (!valid) return [{ json: { proceed: false, status: 401 } }];

const payload = JSON.parse(raw);
// Idempotency: Convex retries with the same eventId. Remember recent ids and no-op on repeats.
const store = $getWorkflowStaticData('global');
store.seen = store.seen || [];
if (store.seen.includes(payload.eventId)) return [{ json: { proceed: false, status: 200, duplicate: true } }];
store.seen.push(payload.eventId);
if (store.seen.length > 500) store.seen.shift();
return [{ json: { proceed: true, status: 200, payload } }];
"""

build_js = """const p = $json.payload;
// Only the fields needed to notify one person.
const texts = {
  request_created: `${p.actorName} wants to borrow your "${p.toolName}" from ${p.startDate} to ${p.endDate}.`,
  approved: `${p.actorName} approved your request for "${p.toolName}" (${p.startDate} to ${p.endDate}).`,
  declined: `${p.actorName} declined your request for "${p.toolName}".`,
  returned: `"${p.toolName}" was marked as returned. Thanks for lending and borrowing!`,
  cancelled: `${p.actorName} cancelled their request for "${p.toolName}".`,
};
return [{ json: {
  to: p.recipientEmail,
  subject: `LendLoop: ${p.event.replace('_', ' ')} - ${p.toolName}`,
  text: `Hi ${p.recipientName},\\n\\n${texts[p.event] || 'Your request was updated.'}`,
  eventId: p.eventId,
} }];
"""

send_js = """// Mock delivery: logged to the n8n execution log. To send real email, replace this node with an
// "Email Send" (SMTP) node using an n8n SMTP credential and map to/subject/text from the previous node.
console.log('[LendLoop notification]', JSON.stringify({ eventId: $json.eventId, to: $json.to, subject: $json.subject }));
return [{ json: { delivered: true, eventId: $json.eventId } }];
"""

wf1 = {
    "name": "LendLoop - Request notification",
    "nodes": [
        node("Webhook", "n8n-nodes-base.webhook",
             {"httpMethod": "POST", "path": "lendloop-request", "responseMode": "responseNode",
              "options": {"rawBody": True}}, [0, 200], 2, webhookId="lendloop-request"),
        node("Verify HMAC + dedupe", "n8n-nodes-base.code", {"jsCode": verify_js}, [220, 200], 2),
        node("Proceed?", "n8n-nodes-base.if",
             {"conditions": {"options": {"caseSensitive": True, "typeValidation": "strict"},
                             "conditions": [{"leftValue": "={{ $json.proceed }}", "rightValue": True,
                                             "operator": {"type": "boolean", "operation": "true", "singleValue": True}}],
                             "combinator": "and"}}, [440, 200], 2),
        node("Build message", "n8n-nodes-base.code", {"jsCode": build_js}, [660, 120], 2),
        node("Send notification (mock)", "n8n-nodes-base.code", {"jsCode": send_js}, [880, 120], 2, **RETRY),
        node("Respond 200", "n8n-nodes-base.respondToWebhook",
             {"respondWith": "json", "responseBody": "={{ { ok: true } }}", "options": {"responseCode": 200}}, [1100, 120], 1.1),
        node("Respond (401 or duplicate)", "n8n-nodes-base.respondToWebhook",
             {"respondWith": "json", "responseBody": "={{ { ok: $json.status === 200 } }}",
              "options": {"responseCode": "={{ $json.status }}"}}, [660, 300], 1.1),
    ],
    "connections": conn(
        ("Webhook", "Verify HMAC + dedupe", 0), ("Verify HMAC + dedupe", "Proceed?", 0),
        ("Proceed?", "Build message", 0), ("Proceed?", "Respond (401 or duplicate)", 1),
        ("Build message", "Send notification (mock)", 0), ("Send notification (mock)", "Respond 200", 0)),
    "settings": {"executionOrder": "v1"},
    "active": False,
    "tags": [],
}

# ---------- Workflow 2: overdue reminders ----------
sign_get_js = SIGN_HELPER + """const ts = String(Math.floor(Date.now() / 1000));
return [{ json: { ts, sig: sign(ts, '') } }];  // GET requests sign an empty body
"""
split_js = """const loans = ($input.first().json.loans || []).filter((l) => !l.remindedToday);
return loans.map((l) => ({ json: l }));
"""
remind_js = SIGN_HELPER + """const l = $json;
const sentOn = new Date().toISOString().slice(0, 10);
// Mock delivery (see README to swap in SMTP). Only the fields the reminder needs are used.
console.log('[LendLoop reminder]', JSON.stringify({ to: l.borrowerEmail, tool: l.toolName, daysOverdue: l.daysOverdue }));
const body = JSON.stringify({ requestId: l.requestId, sentOn, idempotencyKey: l.requestId + ':' + sentOn });
const ts = String(Math.floor(Date.now() / 1000));
return [{ json: { body, ts, sig: sign(ts, body) } }];
"""

http_headers = lambda: {"parameters": [
    {"name": "x-lendloop-timestamp", "value": "={{ $json.ts }}"},
    {"name": "x-lendloop-signature", "value": "={{ $json.sig }}"}]}

wf2 = {
    "name": "LendLoop - Overdue reminders (daily)",
    "nodes": [
        node("Daily 09:00", "n8n-nodes-base.scheduleTrigger",
             {"rule": {"interval": [{"field": "days", "triggerAtHour": 9}]}}, [0, 200], 1.2),
        node("Sign GET", "n8n-nodes-base.code", {"jsCode": sign_get_js}, [220, 200], 2),
        node("Fetch overdue loans", "n8n-nodes-base.httpRequest",
             {"method": "GET", "url": "={{ $env.CONVEX_SITE_URL }}/n8n/overdue", "sendHeaders": True,
              "headerParameters": http_headers(), "options": {"timeout": 15000}}, [440, 200], 4.2, **RETRY),
        node("One item per overdue loan", "n8n-nodes-base.code", {"jsCode": split_js}, [660, 200], 2),
        node("Send reminder + sign write-back", "n8n-nodes-base.code", {"jsCode": remind_js}, [880, 200], 2),
        node("Write back (idempotent)", "n8n-nodes-base.httpRequest",
             {"method": "POST", "url": "={{ $env.CONVEX_SITE_URL }}/n8n/reminder-sent", "sendHeaders": True,
              "headerParameters": http_headers(), "sendBody": True, "contentType": "raw",
              "rawContentType": "application/json", "body": "={{ $json.body }}",
              "options": {"timeout": 15000}}, [1100, 200], 4.2, **RETRY),
    ],
    "connections": conn(
        ("Daily 09:00", "Sign GET", 0), ("Sign GET", "Fetch overdue loans", 0),
        ("Fetch overdue loans", "One item per overdue loan", 0),
        ("One item per overdue loan", "Send reminder + sign write-back", 0),
        ("Send reminder + sign write-back", "Write back (idempotent)", 0)),
    "settings": {"executionOrder": "v1", "errorWorkflow": ""},
    "active": False,
    "tags": [],
}

# ---------- Workflow 3: error workflow ----------
err_js = SIGN_HELPER + """const e = $json;
const workflow = (e.workflow && e.workflow.name) || 'unknown';
const message = (e.execution && e.execution.error && e.execution.error.message) || 'unknown error';
console.error('[LendLoop automation failure]', workflow, message);
const body = JSON.stringify({ workflow, message: message.slice(0, 180) });
const ts = String(Math.floor(Date.now() / 1000));
return [{ json: { body, ts, sig: sign(ts, body) } }];
"""
wf3 = {
    "name": "LendLoop - Error workflow",
    "nodes": [
        node("Error Trigger", "n8n-nodes-base.errorTrigger", {}, [0, 200], 1),
        node("Format + sign", "n8n-nodes-base.code", {"jsCode": err_js}, [220, 200], 2),
        node("Report to Convex activity log", "n8n-nodes-base.httpRequest",
             {"method": "POST", "url": "={{ $env.CONVEX_SITE_URL }}/n8n/automation-failure", "sendHeaders": True,
              "headerParameters": http_headers(), "sendBody": True, "contentType": "raw",
              "rawContentType": "application/json", "body": "={{ $json.body }}"}, [440, 200], 4.2, **RETRY),
    ],
    "connections": conn(("Error Trigger", "Format + sign", 0), ("Format + sign", "Report to Convex activity log", 0)),
    "settings": {"executionOrder": "v1"},
    "active": False,
    "tags": [],
}

for fname, wf in [("01-request-notification.json", wf1), ("02-overdue-reminders.json", wf2), ("03-error-workflow.json", wf3)]:
    (OUT / fname).write_text(json.dumps(wf, indent=2) + "\n")
print("ok")
