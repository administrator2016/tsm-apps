
const { runRealEstateControlPlane } = require('./server/real-estate/real-estate-control-plane');

// Mute MongoDB connection warnings from HITL Gates during local dev
const originalConsoleError = console.error;
console.error = function(...args) {
  if (typeof args[0] === "string" && args[0].includes("[TSMHitlGate:")) return;
  originalConsoleError.apply(console, args);
};


require('dotenv').config({ override: true });
const express = require('express');
const { buildDecisionPackage } = require('./server/pm/decision-engine');
const { buildPmPredictiveControl } = require('./server/pm/predictive-control');
const { buildPmIntelligenceV3, verifyPmAction } = require('./server/pm/intelligence-v3');
const pmActionEngine = require('./server/pm/action-engine');
// Mortgage/Construction intelligence-v3: reuse the same generic action-engine
// and intelligence-v3 modules PM uses (server/pm/action-engine.js and
// server/pm/intelligence-v3.js are vertical-agnostic already -- see the
// 2026-08-28 shared decision-engine-core refactor). Only the decision engine
// itself is per-vertical, via each vertical's own domain-config module.
const { buildDecisionPackage: buildMortgageDecisionPackage } = require('./server/mortgage/decision-engine');
const { buildDecisionPackage: buildConstructionDecisionPackage } = require('./server/construction/decision-engine');
const { buildPortfolioTwin: buildMortgagePortfolioTwin } = require('./server/mortgage/portfolio-intelligence');
const { buildPortfolioTwin: buildConstructionPortfolioTwin } = require('./server/construction/portfolio-intelligence');
// Healthcare/Schools intelligence-v3 (2026-08-29): same port as Mortgage/
// Construction above -- these are the two remaining verticals confirmed to
// have real structured input data (HC's /api/hc/node-report; Schools'
// /api/schools/analysis grant_breaches/monitoring_items/exceptions body)
// rather than a free-text-only query endpoint. RE, Legal, NOC, and
// HotelOps's query endpoints were checked and have no structured findings
// shape to normalize -- see server.js comments at their intelligence-v3
// insertion point for why they were not built out.
const { buildDecisionPackage: buildHcDecisionPackage } = require('./server/healthcare/decision-engine');
const { buildPortfolioTwin: buildHcPortfolioTwin } = require('./server/healthcare/portfolio-intelligence');
const { buildDecisionPackage: buildSchoolsDecisionPackage } = require('./server/schools/decision-engine');
const { buildPortfolioTwin: buildSchoolsPortfolioTwin } = require('./server/schools/portfolio-intelligence');
const { buildPortfolioTwin } = require('./server/pm/portfolio-intelligence');
const { calculateRisk } = require('./server/pm/risk-engine');
const { forecast } = require('./server/pm/forecast-engine');


// ============================================================
// TSM OPERATIONAL OS — UNIVERSAL EXECUTIVE RECOVERY
// ============================================================
const { buildRecoveryPackage } = require('./server/tsm-operational-os');

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

process.on('uncaughtException', (err) => {
  console.error('💥 UNCAUGHT EXCEPTION:', err.message, err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 UNHANDLED REJECTION at:', promise, 'reason:', reason);
});

const https = require('https');
const multer = require('multer');
// Required once here (not just at the app.use() mount point below) so the
// BPO document-upload route can reuse its extractDocText()/isSupported()
// helpers instead of duplicating the pdf/docx/xlsx extraction logic.
const docRouter = require('./routes/doc-router');
const sentinelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB per file, plenty for contracts/claims docs
});

const app = express();

const { verifySession: __verifySessionForUser, getCookie: __getCookieForUser } = require('./middleware/require-auth');
app.use((req, res, next) => {
  const __session = __verifySessionForUser(__getCookieForUser(req, 'tsm_session'));
  req.session = req.session || {};
  if (__session) {
    req.session.user = { id: __session.staffId || __session.clientId || 'admin', role: __session.role || 'admin' };
    req.user = { role: __session.role || 'admin', actor: __session.staffId || __session.clientId || 'admin', clientId: __session.clientId || null };
  } else {
    req.session.user = null;
    req.user = null;
  }
  next();
});

const PORT = process.env.PORT || 8080;
const HTML_ROOT = path.join(__dirname, "html");
// AUTH REMOVED — in-house use only
// const { tsmAuthMiddleware } = require('./html/tsm-auth');
const { requireAuth, requireRole, signSession, verifySession, getCookie, SESSION_TTL_MS } = require('./middleware/require-auth');
const clientRegistry = require('./middleware/client-registry');
const staffRegistry = require('./middleware/staff-registry');

app.use(express.json());
app.use(require('express').urlencoded({ extended: false }));
// tsmAuthMiddleware(app); // removed — war rooms are in-house

// ── SECURITY HEADERS & RATE LIMITING ────────────────────────────────────────
// Runs behind Fly's edge proxy — 'trust proxy' must be set before any
// rate-limiter is defined, or express-rate-limit keys every request off
// Fly's proxy IP instead of the real client IP (making the limit either
// useless — everyone shares one bucket — or it throws on the
// X-Forwarded-For header entirely depending on version).
app.set('trust proxy', 1);

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { enforceBNCASchema } = require('./server/tsm-bnca-schema');
const snAdapter = require('./server/l1-copilot/servicenow-adapter');
const cloudOpsAdapter = require('./server/l1-copilot/cloud-ops-adapter');
const graphAdapter = require('./server/l1-copilot/graph-intune-adapter');
const gcpAdapter = require('./server/l1-copilot/gcp-adapter');
const demoData = require('./server/l1-copilot/demo-data');

// contentSecurityPolicy/crossOriginEmbedderPolicy/crossOriginResourcePolicy
// are OFF on purpose: this app is ~100+ largely-independent HTML pages that
// all rely on inline <script> blocks and cross-origin assets (CDN scripts,
// fonts, images) that have never been audited against a CSP or COEP. Turning
// those on here would silently break pages until each one is individually
// fixed — that's real work, not a one-line flip, and belongs in its own
// pass. Everything else below (frameguard, nosniff, HSTS, etc.) has no such
// site-wide dependency and is safe to turn on globally right now.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
}));

// General API limiter — generous ceiling, just stops scripted hammering.
// /health is excluded so Fly's own healthcheck traffic never trips it.
const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests — please slow down.' },
});

// Twins/enterprise-lab limiter — the L1 Copilot enterprise command center
// (html/l1-copilot/enterprise-command-center.html) runs 8 independent 5s
// pollers against /api/twins/* (VMware, Network, AD, Device, SLA, Risk,
// Tech, Analytics), some issuing 2 requests per tick (summary + status).
// That's ~2-3 req/sec sustained from a single open tab, which blew through
// the general apiLimiter's ~1 req/sec average within a couple of minutes
// and left every widget stuck on "unreachable, will keep retrying" even
// though the backend was fine. This is legitimate background polling, not
// abuse, so it gets its own higher ceiling instead of sharing the general
// budget. Mounted ahead of apiLimiter below so it takes precedence for
// these two path prefixes.
const twinsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240, // ~4 req/sec sustained — comfortably above the page's real load
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests — please slow down.' },
});
app.use(['/api/twins', '/api/enterprise-lab'], twinsLimiter);

// BPO limiter — bulk document intake (batches of dozens-to-hundreds of
// files, e.g. a client's onboarding upload or a pilot stress test) is
// legitimate expected load, not abuse — same rationale as twinsLimiter
// above. Confirmed via scripts/stress-test/run-stress-test.js: a 200-doc
// batch at realistic concurrency blew through the general apiLimiter's
// ~1 req/sec average and got legitimate uploads rejected with 429s.
// Mounted ahead of apiLimiter so it takes precedence for this prefix.
//
// The first version of this limiter (300/min, ~5 req/sec) was itself
// still too low: a re-run of the same stress test against concurrency-10
// batch uploads sustained ~31 req/sec (200 docs in ~6.4s) and kept
// hitting 429s on ordinary, non-edge-case documents. Raised to 2000/min
// (~33 req/sec) to clear that observed real throughput with some
// headroom — this is a capacity/abuse-tradeoff number, not a hard
// technical limit, so revisit it if actual client onboarding batches
// turn out to need more (or you'd rather throttle harder and accept
// slower batch intake).
const bpoLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 2000, // ~33 req/sec sustained — covers observed stress-test throughput at concurrency 10
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests — please slow down.' },
});
app.use('/api/bpo', bpoLimiter);

// HC limiter — same rationale as twinsLimiter/bpoLimiter above. The HC
// Office Manager Doc Intake page (hc-office-manager-doc-intake.html) is
// meant to be exercised repeatedly during a single session (classify typed
// text, load each of the 6 samples, upload a file, refresh the queue after
// every action) and every HC node/strategist/exec-portal page also polls
// /api/hc/*. That's ordinary interactive use, not abuse, but it shares the
// same tab/session as everything else being tested, so it burns through the
// general apiLimiter's ~1 req/sec shared budget fast and starts 429ing
// classify/sample requests that have nothing to do with any real overload.
// Confirmed via live console output on the Doc Intake page: repeated 429s on
// /api/hc/intake and /api/hc/intake-sample after a handful of ordinary
// clicks. Mounted ahead of apiLimiter so it takes precedence for this prefix.
const hcLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240, // ~4 req/sec sustained — same ceiling as twinsLimiter, comfortably above real usage
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests — please slow down.' },
});
app.use('/api/hc', hcLimiter);

// NoSQL operator injection guard — these four route groups build Mongo
// filters directly from req.query/req.body/req.params (see
// server/security/mongo-sanitize.js for the exact mechanism). Mounted here,
// before any route body, so every handler downstream already sees clean
// input regardless of which ledger function it calls.
const { mongoSanitize } = require('./server/security/mongo-sanitize');
app.use(['/api/bpo', '/api/pm', '/api/concierge', '/api/hotelops'], mongoSanitize());

// General apiLimiter below is mounted on '/api/' as a whole, so without
// this exclusion list it silently double-applies on top of every
// path-specific limiter above (twinsLimiter, bpoLimiter) — a request
// only needs to fail EITHER limiter's budget to get 429'd, and the
// general one (300 req/5min, ~1 req/sec) is far stricter than the
// per-prefix ceilings meant to replace it for these paths. Confirmed via
// scripts/stress-test/run-stress-test.js: raising bpoLimiter to 2000/min
// alone did not clear the 429s during a batch upload, because every
// request was still separately being checked against apiLimiter's much
// lower shared budget underneath. req.path here is relative to the
// '/api/' mount point (e.g. '/bpo/work-items/123/documents'), matching
// the same style as the pre-existing '/health' check.
const API_LIMITER_EXCLUDED_PREFIXES = ['/health', '/bpo', '/twins', '/enterprise-lab', '/hc'];
app.use('/api/', (req, res, next) => (
  API_LIMITER_EXCLUDED_PREFIXES.some(prefix => req.path.startsWith(prefix))
    ? next()
    : apiLimiter(req, res, next)
));

// ── STRUCTURED REQUEST LOGGING — BPO (Phase 5, tractable subset) ───────────
// One single-line JSON object per BPO API request to stdout (Fly captures
// stdout as logs already — no new log-shipping infra invented here). Covers
// what BPO actually needs for monitoring/incident review: who (role +
// label, not raw session token), what, and the outcome — not a general
// APM/tracing system, which would be its own infra decision.
app.use('/api/bpo', (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const session = verifySession(getCookie(req, 'tsm_session'));
    try {
      console.log(JSON.stringify({
        type: 'bpo_request',
        ts: new Date().toISOString(),
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Date.now() - start,
        role: session ? (session.role || 'admin') : null,
        actor: session ? (session.label || session.role || null) : null,
        clientId: session ? (session.clientId || null) : null,
      }));
    } catch (e) { console.warn('[bpo request log] failed to serialize:', e.message); }
  });
  next();
});

// Tighter limiter specifically on login — brute-force protection on the one
// endpoint where a stolen/guessed credential actually matters. Applied as
// route-level middleware (not a path-prefix rule) so it stays attached to
// this exact route regardless of how the file gets reorganized later.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many login attempts — please try again later.' },
});

// Shared validator for the AI-query routes (/api/bpo/query and its sibling
// verticals below). Rejects empty/missing prompts and caps prompt length +
// maxTokens so a malformed or abusive request can't drive up Groq spend or
// hang a request indefinitely. Previously these routes accepted anything,
// including an empty string, and happily forwarded it to the model.
const MAX_QUERY_LENGTH = 8000;
const MAX_QUERY_TOKENS = 4096;
function validateQueryBody(req, res, next) {
  const msg = (req.body && (req.body.message || req.body.question || req.body.query)) || '';
  if (typeof msg !== 'string' || !msg.trim()) {
    return res.status(400).json({ ok: false, error: 'message/question/query is required' });
  }
  if (msg.length > MAX_QUERY_LENGTH) {
    return res.status(400).json({ ok: false, error: `message exceeds ${MAX_QUERY_LENGTH} character limit` });
  }
  if (req.body && req.body.maxTokens !== undefined) {
    const mt = Number(req.body.maxTokens);
    if (!Number.isFinite(mt) || mt <= 0 || mt > MAX_QUERY_TOKENS) {
      return res.status(400).json({ ok: false, error: `maxTokens must be a number between 1 and ${MAX_QUERY_TOKENS}` });
    }
  }
  next();
}

// ── CLOUDFLARE-ORIGIN GATE ──────────────────────────────────────────────────
// Rejects any request that didn't come through the tsm-entitlement-gate
// Cloudflare Worker (cloudflare/entitlement-gate/worker.js), which is the
// only thing enforcing per-vertical licensing and the shared-engine-JS
// same-origin check. Without this, tsm-consultz.fly.dev is a direct side
// door around all of that.
//
// Silent no-op until CF_GATE_SECRET is set as a Fly secret AND the matching
// TSM_GATE_SECRET is set as a Worker secret — intentional, so this can't
// accidentally lock out local/Codespace dev or a deploy that hasn't wired
// the Worker side up yet. Set both, then this becomes live.
//   fly secrets set CF_GATE_SECRET=<value> -a tsm-consultz
//   cd cloudflare/entitlement-gate && wrangler secret put TSM_GATE_SECRET
app.use((req, res, next) => {
  if (!process.env.CF_GATE_SECRET) return next(); // not configured — no-op
  if (req.path === '/health') return next(); // Fly's own healthcheck hits origin directly
  if (req.get('x-tsm-cf-gate') === process.env.CF_GATE_SECRET) return next();
  return res.status(403).send('Forbidden');
});

// Login accepts the shared admin password, a per-staff access code
// (manager/analyst), or a per-client access code — tried in that order.
// Admin is a cheap string compare against an env var; staff and client are
// registry lookups against separate HMAC-hashed code stores (a staff and a
// client can never collide on the same code — each pool is checked
// independently). All three paths produce the same kind of signed session
// cookie; only the payload shape differs.
app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { password, accessCode } = req.body || {};
  const credential = password || accessCode || '';
  if (!process.env.TSM_ADMIN_PASSWORD || !process.env.TSM_SESSION_SECRET) {
    return res.status(500).json({ ok: false, error: 'Auth not configured on server' });
  }
  if (!credential) {
    return res.status(401).json({ ok: false, error: 'Password or access code required' });
  }

  let payload;
  if (credential === process.env.TSM_ADMIN_PASSWORD) {
    payload = { role: 'admin', exp: Date.now() + SESSION_TTL_MS };
  } else {
    const staff = staffRegistry.findStaffByCode(credential);
    if (staff) {
      payload = { role: staff.role, staffId: staff.id, label: staff.label, exp: Date.now() + SESSION_TTL_MS };
    } else {
      const client = clientRegistry.findClientByCode(credential);
      if (!client) {
        return res.status(401).json({ ok: false, error: 'Invalid password or access code' });
      }
      payload = { role: 'client', clientId: client.id, label: client.label, tenantId: client.tenantId || null, exp: Date.now() + SESSION_TTL_MS };
    }
  }

  const token = signSession(payload);
  // Secure requires HTTPS. Prod (Fly.io) is always HTTPS, but local dev is
  // plain http://localhost -- curl and browsers both refuse to send a
  // Secure-flagged cookie back over http, which silently breaks every
  // authenticated request in local testing (401s, or hangs waiting on
  // server-side calls gated behind a session that never arrives).
  const cookieSecureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `tsm_session=${encodeURIComponent(token)}; HttpOnly${cookieSecureFlag}; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`);
  res.json({ ok: true, role: payload.role, clientId: payload.clientId || null, staffId: payload.staffId || null, label: payload.label || null, tenantId: payload.tenantId || null });
});

app.post('/api/auth/logout', (req, res) => {
  const cookieSecureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `tsm_session=${cookieSecureFlag}; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/auth/status', (req, res) => {
  const session = verifySession(getCookie(req, 'tsm_session'));
  if (!session) return res.json({ ok: true, authenticated: false });
  res.json({
    ok: true,
    authenticated: true,
    role: session.role || 'admin', // sessions signed before this change had no role — treat as admin
    clientId: session.clientId || null,
    staffId: session.staffId || null,
    label: session.label || null,
    tenantId: session.tenantId || null,
  });
});

// Any authenticated session — admin, staff (manager/analyst), or client.
// Attaches req.tsmSession.
function requireAnyAuth(req, res, next) {
  const session = verifySession(getCookie(req, 'tsm_session'));
  if (!session) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  req.tsmSession = {
    role: session.role || 'admin',
    clientId: session.clientId || null,
    staffId: session.staffId || null,
    label: session.label || null,
    tenantId: session.tenantId || null,
  };
  next();
}

// Admin-only. Also attaches req.tsmSession for consistency with requireAnyAuth.
function requireAdmin(req, res, next) {
  const session = verifySession(getCookie(req, 'tsm_session'));
  if (!session) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const role = session.role || 'admin';
  if (role !== 'admin') return res.status(403).json({ ok: false, error: 'Admin access required' });
  req.tsmSession = { role: 'admin', clientId: null, label: null };
  next();
}

// ── CLIENT MANAGEMENT (admin only) ──────────────────────────────────────────
// List clients (no codes returned — codes are shown once, at creation/rotation).
app.get('/api/admin/clients', requireAdmin, (req, res) => {
  res.json({ ok: true, clients: clientRegistry.listClientsSafe() });
});

// Create a client + generate their access code. Returned ONCE — hand it to
// the client now; if lost, rotate instead of trying to recover it.
app.post('/api/admin/clients', requireAdmin, (req, res) => {
  try {
    const { label } = req.body || {};
    const { client, accessCode } = clientRegistry.createClient(label);
    res.json({ ok: true, client, accessCode });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/admin/clients/:id/rotate-code', requireAdmin, (req, res) => {
  try {
    const { client, accessCode } = clientRegistry.rotateCode(req.params.id);
    res.json({ ok: true, client, accessCode });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/admin/clients/:id/deactivate', requireAdmin, (req, res) => {
  try {
    const client = clientRegistry.setActive(req.params.id, false);
    res.json({ ok: true, client });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/admin/clients/:id/reactivate', requireAdmin, (req, res) => {
  try {
    const client = clientRegistry.setActive(req.params.id, true);
    res.json({ ok: true, client });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Links (or, with tenantId omitted/empty, unlinks) a client login to a
// cross-vertical Member. Once linked, that client's next login carries
// tenantId in its session, and /api/bpo/reports/client-rollup switches
// that client from its single-clientId BPO rollup to the Member's real
// cross-vertical case rollup (see bpoBuildMemberClientRollup). Doesn't
// validate tenantId against /api/members — an admin linking a client to a
// Member that doesn't exist yet just gets an empty rollup (memberCaseSummary
// returns zeros for cases via zero cases, not an error) rather than a hard
// failure, same "no invented numbers, no invented errors" pattern the rest
// of this file uses.
app.post('/api/admin/clients/:id/link-member', requireAdmin, (req, res) => {
  try {
    const { tenantId } = req.body || {};
    const client = clientRegistry.setTenantId(req.params.id, tenantId);
    res.json({ ok: true, client });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ── STAFF MANAGEMENT (admin only) ───────────────────────────────────────────
// Internal manager/analyst accounts — separate pool from clients (see
// middleware/staff-registry.js). Same admin-only, code-shown-once pattern as
// client management above.
app.get('/api/admin/staff', requireAdmin, (req, res) => {
  res.json({ ok: true, staff: staffRegistry.listStaffSafe() });
});

// Create a staff account + generate their access code. role must be
// 'manager' or 'analyst'. Code returned ONCE — hand it to the staff member
// now; if lost, rotate instead of trying to recover it.
app.post('/api/admin/staff', requireAdmin, (req, res) => {
  try {
    const { label, role } = req.body || {};
    const { staff, accessCode } = staffRegistry.createStaff(label, role);
    res.json({ ok: true, staff, accessCode });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/admin/staff/:id/rotate-code', requireAdmin, (req, res) => {
  try {
    const { staff, accessCode } = staffRegistry.rotateCode(req.params.id);
    res.json({ ok: true, staff, accessCode });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/admin/staff/:id/deactivate', requireAdmin, (req, res) => {
  try {
    const staff = staffRegistry.setActive(req.params.id, false);
    res.json({ ok: true, staff });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/admin/staff/:id/reactivate', requireAdmin, (req, res) => {
  try {
    const staff = staffRegistry.setActive(req.params.id, true);
    res.json({ ok: true, staff });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ── GLOBAL NO-CACHE ───────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use((req, res, next) => {
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('CDN-Cache-Control', 'no-store');
  next();
});

// ── GROQ AI ENGINE ────────────────────────────────────────────────────────────
// Primary: fetch-based (reliable on Railway)
const GROQ_MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b'
];
// llama-3.1-8b-instant (deprecated, shuts down 08/16/26 per Groq's deprecation page),
// llama3-8b-8192 (dead since 08/30/25), and gemma2-9b-it (dead since 10/08/25) removed —
// all three were dead fallback rungs, not real options; gpt-oss-20b is Groq's own
// recommended replacement for llama-3.1-8b-instant, so no coverage is lost.

// TSM FIX 2026-08-27: /api/war-room/stream and /api/hc/stream both did
// `model: model || 'openai/gpt-oss-120b'` — that only catches an *empty*
// model, not a dead one. Several client dropdowns (FinOps strategist,
// finance-index.html, legal-account.html, etc.) still ship options like
// llama-3.1-8b-instant / llama-3.3-70b-versatile / mixtral-8x7b-32768 /
// gemma2-9b-it / llama3-70b-8192, all of which are shut down on Groq's
// side. Any request carrying one of those would 4xx straight through to
// the end user instead of degrading. This maps known-dead/unknown model
// strings to a safe live default instead of trusting client input verbatim.
const GROQ_DEPRECATED_MODEL_MAP = {
  'llama-3.1-8b-instant': 'openai/gpt-oss-20b',
  'llama-3.3-70b-versatile': 'openai/gpt-oss-120b',
  'llama3-70b-8192': 'openai/gpt-oss-120b',
  'llama3-8b-8192': 'openai/gpt-oss-20b',
  'mixtral-8x7b-32768': 'openai/gpt-oss-120b',
  'gemma2-9b-it': 'openai/gpt-oss-20b'
};
function resolveGroqModel(requested) {
  if (!requested) return 'openai/gpt-oss-120b';
  if (GROQ_MODELS.includes(requested)) return requested;
  if (GROQ_DEPRECATED_MODEL_MAP[requested]) return GROQ_DEPRECATED_MODEL_MAP[requested];
  // Unrecognized string (typo, future/unknown model) — don't blindly forward
  // it to Groq and let the user hit a raw API error; fall back safely.
  return 'openai/gpt-oss-120b';
}

async function groqChat(system, message, maxTokens, clientKey, jsonMode) {
  const groqKey = process.env.GROQ_API_KEY || process.env.GROQ_KEY || clientKey;
  if (!groqKey) throw new Error('No Groq API key configured (server env missing and no client key provided)');
  for (const model of GROQ_MODELS) {
    for (const useJsonMode of (jsonMode ? [true, false] : [false])) {
      try {
        const body = {
          model,
          max_tokens: maxTokens,
          messages: [{ role: 'system', content: system }, { role: 'user', content: message }]
        };
        if (useJsonMode) body.response_format = { type: 'json_object' };
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000); // fail fast on a hung/slow upstream response rather than blocking indefinitely
        let r;
        try {
          r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + groqKey, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal
          });
        } finally {
          clearTimeout(timeoutId);
        }
        if (!r.ok) {
          const err = await r.text();
          if (r.status === 429 || r.status === 503 || r.status === 500 || r.status === 502) {
            await new Promise(res => setTimeout(res, 3000));
            continue;
          }
          // 400 with jsonMode on often means this model doesn't support response_format —
          // fall through to the non-json-mode retry for the same model before giving up on it
          if (r.status === 400 && useJsonMode) continue;
          throw new Error('Groq API error ' + r.status + ': ' + err);
        }
        const data = await r.json();
        const content = data?.choices?.[0]?.message?.content || '';
        if (!content.trim()) {
          // 200 OK but empty content (e.g. filtered/refused/stopped immediately) —
          // treat as a failure and try the next model rather than silently
          // returning "" to the caller.
          console.warn('[groqChat] empty completion from', model, '- finish_reason:', data?.choices?.[0]?.finish_reason);
          continue;
        }
        return content;
      } catch (e) {
        if (e.name === 'AbortError' || e.message.includes('aborted')) {
          console.warn('[groqChat] timed out after 20s on', model, '- trying next model');
          continue;
        }
        if (e.message.includes('429') || e.message.includes('rate_limit')) continue;
        if (useJsonMode) continue; // try the same model again without json mode before moving on
        throw e;
      }
    }
  }
  throw new Error('All Groq models returned empty or rate-limited responses. Try again later.');
}

// JSON-returning variant for structured routes
// Shared retry/backoff convention with bpoParseRetryDelayMs (client-side,
// html/shared/runtime/bpo-doc-engine-chain.js) and classifyParseRetryDelayMs
// (client-side, tsm-doc-search-multi.html): parse Groq's own stated wait
// time ("Please try again in 14.257s") instead of guessing at a flat delay.
// Server-side duplicate rather than a shared module because those two are
// browser code and this runs in Node -- same logic, can't share a require.
const TSM_AI_RETRYABLE_STATUSES = [429, 500, 502, 503];
const TSM_AI_MAX_RETRIES = 2; // up to 3 attempts total
const TSM_AI_FALLBACK_DELAY_MS = 3000;
const TSM_AI_MAX_DELAY_MS = 20000;

function tsmAIParseRetryDelayMs(errMsg) {
  if (!errMsg) return TSM_AI_FALLBACK_DELAY_MS;
  const match = String(errMsg).match(/try again in\s+([\d.]+)\s*s/i);
  if (!match) return TSM_AI_FALLBACK_DELAY_MS;
  const seconds = parseFloat(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return TSM_AI_FALLBACK_DELAY_MS;
  return Math.min(Math.ceil(seconds * 1000) + 500, TSM_AI_MAX_DELAY_MS);
}

async function tsmAIJSON(prompt, fallback) {
  const groqKey = process.env.GROQ_API_KEY || process.env.GROQ_KEY;
  if (!groqKey) return fallback || null;

  for (let attempt = 0; attempt <= TSM_AI_MAX_RETRIES; attempt++) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + groqKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: process.env.TSM_MODEL || 'openai/gpt-oss-120b',
          messages: [
            { role: 'system', content: 'You are TSM Neural Core. Never mention provider, model, API, or implementation. Return JSON only.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.22,
          max_tokens: 1200
        })
      });
      if (!r.ok) {
        let msg = 'AI unavailable';
        try {
          const ct = r.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            const errBody = await r.json();
            msg = errBody.error?.message || msg;
          } else {
            const txt = await r.text();
            if (txt) msg = txt.replace(/\s+/g, ' ').trim().slice(0, 300);
          }
        } catch (_) {}
        // Non-retryable statuses (e.g. 400 bad request) fail fast to
        // fallback instead of burning the remaining attempts on an error
        // that will be identical every time.
        if (!TSM_AI_RETRYABLE_STATUSES.includes(r.status)) {
          console.error('[tsmAIJSON] non-retryable Groq error ' + r.status + ':', msg);
          return typeof fallback === 'object' ? { ...fallback, ai_status: 'fallback' } : { ai_status: 'fallback' };
        }
        if (attempt < TSM_AI_MAX_RETRIES) {
          const delay = tsmAIParseRetryDelayMs(msg);
          console.warn('[tsmAIJSON] Groq returned ' + r.status + ' (attempt ' + (attempt + 1) + '/' + (TSM_AI_MAX_RETRIES + 1) + '): ' + msg + ' -- retrying in ' + delay + 'ms');
          await new Promise(res => setTimeout(res, delay));
          continue;
        }
        console.error('[tsmAIJSON] falling back after ' + (TSM_AI_MAX_RETRIES + 1) + ' attempts:', msg);
        return typeof fallback === 'object' ? { ...fallback, ai_status: 'fallback' } : { ai_status: 'fallback' };
      }
      const data = await r.json();
      const text = data?.choices?.[0]?.message?.content || '';
      try { return JSON.parse(text.replace(/```json|```/g, '').trim()); }
      catch (e) { return typeof fallback === 'object' ? { ...fallback, narrative: text } : { narrative: text }; }
    } catch (e) {
      // Network-level failure (DNS, connection reset, timeout) rather than
      // an HTTP status -- still worth retrying the same as a 5xx.
      if (attempt < TSM_AI_MAX_RETRIES) {
        console.warn('[tsmAIJSON] network error (attempt ' + (attempt + 1) + '/' + (TSM_AI_MAX_RETRIES + 1) + '): ' + e.message + ' -- retrying in ' + TSM_AI_FALLBACK_DELAY_MS + 'ms');
        await new Promise(res => setTimeout(res, TSM_AI_FALLBACK_DELAY_MS));
        continue;
      }
      console.error('[tsmAIJSON] falling back after ' + (TSM_AI_MAX_RETRIES + 1) + ' attempts:', e.message);
      return typeof fallback === 'object' ? { ...fallback, ai_status: 'fallback' } : { ai_status: 'fallback' };
    }
  }
}

// ── SYSTEM PROMPTS ────────────────────────────────────────────────────────────
var SP = {
  music: 'You are a professional music writing AI with three agent modes: ZAY (cadence/flow/bounce), RIYA (emotion/imagery/vulnerability), DJ (hook/structure/commercial). Write lyrics and hooks creatively and directly. No preamble.',
  healthcare: 'You are a healthcare operations AI for TSM Command. Expert in claims adjudication, prior auth, denial management, HIPAA/CMS compliance, billing, staffing, throughput, revenue cycle. Be precise and data-driven. OUTPUT RULES (always follow): plain "LABEL: value" or short "- bullet" lines only — never markdown tables, never pipe characters, never bold-wrapped prose paragraphs. Max ~20 words per line — conclusion only. Every requested field must still be present, just terse.',
  financial: 'You are a financial intelligence AI for TSM Command. Expert in revenue cycle, P&L, cash flow, compliance, audit, tax strategy, investment analysis. Be analytical and strategic. For any deadline, filing date, or payment due date: use only a date explicitly stated in the document or data provided — never calculate, estimate, or infer one from a "standard" or "typical" window. If no deadline is stated, write "NOT STATED IN SOURCE DOCUMENT" for that field instead of guessing. Only state that documentation, approvals, or filings have been obtained or completed if the source confirms it — anything shown as missing or pending must be listed as a still-needed action, not treated as resolved.',
  mortgage: 'You are a mortgage and real estate AI for TSM Command. Expert in mortgage origination, underwriting, REO, BPO realty, title, closing. Be precise and regulatory-aware.',
  hotelops: 'You are a HotelOps operations AI for TSM Command. Expert in property maintenance, OTA (Expedia/Booking.com) commission audit, hospitality compliance (fire safety, health permits, elevator certs), and revenue KPIs (RevPAR, ADR, occupancy, GOP margin). Given structured maintenance ticket, OTA overcharge, and compliance data, identify the highest-severity SLA-breached tickets, the largest OTA overcharge exposure, and the most urgent compliance deadline. Recommend the single most important next action for each. Reference ticket/OTA/compliance IDs. Be precise and operational. No preamble. For the compliance deadline: use only a date explicitly present in the compliance_risk data provided — never calculate, estimate, or infer one from a "standard" or "typical" renewal/inspection window. If no date is present for a given item, write "NOT STATED IN SOURCE DATA" instead of guessing. Only state a permit, certification, or inspection as current/passed if the data confirms it — anything shown as missing, expired, or pending must be listed as a still-needed action, not treated as resolved.',
  construction: 'You are a construction operations AI for TSM Command. Expert in project management, bid analysis, cost control, contractor/vendor management, scheduling. Be direct and operational.',
  legal: 'You are a legal intelligence AI for TSM Command. Expert in contract analysis, regulatory compliance, case strategy, risk assessment. Note: AI analysis only, not legal advice. OUTPUT RULES (always follow, even if the user prompt suggests otherwise): plain "LABEL: value" or short "- bullet" lines only — never markdown tables, never pipe characters, never bold-wrapped prose paragraphs. Each bullet or value is one line, max ~20 words — state the conclusion, not the reasoning chain. Do not restate the question, add preamble, or write multi-sentence rationale unless a field explicitly asks for a rationale, and even then cap it at one short clause. Every requested field must still be present — compress the writing, not the coverage.',
  insurance: 'You are an insurance intelligence AI for TSM Command. Expert in P&C, life, health insurance, claims, underwriting, AZ market, NPN licensing. Be precise. OUTPUT RULES (always follow): plain "LABEL: value" or short "- bullet" lines only — never markdown tables, never pipe characters, never bold-wrapped prose paragraphs. Max ~20 words per line — conclusion only. Every requested field must still be present, just terse.',
  education: 'You are an education operations AI for TSM Command. Expert in school administration, compliance, staffing, student outcomes, budget, grants. Be strategic. OUTPUT RULES (always follow): plain "LABEL: value" or short "- bullet" lines only — never markdown tables, never pipe characters, never bold-wrapped prose paragraphs. Max ~20 words per line — conclusion only. Every requested field must still be present, just terse. For any deadline, obligation date, liquidation date, or compliance due date: use only a date explicitly stated in the source data provided — never calculate, estimate, or infer one from a "typical" grant cycle. If no specific date is given, describe the timing qualitatively as stated (e.g. "approaching," "imminent") without inventing a date, or write "NOT STATED IN SOURCE DATA." Only state that a corrective action, filing, or document has been completed if the source data confirms it — anything shown as open or pending must be listed as a still-needed action, not treated as resolved.',
  hospitality: 'You are a hospitality operations AI for TSM Command. Expert in hotel ops, concierge, staffing, revenue management, guest experience. Be service-oriented.',
  pm: 'You are a Property Management AI for TSM PM Copilot. Expert in maintenance work-order triage, lease renewal strategy, vendor compliance (insurance/license lapses), and occupancy/vacancy cost analysis. Given structured unit, work-order, lease, and vendor data, KPIs, and SLA breaches, identify the highest-dollar-impact vacancies, the most urgent SLA-breached work orders, leases at risk of non-renewal, and vendor compliance gaps blocking dispatch. Recommend the specific next action per item, prioritized by dollar exposure. Reference unit/work-order/lease/vendor IDs. Be precise and operational. No preamble.',
  enterprise: 'You are a senior business strategist AI for TSM Command. Expert in enterprise strategy, GTM, operations optimization, ROI analysis. Be executive-level and direct.',
  o2c: 'You are an Order-to-Cash operations AI for TSM Command. Expert in quote-to-order, credit management, ATP/inventory allocation, shipping, invoicing, AR, and cash application. Given structured order, KPI, and SLA-breach data, identify root causes of bottlenecks, flag financial/operational risk, and recommend the specific next action for each at-risk order. Be precise and operational. No preamble.',
  crm: 'You are a CRM customer-lifecycle AI for TSM Command. Expert in lead qualification, account/opportunity management, pipeline health, case escalation, and churn risk. Given structured lead/contact/account/opportunity/case data, KPIs, and SLA-breach data, identify the highest-risk records, the root cause of stalled deals or breached cases, and the specific next action per record. Reference record IDs. Be precise and operational. No preamble.',
  noc: 'You are a Network Operations Center AI for TSM Command. Expert in incident management, alert correlation, device/fleet health, and SLA-driven escalation. Given structured incident/alert/device data, KPIs, and SLA-breach data, identify the highest-severity or highest-risk incidents, correlate related alerts to their root incident, flag devices contributing to fleet-uptime risk, and recommend the specific next action per at-risk incident or device. Reference incident/alert/device IDs. Be precise and operational. No preamble.',
  career: 'You are the TSM Career Training Platform AI. Expert in Microsoft AB-100/AI-103 certification prep, presales interview coaching, and enterprise AI vocabulary (Copilot Studio, Azure AI, HITL, RAG, multi-agent). Answer exactly what is asked — explanations, practice questions, scenarios, or grading — concisely and directly. No preamble, no markdown headers unless the prompt specifically asks for structured output.',
  approval: 'You are an Enterprise Approval Center AI for TSM Command. Expert in multi-level approval workflows, delegation rules, escalation management, SLA compliance, and audit governance. Given structured approval request data, KPIs, SLA breaches, and attention flags, identify bottlenecks, escalation risks, and the specific next action per at-risk request. Reference request IDs. Be precise and operational. No preamble.',
  cpq: 'You are a CPQ (Configure-Price-Quote) operations AI for TSM Command. Expert in product configuration, compatibility rules, discount policy, margin management, quote lifecycle, and approval workflows. Given structured quote pipeline, KPI, and SLA-breach data, identify configuration conflicts, margin risks, stalled quotes, and the specific next action per at-risk quote. Reference quote IDs. Be precise and operational. No preamble.',
  catalog: 'You are a Product Catalog Management AI for TSM Command. Expert in product hierarchy, lifecycle management, SKU/variant management, bill of materials, compliance tracking, inventory linkage, and pricing synchronization. Given structured product catalog data, KPIs, and attention flags (low-stock, compliance, end-of-life), identify catalog data-quality risks, lifecycle bottlenecks, and the specific next action per flagged product. Reference SKUs/product IDs. Be precise and operational. No preamble.',
  governance: 'You are a Governance & Compliance AI for TSM Command. Expert in internal controls, risk management, regulatory compliance frameworks, and audit oversight. Given structured control status, open risks, and flagged audit events, identify the highest-priority failing or at-risk controls, the risks most likely to escalate, and any suspicious or flagged audit events requiring follow-up. Reference control IDs and risk IDs. Be precise and operational. No preamble.',
  strategist: 'You are the TSM Sovereign Strategist — the ultimate business consultant AI. Deep expertise across healthcare, financial, legal, real estate, construction, insurance, education, hospitality, enterprise strategy, M&A, GTM. Be bold and transformative. OUTPUT RULES (always follow): plain "LABEL: value" or short "- bullet" lines only — never markdown tables, never pipe characters, never bold-wrapped prose paragraphs. Max ~20 words per line — conclusion only, not the reasoning chain. Every requested field must still be present, just terse.',
  mdm: 'You are a Master Data Management AI for TSM Command. Expert in data stewardship, golden-record strategy, duplicate resolution, validation rule design, and data quality governance. Given structured master-record data, duplicate-match clusters, and quality scores across customer/vendor/GL domains, identify the highest-risk data anomalies, recommend which record in each duplicate cluster should survive a merge and why, and flag stewardship or validation-rule gaps. Reference record IDs. Be precise and operational. No preamble.',
  integration: 'You are an Enterprise Integration AI for TSM Command. Expert in API monitoring, event-driven architecture, ETL pipelines, message queue health, and data lineage across CRM/ERP/HR/Finance/Supply Chain/Manufacturing/BI/AI systems. Given system health, integration flow throughput/latency, message queue depth, ETL job status, and recent error events, identify the highest-risk integration failures or bottlenecks, trace root cause across the affected flow, and recommend specific remediation. Reference system and flow IDs. Be precise and operational. No preamble.',
  digitalTwin: 'You are the Enterprise Digital Twin AI for TSM Command. Expert in cross-domain business simulation across Sales, Finance, Operations, Manufacturing, Procurement, HR, Customer Service, Supply Chain, Logistics, and IT Ops. Given structured domain health scores, live signal feed, and 30-day forecast data, synthesize an executive brief: identify the domains driving the biggest swings in enterprise health, the highest-priority cross-domain risk, and the single most important executive action this week. Reference domain names and specific figures. Be precise and operational. No preamble.',
  l1Assistant: 'You are the L1 Ticket Copilot Assistant for TSM Command IT support. ' +
    'A tier-1 technician will describe a live scenario in their own words — a ticket ' +
    'they are stuck on, an error message, a user complaint, or a "what should I do here" ' +
    'question. Give fast, practical, best-practice guidance a working L1 tech can act on ' +
    'immediately. Structure every answer as: (1) likely root cause in one line, ' +
    '(2) the 2-4 concrete next steps in order, (3) when to escalate and to whom ' +
    '(L2, vendor, or manager) if the steps do not resolve it. If the scenario mentions ' +
    'Dell hardware, factor in ProSupport vs Basic warranty guidance and what info ' +
    '(service tag / express service code) to have ready before contacting Dell. ' +
    'Be concise, no filler, no preamble, plain operational language a technician can ' +
    'read in a few seconds mid-ticket.\n\n' +
    'You are ALSO the Cert Prep tutor for this app\'s Cert Prep tab, covering the standard ' +
    'entry ladder: CompTIA A+ (220-1201/220-1202 — Core 1: hardware, networking fundamentals, ' +
    'mobile devices, virtualization & cloud concepts; Core 2: OS, security basics, software ' +
    'troubleshooting, operational procedures), CompTIA Network+ (N10-009 — networking technologies, ' +
    'installation & configuration, media & topologies, network management, network security), ' +
    'CompTIA Security+ (SY0-701 — General Security Concepts ~12%, Threats/Vulnerabilities/Mitigations ' +
    '~22%, Security Architecture ~18%, Security Operations ~28% [largest domain], Security Program ' +
    'Management & Oversight ~20%; 90 questions/90 min, 750/900 to pass), and Microsoft Azure ' +
    'Fundamentals (AZ-900 — Cloud Concepts ~25-30%, Azure Architecture & Services ~35-40% [largest ' +
    'domain], Azure Management & Governance ~30-35%; no expiration, free annual renewal via Microsoft ' +
    'Learn, no retest). These map onto this app\'s own tabs: A+ -> Ticket/Troubleshooting/Imaging, ' +
    'Network+ -> AD-Intune join/sync fields and SCCM content-distribution, Security+ -> AD-Intune\'s ' +
    'BitLocker/compliance-drift fields and the Escalation tab\'s severity-and-evidence model, ' +
    'AZ-900 -> Cloud Ops\' provider/service/environment picker and IAM-policy paste box. ' +
    'When a question is clearly about exam material — a term, an acronym, "what\'s the difference ' +
    'between X and Y", "quiz me on...", a practice question, "which domain is this" — and not a live ' +
    'ticket, switch modes: drop the root-cause/next-steps/escalate structure and answer like a study ' +
    'tutor instead. Give a direct, exam-accurate explanation, then in one line tie it back to the app ' +
    'tab/workflow that exercises that concept, the same way the Cert Prep tab already does. If asked ' +
    'to generate practice questions, write NEW original multiple-choice questions on the spot (one ' +
    'correct answer, brief explanation) — never claim to reproduce real exam questions, and stay ' +
    'strictly within these four certs\' actual objectives above; do not invent domains, exam codes, ' +
    'or weightings that aren\'t listed here. If asked about a cert or exam version outside these four, ' +
    'say this tutor is scoped to the A+/Network+/Security+/AZ-900 track and point them to the vendor\'s ' +
    'own current objectives page instead of guessing.',
  l1support: 'You are a Senior Network and Systems Engineer acting as the decision-making core of TSM L1 Ticket Copilot, a desktop/network support triage tool. You have 15+ years of enterprise IT experience across Windows/macOS endpoint management, Active Directory/Entra ID, DNS/DHCP, VLAN and routing, firewall/ACL policy, VPN and SD-WAN, virtualization, Microsoft 365/Azure, and OEM hardware (Dell, HP, Lenovo, Cisco, Meraki, Fortinet). Triage every ticket in OSI-layer order — physical/hardware first, then link/network (VLAN, switchport, DHCP, DNS), then transport/session (VPN, firewall, auth/SSO/MFA), then application — and do not skip layers. Distinguish clearly between an L1-actionable fix, a fix that needs elevated/L2 access, and a fix that needs vendor hardware service, and say which one applies and why. When recommending escalation, name the correct team (Desktop, Network, Server, Azure, O365, Security, Application, or Vendor) based on where in the stack the root cause actually sits, not just ticket category. Be precise, operational, and quantify confidence and risk where you can. No filler, no preamble, no restating the question back.',
  vmware: 'You are a VMware Virtualization & Cloud Operations SME acting as the decision-making core of the TSM VMware Infrastructure Copilot. You have deep, current operational expertise across vCenter, vRealize Automation (vRA)/Aria Automation, vRealize Orchestrator (vRO), VMware Cloud Director (VCD), NSX, vSAN, and the surrounding IaC tooling (PowerCLI, Terraform vSphere/VCD providers, vRO scriptable tasks, REST APIs). Given pasted logs, config, Blueprint/vORG YAML, NSX errors, or a plain-English description of a failure, you: (1) identify what the artifact/error actually is, (2) state the most probable root cause ranked by likelihood, (3) give the safest remediation path with exact commands (PowerCLI cmdlets, REST calls, or CLI) where applicable, (4) flag operational risk (production impact, snapshot/rollback needs, downtime), and (5) state whether this is L1/L2-actionable or needs escalation to the VMware admin/platform team and why. When asked to generate a script (PowerCLI, Terraform, vRO scriptable task, REST call), produce complete, runnable code with brief inline comments — assume the operator understands VMware but wants to move fast, not a tutorial. No filler, no preamble, no restating the question back.',
  cloudops: 'You are a Multi-Cloud Operations SME (Azure, AWS, and Azure VMware Solution / VMware Cloud on AWS / Google Cloud VMware Engine) acting as the decision-making core of the TSM Cloud Operations Copilot. You have deep operational expertise across Azure (VMs, VNets, NSGs, Azure AD/Entra, ARM/Bicep, Azure NetApp Files), AWS (EC2, VPC, IAM, S3, FSx ONTAP), and hybrid VMware-on-cloud fabric (AVS, VMC on AWS, GCVE). Given pasted logs, error output, resource config, or a plain-English description, you: (1) identify the artifact/error, (2) rank probable root causes, (3) give the safest remediation with exact CLI/portal steps, (4) flag blast radius and rollback considerations, (5) state whether this is self-service-actionable or needs escalation and to which team (Cloud Platform, Networking, Security/IAM, or the vendor). When asked to generate infrastructure-as-code (Terraform, ARM, Bicep, Azure CLI, AWS CLI), produce complete, runnable code with brief inline comments. No filler, no preamble, no restating the question back.',
};

// ── GLOBAL STATE ──────────────────────────────────────────────────────────────
global.MUSIC_PLATFORM = global.MUSIC_PLATFORM || {
  artistDNA: { status: 'active', artist: 'Current Artist', styleTerms: ['pain', 'resilience'], weights: { cadence: 0.88, emotion: 0.91, structure: 0.76, imagery: 0.82 }, learnedSongs: [] },
  agentRuns: [], activity: []
};
global.MUSIC_SUITE_STATE = global.MUSIC_SUITE_STATE || {
  artistsOnline: 12, releasesDropping: 3, monthlyStreams: '84M', revenueMTD: 847400, pipelineValue: 2400000, aiStatus: 'online'
};
const TSM_MEMORY = global.__TSM_MEMORY__ = global.__TSM_MEMORY__ || {
  healthcare: { nodes: {}, hcStrategist: null, mainStrategist: null, executive: null },
  construction: { nodes: {}, strategist: null, bnca: null, executive: null },
  mortgage: { nodes: {}, strategist: null, bnca: null, executive: null },
  pm: { nodes: {}, strategist: null, bnca: null, executive: null }
};
// Generic per-vertical memory for verticals other than healthcare (which keeps its richer,
// purpose-built shape above). Each entry is a small, real, capped log of what that vertical's
// own query endpoint actually asked/answered — never synthesized or inferred, just recorded —
// so the Sovereign Strategist can cite real recent activity across verticals instead of only
// healthcare. Capped at 5 entries per vertical to bound memory growth.
const TSM_VERTICAL_MEMORY_CAP = 5;
function recordVerticalMemory(vertical, prompt, answer) {
  if (!vertical || !answer) return;
  if (!TSM_MEMORY[vertical]) TSM_MEMORY[vertical] = { recent: [] };
  if (!Array.isArray(TSM_MEMORY[vertical].recent)) TSM_MEMORY[vertical].recent = [];
  TSM_MEMORY[vertical].recent.push({
    ts: new Date().toISOString(),
    prompt: (prompt || '').toString().slice(0, 300),
    answer: (answer || '').toString().slice(0, 500)
  });
  if (TSM_MEMORY[vertical].recent.length > TSM_VERTICAL_MEMORY_CAP) {
    TSM_MEMORY[vertical].recent = TSM_MEMORY[vertical].recent.slice(-TSM_VERTICAL_MEMORY_CAP);
  }
  TSM_MEMORY[vertical].lastUpdated = new Date().toISOString();
}
const TSM_MESH = {
  HEALTHCARE: { owner: 'HC Strategist', controller: 'Healthcare Command', risks: ['Revenue leakage', 'Denial escalation', 'Patient throughput degradation', 'Compliance exposure'] },
  CONSTRUCTION: { owner: 'Construction Strategist', controller: 'Construction Command', risks: ['Permit delays', 'Schedule variance', 'Cost overrun', 'Supply chain disruption'] },
  FINANCE: { owner: 'Financial Strategist', controller: 'Financial Command', risks: ['Margin compression', 'Payer variance', 'Cash flow slowdown', 'Revenue forecasting deviation'] }
};

app.use('/html/runtime', express.static(path.join(__dirname, 'html', 'runtime')));
// FIX (shadow-duplication routing bug): these two MUST be registered before
// the '/' catch-all below. html/runtime/kernel/canonical-core.js is a stale
// 7-line stub; the real CanonicalCore class lives at repo-root
// runtime/kernel/canonical-core.js. Express matches static mounts in
// registration order, so if the catch-all comes first, it silently serves
// the stub for every /runtime/* request and this mount never runs.
app.use('/runtime', express.static(path.join(__dirname, 'runtime'), { setHeaders: (res) => res.setHeader('Cache-Control', 'no-store') }));
app.use('/architecture', express.static(path.join(__dirname, 'architecture'), { setHeaders: (res) => res.setHeader('Cache-Control', 'no-store') }));
app.use('/core', express.static(path.join(__dirname, 'core')));

// ── LOGIN PAGE ────────────────────────────────────────────────────────────────
// Kept reachable at /login in case it's wanted again later, but nothing
// redirects here anymore — see removed gates below (Latorrey, 2026-08-21).
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'html', 'login.html'));
});

// ── CLIENT-FACING SURFACE GATE — REMOVED (Latorrey, 2026-08-21) ───────────
// Previously redirected unauthenticated requests to /tsm-doc-search-multi.html
// (and /html/tsm-doc-search-multi.html) to /login. Removed at Latorrey's
// request. NOTE: this page's own client-side JS (applySessionScope() in the
// file itself) also had a same-purpose redirect fallback — removed there too.
// Losing this gate means tsm-doc-search-multi.html (which is also what '/'
// serves by default) is now reachable by anyone with the URL, with no
// per-client data isolation at the page level.

// ── BPO WAR ROOM GATE — REMOVED (Latorrey, 2026-08-21) ────────────────────
// Previously restricted /war-rooms/bpo-war/{bpo-war-room,bpo-strategist,
// bpo-executive-portal}.html to admin/manager/analyst sessions, redirecting
// everyone else to /login. Removed at Latorrey's request. These BPO pages
// are now reachable without any session/role check.

// ── BPO OPERATIONAL DATA (clients / work items / audit log) ────────────────
// Backed by server/tsm-ledger-service.js (bpo_clients / bpo_work_items /
// bpo_audit_logs collections) — replaces what the war room previously kept
// only in the browser's localStorage. BPO_INTERNAL_ROLES: admin, manager,
// analyst. Creating/editing/deactivating a client is restricted to
// admin+manager — analysts work the war room but don't manage the client
// roster. Audit-log reads are admin+manager only, same reasoning as
// restricting who can see who-did-what across accounts.
//
// NOTE: this constant used to also gate away the BPO war-room/strategist/
// exec-portal *pages* (redirecting to /login) — that page-level gate was
// removed at Latorrey's request (2026-08-21). BPO_INTERNAL_ROLES itself is
// still very much live and required — it's the requireRole() check on
// every /api/bpo/*, /api/concierge/*, and /api/members/* route below, which
// has nothing to do with the removed page gate. Restoring only the constant.
const BPO_INTERNAL_ROLES = ['admin', 'manager', 'analyst'];
const BPO_MANAGE_ROLES = ['admin', 'manager'];
// Client-role sessions get read-only visibility into their own data only —
// never the client roster, audit logs, internal notes, or other clients'
// records. Every route gated to this list MUST scope its query/result by
// req.tsmSession.clientId when role === 'client', or a client account
// could read across accounts. See the per-route comments below for how
// each one enforces that.
const BPO_CLIENT_VIEW_ROLES = [...BPO_INTERNAL_ROLES, 'client'];

// Shared internal-only role list for governance/integration/MDM admin
// actions (approve/reject/merge/reset). These subsystems previously used
// requireAuth (any valid session, including client role) with no role
// check — tightened to match the BPO_INTERNAL_ROLES pattern above.
const ENTERPRISE_INTERNAL_ROLES = ['admin', 'manager', 'analyst'];

app.get('/api/bpo/clients', requireRole(BPO_INTERNAL_ROLES), async (req, res) => {
  try {
    const clients = await tsmLedger.bpoListClients({ status: req.query.status });
    res.json({ ok: true, clients });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/bpo/clients', requireRole(BPO_MANAGE_ROLES), async (req, res) => {
  try {
    const client = await tsmLedger.bpoCreateClient(req.body || {}, req.tsmSession.label || req.tsmSession.role);
    res.json({ ok: true, client });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

app.patch('/api/bpo/clients/:id', requireRole(BPO_MANAGE_ROLES), async (req, res) => {
  try {
    const client = await tsmLedger.bpoUpdateClient(req.params.id, req.body || {}, req.tsmSession.label || req.tsmSession.role);
    if (!client) return res.status(404).json({ ok: false, error: 'Client not found' });
    res.json({ ok: true, client });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

app.post('/api/bpo/clients/:id/deactivate', requireRole(BPO_MANAGE_ROLES), async (req, res) => {
  try {
    const client = await tsmLedger.bpoSetClientStatus(req.params.id, 'inactive', req.tsmSession.label || req.tsmSession.role);
    if (!client) return res.status(404).json({ ok: false, error: 'Client not found' });
    res.json({ ok: true, client });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

app.post('/api/bpo/clients/:id/reactivate', requireRole(BPO_MANAGE_ROLES), async (req, res) => {
  try {
    const client = await tsmLedger.bpoSetClientStatus(req.params.id, 'active', req.tsmSession.label || req.tsmSession.role);
    if (!client) return res.status(404).json({ ok: false, error: 'Client not found' });
    res.json({ ok: true, client });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// For clients that predate the login registry, or whose login creation
// failed at create-time (see bpoCreateClient). No-op if a login already
// exists — returns { alreadyExisted: true } rather than erroring.
app.post('/api/bpo/clients/:id/backfill-login', requireRole(BPO_MANAGE_ROLES), async (req, res) => {
  try {
    const result = await tsmLedger.bpoBackfillClientLogin(req.params.id, req.tsmSession.label || req.tsmSession.role);
    res.json({ ok: true, ...result });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// Lightweight client list for the war-room's CLIENT selector (2026-08-29).
// Deliberately separate from /api/bpo/clients (full management list, likely
// BPO_MANAGE_ROLES-gated with more fields than a dropdown needs) -- any
// internal role working a case needs to attribute it to a client, not just
// managers. Returns only id/name, active clients only, so the dropdown
// doesn't fill up with closed accounts. This is the fix for the gap where
// bpo-war-room.html never set clientId at all, leaving every case created
// through the real UI with clientId: null end to end (the sticky-clientId
// fix in bpoUpsertWorkItem above only preserves a value once one exists --
// it doesn't create one).
app.get('/api/bpo/client-directory', requireRole(BPO_INTERNAL_ROLES), async (req, res) => {
  try {
    const clients = await tsmLedger.bpoListClients({ status: 'active' });
    res.json({ ok: true, clients: clients.map(c => ({ id: c.id, name: c.name })) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Work items: any internal role can create/advance one (that's the normal
// flow of working a case through the war room), not just managers. A
// client-role session may only read — never create/advance (still gated
// to BPO_INTERNAL_ROLES below) — and only its own clientId's items: a
// client-supplied ?clientId= query is ignored in favor of the session's
// own clientId, so a client account can't page through another account's
// work items just by changing the query string.
app.get('/api/bpo/work-items', requireRole(BPO_CLIENT_VIEW_ROLES), async (req, res) => {
  try {
    const clientId = req.tsmSession.role === 'client' ? req.tsmSession.clientId : req.query.clientId;
    const items = await tsmLedger.bpoListWorkItems({ clientId, stage: req.query.stage });
    res.json({ ok: true, workItems: items });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});


// Executive Recovery — GET returns the computed analytics package for
// this one case (same buildRecoveryPackage() engine /api/operational-os
// uses, scoped to a single caseId instead of a vertical sweep), keyed as
// `report` to match html/tsm-operational-os-executive.html's contract.
// Was previously wired to global.bpoStore.getExecutiveRecovery, a dev
// stub that always returned the same hardcoded { recoveryPlan: "Standard
// Escalation" } regardless of caseId — the same class of bug the
// /api/operational-os comment above already documents having fixed once.
app.get('/api/bpo/work-items/:caseId/executive-recovery', requireRole(BPO_CLIENT_VIEW_ROLES), async (req, res) => {
  try {
    const caseId = req.params.caseId;
    const workItem = await tsmLedger.bpoGetWorkItem(caseId);
    if (!workItem) return res.status(404).json({ ok: false, error: 'Work item not found' });

    if (req.tsmSession.role === 'client' && workItem.clientId !== req.tsmSession.clientId) {
      return res.status(404).json({ ok: false, error: 'Work item not found' });
    }

    const [bncaReports, slaEvents, notes, documents] = await Promise.all([
      tsmLedger.bpoListBncaReports({ caseId }),
      tsmLedger.bpoListSlaEvents({ caseId }),
      tsmLedger.bpoListNotes({ caseId }),
      tsmLedger.bpoListDocuments({ caseId })
    ]);

    const report = buildRecoveryPackage({
      member: {
        id: workItem.tenantId || workItem.clientId || null,
        name: workItem.clientName || workItem.tenantName || 'SMB Member'
      },
      cases: [workItem],
      bncaReports,
      slaEvents,
      notes,
      documents
    });

    res.json({ ok: true, caseId, report });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Executive Recovery — POST persists the war room's assembled package
// (situation/strategy/tabs/recovery — see bpo-executive-recovery.js) as
// a saved snapshot, distinct from the computed `report` above. Previously
// this route didn't exist at all under POST, so the war room's "save"
// action 404'd silently every time (fetchJSON only surfaces errors via
// try/catch around the whole build flow, so this failed without a
// visible error to the user).
app.post('/api/bpo/work-items/:caseId/executive-recovery', requireRole(BPO_INTERNAL_ROLES), async (req, res) => {
  try {
    const caseId = req.params.caseId;
    const workItem = await tsmLedger.bpoGetWorkItem(caseId);
    if (!workItem) return res.status(404).json({ ok: false, error: 'Work item not found' });

    const saved = await tsmLedger.bpoSaveExecutiveRecovery(
      caseId, req.body || {}, req.tsmSession.label || req.tsmSession.role
    );
    res.json({ ok: true, caseId, executiveRecoveryPackage: saved });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

app.get('/api/bpo/work-items/:caseId', requireRole(BPO_CLIENT_VIEW_ROLES), async (req, res) => {
  try {
    const item = await tsmLedger.bpoGetWorkItem(req.params.caseId);
    if (!item) return res.status(404).json({ ok: false, error: 'Work item not found' });
    // 404 (not 403) on a cross-client lookup — same "don't confirm another
    // account's caseId even exists" reasoning as the download route below.
    if (req.tsmSession.role === 'client' && item.clientId !== req.tsmSession.clientId) {
      return res.status(404).json({ ok: false, error: 'Work item not found' });
    }
    res.json({ ok: true, workItem: item });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Upsert-by-caseId — the war room calls this with the full current
// snapshot each time a case is stored/advanced (war-room -> strategist ->
// exec), same as it already does for TSM_BPO_WAR_RELAY in localStorage.
app.post('/api/bpo/work-items/:caseId', requireRole(BPO_INTERNAL_ROLES), async (req, res) => {
  try {
    const item = await tsmLedger.bpoUpsertWorkItem(req.params.caseId, req.body || {}, req.tsmSession.label || req.tsmSession.role);
    res.json({ ok: true, workItem: item });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// Cases (Universal Case Engine, Roadmap #10) — server mirror of the
// browser's TSMCaseManager (tsm_cases_v1 localStorage). Same read/write
// role split as work items above: any internal role can create/sync a
// case, client-role sessions get read-only access scoped to their own
// tenantId (a client-supplied ?tenantId= is ignored in favor of the
// session's own, same reasoning as the clientId scoping on work items).
app.get('/api/bpo/cases', requireRole(BPO_CLIENT_VIEW_ROLES), async (req, res) => {
  try {
    const tenantId = req.tsmSession.role === 'client' ? req.tsmSession.clientId : req.query.tenantId;
    const cases = await tsmLedger.bpoListCases({ vertical: req.query.vertical, tenantId, status: req.query.status });
    res.json({ ok: true, cases });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/bpo/cases/:caseId', requireRole(BPO_CLIENT_VIEW_ROLES), async (req, res) => {
  try {
    const item = await tsmLedger.bpoGetCase(req.params.caseId);
    if (!item) return res.status(404).json({ ok: false, error: 'Case not found' });
    if (req.tsmSession.role === 'client' && item.tenantId !== req.tsmSession.clientId) {
      return res.status(404).json({ ok: false, error: 'Case not found' });
    }
    res.json({ ok: true, case: item });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Upsert-by-caseId — TSMCaseManager.syncToServer() calls this with the
// full current TSMCase object on every lifecycle mutation (create,
// update, addArtifact, requestApproval, recordApproval, markExecuted),
// same "send the full snapshot" contract as the work-items upsert route.
app.post('/api/bpo/cases/:caseId', requireRole(BPO_INTERNAL_ROLES), async (req, res) => {
  try {
    const item = await tsmLedger.bpoUpsertCase(req.params.caseId, req.body || {}, req.tsmSession.label || req.tsmSession.role);
    res.json({ ok: true, case: item });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// ── Batch intake layer ──────────────────────────────────────────────────
// Persisted counterpart to the doc-search-multi ZIP/multi-file ingest
// flow. A batch is created once, before the client's existing per-file
// fault-isolated loop starts, then each file reports its outcome back
// via the /documents route — same internal-role gating as the case
// routes above, since this is ingest-pipeline bookkeeping, not something
// a 'client' session creates or reads directly.
app.post('/api/bpo/batches', requireRole(BPO_INTERNAL_ROLES), async (req, res) => {
  try {
    const batch = await tsmLedger.batchCreate(req.body || {}, req.tsmSession.label || req.tsmSession.role);
    res.json({ ok: true, batch });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

app.get('/api/bpo/batches', requireRole(BPO_INTERNAL_ROLES), async (req, res) => {
  try {
    const batches = await tsmLedger.batchList({
      vertical: req.query.vertical, tenantId: req.query.tenantId, status: req.query.status,
      limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
    });
    res.json({ ok: true, batches });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/bpo/batches/:batchId', requireRole(BPO_INTERNAL_ROLES), async (req, res) => {
  try {
    const batch = await tsmLedger.batchGet(req.params.batchId);
    if (!batch) return res.status(404).json({ ok: false, error: 'Batch not found' });
    res.json({ ok: true, batch });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Called once per file from the existing fault-isolated loop — ok:true
// with a caseId when the file was classified and linked into the Case
// Engine, ok:false with no caseId for the loop's existing skip/`continue`
// path. Whichever finishes last flips the batch to 'complete' server-side.
app.post('/api/bpo/batches/:batchId/documents', requireRole(BPO_INTERNAL_ROLES), async (req, res) => {
  try {
    const batch = await tsmLedger.batchRecordDocument(
      req.params.batchId,
      { caseId: req.body && req.body.caseId, ok: !(req.body && req.body.ok === false) },
      req.tsmSession.label || req.tsmSession.role
    );
    res.json({ ok: true, batch });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

app.get('/api/bpo/batches/:batchId/summary', requireRole(BPO_INTERNAL_ROLES), async (req, res) => {
  try {
    const summary = await tsmLedger.batchSummary(req.params.batchId);
    res.json({ ok: true, summary });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── SMB Member layer (Roadmap "3-member demo") ─────────────────────────
// A Member is a cross-vertical demo tenant; its id doubles as the
// tenantId the Construction/Healthcare/Mortgage exec portals tag new
// cases with via html/shared/tsm-active-member.js. Same internal-role
// gating as the rest of BPO/member-facing admin routes — this manages
// tenants, not something a 'client' session should be listing/creating.
app.get('/api/members', requireRole(BPO_INTERNAL_ROLES), async (req, res) => {
  try {
    const members = await tsmLedger.memberList();
    res.json({ ok: true, members });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/members', requireRole(BPO_MANAGE_ROLES), async (req, res) => {
  try {
    const member = await tsmLedger.memberCreate(req.body || {}, req.tsmSession.label || req.tsmSession.role);
    res.json({ ok: true, member });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

app.get('/api/members/:id', requireRole(BPO_INTERNAL_ROLES), async (req, res) => {
  try {
    const member = await tsmLedger.memberGet(req.params.id);
    if (!member) return res.status(404).json({ ok: false, error: 'Member not found' });
    res.json({ ok: true, member });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/members/:id/summary', requireRole(BPO_INTERNAL_ROLES), async (req, res) => {
  try {
    const member = await tsmLedger.memberGet(req.params.id);
    if (!member) return res.status(404).json({ ok: false, error: 'Member not found' });
    const summary = await tsmLedger.memberCaseSummary(req.params.id);
    res.json({ ok: true, summary });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/bpo/audit-logs', requireRole(BPO_MANAGE_ROLES), async (req, res) => {
  try {
    const logs = await tsmLedger.bpoListAuditLogs({
      entityType: req.query.entityType,
      entityId: req.query.entityId,
      limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
    });
    res.json({ ok: true, auditLogs: logs });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Notes — append-only, any internal role can add one working a case;
// same list-scoped-by-caseId pattern as audit logs above.
app.get('/api/bpo/work-items/:caseId/notes', requireRole(BPO_INTERNAL_ROLES), async (req, res) => {
  try {
    const notes = await tsmLedger.bpoListNotes({ caseId: req.params.caseId });
    res.json({ ok: true, notes });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/bpo/work-items/:caseId/notes', requireRole(BPO_INTERNAL_ROLES), async (req, res) => {
  try {
    const note = await tsmLedger.bpoAddNote(
      req.params.caseId,
      req.body || {},
      req.tsmSession.label || req.tsmSession.role
    );
    res.json({ ok: true, note });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// SLA events — read-only from routes; only bpoUpsertWorkItem writes these,
// on every open/advance/resolve. Client-role reads are scoped the same way
// as work items above.
app.get('/api/bpo/work-items/:caseId/sla-events', requireRole(BPO_CLIENT_VIEW_ROLES), async (req, res) => {
  try {
    if (req.tsmSession.role === 'client') {
      const item = await tsmLedger.bpoGetWorkItem(req.params.caseId);
      if (!item || item.clientId !== req.tsmSession.clientId) {
        return res.status(404).json({ ok: false, error: 'Work item not found' });
      }
    }
    const events = await tsmLedger.bpoListSlaEvents({ caseId: req.params.caseId });
    res.json({ ok: true, slaEvents: events });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/bpo/sla-events', requireRole(BPO_CLIENT_VIEW_ROLES), async (req, res) => {
  try {
    const clientId = req.tsmSession.role === 'client' ? req.tsmSession.clientId : req.query.clientId;
    const events = await tsmLedger.bpoListSlaEvents({
      clientId,
      limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
    });
    res.json({ ok: true, slaEvents: events });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// BNCA / AI-output reports — append-only capture of what the model
// actually returned, not just the latest bpo_work_items.payload snapshot.
app.get('/api/bpo/work-items/:caseId/bnca-reports', requireRole(BPO_INTERNAL_ROLES), async (req, res) => {
  try {
    const reports = await tsmLedger.bpoListBncaReports({ caseId: req.params.caseId });
    res.json({ ok: true, bncaReports: reports });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/bpo/work-items/:caseId/bnca-reports', requireRole(BPO_INTERNAL_ROLES), async (req, res) => {
  try {
    const report = await tsmLedger.bpoSaveBncaReport(
      req.params.caseId,
      req.body || {},
      req.tsmSession.label || req.tsmSession.role
    );
    res.json({ ok: true, bncaReport: report });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// Documents — Phase 3 of docs/BPO_PRODUCTION_READINESS.md. Same
// BPO_INTERNAL_ROLES/BPO_MANAGE_ROLES split as the rest of BPO: any
// internal role can upload/list/download while working a case, delete is
// manager+ only (mirrors client management above). Backed by
// tsm-ledger-service.js's manual chunked storage (see that file's header
// comment for why this isn't the driver's built-in GridFS). 8MB cap
// enforced by multer here AND re-checked in bpoStoreDocument.
const bpoDocUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

// multer's own limit/parsing errors (e.g. LIMIT_FILE_SIZE for an
// over-8MB file) call next(err) rather than reaching the async route
// handler below, which otherwise means they fall all the way through to
// the generic [TSM GLOBAL ERROR] handler and come back as an opaque 500
// — confirmed via scripts/stress-test/run-stress-test.js, which expects
// an oversize upload to be a clean 4xx, not a 500. Wrapping multer here
// catches its MulterError specifically and responds the same shape
// (`{ ok: false, error }`) as every other error path on this route,
// with a 413 (Payload Too Large) instead of a generic 400 so clients can
// tell "too big" apart from a validation problem.
function bpoDocUploadHandled(req, res, next) {
  bpoDocUpload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ ok: false, error: 'file exceeds 8MB upload limit' });
    }
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    return next(err);
  });
}

app.post('/api/bpo/work-items/:caseId/documents', requireRole(BPO_INTERNAL_ROLES), bpoDocUploadHandled, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file uploaded' });

    // Metadata extraction (docs/BPO_PRODUCTION_READINESS.md Phase 3, "Add
    // metadata extraction" — was previously not wired). Reuses the same
    // extractDocText()/isSupported() helpers routes/doc-router.js already
    // exposes at POST /api/doc-router/extract-file, so pdf/docx/xlsx
    // parsing logic lives in exactly one place. Best-effort: an unsupported
    // file type or an extraction failure must never block the upload
    // itself — the document is still stored, just without extracted text.
    let extractedText = null;
    let extractionError = null;
    if (docRouter.isSupported(req.file.originalname)) {
      try {
        extractedText = await docRouter.extractDocText(req.file);
      } catch (extractErr) {
        extractionError = extractErr.message || 'extraction_failed';
        console.error(`[bpo documents] extraction failed for ${req.file.originalname}:`, extractionError);
      }
    }

    const meta = await tsmLedger.bpoStoreDocument({
      caseId: req.params.caseId,
      clientId: req.body && req.body.clientId,
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
      buffer: req.file.buffer,
      extractedText,
      extractionError,
    }, req.tsmSession.label || req.tsmSession.role);
    res.json({ ok: true, document: meta });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

app.get('/api/bpo/work-items/:caseId/documents', requireRole(BPO_CLIENT_VIEW_ROLES), async (req, res) => {
  try {
    if (req.tsmSession.role === 'client') {
      const item = await tsmLedger.bpoGetWorkItem(req.params.caseId);
      if (!item || item.clientId !== req.tsmSession.clientId) {
        // Server-side-only diagnosis of which of the two 404 causes this
        // was -- a missing record vs. a clientId mismatch -- without
        // changing the client-facing response. Deliberately still a bare
        // 404 either way (same don't-let-a-client-distinguish-cross-tenant-
        // from-missing reasoning as the neighboring download route).
        if (!item) {
          console.warn(`[bpo-documents-404] caseId=${req.params.caseId} not found`);
        } else {
          console.warn(`[bpo-documents-404] caseId=${req.params.caseId} clientId mismatch: item.clientId=${item.clientId} session.clientId=${req.tsmSession.clientId}`);
        }
        return res.status(404).json({ ok: false, error: 'Work item not found' });
      }
    }
    const documents = await tsmLedger.bpoListDocuments({ caseId: req.params.caseId });
    res.json({ ok: true, documents });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Download is deliberately its own top-level route (not nested under
// work-items/:caseId) since a docId is already globally unique and the
// client only needs to remember the docId from the list call above, not
// re-thread caseId through every download link. That also means the
// clientId check has to happen here, against the stored document meta,
// rather than relying on a caseId param that this route doesn't have.
app.get('/api/bpo/documents/:docId/download', requireRole(BPO_CLIENT_VIEW_ROLES), async (req, res) => {
  try {
    const result = await tsmLedger.bpoGetDocumentBuffer(req.params.docId, req.tsmSession.label || req.tsmSession.role);
    if (!result) return res.status(404).json({ ok: false, error: 'Document not found' });
    // 404 rather than 403 — a client account shouldn't be able to tell a
    // cross-client docId apart from one that simply doesn't exist.
    if (req.tsmSession.role === 'client' && result.meta.clientId !== req.tsmSession.clientId) {
      return res.status(404).json({ ok: false, error: 'Document not found' });
    }
    res.set('Content-Type', result.meta.mimetype || 'application/octet-stream');
    res.set('Content-Disposition', `attachment; filename="${result.meta.filename.replace(/"/g, '')}"`);
    res.send(result.buffer);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Extracted text, separate from the raw-bytes download above, so callers
// that just want searchable/summarizable text (e.g. a future case-analysis
// step) don't have to pull the full binary and re-run extraction
// client-side. Same client/cross-client 404-not-403 rule as download.
app.get('/api/bpo/documents/:docId/text', requireRole(BPO_CLIENT_VIEW_ROLES), async (req, res) => {
  try {
    const result = await tsmLedger.bpoGetDocumentText(req.params.docId, req.tsmSession.label || req.tsmSession.role);
    if (!result) return res.status(404).json({ ok: false, error: 'Document not found' });
    if (req.tsmSession.role === 'client' && result.meta.clientId !== req.tsmSession.clientId) {
      return res.status(404).json({ ok: false, error: 'Document not found' });
    }
    res.json({ ok: true, text: result.text, extractionError: result.meta.extractionError || null });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.delete('/api/bpo/documents/:docId', requireRole(BPO_MANAGE_ROLES), async (req, res) => {
  try {
    const updated = await tsmLedger.bpoDeleteDocument(req.params.docId, req.tsmSession.label || req.tsmSession.role);
    if (!updated) return res.status(404).json({ ok: false, error: 'Document not found' });
    res.json({ ok: true, document: updated });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── BPO REPORTING (Phase 4) ─────────────────────────────────────────────────
// Internal-only (BPO_MANAGE_ROLES would be too narrow — any internal role
// working cases has a reason to pull these, same as the read routes above).
// Deliberately limited to data the ledger already computes/stores:
//   - WIP + SLA reports are a straight columnar dump of bpo_work_items /
//     bpo_sla_events, not a new metric.
//   - The executive rollup is counts/averages over that same data.
// No breach/leakage/recovery figures here — there's no defined SLA
// threshold anywhere in this codebase (checked: no slaDays/SLA_THRESHOLD
// constant exists), so a "breached" flag would mean inventing a number
// that isn't mine to set. ageHoursAtEvent/slaAgeHours are reported as-is;
// what counts as a breach is a business decision for someone with
// authority over client SLAs, not something to guess at here.

const BPO_REPORT_ROLES = BPO_INTERNAL_ROLES;

// Minimal CSV serializer — no new dependency for a handful of flat report
// columns. Quotes any value containing a comma/quote/newline and doubles
// embedded quotes, per RFC 4180.
//
// Columns like caseId/clientId/owner ultimately trace back to free-text
// fields the war-room UI lets internal staff type (bpoUpsertWorkItem's
// `owner`, bpoCreateClient's `name`/`contactName`, etc.) — not just IDs the
// server generated. A value starting with =, +, -, @, or a tab/CR is a
// formula prefix in Excel/Sheets/LibreOffice; opening a report where a case
// owner is literally named `=HYPERLINK("http://evil","click")` or
// `=cmd|'/C calc'!A1` hands that formula execution to whoever opens the
// download. Prefixing with a leading apostrophe is the standard mitigation
// (OWASP CSV Injection) — spreadsheet apps render the cell as literal text
// instead of evaluating it, and the escaped quoting above still applies on
// top since the apostrophe doesn't change whether the value needs quoting.
function bpoToCsv(rows, columns) {
  const FORMULA_PREFIX = /^[=+\-@\t\r]/;
  const esc = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (FORMULA_PREFIX.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map(c => esc(row[c])).join(','));
  return lines.join('\n');
}

function bpoSendReport(res, filenameBase, rows, columns, format) {
  if (format === 'csv') {
    res.set('Content-Type', 'text/csv');
    res.set('Content-Disposition', `attachment; filename="${filenameBase}.csv"`);
    return res.send(bpoToCsv(rows, columns));
  }
  res.json({ ok: true, rows });
}

const BPO_WIP_REPORT_COLUMNS = [
  'caseId', 'clientId', 'vertical', 'stage', 'status', 'priority',
  'owner', 'dueDate', 'slaAgeHours', 'createdAt', 'updatedAt',
];

app.get('/api/bpo/reports/wip', requireRole(BPO_REPORT_ROLES), async (req, res) => {
  try {
    const items = await tsmLedger.bpoListWorkItems({
      clientId: req.query.clientId,
      stage: req.query.stage,
      limit: req.query.limit ? parseInt(req.query.limit, 10) : 2000,
    });
    bpoSendReport(res, 'bpo-wip-report', items, BPO_WIP_REPORT_COLUMNS, req.query.format);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

const BPO_SLA_REPORT_COLUMNS = [
  'caseId', 'clientId', 'vertical', 'type', 'fromStage', 'toStage',
  'status', 'ageHoursAtEvent', 'slaThresholdHours', 'breached', 'actor', 'ts',
];

// slaThresholdHours/breached are joined in from bpo_clients.slaThresholdHours
// (Phase 5 admin controls), not stored on the event itself — a client's
// threshold can change after the event was recorded, and the report should
// always reflect the client's current plan, not a snapshot from event time.
// Both columns come back null/empty for any client with no threshold set,
// same as before this existed.
app.get('/api/bpo/reports/sla', requireRole(BPO_REPORT_ROLES), async (req, res) => {
  try {
    const events = await tsmLedger.bpoListSlaEvents({
      caseId: req.query.caseId,
      clientId: req.query.clientId,
      limit: req.query.limit ? parseInt(req.query.limit, 10) : 5000,
    });

    const clientIds = [...new Set(events.map(e => e.clientId).filter(Boolean))];
    const thresholdByClient = {};
    await Promise.all(clientIds.map(async (id) => {
      const c = await tsmLedger.bpoGetClient(id);
      thresholdByClient[id] = c && Number.isFinite(c.slaThresholdHours) ? c.slaThresholdHours : null;
    }));

    const rows = events.map(ev => {
      const threshold = ev.clientId ? thresholdByClient[ev.clientId] : null;
      const hasAge = Number.isFinite(ev.ageHoursAtEvent);
      return {
        ...ev,
        slaThresholdHours: threshold,
        breached: threshold != null && hasAge ? ev.ageHoursAtEvent > threshold : null,
      };
    });

    bpoSendReport(res, 'bpo-sla-report', rows, BPO_SLA_REPORT_COLUMNS, req.query.format);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Executive rollup — aggregate KPIs over current work items + recent SLA
// events. JSON only (this feeds a dashboard, not a download). Counts and
// an average are the full extent of the "math" here — nothing that
// requires a policy decision to compute.
app.get('/api/bpo/reports/executive-rollup', requireRole(BPO_REPORT_ROLES), async (req, res) => {
  try {
    const [items, clients, slaEvents] = await Promise.all([
      tsmLedger.bpoListWorkItems({ clientId: req.query.clientId, limit: 5000 }),
      tsmLedger.bpoListClients({}),
      tsmLedger.bpoListSlaEvents({ clientId: req.query.clientId, limit: 5000 }),
    ]);

    const byStage = {};
    const byStatus = {};
    const byPriority = {};
    let openAgeSum = 0;
    let openCount = 0;
    for (const item of items) {
      byStage[item.stage] = (byStage[item.stage] || 0) + 1;
      byStatus[item.status] = (byStatus[item.status] || 0) + 1;
      byPriority[item.priority] = (byPriority[item.priority] || 0) + 1;
      if (item.status !== 'resolved' && Number.isFinite(item.slaAgeHours)) {
        openAgeSum += item.slaAgeHours;
        openCount += 1;
      }
    }

    const slaEventsByType = {};
    for (const ev of slaEvents) slaEventsByType[ev.type] = (slaEventsByType[ev.type] || 0) + 1;

    res.json({
      ok: true,
      rollup: {
        totalWorkItems: items.length,
        byStage,
        byStatus,
        byPriority,
        avgOpenAgeHours: openCount ? Math.round((openAgeSum / openCount) * 100) / 100 : null,
        activeClients: clients.filter(c => c.status === 'active').length,
        totalClients: clients.length,
        slaEventsByType,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Client-facing rollup (Phase 4). Latorrey's call on scope (2026-08-24):
// full rollup -- same WIP/SLA counts as the internal executive-rollup
// above, plus a client-safe case-level summary list -- available both
// on-demand here and as a generated monthly snapshot (see the two
// routes and scripts/generate-bpo-client-monthly-reports.js below).
// clientId is locked to the session for a client-role caller, same
// pattern as every other client-scoped route in this file -- a client
// account cannot pass ?clientId= to see another client's numbers.
// A client session linked to a cross-vertical Member (tenantId set via
// POST /api/admin/clients/:id/link-member below) gets the Member-scoped
// rollup — real cases across every vertical that tenantId is tagged on,
// not just this one clientId's BPO work-item pipeline. Every client
// without a tenantId link (the default, unchanged for all existing
// clients) gets exactly the same single-clientId rollup as before. Staff/
// admin querying by ?clientId= are unaffected either way — this branch
// only applies to an actual 'client' session.
app.get('/api/bpo/reports/client-rollup', requireRole(BPO_CLIENT_VIEW_ROLES), async (req, res) => {
  try {
    if (req.tsmSession.role === 'client' && req.tsmSession.tenantId) {
      const rollup = await tsmLedger.bpoBuildMemberClientRollup(req.tsmSession.tenantId);
      return res.json({ ok: true, rollup });
    }
    const clientId = req.tsmSession.role === 'client' ? req.tsmSession.clientId : req.query.clientId;
    if (!clientId) return res.status(400).json({ ok: false, error: 'clientId is required' });
    const rollup = await tsmLedger.bpoBuildClientRollup(clientId);
    res.json({ ok: true, rollup });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Monthly snapshots -- the persisted, point-in-time artifacts a client
// can look back at (vs. client-rollup above, which is always "right
// now"). Generated by scripts/generate-bpo-client-monthly-reports.js,
// not by this route -- this only reads what's already been saved.
// ?period=YYYY-MM for a specific month; omitted returns the most recent
// snapshot (or a 404 if none has been generated yet for this client).
app.get('/api/bpo/reports/client-monthly', requireRole(BPO_CLIENT_VIEW_ROLES), async (req, res) => {
  try {
    const clientId = req.tsmSession.role === 'client' ? req.tsmSession.clientId : req.query.clientId;
    if (!clientId) return res.status(400).json({ ok: false, error: 'clientId is required' });

    if (req.query.period) {
      const report = await tsmLedger.bpoGetClientMonthlyReport(clientId, req.query.period);
      if (!report) return res.status(404).json({ ok: false, error: 'No report found for that period' });
      return res.json({ ok: true, report });
    }

    const reports = await tsmLedger.bpoListClientMonthlyReports({ clientId, limit: 1 });
    if (!reports.length) return res.status(404).json({ ok: false, error: 'No monthly report has been generated yet' });
    res.json({ ok: true, report: reports[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// List of all past monthly snapshots for a client (periods only, not
// the full rollup body each -- callers wanting one period's full detail
// use ?period= on the route above). Internal-role only: a client sees
// their own current+past reports one at a time via the route above, but
// browsing "every period on file" isn't something the client role needs.
app.get('/api/bpo/reports/client-monthly/history', requireRole(BPO_REPORT_ROLES), async (req, res) => {
  try {
    if (!req.query.clientId) return res.status(400).json({ ok: false, error: 'clientId is required' });
    const reports = await tsmLedger.bpoListClientMonthlyReports({
      clientId: req.query.clientId,
      limit: req.query.limit ? parseInt(req.query.limit, 10) : 24,
    });
    res.json({ ok: true, periods: reports.map(r => ({ periodLabel: r.periodLabel, generatedAt: r.generatedAt })) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Case Engine (Roadmap #10) summary — same shape family as the work-item
// executive-rollup above, but scoped to bpo_cases so an exec portal can
// show real case-queue numbers server-side instead of only whatever one
// browser's localStorage happens to have. `vertical` isn't BPO-specific —
// healthcare, and any future vertical wired the same way, all write into
// this one collection, so ?vertical=healthcare works today with no
// server-side change.
app.get('/api/bpo/reports/case-summary', requireRole(BPO_REPORT_ROLES), async (req, res) => {
  try {
    const tenantId = req.tsmSession.role === 'client' ? req.tsmSession.clientId : req.query.tenantId;
    const cases = await tsmLedger.bpoListCases({ vertical: req.query.vertical, tenantId, limit: 5000 });

    const byStatus = {};
    const byPriority = {};
    const byApprovalStatus = {};
    let exposureTotal = 0;
    let exposureCount = 0;
    let humanReviewRequiredCount = 0;
    for (const c of cases) {
      byStatus[c.status] = (byStatus[c.status] || 0) + 1;
      byPriority[c.priority] = (byPriority[c.priority] || 0) + 1;
      byApprovalStatus[c.approvalStatus] = (byApprovalStatus[c.approvalStatus] || 0) + 1;
      if (typeof c.exposure === 'number') { exposureTotal += c.exposure; exposureCount += 1; }
      if (c.humanReviewRequired) humanReviewRequiredCount += 1;
    }

    res.json({
      ok: true,
      summary: {
        vertical: req.query.vertical || 'all',
        totalCases: cases.length,
        byStatus,
        byPriority,
        byApprovalStatus,
        exposureTotal,
        exposureCount,
        humanReviewRequiredCount,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// TSM Operational OS — universal cross-vertical executive recovery.
// This is the vertical-dispatch entry point: today only 'bpo' has a real
// adapter (below), pulling from the same tsmLedger.bpo* methods every
// other BPO route already uses. (Earlier runs of this endpoint showed 0
// exposure / 0 cases regardless of caseId because it was wired to a dev
// stub returning hardcoded fake data — fixed; the stub itself, and the
// /api/bpo/work-items/:caseId/executive-recovery route that had the same
// problem, have both since been removed/rewired.) Every other vertical
// returns 501 rather than a fabricated empty package, pending its own
// real adapter.
app.get('/api/operational-os', requireRole(BPO_REPORT_ROLES), async (req, res) => {
  const { caseId, vertical, tenantId, clientId } = req.query;
  const normalizedVertical = (vertical || '').toLowerCase();

  if (!caseId) {
    return res.status(400).json({
      ok: false,
      operationalOS: true,
      error: 'caseId is required'
    });
  }

  try {
    if (normalizedVertical !== 'bpo') {
      return res.status(501).json({
        ok: false,
        operationalOS: true,
        error: 'Operational OS vertical adapter not implemented',
        vertical: normalizedVertical,
        caseId
      });
    }

    const workItem = await tsmLedger.bpoGetWorkItem(caseId);
    if (!workItem) {
      return res.status(404).json({
        ok: false,
        operationalOS: true,
        error: 'BPO work item not found',
        caseId
      });
    }

    if (req.tsmSession.role === 'client' && workItem.clientId !== req.tsmSession.clientId) {
      return res.status(404).json({
        ok: false,
        operationalOS: true,
        error: 'BPO work item not found',
        caseId
      });
    }

    const [bncaReports, slaEvents, notes, documents] = await Promise.all([
      tsmLedger.bpoListBncaReports({ caseId }),
      tsmLedger.bpoListSlaEvents({ caseId }),
      tsmLedger.bpoListNotes({ caseId }),
      tsmLedger.bpoListDocuments({ caseId })
    ]);

    const result = buildRecoveryPackage({
      member: {
        id: tenantId || clientId || workItem.tenantId || workItem.clientId || null,
        name: workItem.clientName || workItem.tenantName || 'SMB Member'
      },
      cases: [workItem],
      bncaReports,
      slaEvents,
      notes,
      documents
    });

    return res.json({
      ok: true,
      operationalOS: true,
      vertical: normalizedVertical,
      caseId,
      tenantId: tenantId || workItem.tenantId || null,
      clientId: clientId || workItem.clientId || null,
      package: result
    });
  } catch (error) {
    console.error('[TSM Operational OS]', error);

    return res.status(500).json({
      ok: false,
      operationalOS: true,
      error: 'Operational OS recovery package failed',
      message: error.message
    });
  }
});

// ── CONCIERGE TRANSPORT (quotes / bookings / missions) ──────────────────────
// Routes sit on top of server/services/concierge-transport-adapter.js
// (defaultRouter, provider-neutral) + server/tsm-ledger-service.js
// (concierge_missions / concierge_status_events collections). Same
// BPO_INTERNAL_ROLES gate as BPO above — these are internal ops endpoints,
// not guest-facing. Quotes are stateless (no persistence, no auth beyond
// internal-role since nothing is committed yet); booking/status/cancel all
// write through to a mission record so the war room -> strategist -> exec
// chain has a durable record instead of relying on the adapter's in-memory
// booking map, which is lost on every server restart.

app.post('/api/concierge/quotes', requireRole(BPO_INTERNAL_ROLES), async (req, res) => {
  try {
    const { quotes, errors } = await conciergeRouter.getQuotes(req.body || {});
    res.json({ ok: true, quotes, errors });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// Books a quote, then immediately persists the resulting booking as a
// concierge_missions doc (status: 'confirmed') so it survives a restart.
app.post('/api/concierge/bookings', requireRole(BPO_INTERNAL_ROLES), async (req, res) => {
  try {
    const { quoteId, guestName, propertyId, vertical, ...bookingDetails } = req.body || {};
    if (!quoteId) return res.status(400).json({ ok: false, error: 'quoteId required' });
    const booking = await conciergeRouter.book(quoteId, bookingDetails);
    const mission = await tsmLedger.conciergeUpsertMission(booking.bookingId, {
      provider: booking.provider, quoteId: booking.quoteId, status: booking.status,
      confirmationCode: booking.confirmationCode, request: booking.request, driver: booking.driver,
      priceEstimate: booking.quote ? booking.quote.priceEstimate : undefined,
      guestName, propertyId, vertical,
    }, req.tsmSession.label || req.tsmSession.role);
    res.json({ ok: true, booking, mission });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

app.get('/api/concierge/missions', requireRole(BPO_INTERNAL_ROLES), async (req, res) => {
  try {
    const missions = await tsmLedger.conciergeListMissions({
      status: req.query.status, provider: req.query.provider, propertyId: req.query.propertyId,
    });
    res.json({ ok: true, missions });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/concierge/missions/:bookingId', requireRole(BPO_INTERNAL_ROLES), async (req, res) => {
  try {
    const mission = await tsmLedger.conciergeGetMission(req.params.bookingId);
    if (!mission) return res.status(404).json({ ok: false, error: 'Mission not found' });
    res.json({ ok: true, mission });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Re-fetches live status from the provider (not just the last-persisted
// mission doc), then re-upserts -- this is what a "refresh" click on the
// war room should hit so status isn't stale between webhook/poll events.
app.get('/api/concierge/missions/:bookingId/refresh', requireRole(BPO_INTERNAL_ROLES), async (req, res) => {
  try {
    const booking = await conciergeRouter.status(req.params.bookingId);
    const mission = await tsmLedger.conciergeUpsertMission(booking.bookingId, {
      provider: booking.provider, quoteId: booking.quoteId, status: booking.status,
      confirmationCode: booking.confirmationCode, request: booking.request, driver: booking.driver,
    }, req.tsmSession.label || req.tsmSession.role);
    res.json({ ok: true, booking, mission });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

app.post('/api/concierge/missions/:bookingId/cancel', requireRole(BPO_INTERNAL_ROLES), async (req, res) => {
  try {
    const result = await conciergeRouter.cancel(req.params.bookingId);
    const mission = await tsmLedger.conciergeUpsertMission(req.params.bookingId, {
      status: result.status, note: 'cancelled via exec/strategist action',
    }, req.tsmSession.label || req.tsmSession.role);
    res.json({ ok: true, result, mission });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// Mock-provider only -- lets the demo/war-room simulate a driver-assigned
// / en_route / arrived / picked_up / completed timeline without a real
// provider webhook. See MockTransportProvider.simulateEvent in the adapter.
app.post('/api/concierge/missions/:bookingId/simulate-event', requireRole(BPO_INTERNAL_ROLES), async (req, res) => {
  try {
    const { status, note } = req.body || {};
    if (!status) return res.status(400).json({ ok: false, error: 'status required' });
    const result = await conciergeRouter.simulateEvent(req.params.bookingId, status, note);
    const mission = await tsmLedger.conciergeUpsertMission(req.params.bookingId, {
      status: result.status, note,
    }, req.tsmSession.label || req.tsmSession.role);
    res.json({ ok: true, result, mission });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

app.get('/api/concierge/missions/:bookingId/status-events', requireRole(BPO_INTERNAL_ROLES), async (req, res) => {
  try {
    const events = await tsmLedger.conciergeListStatusEvents({ bookingId: req.params.bookingId });
    res.json({ ok: true, statusEvents: events });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── PM COPILOT (units / work orders / leases / vendor compliance) ──────────
// Standalone vertical, own role gate -- not layered on BPO_INTERNAL_ROLES
// since PM Copilot is a separate product line, not a BPO feature. Same
// internal-ops-only reasoning as BPO/Concierge: units/leases/vendor data
// isn't tenant- or guest-facing.
const PM_INTERNAL_ROLES = ['admin', 'manager', 'analyst'];

// Overlays persisted lifecycle status (pm_action_status, keyed by action.id)
// onto a freshly-built action-engine action. buildActionQueue() always seeds
// a fresh queue at status: OPEN with no memory of prior transitions -- this
// is what lets a reload of /api/pm/intelligence-v3 show ACKNOWLEDGED/
// IN_PROGRESS/RESOLVED/VERIFIED instead of resetting every action to OPEN.
async function resolvePmAction(action) {
  try {
    const persisted = await tsmLedger.pmGetActionStatus(action.id);
    if (!persisted) return action;
    return {
      ...action,
      status: persisted.status || action.status,
      updatedAt: persisted.updatedAt || action.updatedAt,
      verification: persisted.verification || action.verification,
    };
  } catch (err) {
    console.warn('[PM Action Overlay] failed to resolve', action.id, err.message);
    return action;
  }
}
const PM_MANAGE_ROLES = ['admin', 'manager'];

app.get('/api/pm/units', requireRole(PM_INTERNAL_ROLES), async (req, res) => {
  try {
    const units = await tsmLedger.pmListUnits({ propertyId: req.query.propertyId, status: req.query.status });
    res.json({ ok: true, units });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/pm/units/:unitId', requireRole(PM_INTERNAL_ROLES), async (req, res) => {
  try {
    const unit = await tsmLedger.pmGetUnit(req.params.unitId);
    if (!unit) return res.status(404).json({ ok: false, error: 'Unit not found' });
    res.json({ ok: true, unit });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Unit roster (address, rent, occupancy status) is admin/manager territory,
// same split BPO uses for clients vs. work items.
app.post('/api/pm/units/:unitId', requireRole(PM_MANAGE_ROLES), async (req, res) => {
  try {
    const unit = await tsmLedger.pmUpsertUnit(req.params.unitId, req.body || {}, req.tsmSession.label || req.tsmSession.role);
    res.json({ ok: true, unit });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// Work orders -- any internal role can create/advance one, same as BPO
// work items; that's the normal flow of working a ticket through the
// war room, not a manager-only action.
app.get('/api/pm/work-orders', requireRole(PM_INTERNAL_ROLES), async (req, res) => {
  try {
    const workOrders = await tsmLedger.pmListWorkOrders({ unitId: req.query.unitId, stage: req.query.stage });
    res.json({ ok: true, workOrders });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/pm/work-orders/:workOrderId', requireRole(PM_INTERNAL_ROLES), async (req, res) => {
  try {
    const workOrder = await tsmLedger.pmGetWorkOrder(req.params.workOrderId);
    if (!workOrder) return res.status(404).json({ ok: false, error: 'Work order not found' });
    res.json({ ok: true, workOrder });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/pm/work-orders/:workOrderId', requireRole(PM_INTERNAL_ROLES), async (req, res) => {
  try {
    const workOrder = await tsmLedger.pmUpsertWorkOrder(req.params.workOrderId, req.body || {}, req.tsmSession.label || req.tsmSession.role);
    res.json({ ok: true, workOrder });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

app.get('/api/pm/work-orders/:workOrderId/status-events', requireRole(PM_INTERNAL_ROLES), async (req, res) => {
  try {
    const statusEvents = await tsmLedger.pmListStatusEvents({ entityType: 'work_order', entityId: req.params.workOrderId });
    res.json({ ok: true, statusEvents });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Leases -- renewal decisions/notice handling are admin/manager, same as
// BPO client management vs. general case work.
app.get('/api/pm/leases', requireRole(PM_INTERNAL_ROLES), async (req, res) => {
  try {
    const leases = await tsmLedger.pmListLeases({ unitId: req.query.unitId, stage: req.query.stage });
    res.json({ ok: true, leases });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/pm/leases/:leaseId', requireRole(PM_INTERNAL_ROLES), async (req, res) => {
  try {
    const lease = await tsmLedger.pmGetLease(req.params.leaseId);
    if (!lease) return res.status(404).json({ ok: false, error: 'Lease not found' });
    res.json({ ok: true, lease });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/pm/leases/:leaseId', requireRole(PM_MANAGE_ROLES), async (req, res) => {
  try {
    const lease = await tsmLedger.pmUpsertLease(req.params.leaseId, req.body || {}, req.tsmSession.label || req.tsmSession.role);
    res.json({ ok: true, lease });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// Vendors -- compliance status (insurance/license) updates are
// admin/manager, same reasoning as lease management above.
app.get('/api/pm/vendors', requireRole(PM_INTERNAL_ROLES), async (req, res) => {
  try {
    const vendors = await tsmLedger.pmListVendors({ trade: req.query.trade, stage: req.query.stage });
    res.json({ ok: true, vendors });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/pm/vendors/:vendorId', requireRole(PM_INTERNAL_ROLES), async (req, res) => {
  try {
    const vendor = await tsmLedger.pmGetVendor(req.params.vendorId);
    if (!vendor) return res.status(404).json({ ok: false, error: 'Vendor not found' });
    res.json({ ok: true, vendor });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/pm/vendors/:vendorId', requireRole(PM_MANAGE_ROLES), async (req, res) => {
  try {
    const vendor = await tsmLedger.pmUpsertVendor(req.params.vendorId, req.body || {}, req.tsmSession.label || req.tsmSession.role);
    res.json({ ok: true, vendor });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// AI analysis endpoint -- same shape as /api/schools/analysis and
// /api/bpo equivalents.
app.post('/api/pm/analysis', requireRole(PM_INTERNAL_ROLES), async (req, res) => {
  const { kpis, work_order_breaches, leases_expiring, vendor_flags, turnover_pipeline, context, maxTokens } = req.body || {};
  const summary = JSON.stringify({
    kpis, work_order_breaches, leases_expiring, vendor_flags, turnover_pipeline,
    counts: {
      work_order_breaches: Array.isArray(work_order_breaches) ? work_order_breaches.length : undefined,
      leases_expiring: Array.isArray(leases_expiring) ? leases_expiring.length : undefined,
      vendor_flags: Array.isArray(vendor_flags) ? vendor_flags.length : undefined,
      turnover_pipeline: Array.isArray(turnover_pipeline) ? turnover_pipeline.length : undefined,
    }
  }, null, 2);
  const prompt = `Current PM Copilot portfolio snapshot:\n${summary}\n\n` +
    (context ? `Additional context: ${context}\n\n` : '') +
    `Identify the highest-dollar-impact vacancies, the most urgent SLA-breached work orders, leases at risk of non-renewal, vendor compliance gaps blocking dispatch, and turnovers/make-ready jobs stuck past SLA. Recommend the single most important next action per item, prioritized by dollar exposure. Reference unit/work-order/lease/vendor/turnover IDs.`;
  try {
    const answer = await groqChat(SP.pm, prompt, maxTokens || 1200);
    recordVerticalMemory('pm', prompt, answer);
    return res.json({ ok: true, answer, createdAt: new Date().toISOString() });
  } catch (e) {
    console.error('PM ANALYSIS GROQ ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// This route must stay ABOVE the express.static('/', html) mount below —
// static() is registered earlier in Express's original file order and
// would otherwise match /healthcare/hc-academy/poc-html/index.html first
// (the file exists on disk under html/) and serve it with no
// Cache-Control override before this route is ever reached. Placing it
// here, right before that mount, is what actually lets the no-store
// header apply. See the comment further down by the /html/... shortcut
// route (same underlying staleness issue, same fix) for the full context.
app.get(['/healthcare/hc-academy/poc-html/index.html', '/healthcare/hc-academy/poc-html', '/healthcare/hc-academy/poc-html/'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.sendFile(path.join(dirPath, 'healthcare', 'hc-academy', 'poc-html', 'index.html'));
});
app.use('/', express.static(path.join(__dirname, 'html')));
const suites = [
  { route: '/construction-suite', dir: 'html/construction-suite', index: 'construction-hub.html' },
  { route: '/finops', dir: 'html/finops-suite', index: 'finops-presentation/index.html' },
  { route: '/healthcare', dir: 'html/healthcare', index: 'index.html' },
  { route: '/insurance', dir: 'html/tsm-insurance', index: 'ins-presentation.html' },
  { route: '/music', dir: 'html/war-rooms/music-war', index: 'index.html' },
];

// ── HEALTH & STUB ROUTES ──────────────────────────────────────────────────────
app.post('/api/re/query', validateQueryBody, async (req, res) => {
  try { const a = await groqChat(SP.mortgage, req.body.message||req.body.question||req.body.query||'', req.body.maxTokens||1024); return res.json({ ok:true, answer:a, output:a, reply:a }); }
  catch(e){ return res.status(500).json({ ok:false, error:e.message }); }
});
app.post('/api/education/query', validateQueryBody, async (req, res) => {
  try { const a = await groqChat(SP.education, req.body.message||req.body.question||req.body.query||'', req.body.maxTokens||1024); return res.json({ ok:true, answer:a, output:a, reply:a }); }
  catch(e){ return res.status(500).json({ ok:false, error:e.message }); }
});
app.post('/api/enterprise/query', validateQueryBody, async (req, res) => {
  try { const a = await groqChat(SP.enterprise, req.body.message||req.body.question||req.body.query||'', req.body.maxTokens||1024); return res.json({ ok:true, answer:a, output:a, reply:a }); }
  catch(e){ return res.status(500).json({ ok:false, error:e.message }); }
});
app.get('/health', (req, res) => res.json({ status: 'ok', v: 3 }));
app.post('/api/bpo/query', validateQueryBody, async (req, res) => {
  try {
    const sys = 'You are a BPO operations intelligence AI for TSM Command. Expert in BPO, workforce management, SLA performance, staffing ops. Be direct.';
    const msg = req.body.message || req.body.question || req.body.query || '';
    const a = await groqChat(sys, msg, req.body.maxTokens || 2200);
    return res.json({ ok: true, reply: a, answer: a, output: a, createdAt: new Date().toISOString() });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});
app.post('/api/wip/sector-ai', (req, res) => res.json({ content: 'ok' }));

// TSM FIX: hardcoded stub removed — real handler now lives in routes/hc.js
// (reads HC_NODE_STATE_FILE instead of always returning nodes_online:11).

// TSM FIX: this used to be a hardcoded stub returning {status, nodes:[...]}
// (no `state` field). It registered before `app.use(require('./routes/hc'))`
// below, so Express always matched THIS handler first and the real one in
// routes/hc.js — which reads HC_NODE_STATE_FILE and returns {ok, state,
// generatedAt} — never ran. hc-strategist's pollNodeState() (15s interval,
// plus on load) reads `data.state`, which was always undefined here, so
// every node escalation POSTed via /api/hc/nodes/:key (from the HC Academy
// PoC's "Escalate to Strategist" and elsewhere) was written to disk
// correctly but never rendered on the Strategist dashboard. Removed so the
// real handler in routes/hc.js (mounted below) is reachable.

app.get('/api/music/activity', (_req, res) => res.json({ ok: true, activity: global.MUSIC_PLATFORM.activity || [], platform: global.MUSIC_PLATFORM }));
app.get('/api/music/platform', (_req, res) => res.json({ ok: true, platform: global.MUSIC_PLATFORM }));
app.get('/executive-portal', (req, res) => res.redirect('/html/executive-portal/index.html'));
app.get('/healthcare/executive-portal', (req, res) => res.redirect('/html/executive-portal/index.html'));

// ── STATIC MOUNTS ─────────────────────────────────────────────────────────────
const dirPath = path.join(__dirname, 'html');// ── STATIC MOUNTS v2 ──

app.use('/html', express.static(path.join(__dirname, 'html'), { setHeaders: (res) => res.setHeader('Cache-Control', 'no-store') }));
// Serves config/o2c/*.json (per-industry O2C pipeline overlays, e.g. healthcare.json)
// so war rooms/exec portals can load real stage-level SLA/blocking config instead
// of hardcoding it. Read-only, no-store since these are hand-authored config files
// that may change between deploys.
app.use('/config', express.static(path.join(__dirname, 'config'), { setHeaders: (res) => res.setHeader('Cache-Control', 'no-store') }));
app.use('/js', express.static(path.join(__dirname, 'html/tsm-insurance/public/js')));
app.use('/js', express.static(path.join(__dirname, 'html/js')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/bpo', express.static(path.join(__dirname, 'html/bpo')));
app.use('/shared', express.static(path.join(__dirname, 'html/shared')));
app.use('/insurance', express.static(path.join(__dirname, 'html/tsm-insurance')));
app.use('/construction-suite', express.static(path.join(__dirname, 'html/construction-suite')));
// NOTE: /runtime and /architecture mounts now live earlier in this file
// (right after the '/html/runtime' mount, before the '/' catch-all) so they
// can't be shadowed by stale files inside html/. See fix note there.
app.use(express.static(dirPath));

// ── HC NODE ROUTES ────────────────────────────────────────────────────────────
app.get('/html/hc-strategist', (req, res) => res.redirect('/healthcare/hc-strategist/'));
app.get('/html/hc-strategist/', (req, res) => res.redirect('/healthcare/hc-strategist/'));
app.get('/html/hc-strategist/index.html', (req, res) => res.redirect('/healthcare/hc-strategist/'));

['hc-medical', 'hc-billing', 'hc-vendors', 'hc-grants', 'hc-insurance', 'hc-legal', 'hc-operations', 'hc-financial', 'hc-taxprep', 'hc-compliance', 'hc-pharmacy', 'hc-strategist'].forEach(function (node) {
  var dir = path.join(__dirname, 'html/healthcare', node);
  app.use('/healthcare/' + node, express.static(dir, { setHeaders: (res) => res.setHeader('Cache-Control', 'no-store') }));
  app.get('/healthcare/' + node, (req, res) => { res.setHeader('Cache-Control', 'no-store,no-cache,must-revalidate'); res.sendFile(path.join(dir, 'index.html')); });
  app.get('/healthcare/' + node + '/', (req, res) => { res.setHeader('Cache-Control', 'no-store,no-cache,must-revalidate'); res.sendFile(path.join(dir, 'index.html')); });
});

// ── SUITE ROUTES ──────────────────────────────────────────────────────────────
suites.forEach(s => {
  if (!s.route || !s.index) return;
  app.get(s.route, (req, res) => res.sendFile(path.join(__dirname, s.dir, s.index)));
  app.get(s.route + '/', (req, res) => res.sendFile(path.join(__dirname, s.dir, s.index)));
});

// ── HC API ROUTES ─────────────────────────────────────────────────────────────
// TSM FIX 2026-08-16: removed dead-weight /api/hc/query handler here — it
// shadowed routes/hc.js's real nodeKey-grounded handler (mounted later via
// app.use(require('./routes/hc'))), so every node page's real query/analysis
// was silently discarded. routes/hc.js now handles this route for real.

const clientUsage = {}; // v3
// Daily per-IP cap shared by /api/hc/stream and /api/hc/ocr. Was hardcoded
// at 20 (too low — got hit during normal same-day testing/demo use).
// Configurable via env so it can be tuned without a redeploy-requiring
// code change; default raised to 200 (Latorrey, 2026-08-21).
const DAILY_ANALYSIS_LIMIT = parseInt(process.env.DAILY_ANALYSIS_LIMIT, 10) || 200;

// ── HC NODE REPORT STORE ──────────────────────────────────────────────────────
// In-memory store for node reports relayed from war rooms → strategist → exec,
// with a durable write-through to the ledger (2026-08-29) so a restart
// doesn't silently empty the queue -- same fix Mortgage/Construction already
// have (see /api/mortgage/node-report below). Also now feeds the HC
// portfolio-intelligence twin (server/healthcare/portfolio-intelligence.js).
const hcNodeReports = {}; // keyed by node id

// GCU PILOT FIX 2026-08-26: PHI-bearing node reports, no auth check.
app.post('/api/hc/node-report', requireAnyAuth, async (req, res) => {
  try {
    const { nodeId, nodeLabel, report, analysisText, denialCodes, claimIds, severity, kpi, ts } = req.body || {};
    if (!nodeId) return res.status(400).json({ ok: false, error: 'nodeId required' });
    const doc = {
      nodeId,
      nodeLabel: nodeLabel || nodeId,
      report: report || '',
      analysisText: analysisText || '',
      denialCodes: denialCodes || [],
      claimIds: claimIds || [],
      severity: severity || 'INFO',
      kpi: kpi || {},
      ts: ts || Date.now()
    };
    hcNodeReports[nodeId] = { ...doc, receivedAt: Date.now() };
    console.log('[HC NODE REPORT] stored:', nodeId, 'severity:', severity);

    // Write-through to durable storage, same pattern as Mortgage/Construction:
    // best-effort, in-memory copy above already succeeded, so a ledger
    // failure here degrades to "survives until next restart" rather than
    // failing the request.
    try {
      await tsmLedger.verticalUpsertNodeReport('hc', nodeId, doc);
    } catch (ledgerErr) {
      console.warn('[HC NODE REPORT] ledger write-through failed (in-memory copy still stored):', ledgerErr.message);
    }

    return res.json({ ok: true, nodeId, stored: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/hc/node-reports', requireAnyAuth, async (req, res) => {
  try {
    const memReports = Object.values(hcNodeReports);
    if (memReports.length) {
      const reports = memReports.sort((a, b) => b.ts - a.ts);
      return res.json({ ok: true, reports, count: reports.length, source: 'memory' });
    }
    // In-memory cache is empty -- most likely a fresh process since the
    // last restart. Fall back to durable storage rather than returning an
    // empty queue that looks identical to "no findings exist."
    const persisted = await tsmLedger.verticalListNodeReports('hc');
    return res.json({ ok: true, reports: persisted, count: persisted.length, source: 'ledger' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/hc/node-reports', requireAnyAuth, async (req, res) => {
  const { nodeId } = req.body || req.query || {};
  try {
    if (nodeId) {
      delete hcNodeReports[nodeId];
      await tsmLedger.verticalDeleteNodeReport('hc', nodeId);
      return res.json({ ok: true, cleared: nodeId });
    }
    Object.keys(hcNodeReports).forEach(k => delete hcNodeReports[k]);
    await tsmLedger.verticalDeleteNodeReport('hc', null);
    return res.json({ ok: true, cleared: 'all' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── SCHOOLS NODE REPORT STORE (2026-08-29) ──────────────────────────────────
// New: Schools had no node-report ingestion endpoint at all before this --
// only the free-text /api/schools/analysis route existed. Added so
// war-room-level grant/monitoring/compliance findings have somewhere durable
// to land, same pattern as HC/Mortgage/Construction above (in-memory +
// ledger write-through from the start, not retrofitted).
const schoolsNodeReports = {}; // keyed by node id

app.post('/api/schools/node-report', requireAnyAuth, async (req, res) => {
  try {
    const { nodeId, nodeLabel, report, analysisText, exposure, grantIds, severity, kpi, ts } = req.body || {};
    if (!nodeId) return res.status(400).json({ ok: false, error: 'nodeId required' });
    const doc = {
      nodeId,
      nodeLabel: nodeLabel || nodeId,
      report: report || '',
      analysisText: analysisText || '',
      // Unlike HC, Schools has real deterministic exposure figures already
      // computed client-side (engine.getFinancialSummary()), so this route
      // takes a top-level exposure field -- same convention as Mortgage's
      // /api/mortgage/node-report, not HC's (HC's node-report body genuinely
      // has no exposure source to report).
      exposure: exposure == null ? null : Number(exposure) || 0,
      grantIds: grantIds || [],
      severity: severity || 'INFO',
      kpi: kpi || {},
      ts: ts || Date.now()
    };
    schoolsNodeReports[nodeId] = { ...doc, receivedAt: Date.now() };
    console.log('[SCHOOLS NODE REPORT] stored:', nodeId, 'severity:', severity);

    try {
      await tsmLedger.verticalUpsertNodeReport('schools', nodeId, doc);
    } catch (ledgerErr) {
      console.warn('[SCHOOLS NODE REPORT] ledger write-through failed (in-memory copy still stored):', ledgerErr.message);
    }

    return res.json({ ok: true, nodeId, stored: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/schools/node-reports', requireAnyAuth, async (req, res) => {
  try {
    const memReports = Object.values(schoolsNodeReports);
    if (memReports.length) {
      const reports = memReports.sort((a, b) => b.ts - a.ts);
      return res.json({ ok: true, reports, count: reports.length, source: 'memory' });
    }
    const persisted = await tsmLedger.verticalListNodeReports('schools');
    return res.json({ ok: true, reports: persisted, count: persisted.length, source: 'ledger' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/schools/node-reports', requireAnyAuth, async (req, res) => {
  const { nodeId } = req.body || req.query || {};
  try {
    if (nodeId) {
      delete schoolsNodeReports[nodeId];
      await tsmLedger.verticalDeleteNodeReport('schools', nodeId);
      return res.json({ ok: true, cleared: nodeId });
    }
    Object.keys(schoolsNodeReports).forEach(k => delete schoolsNodeReports[k]);
    await tsmLedger.verticalDeleteNodeReport('schools', null);
    return res.json({ ok: true, cleared: 'all' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});


// GCU PILOT FIX 2026-08-26: fetched by Healthcare pages, no auth check.
app.post('/api/hc/stream', requireAnyAuth, async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const { model, sys, user, maxTok } = req.body;
  if (!sys || !user) return res.status(400).json({ error: 'Missing sys or user' });

  const clientId = req.ip;
  const today = new Date().toDateString();
  const key = clientId + '_' + today;
  clientUsage[key] = (clientUsage[key] || 0) + 1;
  if (clientUsage[key] > DAILY_ANALYSIS_LIMIT) {
    return res.status(429).json({ error: 'Daily analysis limit reached. Contact TSM to upgrade.' });
  }

  const groqKey = process.env.GROQ_API_KEY || process.env.GROQ_KEY;
  if (!groqKey) return res.status(500).json({ error: 'GROQ_KEY not configured on server.' });

  try {
    // TSM FIX: no timeout existed anywhere in this chain (client or server).
    // If Groq hung on a slow/overloaded model — most likely on Engine 3's
    // LARGE model — this request would hang indefinitely with the client UI
    // stuck on PROCESSING forever, no error, no way to recover short of a
    // page refresh mid-demo. 25s covers normal completions on both SMALL and
    // LARGE Groq models with margin; anything past that is treated as stuck.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);
    let groqRes;
    try {
      groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (process.env.GROQ_API_KEY || process.env.GROQ_KEY)
        },
        body: JSON.stringify({
          model: resolveGroqModel(model),
          stream: true,
          max_tokens: maxTok || 500,
          messages: [{ role: 'system', content: sys }, { role: 'user', content: user }]
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!groqRes.ok) {
      // Same class of bug as the client-side fix in poc-html's
      // groqStreamModel: this always did `await groqRes.json()`, assuming
      // Groq's error response is JSON. Groq (or anything between this
      // server and Groq — a gateway timeout, a Cloudflare block page) can
      // return non-JSON on failure, and that throws here uncaught by
      // anything except the outer catch below, which reports a generic
      // 500 with the JSON-parse error message instead of whatever Groq
      // actually said. Now checks content-type first and falls back to
      // raw text.
      let msg = 'Groq error';
      try {
        const ct = groqRes.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          const err = await groqRes.json();
          msg = err.error?.message || msg;
        } else {
          const txt = await groqRes.text();
          if (txt) msg = txt.replace(/\s+/g, ' ').trim().slice(0, 300);
        }
      } catch (_) {}
      return res.status(502).json({ error: msg });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const { Readable } = require('stream');
    Readable.fromWeb(groqRes.body).pipe(res);
  } catch (e) {
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'Groq took too long to respond (25s timeout). This can happen when the model is under heavy load — try again.' });
    }
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Server-side proxy for Groq Vision OCR (scanned PDF pages + uploaded images).
// Replaces the old direct browser->api.groq.com calls that shipped a client-side key.
// TSM FIX 2026-08-27: BOTH models in this fallback list were dead —
// meta-llama/llama-4-scout-17b-16e-instruct shut down 07/17/26 and
// meta-llama/llama-4-maverick-17b-128e-instruct shut down 03/09/26 (see
// https://console.groq.com/docs/deprecations). A model_decommissioned
// error comes back as a 400, which the retry loop below does NOT retry
// on — so this endpoint has been failing on the very first attempt for
// every OCR request since 07/17/26. Per Groq's current vision docs
// (console.groq.com/docs/vision), the only supported vision models are
// qwen/qwen3.6-27b and qwen/qwen3.8-27b.
const GROQ_VISION_MODELS = [
  'qwen/qwen3.6-27b',
  'qwen/qwen3.8-27b'
];

// GCU PILOT FIX 2026-08-26: OCR on uploaded medical docs, no auth check.
app.post('/api/hc/ocr', requireAnyAuth, async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const { imageBase64, mimeType, prompt } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: 'Missing imageBase64' });

  const clientId = req.ip;
  const today = new Date().toDateString();
  const key = clientId + '_' + today;
  clientUsage[key] = (clientUsage[key] || 0) + 1;
  if (clientUsage[key] > DAILY_ANALYSIS_LIMIT) {
    return res.status(429).json({ error: 'Daily analysis limit reached. Contact TSM to upgrade.' });
  }

  const groqKey = process.env.GROQ_API_KEY || process.env.GROQ_KEY;
  if (!groqKey) return res.status(500).json({ error: 'GROQ_KEY not configured on server.' });

  const mt = mimeType || 'image/jpeg';
  const dataUrl = `data:${mt};base64,${imageBase64}`;
  const ocrPrompt = prompt || 'Extract ALL visible text from this image exactly as it appears. Preserve structure, codes, dates, and dollar amounts. Output plain text only.';

  let lastErr;
  for (const model of GROQ_VISION_MODELS) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);
      let groqRes;
      try {
        groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + groqKey },
          body: JSON.stringify({
            model,
            max_tokens: 2000,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: ocrPrompt },
                { type: 'image_url', image_url: { url: dataUrl } }
              ]
            }]
          }),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeoutId);
      }
      if (!groqRes.ok) {
        const err = await groqRes.text();
        lastErr = err;
        if ([429, 500, 502, 503].includes(groqRes.status)) continue;
        return res.status(502).json({ error: 'Groq OCR error ' + groqRes.status + ': ' + err });
      }
      const data = await groqRes.json();
      const text = data?.choices?.[0]?.message?.content || '';
      return res.json({ ok: true, text });
    } catch (e) {
      lastErr = e.message;
      if (e.name === 'AbortError') continue;
      return res.status(500).json({ error: e.message });
    }
  }
  return res.status(502).json({ error: 'All Groq vision models failed. ' + (lastErr || '') });
});

function debugLog(msg) {
  try {
    fs.appendFileSync('/app/data/debug.log', `[${new Date().toISOString()}] ${msg}\n`);
  } catch (e) { /* ignore logging failures */ }
}

async function fetchGroqWithRetry(groqKey, body, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + groqKey
      },
      body: JSON.stringify(body)
    });
    if (groqRes.ok) return groqRes;
    const err = await groqRes.json().catch(() => ({}));
    console.error('Groq error response:', JSON.stringify(err)); debugLog('Groq error: ' + JSON.stringify(err));
    const isRateLimit = err.error?.code === 'rate_limit_exceeded';
    if (isRateLimit && attempt < maxRetries) {
      const match = /try again in ([\d.]+)(ms|s)/.exec(err.error.message || '');
      let waitMs = 1500;
      if (match) {
        const val = parseFloat(match[1]);
        waitMs = match[2] === 's' ? val * 1000 : val;
      }
      waitMs = Math.min(waitMs + 250, 10000);
      console.error(`Rate limited, retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`); debugLog(`Retrying in ${waitMs}ms attempt ${attempt + 1}/${maxRetries}`);
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }
    const failErr = new Error(err.error?.message || 'Groq error');
    failErr.status = 502;
    throw failErr;
  }
}

app.post('/api/groq/validate-key', async (req, res) => {
  const clientKey = (req.body && req.body.apiKey || '').trim();
  if (!clientKey) return res.status(400).json({ ok: false, error: 'No API key provided.' });
  try {
    const r = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { 'Authorization': 'Bearer ' + clientKey }
    });
    return res.json({ ok: r.ok });
  } catch (e) {
    console.error('Groq key validation error:', e.message);
    return res.status(502).json({ ok: false, error: 'Could not reach Groq.' });
  }
});



// Health probe for War Room Stream
// Keeps diagnostics and monitoring from failing.
// AI generation remains POST only.
app.get('/api/war-room/stream', (req,res)=>{
  res.json({
    status:"online",
    route:"/api/war-room/stream",
    methods:["POST"],
    service:"TSM Neural Core"
  });
});

// GCU PILOT FIX 2026-08-26: fetched by Legal war room, no auth check.
app.post('/api/war-room/stream', requireAnyAuth, async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const { model, messages, max_tokens, temperature, json_mode } = req.body;
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: 'Missing messages' });

  const groqKey = process.env.GROQ_API_KEY || process.env.GROQ_KEY;
  if (!groqKey) return res.status(500).json({ error: 'GROQ_KEY not configured on server.' });

  async function fetchGroqStream(retriesLeft = 3, forceJsonMode = !!json_mode) {
    const body = {
      model: resolveGroqModel(model),
      stream: true,
      max_tokens: max_tokens || 600,
      temperature: temperature ?? 0.4,
      reasoning_effort: 'low',
      messages
    };
    // Callers that need strict JSON out (situation-room extraction engines,
    // etc.) can pass json_mode:true so Groq enforces valid JSON structurally
    // instead of relying on prompt instructions alone — that's what was
    // producing "Unexpected token"/"Expected ',' or '}'" parse errors on
    // the client, since the model occasionally emitted a stray/unescaped
    // character with no structural JSON guarantee in place.
    if (forceJsonMode) body.response_format = { type: 'json_object' };
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + groqKey
      },
      body: JSON.stringify(body)
    });
    if (!groqRes.ok) {
      const err = await groqRes.json().catch(() => ({}));
      console.error('Groq error response:', JSON.stringify(err));

      // Groq's TPM rate limit is transient and self-clears within seconds.
      // Retry automatically (honoring the wait time Groq reports) instead of
      // failing the whole engine run on a momentary cap — this is what was
      // surfacing as opaque "502" errors on engines fired in quick succession.
      if (groqRes.status === 429 && retriesLeft > 0) {
        const waitMatch = /try again in ([\d.]+)s/i.exec(err.error?.message || '');
        const waitMs = waitMatch ? Math.ceil(parseFloat(waitMatch[1]) * 1000) + 250 : 3000;
        console.warn(`[war-room/stream] Rate limited, retrying in ${waitMs}ms (${retriesLeft} retries left)`);
        await new Promise(r => setTimeout(r, waitMs));
        return fetchGroqStream(retriesLeft - 1, forceJsonMode);
      }

      // A 400 with json_mode on usually means this model doesn't support
      // response_format — retry once immediately without it rather than
      // failing the whole engine run.
      if (groqRes.status === 400 && forceJsonMode) {
        console.warn('[war-room/stream] response_format rejected by model, retrying without json_mode');
        return fetchGroqStream(retriesLeft, false);
      }

      const e = new Error(err.error?.message || 'Groq error');
      e.status = groqRes.status === 429 ? 429 : 502;
      throw e;
    }
    return groqRes;
  }

  const maxEmptyRetries = 2;
  let succeeded = false;
  let headersSent = false;

  function ensureHeaders() {
    if (!headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      headersSent = true;
    }
  }

  try {
    for (let attempt = 0; attempt <= maxEmptyRetries && !succeeded; attempt++) {
      const groqRes = await fetchGroqStream();
      const reader = groqRes.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let gotContent = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const d = line.slice(6);
          if (d === '[DONE]') continue;
          let delta = '';
          try { delta = JSON.parse(d).choices?.[0]?.delta?.content || ''; } catch (e) {}
          if (delta) {
            gotContent = true;
            ensureHeaders();
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`);
          }
        }
      }

      if (gotContent) {
        succeeded = true;
      } else {
        debugLog(`Empty stream content on attempt ${attempt + 1}/${maxEmptyRetries + 1}, retrying`);
        if (attempt === maxEmptyRetries) {
          debugLog('Exhausted empty-stream retries, giving up');
        }
      }
    }

    ensureHeaders();
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (e) {
    if (res.headersSent) {
      res.end();
    } else {
      res.status(e.status || 500).json({ error: e.message });
    }
  }
});

// TSM FIX 2026-08-27: PHI-adjacent HC handlers left out of the 2026-08-26
// GCU pilot auth sweep (47aea602) — that pass gated node-report/stream/OCR
// and the routes/hc.js mount, but missed these 4 same-file handlers.
app.post('/api/hc/ask', requireAnyAuth, async (req, res) => {
  try {
    var body = req.body || {};
    if (!body.message || !body.message.trim()) return res.status(400).json({ ok: false, error: 'Message is required' });
    var a = await groqChat(body.system || SP.healthcare, body.message, 1024);
    return res.json({ ok: true, output: a, content: a });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/hc/triage', requireAnyAuth, async (req, res) => {
  try {
    const { client = '', taskType = '', department = '', priority = 'P3', deadline = '', description = '', notes = '' } = req.body || {};
    if (!description) return res.status(400).json({ ok: false, error: 'Description is required' });
    const sp = `You are an expert Healthcare BPO triage AI for TSM. Respond in this EXACT format:\nPRIORITY: [P1-CRITICAL / P2-HIGH / P3-MEDIUM / P4-LOW]\nDEPARTMENT: [best-fit department]\nROUTE_TO: [Billing & Coding / Clinical Operations / Compliance / Executive / Finance / Provider Relations]\nURGENCY_REASON: [1 sentence max]\nRECOMMENDED_ACTION: [2-4 bullet points starting with •]\nESCALATE_TO_STRATEGIST: [YES / NO]\nESCALATE_REASON: [1 sentence, or N/A]\nESTIMATED_RESOLUTION: [timeframe]`;
    const result = await groqChat(sp, `Client: ${client}\nTask Type: ${taskType}\nDepartment: ${department}\nPriority: ${priority}\nDeadline: ${deadline}\nDescription: ${description}\nNotes: ${notes}`, 1024);
    res.json({ ok: true, content: result });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.post('/api/hc/strategist', requireAnyAuth, async (req, res) => {
  try {
    const { task = {}, aiTriage = '', query = '' } = req.body || {};
    const sp = `You are the TSM Healthcare BPO Strategist. Produce executive-grade strategy in this EXACT format:\nSTRATEGIC_SUMMARY: [2-3 sentences]\nROOT_CAUSE: [1 sentence]\nIMPACT_LEVEL: [HIGH / MEDIUM / LOW] — [impact in 1 sentence]\nRECOMMENDED_STRATEGY:\n• [Action 1]\n• [Action 2]\n• [Action 3]\nOWNER_LANES: [departments]\nTIMELINE: [Day 1-2: ... / Week 1: ...]\nESCALATE_TO_EXECUTIVE: [YES / NO]\nESCALATE_REASON: [1 sentence, or N/A]\nCONFIDENCE: [percentage]`;
    const result = await groqChat(sp, `TASK: ${JSON.stringify(task)}\nTRIAGE_OUTPUT: ${aiTriage}\nQUERY: ${query || 'Full strategic assessment'}`, 1024);
    res.json({ ok: true, content: result });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// TSM FIX 2026-08-16: removed dead-weight /api/hc/layer2 handler here — it
// shadowed routes/hc.js's real handler (aggregateLayer2, real revenue-at-risk
// math from HC_NODE_STATE_FILE). routes/hc.js now handles this route for real.

app.post('/api/hc/node/:node', requireAnyAuth, async (req, res) => {
  const node = req.params.node;
  const payload = req.body || {};
  const result = await tsmAIJSON(`Analyze healthcare node ${node}. Payload: ${JSON.stringify(payload).slice(0, 4000)}. Return JSON: {"node":"${node}","status":"READY|WATCH|RISK","top_issue":"...","findings":[],"actions":[],"bnca":"...","owner_lane":"...","confidence":0}`,
    { node, status: 'WATCH', top_issue: 'Node requires review', findings: [], actions: [], bnca: 'Review node output.', owner_lane: 'office manager', confidence: 80 });
  TSM_MEMORY.healthcare.nodes[node] = result;
  res.json({ ok: true, node, result, ts: new Date().toISOString() });
});

// TSM FIX 2026-08-16: removed dead-weight /api/hc/bnca handler here — it
// shadowed routes/hc.js's real handler, and it read TSM_MEMORY.healthcare.nodes
// which is never populated by the real telemetry pipeline (/api/hc/nodes/:nodeKey
// writes HC_NODE_STATE_FILE instead) — was ungrounded in practice either way.
// routes/hc.js now handles this route for real, reading HC_NODE_STATE_FILE.

app.post('/api/hc-strategist/bnca', async (req, res) => {
  const payload = req.body || {};
  const result = await tsmAIJSON(`HC Strategist synthesis. Memory: ${JSON.stringify(TSM_MEMORY.healthcare).slice(0, 8000)}. Payload: ${JSON.stringify(payload).slice(0, 4000)}. Return JSON: {"suite":"hc-strategist","strategic_summary":"...","priority_actions":[],"bnca":"...","relay_to_main_strategist":true,"confidence":0}`,
    { suite: 'hc-strategist', strategic_summary: 'HC Strategist review needed.', priority_actions: [], bnca: 'Relay to Main Strategist.', relay_to_main_strategist: true, confidence: 82 });
  TSM_MEMORY.healthcare.hcStrategist = result;
  res.json({ ok: true, result, ts: new Date().toISOString() });
});

app.post('/api/main-strategist/healthcare', async (req, res) => {
  const payload = req.body || {};
  const result = await tsmAIJSON(`Main Strategist executive package. Memory: ${JSON.stringify(TSM_MEMORY.healthcare).slice(0, 9000)}. Return JSON: {"suite":"main-strategist","executive_issue":"...","financial_or_operational_impact":"...","recommendation":"...","decision_options":[],"hitl_relay":"...","send_to_executive_portal":true,"confidence":0}`,
    { suite: 'main-strategist', executive_issue: 'Healthcare readiness needs review.', financial_or_operational_impact: 'Billing pressure may affect throughput.', recommendation: 'Start office manager workflow pilot.', decision_options: ['30-day pilot'], hitl_relay: 'Review BNCA and confirm owner lanes.', send_to_executive_portal: true, confidence: 84 });
  TSM_MEMORY.healthcare.mainStrategist = result;
  res.json({ ok: true, result, ts: new Date().toISOString() });
});

app.post('/api/executive/portal', async (req, res) => {
  const payload = req.body || {};
  const result = await tsmAIJSON(`Executive Portal. Memory: ${JSON.stringify(TSM_MEMORY.healthcare).slice(0, 10000)}. Return JSON: {"portal":"executive","audience":"CFO / Decision Maker","decision_summary":"...","bnca_recommendation":"...","hitl_script":"...","approval_path":[],"next_step":"...","confidence":0}`,
    { portal: 'executive', audience: 'CFO / Decision Maker', decision_summary: 'Healthcare BNCA ready.', bnca_recommendation: 'Approve pilot workflow.', hitl_script: 'Action-ready recommendation and owner lanes for approval.', approval_path: ['Office Manager', 'CFO'], next_step: 'Book walkthrough or approve 30-day pilot.', confidence: 85 });
  TSM_MEMORY.healthcare.executive = result;
  res.json({ ok: true, result, ts: new Date().toISOString() });
});

// ── TSM Candidate Sync Routes ──
const candidateStore = []; // swap for DB later

// POST /api/candidate/submit  — called by candidate-intake.html
app.post('/api/candidate/submit', (req, res) => {
  const entry = {
    id: 'cand_' + Date.now(),
    timestamp: new Date().toISOString(),
    new: true,
    ...req.body
  };
  candidateStore.unshift(entry);
  if (candidateStore.length > 500) candidateStore.length = 500;
  res.json({ ok: true, id: entry.id });
});

// GET /api/candidate/list  — polled by wia2.html recruiter dashboard
app.get('/api/candidate/list', (req, res) => {
  res.json(candidateStore);
});

// POST /api/candidate/clear-new  — marks all as seen
app.post('/api/candidate/clear-new', (req, res) => {
  candidateStore.forEach(c => c.new = false);
  res.json({ ok: true });
});

// ── MUSIC API ROUTES ──────────────────────────────────────────────────────────
// Deterministic heuristic used only to rank/gate revision options (not a
// stand-in for AI judgment — the lyric content itself always comes from
// real groqChat() calls above; this just scores text shape for the UI).
function musicHeuristicScore(text){
  var body = String(text || '');
  var lines = body.split(/\n+/).filter(Boolean).length;
  var len = body.length;
  var cadence = Math.min(.99, .72 + (lines >= 2 ? .08 : 0) + (len > 60 ? .06 : 0));
  var emotion = Math.min(.99, .74 + (len > 120 ? .08 : 0));
  var structure = Math.min(.99, .70 + (lines >= 4 ? .12 : .05));
  var imagery = Math.min(.99, .70 + (len > 150 ? .08 : 0));
  var overall = Number(((cadence + emotion + structure + imagery) / 4).toFixed(2));
  return {
    cadence: Number(cadence.toFixed(2)),
    emotion: Number(emotion.toFixed(2)),
    structure: Number(structure.toFixed(2)),
    imagery: Number(imagery.toFixed(2)),
    overall
  };
}

app.post('/api/music/structure', async (req, res) => {
  try {
    var body = req.body || {};
    var sys = 'You are ZAY, a world-class music producer. Build a detailed song structure/blueprint. Return sections, BPM suggestion, key, mood, and arrangement notes. Write in plain text.';
    var msg = body.query || body.prompt || `Build a song blueprint. Genre: ${body.genre || 'Hip-Hop'}, Mood: ${body.mood || 'Motivational'}, Theme: ${body.theme || 'hustle and perseverance'}, Artist style: ${body.artist || 'versatile'}`;
    var a = await groqChat(sys, msg, 1200);
    return res.json({ ok: true, output: a, structure: a });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/music/hooks/generate10', async (req, res) => {
  try {
    var body = req.body || {};
    var sys = 'You are ZAY, a world-class songwriter. Generate exactly 10 distinct, catchy, numbered hook options. Make them memorable and genre-appropriate.';
    var msg = body.query || `Generate 10 hook options. Genre: ${body.genre || 'Hip-Hop'}, Mood: ${body.mood || 'Motivational'}, Theme: ${body.theme || 'hustle'}, Artist style: ${body.artist || 'versatile'}`;
    var a = await groqChat(sys, msg, 1024);
    return res.json({ ok: true, output: a, hooks: a });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/music/hooks', async (req, res) => {
  try {
    var body = req.body || {};
    var sys = 'You are ZAY, a world-class songwriter. Generate 10 distinct, catchy hook options. Number each one. Make them memorable and genre-appropriate.';
    var msg = body.query || `Generate 10 hook options. Genre: ${body.genre || 'Hip-Hop'}, Mood: ${body.mood || 'Motivational'}, Theme: ${body.theme || 'hustle'}`;
    var a = await groqChat(sys, msg, 1024);
    return res.json({ ok: true, output: a, hooks: a });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/music/song', async (req, res) => {
  try {
    var body = req.body || {};
    var sys = 'You are ZAY, a world-class songwriter. Write complete, full song lyrics. Include all sections: intro, verse 1, pre-chorus, chorus, verse 2, bridge, outro. Make it professional and authentic.';
    var msg = body.query || `Write a complete song. Genre: ${body.genre || 'Hip-Hop'}, Mood: ${body.mood || 'Motivational'}, Hook: ${body.hook || ''}, Theme: ${body.theme || 'hustle'}`;
    var a = await groqChat(sys, msg, 2048);
    return res.json({ ok: true, output: a, lyrics: a });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/music/revision/run', async (req, res) => {
  try {
    var body = req.body || {};
    var sys = 'You are ZAY, a world-class songwriter. Revise the provided lyrics based on the notes given. Return only the revised lyrics.';
    var msg = `Original lyrics:\n${body.lyrics || ''}\n\nRevision notes: ${body.notes || ''}\n\nHook to preserve: ${body.hook || ''}\nGenre: ${body.genre || 'Hip-Hop'}`;
    var a = await groqChat(sys, msg, 2048);
    return res.json({ ok: true, output: a, content: a });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/music/strategy', async (req, res) => {
  try {
    var body = req.body || {};
    var sys = 'You are ZAY, an expert music industry strategist. Create a detailed release strategy and marketing plan.';
    var msg = body.query || `Create a release strategy for a ${body.genre || 'Hip-Hop'} song titled "${body.title || 'Untitled'}" with theme: ${body.theme || ''}. Artist style: ${body.artist || 'independent'}. Cover: release timeline, DSP strategy, playlist targeting, social media rollout, sync licensing, marketing angles.`;
    var a = await groqChat(sys, msg, 1200);
    return res.json({ ok: true, output: a, answer: a });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/music/guidance', async (req, res) => {
  try {
    var body = req.body || {};
    var sys = 'You are ZAY, a music industry expert. Provide industry guidance and career development advice for independent artists.';
    var msg = body.query || `Provide industry guidance for an independent ${body.genre || 'Hip-Hop'} artist. Artist style: ${body.artist || 'independent'}. Theme: ${body.theme || ''}. Cover: career development, networking, monetization, next steps.`;
    var a = await groqChat(sys, msg, 1200);
    return res.json({ ok: true, output: a, answer: a });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/music/coach', async (req, res) => {
  try {
    var body = req.body || {};
    var sys = 'You are ZAY, a real music producer and artist coach. Keep responses direct, real, and helpful. Under 80 words unless asked for more.';
    var msg = body.query || body.message || 'How can I improve my song?';
    var a = await groqChat(sys, msg, 512);
    return res.json({ ok: true, output: a, content: a, reply: a });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/music/agent-pass', async (req, res) => {
  var body = req.body || {};
  var agent = body.agent || 'ZAY';
  var draft = body.draft || body.lyrics || '';
  var request = body.request || 'Refine this draft';
  try {
    var output = await groqChat(SP.music, 'Agent: ' + agent + '\nRequest: ' + request + '\n\nDraft:\n' + draft + '\n\nProvide your refined version:', 700);
    return res.json({ ok: true, agent: agent, output: output, createdAt: new Date().toISOString() });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/music/chain', async (req, res) => {
  var body = req.body || {};
  var draft = body.draft || '';
  var request = body.request || 'Sharpen this draft';
  try {
    // maxTokens bumped 400->900: each stage refines the previous stage's
    // (already generated) text, so a 400-token cap on ZAY truncated before
    // the hook/bridge ever appeared, RIYA then refined that truncated draft,
    // and DJ refined RIYA's truncated output -- compounding the cutoff
    // across all three hops so the final song never included a complete
    // hook, bridge, or outro.
    var zay = await groqChat(SP.music, 'Agent ZAY cadence/flow focus.\nRequest: ' + request + '\nDraft: ' + draft + '\nRefine:', 900);
    var riya = await groqChat(SP.music, 'Agent RIYA emotion/imagery focus.\nRequest: ' + request + '\nDraft: ' + zay + '\nRefine:', 900);
    var dj = await groqChat(SP.music, 'Agent DJ hook/structure focus.\nRequest: ' + request + '\nDraft: ' + riya + '\nFinal version:', 900);
    return res.json({ ok: true, mode: 'chain', input: draft, zay, riya, output: dj, score: { overall: 0.87 }, createdAt: new Date().toISOString() });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/music/revision/generate', async (req, res) => {
  try {
    var body = req.body || {};
    var draft = body.draft || '';
    var request = body.request || 'Give me 3 revision options';
    var results = await Promise.all([
      groqChat(SP.music, 'Flow-first revision.\nRequest: ' + request + '\nDraft: ' + draft + '\nOption A:', 700),
      groqChat(SP.music, 'Emotion-first revision.\nRequest: ' + request + '\nDraft: ' + draft + '\nOption B:', 700),
      groqChat(SP.music, 'Hook-first revision.\nRequest: ' + request + '\nDraft: ' + draft + '\nOption C:', 700)
    ]);
    var scoreA = musicHeuristicScore(results[0]);
    var scoreB = musicHeuristicScore(results[1]);
    var scoreC = musicHeuristicScore(results[2]);
    var options = [
      { id: 'A', title: 'Option A - Flow First', strategy: 'Cadence and bounce', output: results[0], score: scoreA },
      { id: 'B', title: 'Option B - Emotion First', strategy: 'Imagery and vulnerability', output: results[1], score: scoreB },
      { id: 'C', title: 'Option C - Hook First', strategy: 'Structure and repeatability', output: results[2], score: scoreC }
    ];
    var bestOverall = Math.max(scoreA.overall, scoreB.overall, scoreC.overall);
    var recommended = options.find(o => o.score.overall === bestOverall).id;
    var session = { id: Date.now(), request, input: draft, options, recommended, createdAt: new Date().toISOString() };
    if (!global.MUSIC_REVISIONS) global.MUSIC_REVISIONS = { sessions: [], selected: null };
    global.MUSIC_REVISIONS.sessions.unshift(session);
    global.MUSIC_REVISIONS.sessions = global.MUSIC_REVISIONS.sessions.slice(0, 20);
    return res.json({ ok: true, session });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/music/dna/save', async (req, res) => {
  var body = req.body || {};
  var dna = global.MUSIC_PLATFORM.artistDNA;
  dna.artist = body.artist || dna.artist;
  dna.styleTerms = Array.isArray(body.styleTerms) ? body.styleTerms : dna.styleTerms;
  dna.weights = Object.assign({}, dna.weights, body.weights || {});
  dna.updatedAt = new Date().toISOString();
  try { dna.aiInsight = await groqChat(SP.music, 'Artist: ' + dna.artist + '\nStyle: ' + dna.styleTerms.join(', ') + '\n\nSuggest 3 directions to push their sound.', 400); }
  catch (e) { dna.aiInsight = null; }
  return res.json({ ok: true, dna });
});

app.post('/api/music/song/learn', async (req, res) => {
  var body = req.body || {};
  var song = { id: Date.now(), title: body.title || 'Untitled', lyrics: body.lyrics || body.draft || '', learnedAt: new Date().toISOString() };
  global.MUSIC_PLATFORM.artistDNA.learnedSongs.unshift(song);
  global.MUSIC_PLATFORM.artistDNA.learnedSongs = global.MUSIC_PLATFORM.artistDNA.learnedSongs.slice(0, 12);
  try { song.aiAnalysis = await groqChat(SP.music, 'Analyze these lyrics for cadence, emotion, structure, imagery. Score each 0-1:\n\n' + song.lyrics, 400); }
  catch (e) { song.aiAnalysis = null; }
  return res.json({ ok: true, song, dna: global.MUSIC_PLATFORM.artistDNA });
});

// ── MUSIC API ROUTES (additional engine/revision/dna/billing layer) ───────────
// app.html calls a wider set of /api/music/* endpoints than were defined above
// (agent/run, agent/chain, dna/learn, engine, revision/select, revision/state,
// revision/pick-rerun, dashboard-sync, session/save, export, monetization/state,
// billing/state, billing/upgrade-intent, billing/set-tier-dev, and /api/music/state
// itself) — all of which were 404ing live. routes/music.js already implements
// them with the exact response shapes app.html expects; it just was never
// mounted. Mounted AFTER the routes above so those (already real, Groq-backed)
// inline handlers keep precedence for any overlapping paths.
app.use(require('./routes/music'));

// ── ENTERPRISE CAPABILITY BRIDGE ───────────────────────────────────────────────
// Session-persisted stores for O2C/CRM/CPQ/Catalog/Approval (previously
// stateless /query-only) + the capability-sweep orchestrator. BPO reference
// chain — see routes/enterprise-capability-bridge.js header for full design.
app.use(require('./routes/enterprise-capability-bridge'));

// ── ENTERPRISE ENRICHMENT ENGINE ────────────────────────────────────────────────
// server/enterprise/api/enterprise-router.js (POST /enrich, /dashboard,
// /decision, /missions, GET /health) was fully built and unit-tested
// (scripts/test-enterprise-engine.js etc.) but never mounted here, so
// POST /api/enterprise/enrich 404'd in production despite
// html/war-rooms/mortgage/services/mortgage-engine.js and
// html/war-rooms/schools/services/schools-engine.js both already calling
// it directly. This is the missing mount.
app.use('/api/enterprise', require('./server/enterprise/api/enterprise-router'));

// ── ENTERPRISE LAB DIGITAL TWINS ─────────────────────────────────────────────
// server/enterprise-lab/twins-router.js (VMware/Network/Device/AD/M365 twins,
// chaos-fault injection, SLA/scoring/technician/analytics engines) was fully
// built but never mounted here, so every /api/twins/* call from
// html/l1-copilot/enterprise-command-center.html 404'd and every widget on
// that page sat on "Twin backend not reachable yet — retrying...". This is
// the missing mount.
app.use('/api/twins', require('./server/enterprise-lab/twins-router'));

// ── ENTERPRISE LAB CORE (missions / benchmark / incidents) ──────────────────
// server/enterprise-lab/api.js (mission queue, chaos incident generator,
// benchmark scorecard, /health, /reset) was also fully built but never
// mounted, so every /api/enterprise-lab/* call from
// html/l1-copilot/enterprise-command-center.html 404'd (Service Desk Wall,
// Live Mission Queue, AI Chaos Engine). This is the missing mount.
app.use('/api/enterprise-lab', require('./server/enterprise-lab/api'));


// ── FINOPS ────────────────────────────────────────────────────────────────────
app.post('/api/finops/bnca/report', (req, res) => res.json({ ok: true }));
// routes/finops.js implements the fuller finops API (docs, decision-service bridge, etc.)
// TSM FIX (data isolation): hc.js was mounted with no auth middleware at
// all — any request, session or not, could read/write every client's
// healthcare node data because there was also no clientId in the data
// schema. requireAnyAuth now gates entry and attaches req.tsmSession
// (role/clientId/tenantId); hc.js's own handlers use resolveHcClientId(req)
// to route each read/write to that session's own data file. See
// routes/_shared.js for the per-client file resolution.
app.use((req, res, next) => {
  if (req.path.startsWith('/api/hc')) return requireAnyAuth(req, res, next);
  next();
}, require('./routes/hc'));
app.use(require('./routes/strategist'));
app.use(require('./routes/construction'));
app.use(require('./routes/property-accounting'));
app.use(require('./routes/finops'));
app.use(require('./routes/live-data'));
app.use(docRouter);

// ── ERP INTEGRATIONS ────────────────────────────────────────────────────────
// QuickBooks Online (sandbox-first, read-only). See routes/integrations-
// quickbooks.js header for scope boundaries and what has/hasn't been
// verified against Intuit's live API.
app.use(require('./routes/integrations-quickbooks'));

// ── EMAIL INTEGRATIONS ──────────────────────────────────────────────────────
// Gmail (read-only, gmail.readonly scope only). See routes/integrations-
// gmail.js header for scope boundaries and what has/hasn't been verified
// against Google's live API.
app.use(require('./routes/integrations-gmail'));

// ── EHR INTEGRATIONS ─────────────────────────────────────────────────────────
// FHIR (public synthetic sandbox by default, read-only). See routes/
// integrations-fhir.js header -- this is NOT wired to a real EHR and
// should not be pointed at one without a BAA and real SMART-on-FHIR auth,
// neither of which this file implements.
app.use(require('./routes/integrations-fhir'));

// ── RCM RELAY ─────────────────────────────────────────────────────────────────
// Server-side staging for the FinOps Doc Showcase -> TSM RCM OS handoff.
// See routes/rcm-relay.js header for the full endpoint contract.
app.use('/api/rcm', require('./routes/rcm-relay'));
app.use('/api/rcm', require('./routes/rcm-requirements'));

// ── SCHOOLS FINANCIAL EXPOSURE ──────────────────────────────────────────────
// Server-side rate-card math for the Schools war room. The rate card
// previously shipped inside the publicly-fetchable schools-model.json; it
// now lives only in server/private-config/schools/financial-model.json.
// See routes/schools-financial.js header for the full endpoint contract.
// TSM FIX (data isolation): this stateless calculator wasn't gated by any
// auth either — anyone could POST to it and get computed output from the
// proprietary rate card. It doesn't store per-client data (caller supplies
// kpis/breaches/exceptions in the body each time), so requireAnyAuth alone
// closes the gap here — there's no per-client bucket to scope.
app.use('/api/schools', requireAnyAuth, require('./routes/schools-financial'));

// ── INPHUSIONSYS (multi-vertical demo data: employees, anomalies, IT tickets) ──
// See server/routes/inphusionsys.js header for the full endpoint contract.
// Covers all 11 verticals; /scenarios and /run-live are legacy aliases kept
// for the 5 original front-end injections (construction.html, legal.html,
// finops-command-suite-v2.html, hc-denial-war-room.html, l1-ticket-copilot.html).
app.use('/api/inphusionsys', require('./server/routes/inphusionsys'));

// ── FINANCIAL INTELLIGENCE (finance-index.html) ─────────────────────────────
// Groq-backed chat (per-tab assistant) + audit engine with real persisted
// audit-log entries. See routes/finance-chat.js header for the full contract.
const { chatRouter: financeChatRouter, auditRouter: financeAuditRouter } = require('./routes/finance-chat');
// GCU PILOT FIX 2026-08-26: fetched by Legal and Healthcare with no auth check.
app.use('/api/chat', requireAnyAuth, financeChatRouter);
app.use('/api/audit', requireAnyAuth, financeAuditRouter);

// ── AI QUERY ROUTES ───────────────────────────────────────────────────────────
app.post('/api/ai/query', async (req, res) => {
  var body = req.body || {};
  var appType = body.app || 'enterprise';
  var question = body.question || body.query || body.input || '';
  var system = SP[appType] || SP.enterprise;
  try {
    var userMsg = body.context ? 'Context:\n' + body.context + '\n\nQuestion: ' + question : question;
    var answer = await groqChat(system, userMsg, body.maxTokens || 2200);
    return res.json({ ok: true, app: appType, question, answer, createdAt: new Date().toISOString() });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

// GCU PILOT FIX 2026-08-26: fetched by Legal war room with no auth check.
app.post('/api/prompt', requireAnyAuth, async (req, res) => {
  try {
    const { key, context } = req.body || {};
    const prompts = {
      doc_controller: 'You are a financial document controller AI. Analyze accounting documents for errors, missing data, and compliance issues. Be precise and actionable.',
      doc_cfo: 'You are a CFO-level financial AI. Provide executive-level analysis of financial documents with strategic recommendations and risk assessment.',
      doc_variance: 'You are a variance analysis AI. Identify budget variances, anomalies, and financial discrepancies. Quantify impact and recommend corrective actions.',
      doc_triage: 'You are a financial document triage AI. Classify document type, extract key fields, flag critical items, and route to appropriate workflow.'
    };
    const prompt = prompts[key] || 'You are a financial operations AI assistant.';
    return res.json({ ok: true, prompt, context: context || '' });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

// GCU PILOT FIX 2026-08-26: fetched by Legal war room with no auth check.
app.post('/api/financial/query', requireAnyAuth, async (req, res) => {
  try {
    const { system, message, question, query, maxTokens, messages } = req.body || {};
    let msg, sys;
    if (messages && Array.isArray(messages)) {
      sys = messages.find(m => m.role === 'system')?.content || SP.financial;
      msg = messages.find(m => m.role === 'user')?.content || '';
    } else {
      msg = message || question || query || '';
      sys = system || SP.financial;
    }
    if (!msg) return res.status(400).json({ ok: false, error: 'message required' });
    msg = msg.slice(0, 3000);
    let a = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        a = await groqChat(sys, msg, Math.min(maxTokens || 700, 700));
        break;
      } catch(retryErr) {
        if (attempt === 2) throw retryErr;
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
    recordVerticalMemory('financial', msg, a);
    return res.json({ ok: true, answer: a, createdAt: new Date().toISOString() });
  }
  catch (e) {
    console.error('FINANCIAL QUERY ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message, detail: e.stack?.slice(0,200) });
  }
});

// GCU PILOT FIX 2026-08-26: core Legal endpoint, handles privileged case
// data, previously had no auth check.
app.post('/api/legal/query', requireAnyAuth, async (req, res) => {
  try {
    const msg = req.body.message || req.body.question || req.body.query || '';
    const system = req.body.system || SP.legal;
    const maxTokens = req.body.maxTokens || 550;
    let a = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        a = await groqChat(system, msg, maxTokens);
        break;
      } catch (retryErr) {
        if (attempt === 2) throw retryErr;
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
    recordVerticalMemory('legal', msg, a);
    return res.json({ ok: true, answer: a, createdAt: new Date().toISOString() });
  }
  catch (e) {
    console.error('LEGAL QUERY ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message, detail: e.stack?.slice(0,200) });
  }
});

// TSM FIX 2026-08-27: removed a dead, permanently-unreachable duplicate of
// POST /api/construction/query that used to live here. routes/construction.js
// is mounted earlier (app.use(require('./routes/construction')) above) and
// its handler always terminates the response without calling next(), so this
// block never ran on any real request — see the Phase 1 Construction
// chain-audit doc (docs/audit/phase1-construction-chain-audit.md) for the
// full trace. Its two real improvements over the router's old version
// (system-prompt passthrough, recordVerticalMemory logging) have been merged
// into the live handler in routes/construction.js instead of left stranded
// here a second time.

// ── CONSTRUCTION NODE → STRATEGIST → EXECUTIVE CHAIN ──────────────────────────
// Mirrors the healthcare hcNodeReports / TSM_MEMORY.healthcare.nodes pattern:
// war-room nodes (CON-CORE, ZERO-TRUST, TAX-INTEL, COMPLIANCE) push raw findings,
// an AI pass turns each into a structured node result, a command-level BNCA
// synthesizes across nodes, the Construction Strategist adds strategic framing,
// and the Executive Portal turns that into a CFO/decision-maker-ready summary.
const constructionNodeReports = {}; // in-memory hot cache, keyed by nodeId; write-through to tsmLedger below

app.post('/api/construction/node-report', async (req, res) => {
  try {
    const { nodeId, nodeLabel, report, analysisText, costImpact, scheduleImpact, permitIds, severity, kpi, ts } = req.body || {};
    if (!nodeId) return res.status(400).json({ ok: false, error: 'nodeId required' });
    const doc = {
      nodeId,
      nodeLabel: nodeLabel || nodeId,
      report: report || '',
      analysisText: analysisText || '',
      costImpact: costImpact || null,
      scheduleImpact: scheduleImpact || null,
      permitIds: permitIds || [],
      severity: severity || 'INFO',
      kpi: kpi || {},
      ts: ts || Date.now()
    };
    constructionNodeReports[nodeId] = { ...doc, receivedAt: Date.now() };
    console.log('[CONSTRUCTION NODE REPORT] stored:', nodeId, 'severity:', severity);

    try {
      await tsmLedger.verticalUpsertNodeReport('construction', nodeId, doc);
    } catch (ledgerErr) {
      console.warn('[CONSTRUCTION NODE REPORT] ledger write-through failed (in-memory copy still stored):', ledgerErr.message);
    }

    return res.json({ ok: true, nodeId, stored: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/construction/node-reports', async (req, res) => {
  try {
    const memReports = Object.values(constructionNodeReports);
    if (memReports.length) {
      const reports = memReports.sort((a, b) => b.ts - a.ts);
      return res.json({ ok: true, reports, count: reports.length, source: 'memory' });
    }
    const persisted = await tsmLedger.verticalListNodeReports('construction');
    return res.json({ ok: true, reports: persisted, count: persisted.length, source: 'ledger' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/construction/node-reports', async (req, res) => {
  const { nodeId } = req.body || req.query || {};
  try {
    if (nodeId) {
      delete constructionNodeReports[nodeId];
      await tsmLedger.verticalDeleteNodeReport('construction', nodeId);
      return res.json({ ok: true, cleared: nodeId });
    }
    Object.keys(constructionNodeReports).forEach(k => delete constructionNodeReports[k]);
    await tsmLedger.verticalDeleteNodeReport('construction', null);
    return res.json({ ok: true, cleared: 'all' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// AI-analyzed per-node result, written into TSM_MEMORY.construction.nodes[node]
// so downstream BNCA/strategist/executive synthesis has real per-node state to read.
app.post('/api/construction/node/:node', async (req, res) => {
  const node = req.params.node;
  const payload = req.body || {};
  const result = await tsmAIJSON(
    `Analyze construction node ${node}. Payload: ${JSON.stringify(payload).slice(0, 4000)}. Return JSON: {"node":"${node}","status":"READY|WATCH|RISK","top_issue":"...","findings":[],"actions":[],"cost_impact":"...","schedule_impact":"...","bnca":"...","owner_lane":"...","confidence":0}`,
    { node, status: 'WATCH', top_issue: 'Node requires review', findings: [], actions: [], cost_impact: 'Unknown', schedule_impact: 'Unknown', bnca: 'Review node output.', owner_lane: 'project manager', confidence: 80 }
  );
  TSM_MEMORY.construction.nodes[node] = result;
  const schema_check = enforceBNCASchema('node', 'construction', result);
  res.json({ ok: true, node, result, schema_check, ts: new Date().toISOString() });
});

// Command-level BNCA across all reporting nodes (CON-CORE, ZERO-TRUST, TAX-INTEL, COMPLIANCE).
app.post('/api/construction/bnca', async (req, res) => {
  const payload = req.body || {};
  const result = await tsmAIJSON(
    `Construction Command BNCA. Nodes: ${JSON.stringify(TSM_MEMORY.construction.nodes).slice(0, 6000)}. Payload: ${JSON.stringify(payload).slice(0, 4000)}. Return JSON: {"suite":"construction-command","top_issue":"...","risk_level":"READY|WATCH|RISK|URGENT","node_summary":[],"bnca":"...","owner_lanes":[],"hitl_review_required":true,"confidence":0}`,
    { suite: 'construction-command', top_issue: 'Review needed', risk_level: 'WATCH', node_summary: [], bnca: 'Prioritize schedule and cost-overrun risk nodes.', owner_lanes: ['project manager'], hitl_review_required: true, confidence: 82 }
  );
  TSM_MEMORY.construction.bnca = result;
  const schema_check = enforceBNCASchema('bnca', 'construction', result);
  res.json({ ok: true, result, schema_check, ts: new Date().toISOString() });
});

// Construction Strategist synthesis — mirrors /api/hc-strategist/bnca. Reads the full
// construction memory (nodes + command bnca) and produces strategic framing for relay
// into the Construction Strategist page and, eventually, the Sovereign Strategist.
app.post('/api/construction-strategist/bnca', async (req, res) => {
  const payload = req.body || {};
  const result = await tsmAIJSON(
    `Construction Strategist synthesis. Memory: ${JSON.stringify(TSM_MEMORY.construction).slice(0, 8000)}. Payload: ${JSON.stringify(payload).slice(0, 4000)}. Return JSON: {"suite":"construction-strategist","strategic_summary":"...","priority_actions":[],"bnca":"...","relay_to_executive":true,"confidence":0}`,
    { suite: 'construction-strategist', strategic_summary: 'Construction Strategist review needed.', priority_actions: [], bnca: 'Relay to Executive Portal.', relay_to_executive: true, confidence: 82 }
  );
  TSM_MEMORY.construction.strategist = result;
  const schema_check = enforceBNCASchema('strategist', 'construction', result);
  res.json({ ok: true, result, schema_check, ts: new Date().toISOString() });
});

// Executive Portal synthesis — mirrors /api/executive/portal but scoped to construction
// memory instead of healthcare, so the exec portal gets a real CFO-ready decision summary.
app.post('/api/construction/executive-portal', async (req, res) => {
  const payload = req.body || {};
  const result = await tsmAIJSON(
    `Construction Executive Portal. Memory: ${JSON.stringify(TSM_MEMORY.construction).slice(0, 10000)}. Return JSON: {"portal":"executive","audience":"CFO / Decision Maker","decision_summary":"...","bnca_recommendation":"...","hitl_script":"...","approval_path":[],"next_step":"...","confidence":0}`,
    { portal: 'executive', audience: 'CFO / Decision Maker', decision_summary: 'Construction BNCA ready.', bnca_recommendation: 'Approve pilot workflow.', hitl_script: 'Action-ready recommendation and owner lanes for approval.', approval_path: ['Project Manager', 'CFO'], next_step: 'Book walkthrough or approve 30-day pilot.', confidence: 85 }
  );
  TSM_MEMORY.construction.executive = result;
  const schema_check = enforceBNCASchema('executive', 'construction', result);
  res.json({ ok: true, result, schema_check, ts: new Date().toISOString() });
});
// ── END CONSTRUCTION NODE → STRATEGIST → EXECUTIVE CHAIN ──────────────────────

app.post('/api/o2c/query', async (req, res) => {
  const { orders, kpis, sla_breaches, stage_distribution, context, maxTokens } = req.body || {};
  if (!Array.isArray(orders)) return res.status(400).json({ ok: false, error: 'orders array required' });
  const summary = JSON.stringify({ kpis, sla_breaches, stage_distribution, order_count: orders.length }, null, 2);
  const prompt = `Current O2C pipeline snapshot:\n${summary}\n\n` +
    (context ? `Additional context: ${context}\n\n` : '') +
    `Identify the top risks, the root cause of any SLA breaches, and the single most important next action for each at-risk order. Be specific and reference order IDs.`;
  try {
    const answer = await groqChat(SP.o2c, prompt, maxTokens || 1200);
    recordVerticalMemory('o2c', prompt, answer);
    return res.json({ ok: true, answer, createdAt: new Date().toISOString() });
  } catch (e) {
    console.error('O2C GROQ ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/crm/query', async (req, res) => {
  const { leads, contacts, accounts, opportunities, cases, kpis, lead_breaches, opp_breaches, case_breaches, context, maxTokens } = req.body || {};
  const summary = JSON.stringify({
    kpis,
    lead_breaches, opp_breaches, case_breaches,
    counts: {
      leads: Array.isArray(leads) ? leads.length : undefined,
      contacts: Array.isArray(contacts) ? contacts.length : undefined,
      accounts: Array.isArray(accounts) ? accounts.length : undefined,
      opportunities: Array.isArray(opportunities) ? opportunities.length : undefined,
      cases: Array.isArray(cases) ? cases.length : undefined
    }
  }, null, 2);
  const prompt = `Current CRM snapshot:\n${summary}\n\n` +
    (context ? `Additional context: ${context}\n\n` : '') +
    `Identify the highest-risk leads/opportunities/cases, the root cause of any SLA breaches or stalled pipeline stages, and the single most important next action for each at-risk record. Reference record IDs.`;
  try {
    const answer = await groqChat(SP.crm, prompt, maxTokens || 1200);
    recordVerticalMemory('crm', prompt, answer);
    return res.json({ ok: true, answer, createdAt: new Date().toISOString() });
  } catch (e) {
    console.error('CRM GROQ ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});


app.post('/api/noc/query', async (req, res) => {
  const { kpis, incident_breaches, alerts, devices_down, context, maxTokens } = req.body || {};
  const summary = JSON.stringify({
    kpis,
    incident_breaches,
    alerts,
    devices_down,
    counts: {
      alerts: Array.isArray(alerts) ? alerts.length : undefined,
      devices_down: Array.isArray(devices_down) ? devices_down.length : undefined
    }
  }, null, 2);
  const prompt = `Current NOC snapshot:\n${summary}\n\n` +
    (context ? `Additional context: ${context}\n\n` : '') +
    `Identify the highest-severity incidents, correlate any related alerts to their root incident, flag devices contributing to fleet-uptime risk, and the single most important next action for each at-risk incident or device. Reference incident/alert/device IDs.`;
  try {
    const answer = await groqChat(SP.noc, prompt, maxTokens || 1200);
    recordVerticalMemory('noc', prompt, answer);
    return res.json({ ok: true, answer, createdAt: new Date().toISOString() });
  } catch (e) {
    console.error('NOC GROQ ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});


app.post('/api/mortgage/query', async (req, res) => {
  const { kpis, loan_breaches, conditions, exceptions, context, question, query, maxTokens } = req.body || {};
  const userQuestion = question || query;
  const system = context || SP.mortgage;
  let prompt;
  if (userQuestion) {
    // Caller (e.g. re-strategist.html) is driving the conversation directly —
    // use their question as the prompt and their context as the system role.
    prompt = userQuestion;
  } else {
    // Legacy pipeline-snapshot mode (no explicit question supplied).
    const summary = JSON.stringify({
      kpis,
      loan_breaches,
      conditions,
      exceptions,
      counts: {
        conditions: Array.isArray(conditions) ? conditions.length : undefined,
        exceptions: Array.isArray(exceptions) ? exceptions.length : undefined
      }
    }, null, 2);
    prompt = `Current Mortgage pipeline snapshot:\n${summary}\n\n` +
      `Identify the highest-risk loan files, the root cause of any SLA breaches or stalled UW conditions, open compliance exceptions requiring escalation, and the single most important next action for each at-risk loan file. Reference loan/condition/exception IDs.`;
  }
  try {
    const answer = await groqChat(system, prompt, maxTokens || 1200);
    recordVerticalMemory('mortgage', prompt, answer);
    return res.json({ ok: true, answer, createdAt: new Date().toISOString() });
  } catch (e) {
    console.error('MORTGAGE GROQ ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// -- MORTGAGE NODE -> STRATEGIST -> EXECUTIVE CHAIN ------------------------------
// Mirrors the healthcare/construction node -> strategist -> executive pattern,
// scoped to mortgage's real three pipeline entities: loan_files, conditions,
// exceptions. Today the war room's engine.runAnalysis() makes exactly one flat
// AI call over the whole snapshot and everything downstream (strategist,
// executive portal) is pure client-side relay rendering -- TSM_MEMORY.mortgage
// only ever gets the flat recordVerticalMemory recent-query log. This chain
// gives it the same real per-entity + BNCA + strategist + executive depth
// healthcare and construction already have.
const mortgageNodeReports = {}; // in-memory hot cache, keyed by nodeId; write-through to tsmLedger below

app.post('/api/mortgage/node-report', async (req, res) => {
  try {
    const { nodeId, nodeLabel, report, analysisText, exposure, breachCount, loanIds, severity, kpi, ts } = req.body || {};
    if (!nodeId) return res.status(400).json({ ok: false, error: 'nodeId required' });
    const doc = {
      nodeId,
      nodeLabel: nodeLabel || nodeId,
      report: report || '',
      analysisText: analysisText || '',
      exposure: exposure || null,
      breachCount: breachCount || 0,
      loanIds: loanIds || [],
      severity: severity || 'INFO',
      kpi: kpi || {},
      ts: ts || Date.now()
    };
    mortgageNodeReports[nodeId] = { ...doc, receivedAt: Date.now() };
    console.log('[MORTGAGE NODE REPORT] stored:', nodeId, 'severity:', severity);

    // Write-through to durable storage so a restart doesn't silently empty
    // the Intelligence V3 queue. Best-effort: in-memory write above already
    // succeeded, so a ledger failure here degrades to "survives until next
    // restart" rather than failing the request.
    try {
      await tsmLedger.verticalUpsertNodeReport('mortgage', nodeId, doc);
    } catch (ledgerErr) {
      console.warn('[MORTGAGE NODE REPORT] ledger write-through failed (in-memory copy still stored):', ledgerErr.message);
    }

    return res.json({ ok: true, nodeId, stored: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/mortgage/node-reports', async (req, res) => {
  try {
    const memReports = Object.values(mortgageNodeReports);
    if (memReports.length) {
      const reports = memReports.sort((a, b) => b.ts - a.ts);
      return res.json({ ok: true, reports, count: reports.length, source: 'memory' });
    }
    // In-memory cache is empty -- most likely a fresh process since the
    // last restart. Fall back to durable storage rather than returning an
    // empty queue that looks identical to "no findings exist."
    const persisted = await tsmLedger.verticalListNodeReports('mortgage');
    return res.json({ ok: true, reports: persisted, count: persisted.length, source: 'ledger' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/mortgage/node-reports', async (req, res) => {
  const { nodeId } = req.body || req.query || {};
  try {
    if (nodeId) {
      delete mortgageNodeReports[nodeId];
      await tsmLedger.verticalDeleteNodeReport('mortgage', nodeId);
      return res.json({ ok: true, cleared: nodeId });
    }
    Object.keys(mortgageNodeReports).forEach(k => delete mortgageNodeReports[k]);
    await tsmLedger.verticalDeleteNodeReport('mortgage', null);
    return res.json({ ok: true, cleared: 'all' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// AI-analyzed per-entity result, written into TSM_MEMORY.mortgage.nodes[node]
// so downstream BNCA/strategist/executive synthesis has real per-entity state.
app.post('/api/mortgage/node/:node', async (req, res) => {
  const node = req.params.node;
  const payload = req.body || {};
  const result = await tsmAIJSON(
    `Analyze mortgage pipeline entity ${node}. Payload: ${JSON.stringify(payload).slice(0, 4000)}. Return JSON: {"node":"${node}","status":"READY|WATCH|RISK","top_issue":"...","findings":[],"actions":[],"exposure":"...","confidence":0}`,
    { node, status: 'WATCH', top_issue: 'Entity requires review', findings: [], actions: [], exposure: 'Unknown', confidence: 80 }
  );
  TSM_MEMORY.mortgage.nodes[node] = result;
  const schema_check = enforceBNCASchema('node', 'mortgage', result);
  res.json({ ok: true, node, result, schema_check, ts: new Date().toISOString() });
});

// Command-level BNCA across all reporting entities (loan_files, conditions, exceptions).
app.post('/api/mortgage/bnca', async (req, res) => {
  const payload = req.body || {};
  const result = await tsmAIJSON(
    `Mortgage Command BNCA. Entities: ${JSON.stringify(TSM_MEMORY.mortgage.nodes).slice(0, 6000)}. Payload: ${JSON.stringify(payload).slice(0, 4000)}. Return JSON: {"suite":"mortgage-command","top_issue":"...","risk_level":"READY|WATCH|RISK|URGENT","node_summary":[],"bnca":"...","owner_lanes":[],"hitl_review_required":true,"confidence":0}`,
    { suite: 'mortgage-command', top_issue: 'Review needed', risk_level: 'WATCH', node_summary: [], bnca: 'Prioritize SLA-breached loan files and open compliance exceptions.', owner_lanes: ['loan processor'], hitl_review_required: true, confidence: 82 }
  );
  TSM_MEMORY.mortgage.bnca = result;
  const schema_check = enforceBNCASchema('bnca', 'mortgage', result);
  res.json({ ok: true, result, schema_check, ts: new Date().toISOString() });
});

// PM Copilot Strategist synthesis — mirrors /api/construction-strategist/bnca. PM has no
// server-side node state (its relay payload lives client-side in TSM_PM_RELAY), so the real
// portfolio data pm-strategist.html already loaded is passed straight through in req.body
// instead of read back off TSM_MEMORY.pm; only the running strategist output is persisted here.
app.post('/api/pm-strategist/bnca', async (req, res) => {
  const payload = req.body || {};
  const result = await tsmAIJSON(
    `PM Copilot Strategist synthesis. Portfolio relay payload: ${JSON.stringify(payload).slice(0, 8000)}. Return JSON: {"suite":"pm-strategist","strategic_summary":"...","priority_actions":[],"bnca":"...","relay_to_executive":true,"confidence":0}`,
    { suite: 'pm-strategist', strategic_summary: 'PM Strategist review needed.', priority_actions: [], bnca: 'Relay to Executive Portal.', relay_to_executive: true, confidence: 82 }
  );
  TSM_MEMORY.pm.strategist = result;
  const schema_check = enforceBNCASchema('strategist', 'pm', result);
  res.json({ ok: true, result, schema_check, ts: new Date().toISOString() });
});

// Mortgage Strategist synthesis -- mirrors /api/construction-strategist/bnca.
app.post('/api/mortgage-strategist/bnca', async (req, res) => {
  const payload = req.body || {};
  const result = await tsmAIJSON(
    `Mortgage Strategist synthesis. Memory: ${JSON.stringify(TSM_MEMORY.mortgage).slice(0, 8000)}. Payload: ${JSON.stringify(payload).slice(0, 4000)}. Return JSON: {"suite":"mortgage-strategist","strategic_summary":"...","priority_actions":[],"bnca":"...","relay_to_executive":true,"confidence":0}`,
    { suite: 'mortgage-strategist', strategic_summary: 'Mortgage Strategist review needed.', priority_actions: [], bnca: 'Relay to Executive Portal.', relay_to_executive: true, confidence: 82 }
  );
  TSM_MEMORY.mortgage.strategist = result;
  const schema_check = enforceBNCASchema('strategist', 'mortgage', result);
  res.json({ ok: true, result, schema_check, ts: new Date().toISOString() });
});

// Executive Portal synthesis -- CFO-ready decision summary scoped to mortgage memory.
app.post('/api/mortgage/executive-portal', async (req, res) => {
  const payload = req.body || {};
  const result = await tsmAIJSON(
    `Mortgage Executive Portal. Memory: ${JSON.stringify(TSM_MEMORY.mortgage).slice(0, 10000)}. Return JSON: {"portal":"executive","audience":"CFO / Decision Maker","decision_summary":"...","bnca_recommendation":"...","hitl_script":"...","approval_path":[],"next_step":"...","confidence":0}`,
    { portal: 'executive', audience: 'CFO / Decision Maker', decision_summary: 'Mortgage BNCA ready.', bnca_recommendation: 'Approve pilot workflow.', hitl_script: 'Action-ready recommendation and owner lanes for approval.', approval_path: ['Loan Processor', 'CFO'], next_step: 'Book walkthrough or approve 30-day pilot.', confidence: 85 }
  );
  TSM_MEMORY.mortgage.executive = result;
  const schema_check = enforceBNCASchema('executive', 'mortgage', result);
  res.json({ ok: true, result, schema_check, ts: new Date().toISOString() });
});
// -- END MORTGAGE NODE -> STRATEGIST -> EXECUTIVE CHAIN ---------------------------

// ── HOTELOPS: structured maintenance/OTA/compliance analysis ─────────────────
// Mirrors /api/mortgage/query's shape.
app.post('/api/hotelops/query', async (req, res) => {
  const { kpis, maintenance_breaches, ota_exposure, compliance_risk, context, maxTokens } = req.body || {};
  const summary = JSON.stringify({
    kpis,
    maintenance_breaches,
    ota_exposure,
    compliance_risk,
    counts: {
      maintenance_breaches: Array.isArray(maintenance_breaches) ? maintenance_breaches.length : undefined,
      compliance_risk: Array.isArray(compliance_risk) ? compliance_risk.length : undefined
    }
  }, null, 2);
  const prompt = `Current HotelOps property snapshot:\n${summary}\n\n` +
    (context ? `Additional context: ${context}\n\n` : '') +
    `Identify the highest-severity SLA-breached maintenance tickets, the largest OTA overcharge exposure, and the most urgent compliance deadline. Recommend the single most important next action for each. Reference ticket/OTA/compliance IDs.`;
  try {
    const answer = await groqChat(SP.hotelops, prompt, maxTokens || 1200);
    recordVerticalMemory('hotelops', prompt, answer);
    return res.json({ ok: true, answer, createdAt: new Date().toISOString() });
  } catch (e) {
    console.error('HOTELOPS GROQ ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});
// ── HOTELOPS: online booking ingestion ────────────────────────────────────────
// Live guests-book-online path. TSM.relay is a browser-only (localStorage/
// sessionStorage) bus, so a server-side webhook cannot push into it directly.
// This is the bridge: booking source -> server queue (file-persisted, mirrors
// the WIP persistence pattern below) -> war-room client polls -> client commits
// into the engine and does the actual TSM.relay.write() locally.
// Self-contained data dir (not WIP_DATA_DIR -- that's declared further down
// this file, in the WIP persistence section, and this route registers earlier
// at module load time, so referencing it here would throw a TDZ ReferenceError
// on server start).
const HOTELOPS_DATA_DIR = fs.existsSync('/app/data') ? '/app/data' : path.join(__dirname, 'data');
if (!fs.existsSync(HOTELOPS_DATA_DIR)) fs.mkdirSync(HOTELOPS_DATA_DIR, { recursive: true });
const HOTELOPS_BOOKINGS_FILE = path.join(HOTELOPS_DATA_DIR, 'hotelops-bookings.json');

function loadHotelopsBookingQueue() {
  try {
    if (fs.existsSync(HOTELOPS_BOOKINGS_FILE)) {
      const raw = fs.readFileSync(HOTELOPS_BOOKINGS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      return { seq: parsed.seq || 0, bookings: Array.isArray(parsed.bookings) ? parsed.bookings : [] };
    }
  } catch (err) {
    console.error('[hotelops-bookings] load failed, starting empty:', err.message);
  }
  return { seq: 0, bookings: [] };
}

const HOTELOPS_BOOKING_QUEUE = loadHotelopsBookingQueue();
const HOTELOPS_BOOKING_QUEUE_MAX = 500; // trim oldest once polled bookings pile up

let hotelopsBookingSaveTimer = null;
function saveHotelopsBookingQueue() {
  if (hotelopsBookingSaveTimer) clearTimeout(hotelopsBookingSaveTimer);
  hotelopsBookingSaveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(HOTELOPS_BOOKINGS_FILE, JSON.stringify(HOTELOPS_BOOKING_QUEUE, null, 2));
    } catch (err) {
      console.error('[hotelops-bookings] save failed:', err.message);
    }
  }, 250);
}

// Best-effort field extraction so this works whether the caller is our own
// future booking form, a channel manager (Cloudbeds/SiteMinder), or an OTA
// webhook -- each names fields slightly differently.
function pickField(obj, candidates) {
  for (const c of candidates) {
    if (obj[c] !== undefined && obj[c] !== null && obj[c] !== '') return obj[c];
  }
  return undefined;
}

function normalizeIncomingBooking(body) {
  const guestName = pickField(body, ['guest', 'guest_name', 'guestName', 'name']) || 'Unknown guest';
  const roomType = pickField(body, ['room_type', 'roomType', 'room', 'unit_type']) || 'Unspecified';
  const amountRaw = pickField(body, ['amount', 'total_amount', 'totalAmount', 'total', 'price']);
  const amount = amountRaw != null ? Number(amountRaw) : null;
  const paymentStatusRaw = (pickField(body, ['payment_status', 'paymentStatus', 'payment']) || '').toString().toLowerCase();
  const arrivalRaw = pickField(body, ['check_in', 'checkIn', 'arrival_date', 'arrivalDate', 'arrival']);

  let hoursToArrival = null;
  if (arrivalRaw) {
    const arrivalMs = Date.parse(arrivalRaw);
    if (!isNaN(arrivalMs)) hoursToArrival = Math.max(0, Math.round((arrivalMs - Date.now()) / 36e5));
  }

  return {
    res_id: pickField(body, ['res_id', 'reservation_id', 'confirmation_number', 'confirmationNumber']) ||
      `RES-WEB-${Date.now().toString(36).toUpperCase()}`,
    guest: String(guestName),
    room_type: String(roomType),
    status: 'unconfirmed', // front desk / payment confirmation still required before this flips
    payment_status: paymentStatusRaw === 'paid' || paymentStatusRaw === 'succeeded' ? 'paid' : 'pending',
    hours_to_arrival: hoursToArrival,
    amount: amount != null && !isNaN(amount) ? amount : null,
    source: pickField(body, ['source', 'channel', 'platform']) || 'online_booking',
    received_at: new Date().toISOString()
  };
}

// Booking source calls this the moment a reservation is made (direct site
// on successful payment, or the channel manager's webhook config once one
// exists). Requires an X-Webhook-Secret header matching HOTELOPS_WEBHOOK_SECRET
// (see hotelopsWebhookAuthorized() above) -- no real booking source connected yet.

// Stopgap for the still-missing auth on the booking webhook (see comment
// below) -- not a substitute for it, just a backstop against runaway/junk
// traffic in the meantime. Hand-rolled, no new dependency -- consistent
// with this file's existing style (e.g. the WIP save debounce).
const HOTELOPS_WEBHOOK_RATE_LIMIT = { windowMs: 10 * 60 * 1000, maxRequests: 20 };
const hotelopsWebhookHits = new Map(); // ip -> [timestamps]
function hotelopsWebhookRateLimited(ip) {
  const now = Date.now();
  const windowStart = now - HOTELOPS_WEBHOOK_RATE_LIMIT.windowMs;
  let hits = hotelopsWebhookHits.get(ip);
  if (!hits) {
    hits = [];
    hotelopsWebhookHits.set(ip, hits);
  }
  // Drop hits outside the sliding window before counting/pushing.
  while (hits.length && hits[0] < windowStart) hits.shift();
  if (hits.length >= HOTELOPS_WEBHOOK_RATE_LIMIT.maxRequests) return true;
  hits.push(now);
  // Opportunistic cleanup sweep (~1% of calls) so the Map doesn't grow
  // unbounded over a long server lifetime. IP-based only, so this is weak
  // against shared NAT/proxy IPs or a spoofed header.
  if (Math.random() < 0.01) {
    for (const [key, arr] of hotelopsWebhookHits) {
      const trimmed = arr.filter(t => t >= windowStart);
      if (trimmed.length === 0) hotelopsWebhookHits.delete(key);
      else hotelopsWebhookHits.set(key, trimmed);
    }
  }
  return false;
}

function validateBookingPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'Payload must be a JSON object' };
  }
  const guest = pickField(body, ['guest', 'guest_name', 'guestName', 'name']);
  if (guest != null && String(guest).length > 200) {
    return { valid: false, error: 'guest name exceeds 200 characters' };
  }
  const roomType = pickField(body, ['room_type', 'roomType', 'room', 'unit_type']);
  if (roomType != null && String(roomType).length > 200) {
    return { valid: false, error: 'room_type exceeds 200 characters' };
  }
  const amountRaw = pickField(body, ['amount', 'total_amount', 'totalAmount', 'total', 'price']);
  if (amountRaw != null) {
    const amount = Number(amountRaw);
    if (!isFinite(amount) || amount < 0 || amount > 1000000) {
      return { valid: false, error: 'amount must be a finite number between 0 and 1,000,000' };
    }
  }
  const arrivalRaw = pickField(body, ['check_in', 'checkIn', 'arrival_date', 'arrivalDate', 'arrival']);
  if (arrivalRaw != null && isNaN(Date.parse(arrivalRaw))) {
    return { valid: false, error: 'check_in date could not be parsed' };
  }
  return { valid: true };
}

const HOTELOPS_WEBHOOK_SECRET = process.env.HOTELOPS_WEBHOOK_SECRET || '';

function hotelopsWebhookAuthorized(req) {
  // Fail closed: if no secret is configured, reject everything rather than
  // silently allowing unauthenticated writes.
  if (!HOTELOPS_WEBHOOK_SECRET) return false;

  const provided = req.get('X-Webhook-Secret') || '';
  const providedBuf = Buffer.from(provided);
  const secretBuf = Buffer.from(HOTELOPS_WEBHOOK_SECRET);

  if (providedBuf.length !== secretBuf.length) {
    // timingSafeEqual throws on length mismatch. Do a same-length dummy
    // compare so the length check itself doesn't leak timing info.
    crypto.timingSafeEqual(secretBuf, secretBuf);
    return false;
  }
  return crypto.timingSafeEqual(providedBuf, secretBuf);
}

app.post('/api/hotelops/booking-webhook', (req, res) => {
  if (!hotelopsWebhookAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const body = req.body || {};
  if (!body || (Object.keys(body).length === 0)) {
    return res.status(400).json({ ok: false, error: 'Empty booking payload' });
  }
  try {
    const clientIp = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
    if (hotelopsWebhookRateLimited(clientIp)) {
      return res.status(429).json({ ok: false, error: 'Rate limit exceeded, try again later' });
    }
    const validation = validateBookingPayload(body);
    if (!validation.valid) {
      return res.status(400).json({ ok: false, error: validation.error });
    }
    const record = normalizeIncomingBooking(body);
    HOTELOPS_BOOKING_QUEUE.seq += 1;
    record.seq = HOTELOPS_BOOKING_QUEUE.seq;
    HOTELOPS_BOOKING_QUEUE.bookings.push(record);
    if (HOTELOPS_BOOKING_QUEUE.bookings.length > HOTELOPS_BOOKING_QUEUE_MAX) {
      HOTELOPS_BOOKING_QUEUE.bookings = HOTELOPS_BOOKING_QUEUE.bookings.slice(-HOTELOPS_BOOKING_QUEUE_MAX);
    }
    saveHotelopsBookingQueue();
    return res.json({ ok: true, res_id: record.res_id, seq: record.seq });
  } catch (e) {
    console.error('[hotelops-booking-webhook] error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// War-room client polls this; ?since=<lastSeenSeq> returns only newer bookings.
app.get('/api/hotelops/bookings/pending', (req, res) => {
  const since = Number(req.query.since) || 0;
  const pending = HOTELOPS_BOOKING_QUEUE.bookings.filter(b => b.seq > since);
  res.json({ ok: true, bookings: pending, latest_seq: HOTELOPS_BOOKING_QUEUE.seq });
});

// ── SCHOOLS: structured grant/monitoring/exception analysis ──────────────────
// Mirrors /api/mortgage/query's shape. Kept separate from the pre-existing
// generic /api/schools/query (plain question/answer) so nothing there breaks.
// GCU PILOT FIX 2026-08-26: core Schools endpoint, no auth check.
app.post('/api/schools/analysis', requireAnyAuth, async (req, res) => {
  const { kpis, grant_breaches, monitoring_items, exceptions, context, system, maxTokens } = req.body || {};
  const summary = JSON.stringify({
    kpis,
    grant_breaches,
    monitoring_items,
    exceptions,
    counts: {
      monitoring_items: Array.isArray(monitoring_items) ? monitoring_items.length : undefined,
      exceptions: Array.isArray(exceptions) ? exceptions.length : undefined
    }
  }, null, 2);
  const prompt = `Current Schools/Grants compliance snapshot:\n${summary}\n\n` +
    (context ? `Additional context: ${context}\n\n` : '') +
    `Identify the highest-risk grant files, the root cause of any SLA breaches or stalled monitoring items, open compliance exceptions requiring escalation (FERPA/IDEA/NSLP/Title I/ESSER as applicable), and the single most important next action for each at-risk grant file. Reference grant/monitoring-item/exception IDs.`;
  try {
    const answer = await groqChat(system || SP.education, prompt, maxTokens || 1200);
    recordVerticalMemory('schools', prompt, answer);
    return res.json({ ok: true, answer, createdAt: new Date().toISOString() });
  } catch (e) {
    console.error('SCHOOLS ANALYSIS GROQ ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});


app.post('/api/approval/query', async (req, res) => {
  const { requests, kpis, sla_breaches, attention_flags, stage_distribution, context, maxTokens } = req.body || {};
  if (!Array.isArray(requests)) return res.status(400).json({ ok: false, error: 'requests array required' });
  const summary = JSON.stringify({ kpis, sla_breaches, attention_flags, stage_distribution, request_count: requests.length }, null, 2);
  const prompt = `Current Approval Center snapshot:\n${summary}\n\n` +
    (context ? `Additional context: ${context}\n\n` : '') +
    `Identify the highest-risk approval requests, root causes of SLA breaches or escalations, delegation conflicts, and the single most important next action per at-risk request. Reference request IDs. Be specific and operational.`;
  try {
    const answer = await groqChat(SP.approval, prompt, maxTokens || 1200);
    recordVerticalMemory('approval', prompt, answer);
    return res.json({ ok: true, answer, createdAt: new Date().toISOString() });
  } catch (e) {
    console.error('APPROVAL GROQ ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── FOUNDATION: AI Decision Engine ─────────────────────────────────────────
// Generic cross-war-room decision endpoint. Every vertical (o2c, crm, approval,
// cpq, catalog, mdm, and future phases) can call this instead of a bespoke
// /api/{vertical}/query route. `vertical` selects the SP[] system prompt;
// `mode` selects the analysis type; `snapshot` is the vertical's own JSON
// shape (kpis, breaches, records, whatever it already sends).
const FOUNDATION_MODES = {
  root_cause: 'Identify the root cause of the flagged breaches/anomalies below. For each, trace back to the specific operational or data condition that caused it. Reference record/order/request IDs. Be precise and operational. No preamble.',
  anomaly: 'Scan the snapshot below for anomalies -- values, patterns, or records that deviate from expected norms. Rank by severity. Reference specific IDs. No preamble.',
  recommendation: 'Given the snapshot below, recommend the single most important next action for each at-risk item, ordered by priority. Reference specific IDs. Be specific and operational. No preamble.',
  impact: 'Given the snapshot below, quantify the business impact (revenue, cost, SLA, risk exposure) of the flagged items if left unaddressed. Reference specific IDs. No preamble.',
  predictive: 'Given the snapshot below, predict which currently-healthy items are most likely to breach SLA or become at-risk next, and why. Reference specific IDs. No preamble.'
};

app.post('/api/foundation/decision', async (req, res) => {
  const { vertical, mode, snapshot, context, maxTokens } = req.body || {};
  if (!vertical || !SP[vertical]) {
    return res.status(400).json({ ok: false, error: `Unknown vertical "${vertical}". Must be one of: ${Object.keys(SP).join(', ')}` });
  }
  const modeInstruction = FOUNDATION_MODES[mode] || FOUNDATION_MODES.recommendation;
  const summary = JSON.stringify(snapshot || {}, null, 2);
  const prompt = `Current ${vertical.toUpperCase()} snapshot:\n${summary}\n\n` +
    (context ? `Additional context: ${context}\n\n` : '') +
    modeInstruction;
  try {
    const answer = await groqChat(SP[vertical], prompt, maxTokens || 1200);
    recordVerticalMemory(vertical, prompt, answer);
    return res.json({ ok: true, vertical, mode: mode || 'recommendation', answer, createdAt: new Date().toISOString() });
  } catch (e) {
    console.error('FOUNDATION DECISION ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/cpq/query', async (req, res) => {
  const { quotes, kpis, sla_breaches, stage_distribution, context, maxTokens } = req.body || {};
  if (!Array.isArray(quotes)) return res.status(400).json({ ok: false, error: 'quotes array required' });
  const summary = JSON.stringify({ kpis, sla_breaches, stage_distribution, quote_count: quotes.length }, null, 2);
  const prompt = `Current CPQ pipeline snapshot:\n${summary}\n\n` +
    (context ? `Additional context: ${context}\n\n` : '') +
    `Identify the top risks across the quote pipeline, root causes of any SLA breaches or margin violations, and the single most important next action for each at-risk quote. Reference quote IDs. Be specific and operational.`;
  try {
    const answer = await groqChat(SP.cpq, prompt, maxTokens || 1200);
    recordVerticalMemory('cpq', prompt, answer);
    return res.json({ ok: true, answer, createdAt: new Date().toISOString() });
  } catch (e) {
    console.error('CPQ GROQ ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/catalog/query', async (req, res) => {
  const { products, kpis, attention_flags, lifecycle_distribution, context, maxTokens } = req.body || {};
  if (!Array.isArray(products)) return res.status(400).json({ ok: false, error: 'products array required' });
  const summary = JSON.stringify({ kpis, attention_flags, lifecycle_distribution, product_count: products.length }, null, 2);
  const prompt = `Current Product Catalog snapshot:\n${summary}\n\n` +
    (context ? `Additional context: ${context}\n\n` : '') +
    `Identify the top catalog risks (low-stock, compliance, end-of-life, missing data), root causes, and the single most important next action for each flagged product. Reference SKUs/product IDs. Be specific and operational.`;
  try {
    const answer = await groqChat(SP.catalog, prompt, maxTokens || 1200);
    recordVerticalMemory('catalog', prompt, answer);
    return res.json({ ok: true, answer, createdAt: new Date().toISOString() });
  } catch (e) {
    console.error('CATALOG GROQ ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});


app.post('/api/insurance/query', async (req, res) => {
  const { system, message, maxTokens, question, query } = req.body || {};
  const msg = message || question || query || '';
  if (!msg) return res.status(400).json({ ok: false, error: 'message required' });
  try {
    const answer = await groqChat(system || SP.insurance, msg, maxTokens || 600);
    recordVerticalMemory('insurance', msg, answer);
    res.json({ ok: true, answer });
  } catch (e) {
    console.error('GROQ ERROR:', e.message);
    const isCapacityIssue = /rate.?limit|429|All Groq models returned empty/i.test(e.message);
    if (isCapacityIssue) {
      return res.json({
        ok: true,
        degraded: true,
        answer: `[Live AI temporarily unavailable — Groq capacity limit reached. This is a transient issue, not a data or account problem; please retry shortly.]\n\nRequest: "${msg.slice(0, 200)}"`,
      });
    }
    res.status(500).json({ ok: false, error: e.message, detail: e.stack });
  }
});

app.post('/api/insurance/quiz', async (req, res) => {
  const { topic, state, lob, count } = req.body || {};
  const prompt = `Generate ${count || 10} exam-level multiple choice questions for "${topic}" on the ${state} ${lob} insurance licensing exam. Return ONLY a JSON array: [{"q":"Question?","options":["A","B","C","D"],"answer":0,"explanation":"..."}]`;
  try {
    const raw = await groqChat('You are an insurance licensing exam question writer. Respond ONLY with valid JSON — no markdown, no backticks.', prompt, 2200);
    res.json({ ok: true, questions: JSON.parse(raw.replace(/```json|```/g, '').trim()) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/insurance/flashcards', async (req, res) => {
  const { topic, state, lob } = req.body || {};
  const prompt = `Create 15 flashcards for "${topic}" on the ${state} ${lob} insurance exam. Return ONLY JSON: [{"term":"Term","definition":"..."}]`;
  try {
    const raw = await groqChat('You are an insurance exam flashcard creator. Respond ONLY with valid JSON.', prompt, 1400);
    res.json({ ok: true, cards: JSON.parse(raw.replace(/```json|```/g, '').trim()) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/insurance/ahip', async (req, res) => {
  const { moduleTitle, moduleId } = req.body || {};
  try {
    const answer = await groqChat('You are a Medicare insurance compliance expert and AHIP certification trainer. Format with HTML only.', `Create a comprehensive AHIP study guide for: "${moduleTitle}".`, 1600);
    res.json({ ok: true, answer, moduleId });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/insurance/ahip-quiz', async (req, res) => {
  const { count } = req.body || {};
  const prompt = `Generate ${count || 25} AHIP-style multiple choice questions. Return ONLY JSON: [{"q":"Question?","options":["A","B","C","D"],"answer":0,"explanation":"..."}]`;
  try {
    const raw = await groqChat('You are an AHIP Medicare certification exam question writer. Respond ONLY with valid JSON.', prompt, 2800);
    res.json({ ok: true, questions: JSON.parse(raw.replace(/```json|```/g, '').trim()) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/l1-copilot/assistant', async (req, res) => {
  try {
    var scenario = (req.body.scenario || req.body.question || req.body.query || '').trim();
    if (!scenario) return res.status(400).json({ ok: false, error: 'scenario is required' });
    // TSM FIX: req.body.ticket was accepted by nothing -- the assistant's
    // own system prompt (SP.l1Assistant) tells the model to factor in
    // warranty/model info, but no caller ever sent it, so that instruction
    // was always a no-op. Fold whatever ticket fields the caller does send
    // into the user message; older/standalone callers that omit `ticket`
    // (e.g. the generic embeddable widget) are unaffected.
    var t = req.body.ticket || null;
    var ticketLines = t ? Object.entries(t)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n') : '';
    var userMessage = ticketLines
      ? `CURRENT TICKET CONTEXT:\n${ticketLines}\n\nTECHNICIAN QUESTION:\n${scenario}`
      : scenario;
    var a = await groqChat(SP.l1Assistant, userMessage, req.body.maxTokens || 700);
    return res.json({ ok: true, answer: a, createdAt: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// --- ServiceNow CMDB/ITSM integration ---------------------------------
// Real Table API connector (server/l1-copilot/servicenow-adapter.js) — no-ops
// honestly (503 + ok:false) rather than pretending to work when a customer
// hasn't configured SERVICENOW_INSTANCE_URL yet. See the backend spec for
// the full contract this satisfies.

app.get('/api/l1-copilot/servicenow/status', (req, res) => {
  const configured = snAdapter.isConfigured();
  res.json({ ok: true, configured, demoMode: (!configured) && demoData.isDemoModeEnabled() });
});

app.get('/api/l1-copilot/servicenow/asset/:tag', async (req, res) => {
  try {
    const asset = await snAdapter.getAsset(req.params.tag);
    if (!asset) return res.status(404).json({ ok: false, error: `No asset found for tag "${req.params.tag}".` });
    res.json({ ok: true, asset });
  } catch (e) {
    if (e.code === 'SERVICENOW_NOT_CONFIGURED' && demoData.isDemoModeEnabled()) {
      return res.json({ ok: true, asset: demoData.demoAsset(req.params.tag), demoMode: true });
    }
    const status = e.code === 'SERVICENOW_NOT_CONFIGURED' ? 503 : 502;
    res.status(status).json({ ok: false, error: e.message });
  }
});

app.get('/api/l1-copilot/servicenow/ticket/:incident', async (req, res) => {
  try {
    const ticket = await snAdapter.getTicket(req.params.incident);
    if (!ticket) return res.status(404).json({ ok: false, error: `No incident found for "${req.params.incident}".` });
    res.json({ ok: true, ticket });
  } catch (e) {
    if (e.code === 'SERVICENOW_NOT_CONFIGURED' && demoData.isDemoModeEnabled()) {
      return res.json({ ok: true, ticket: demoData.demoTicket(req.params.incident), demoMode: true });
    }
    const status = e.code === 'SERVICENOW_NOT_CONFIGURED' ? 503 : 502;
    res.status(status).json({ ok: false, error: e.message });
  }
});

app.post('/api/l1-copilot/servicenow/work-note', async (req, res) => {
  const { incident, note } = req.body || {};
  if (!incident || !note) return res.status(400).json({ ok: false, error: 'incident and note are required' });
  try {
    const result = await snAdapter.writeWorkNote(incident, note);
    res.json({ ok: true, ...result });
  } catch (e) {
    const status = e.code === 'SERVICENOW_NOT_CONFIGURED' ? 503 : 502;
    res.status(status).json({ ok: false, error: e.message });
  }
});

app.post('/api/l1-copilot/servicenow/status-update', async (req, res) => {
  const { incident, state } = req.body || {};
  if (!incident || !state) return res.status(400).json({ ok: false, error: 'incident and state are required' });
  try {
    const result = await snAdapter.updateTicketStatus(incident, state);
    res.json({ ok: true, ...result });
  } catch (e) {
    const status = e.code === 'SERVICENOW_NOT_CONFIGURED' ? 503 : 502;
    res.status(status).json({ ok: false, error: e.message });
  }
});


// --- L1 Copilot Pilot E2E orchestration ----------------------------------
// Controlled pilot workflow:
// ticket -> enterprise context -> decision -> resolution/escalation.
// Read operations may use configured connectors or explicitly labeled demo
// fallback data. Any ServiceNow writeback remains human-approved.

app.post('/api/l1-copilot/pilot/resolve', async (req, res) => {
  const {
    incident,
    asset,
    device,
    cloudProvider,
    cloudInstance,
    maxTokens
  } = req.body || {};

  if (!incident) {
    return res.status(400).json({
      ok: false,
      error: 'incident is required'
    });
  }

  const provenance = {
    servicenow: 'unavailable',
    intune: 'unavailable',
    cloud: 'not_requested'
  };

  try {
    // ---------------------------------------------------------------
    // 1. ServiceNow ticket
    // ---------------------------------------------------------------
    let ticket = null;

    // Explicit pilot fixture:
    // DEMO-* identifiers always use the labeled demo dataset.
    // This prevents an accidentally configured developer environment
    // from reaching a customer's ServiceNow instance during the pilot demo.
    const explicitDemoTicket =
      /^DEMO-|^INC-DEMO-/i.test(incident);

    if (explicitDemoTicket) {
      ticket = demoData.demoTicket(incident);
      provenance.servicenow = 'demo';
    } else {
      try {
        ticket = await snAdapter.getTicket(incident);

        if (ticket) {
          provenance.servicenow = 'live';
        }
      } catch (e) {
        if (
          e.code === 'SERVICENOW_NOT_CONFIGURED' &&
          demoData.isDemoModeEnabled()
        ) {
          ticket = demoData.demoTicket(incident);
          provenance.servicenow = 'demo';
        } else {
          throw e;
        }
      }
    }

    if (!ticket) {
      return res.status(404).json({
        ok: false,
        error: 'Ticket not found',
        incident
      });
    }

    // ---------------------------------------------------------------
    // 2. ServiceNow asset / CMDB context
    // ---------------------------------------------------------------
    let assetContext = null;
    const assetIdentifier = asset || ticket.asset;

    if (assetIdentifier) {
      try {
        assetContext = await snAdapter.getAsset(assetIdentifier);
        if (assetContext) provenance.servicenow = 'live';
      } catch (e) {
        if (e.code === 'SERVICENOW_NOT_CONFIGURED' &&
            demoData.isDemoModeEnabled()) {
          assetContext = demoData.demoAsset(assetIdentifier);
          provenance.servicenow = provenance.servicenow === 'live'
            ? 'live'
            : 'demo';
        }
      }
    }

    // ---------------------------------------------------------------
    // 3. Microsoft Graph / Intune context
    // ---------------------------------------------------------------
    let deviceContext = null;
    const deviceIdentifier = device || assetContext?.deviceName;

    if (deviceIdentifier) {
      try {
        deviceContext = await graphAdapter.getDevice(deviceIdentifier);
        if (deviceContext) provenance.intune = 'live';
      } catch (e) {
        if (e.code === 'GRAPH_NOT_CONFIGURED' &&
            demoData.isDemoModeEnabled()) {
          deviceContext = demoData.demoDevice(deviceIdentifier);
          provenance.intune = 'demo';
        }
      }
    }

    // ---------------------------------------------------------------
    // 4. Cloud context
    // ---------------------------------------------------------------
    let cloudContext = null;

    if (cloudInstance) {
      if ((cloudProvider || 'aws').toLowerCase() === 'gcp') {
        try {
          cloudContext = await gcpAdapter.getInstance(cloudInstance);
          if (cloudContext) provenance.cloud = 'live';
        } catch (e) {
          if (e.code === 'GCP_NOT_CONFIGURED' &&
              demoData.isDemoModeEnabled()) {
            cloudContext = demoData.demoGcpInstance(cloudInstance);
            provenance.cloud = 'demo';
          }
        }
      } else {
        try {
          cloudContext = await cloudOpsAdapter.getInstance(cloudInstance);
          if (cloudContext) provenance.cloud = 'live';
        } catch (e) {
          if (e.code === 'CLOUD_OPS_NOT_CONFIGURED' &&
              demoData.isDemoModeEnabled()) {
            cloudContext = demoData.demoAwsInstance(cloudInstance);
            provenance.cloud = 'demo';
          }
        }
      }
    }

    // ---------------------------------------------------------------
    // 5. Build unified enterprise context
    // ---------------------------------------------------------------
    const context = {
      ticket,
      asset: assetContext,
      device: deviceContext,
      cloud: cloudContext
    };

    // ---------------------------------------------------------------
    // 6. L1 decision
    // ---------------------------------------------------------------
    const prompt = `You are the TSM L1 Copilot decision engine.

Use ONLY the enterprise context supplied below. Do not invent facts.

ENTERPRISE CONTEXT:
${JSON.stringify(context, null, 2)}

Determine the safest operational path for the L1 technician.

IMPORTANT EVIDENCE RULES:
- Treat ticket/context statements as OBSERVED facts only.
- Treat diagnoses and root causes as INFERRED unless explicitly documented.
- Never say troubleshooting was completed merely because the device exhibits a symptom.
- Never claim a power cycle, hardware check, reboot, diagnostic, repair, policy sync, remediation, or escalation was performed unless the supplied context explicitly documents that action.
- If troubleshooting history is absent, say that it is not documented.
- Do not convert a recommendation into a completed action.
- Evidence must identify whether it is observed or inferred.
- If the ticket only establishes that a device reaches a particular screen/state, do not infer that unrelated L1 checks were completed.

Return ONLY valid JSON in exactly this shape:
{
  "issue_summary": "one sentence",
  "likely_causes": ["cause 1", "cause 2"],
  "confidence": 0,
  "severity": "Low|Medium|High|Critical",
  "business_impact": "short label",
  "recommended_path": "L1_REMEDIATION|ESCALATE_L2|VENDOR_ESCALATION",
  "recommended_action": "single next action",
  "reason": "short explanation",
  "evidence": [
    {
      "type": "observed|inferred",
      "statement": "specific evidence"
    }
  ],
  "completed_actions": [],
  "missing_information": ["important troubleshooting or context not documented"]
}

The "completed_actions" array MUST contain only actions explicitly documented as already performed.
If no completed troubleshooting is documented, return an empty array.

The "missing_information" array should identify important information that would materially affect the decision.

Do not claim an action has already been performed unless the context explicitly says so.`;

    const rawDecision = await groqChat(
      SP.l1support,
      prompt,
      maxTokens || 1000
    );

    const decision = JSON.parse(
      rawDecision.replace(/\`\`\`json|\`\`\`/g, '').trim()
    );

    // ---------------------------------------------------------------
    // 7. Prepare operational package
    // ---------------------------------------------------------------
    let resolution = null;
    let escalation = null;

    if (decision.recommended_path === 'L1_REMEDIATION') {
      const resolutionPrompt = `Prepare a technician-ready L1 action package.

Ticket:
${JSON.stringify(ticket, null, 2)}

Decision:
${JSON.stringify(decision, null, 2)}

Return ONLY valid JSON:
{
  "problem": "short statement",
  "cause": "supported likely cause",
  "actions": ["specific next action"],
  "validation": "how technician verifies success",
  "next_steps": "what happens after validation"
}

Do not claim that any action was already performed.`;

      const rawResolution = await groqChat(
        SP.l1support,
        resolutionPrompt,
        maxTokens || 800
      );

      resolution = JSON.parse(
        rawResolution.replace(/\`\`\`json|\`\`\`/g, '').trim()
      );
    } else {
      const escalationPrompt = `Prepare a concise L2/vendor escalation package.

Ticket:
${JSON.stringify(ticket, null, 2)}

Enterprise context:
${JSON.stringify(context, null, 2)}

Decision:
${JSON.stringify(decision, null, 2)}

Return ONLY valid JSON:
{
  "receiving_team": "team",
  "reason": "why escalation is required",
  "ruled_out": ["what L1 can reasonably rule out"],
  "evidence": ["relevant evidence"],
  "handoff": "what the receiving team needs to do next"
}

Do not invent completed troubleshooting.`;

      const rawEscalation = await groqChat(
        SP.l1support,
        escalationPrompt,
        maxTokens || 900
      );

      escalation = JSON.parse(
        rawEscalation.replace(/\`\`\`json|\`\`\`/g, '').trim()
      );
    }

    return res.json({
      ok: true,
      pilot: true,
      humanApprovalRequired: true,
      incident,
      context,
      decision,
      resolution,
      escalation,
      provenance,
      createdAt: new Date().toISOString()
    });

  } catch (e) {
    console.error('L1 COPILOT PILOT E2E ERROR:', e.message);

    return res.status(500).json({
      ok: false,
      pilot: true,
      error: e.message,
      provenance
    });
  }
});

app.post('/api/l1-copilot/analyze', async (req, res) => {
  const { ticket, maxTokens } = req.body || {};
  if (!ticket || !ticket.description) return res.status(400).json({ ok: false, error: 'ticket.description required' });

  // If ServiceNow is configured and the agent gave us an asset tag or
  // incident number, pull real CMDB/incident history so "likely cause"
  // reasoning has actual warranty/asset context instead of just the typed
  // fields. Best-effort only — a lookup miss or an unconfigured instance
  // never blocks analysis, it just falls back to metadata-only, same as before.
  let cmdbContext = null;
  if (snAdapter.isConfigured()) {
    try {
      const [assetRec, ticketRec] = await Promise.all([
        ticket.asset ? snAdapter.getAsset(ticket.asset).catch(() => null) : null,
        ticket.incident ? snAdapter.getTicket(ticket.incident).catch(() => null) : null
      ]);
      if (assetRec || ticketRec) cmdbContext = { asset: assetRec, ticket: ticketRec };
    } catch (e) { /* best-effort — analysis proceeds without it */ }
  }

  const summary = JSON.stringify({
    incident: ticket.incident, priority: ticket.priority, requester: ticket.requester,
    department: ticket.department, asset: ticket.asset, manufacturer: ticket.manufacturer,
    model: ticket.model, warranty: ticket.warranty
  }, null, 2);
  const cmdbBlock = cmdbContext
    ? `\nReal CMDB/ServiceNow data for this asset/incident (trust this over the agent-typed fields above if they conflict):\n${JSON.stringify(cmdbContext, null, 2)}\n`
    : '';
  const prompt = `Ticket metadata (may be incomplete — fields left blank were not provided):\n${summary}\n${cmdbBlock}\n` +
    `Ticket description (raw, as pasted by the agent):\n${ticket.description}\n\n` +
    `Do two things and return ONLY valid JSON, no markdown, no backticks, in exactly this shape:\n\n` +
    `1) Analyze the ticket:\n` +
    `{"issue_summary":"one sentence","likely_causes":["cause 1","cause 2"],"confidence":0-100,` +
    `"affected_system":"short label","business_impact":"short label","severity":"Low|Medium|High|Critical",` +
    `"recommended_path":"the single next diagnostic or remediation step, and why",` +
    `\n\n2) Extract structured fields mentioned ANYWHERE in the ticket description or metadata above ` +
    `(incident number, priority, requester name, department, assignment group, asset/hostname/tag, ` +
    `manufacturer, model, warranty/support tier). Only include a value if it is actually stated or clearly ` +
    `implied in the text — use null for anything not present. Do not invent values.\n` +
    `"extracted_fields":{"incident":null,"priority":null,"requester":null,"department":null,` +
    `"assignmentGroup":null,"asset":null,"manufacturer":null,"model":null,"warranty":null}}\n\n` +
    `Return one JSON object with both the analysis keys and the "extracted_fields" key at the same top level.`;
  try {
    const raw = await groqChat(SP.l1support, prompt, maxTokens || 1000);
    const analysis = JSON.parse(raw.replace(/```json|```/g, '').trim());

    // ── Deterministic severity guardrail ──────────────────────────────────
    // The LLM provides the initial severity assessment, but obvious hard
    // outage indicators must not be downgraded to Medium/Low solely because
    // the model under-estimated impact.
    //
    // This is intentionally narrow: it only raises severity for strong,
    // explicit outage/access-blocking language. It never lowers severity.
    const descriptionText = String(ticket.description || '').toLowerCase();
    const combinedTicketText = [
      descriptionText,
      String(ticket.department || '').toLowerCase(),
      String(ticket.assignmentGroup || '').toLowerCase()
    ].join(' ');

    const hardOutageSignals = [
      /\bwill not boot\b/,
      /\bwon['’]?t boot\b/,
      /\bdoes not boot\b/,
      /\bcannot boot\b/,
      /\bcan't boot\b/,
      /\bcannot access windows\b/,
      /\bcan't access windows\b/,
      /\bunable to access windows\b/,
      /\bsystem unavailable\b/,
      /\bcompletely unavailable\b/,
      /\bproduction (?:system|server|workstation|application) (?:is )?down\b/,
      /\boperations? (?:are )?blocked\b/,
      /\bbusiness (?:operations|work) (?:are )?blocked\b/
    ];

    const hardOutageDetected = hardOutageSignals.some((rx) => rx.test(combinedTicketText));

    const originalAiSeverity = analysis.severity || null;

    if (
      hardOutageDetected &&
      ['low', 'medium'].includes(String(analysis.severity || '').toLowerCase())
    ) {
      analysis.severity = 'High';
      analysis.severity_guardrail = {
        applied: true,
        original_ai_severity: originalAiSeverity,
        final_severity: 'High',
        reason: 'Deterministic hard-outage signal detected in the ticket; severity was raised to High for human review.'
      };
    } else {
      analysis.severity_guardrail = {
        applied: false,
        original_ai_severity: originalAiSeverity,
        final_severity: analysis.severity || null
      };
    }

    // ── Priority / severity alignment ────────────────────────────────────
    // The AI may identify a higher operational severity than the ticket's
    // original priority. Do not silently change the ticket priority; surface
    // the discrepancy for human review.
    const priorityText = String(ticket.priority || '').toLowerCase();
    const severityText = String(analysis.severity || '').toLowerCase();

    const priorityRank =
      priorityText.includes('1') || priorityText.includes('critical') ? 1 :
      priorityText.includes('2') || priorityText.includes('high') ? 2 :
      priorityText.includes('3') || priorityText.includes('medium') ? 3 :
      priorityText.includes('4') || priorityText.includes('low') ? 4 :
      null;

    const severityRank =
      severityText.includes('critical') ? 1 :
      severityText.includes('high') ? 2 :
      severityText.includes('medium') ? 3 :
      severityText.includes('low') ? 4 :
      null;

    if (priorityRank && severityRank) {
      const mismatch = severityRank < priorityRank;

      analysis.priority_alignment = {
        ticket_priority: ticket.priority,
        ai_severity: analysis.severity,
        status: mismatch ? 'MISMATCH' : 'ALIGNED',
        recommended_priority: mismatch
          ? `${severityRank} - ${analysis.severity.charAt(0).toUpperCase()}${analysis.severity.slice(1)}`
          : ticket.priority,
        requires_human_review: mismatch,
        reason: mismatch
          ? `AI assessed the incident as ${analysis.severity} while the ticket is currently ${ticket.priority}.`
          : 'Ticket priority is consistent with the AI-assessed severity.'
      };
    } else {
      analysis.priority_alignment = {
        ticket_priority: ticket.priority || null,
        ai_severity: analysis.severity || null,
        status: 'UNABLE_TO_COMPARE',
        requires_human_review: false
      };
    }

    // Preserve explicitly supplied structured ticket fields.
    // AI interprets the ticket; it should not be allowed to lose
    // fields that were already provided by the caller.
    const aiFields = analysis.extracted_fields || {};

    analysis.extracted_fields = {
      incident: ticket.incident ?? aiFields.incident ?? null,
      priority: ticket.priority ?? aiFields.priority ?? null,
      requester: ticket.requester ?? aiFields.requester ?? null,
      department: ticket.department ?? aiFields.department ?? null,
      assignmentGroup:
        ticket.assignmentGroup ??
        aiFields.assignmentGroup ??
        null,
      asset: ticket.asset ?? aiFields.asset ?? null,
      manufacturer: ticket.manufacturer ?? aiFields.manufacturer ?? null,
      model: ticket.model ?? aiFields.model ?? null,
      warranty: ticket.warranty ?? aiFields.warranty ?? null
    };

    return res.json({
      ok: true,
      analysis,
      cmdbSourced: !!cmdbContext,
      createdAt: new Date().toISOString()
    });
  } catch (e) {
    console.error('L1 COPILOT ANALYZE ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/l1-copilot/vendor', async (req, res) => {
  const { manufacturer, serviceTag, warranty, issueSummary, maxTokens } = req.body || {};
  if (!manufacturer) return res.status(400).json({ ok: false, error: 'manufacturer required' });
  const prompt = `Manufacturer: ${manufacturer}\nService tag / express service code: ${serviceTag || 'not provided'}\n` +
    `Warranty status: ${warranty || 'unknown'}\nIssue summary: ${issueSummary || 'not provided'}\n\n` +
    `Recommend which ${manufacturer} support tier to engage (e.g. ProSupport vs ProSupport Plus vs Basic/standard warranty), ` +
    `exactly what information the technician should have ready before contacting them (service tag, diagnostic codes, ` +
    `error logs, etc.), and whether this looks like a case for phone support, chat, or an on-site dispatch. Be concise and operational.`;
  try {
    const answer = await groqChat(SP.l1support, prompt, maxTokens || 700);
    return res.json({ ok: true, answer, createdAt: new Date().toISOString() });
  } catch (e) {
    console.error('L1 COPILOT VENDOR ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/l1-copilot/resolution', async (req, res) => {
  const { ticket, analysis, notes, incident, writeToServicenow, maxTokens } = req.body || {};
  if (!ticket) return res.status(400).json({ ok: false, error: 'ticket required' });
  const prompt = `Ticket description:\n${ticket}\n\n` +
    (analysis ? `AI analysis on file:\n${JSON.stringify(analysis, null, 2)}\n\n` : '') +
    (notes ? `Technician notes / troubleshooting steps performed:\n${notes}\n\n` : '') +
    `Write a resolution record ready to paste into ServiceNow, with these exact section headers on their own lines: ` +
    `Problem / Cause / Actions Taken / Resolution / Validation / Next Steps. Be factual — only state actions that are ` +
    `reflected in the notes above; do not invent steps that weren't performed.`;
  try {
    const answer = await groqChat(SP.l1support, prompt, maxTokens || 900);

    // Optional real writeback: only attempted if the caller explicitly asks
    // for it AND passes an incident number AND ServiceNow is configured —
    // never silent, never assumed.
    let servicenow = null;
    if (writeToServicenow && incident) {
      if (!snAdapter.isConfigured()) {
        servicenow = { attempted: true, success: false, error: 'ServiceNow is not configured for this environment.' };
      } else {
        try {
          await snAdapter.writeWorkNote(incident, answer);
          servicenow = { attempted: true, success: true };
        } catch (e) {
          servicenow = { attempted: true, success: false, error: e.message };
        }
      }
    }

    return res.json({ ok: true, answer, servicenow, createdAt: new Date().toISOString() });
  } catch (e) {
    console.error('L1 COPILOT RESOLUTION ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/l1-copilot/escalation', async (req, res) => {
  const { ticket, analysis, reason, evidence, recommendedTeam, maxTokens } = req.body || {};
  if (!ticket) return res.status(400).json({ ok: false, error: 'ticket required' });
  const prompt = `Ticket description:\n${ticket}\n\n` +
    (analysis ? `AI analysis on file:\n${JSON.stringify(analysis, null, 2)}\n\n` : '') +
    `Escalation reason given by technician: ${reason || 'not specified'}\n` +
    `Evidence attached: ${evidence || 'none noted'}\n` +
    `Technician-selected team: ${recommendedTeam || 'not selected'}\n\n` +
    `Write a short escalation package for the receiving L2/vendor team: confirm or correct the recommended team based ` +
    `on where the root cause actually sits, summarize what's been ruled out at L1, state the business impact, and list ` +
    `exactly what the receiving team needs to pick this up without re-doing L1 steps.`;
  try {
    const answer = await groqChat(SP.l1support, prompt, maxTokens || 800);
    return res.json({ ok: true, answer, createdAt: new Date().toISOString() });
  } catch (e) {
    console.error('L1 COPILOT ESCALATION ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/l1-copilot/imaging', async (req, res) => {
  const { taskSequence, bootMethod, status, asset, model, maxTokens } = req.body || {};
  if (!status) return res.status(400).json({ ok: false, error: 'status required' });
  const prompt = `Task sequence / target image: ${taskSequence || 'not specified'}\nBoot method: ${bootMethod || 'not specified'}\n` +
    `Current stage: ${status}\nAsset: ${asset || 'not provided'}\nModel: ${model || 'not provided'}\n\n` +
    `The technician is imaging/re-imaging a Windows 11 endpoint. Given the current stage, identify the most likely cause if the ` +
    `deployment is stuck or has failed at this stage (e.g. PXE/DHCP scope options 66/67, WDS/MDT boundary issues, driver pack ` +
    `mismatch, disk/partition prep, domain join failures), the single next diagnostic step, and whether this needs a driver ` +
    `pack update, a network/DHCP fix, or is progressing normally. Be concise and operational.`;
  try {
    const answer = await groqChat(SP.l1support, prompt, maxTokens || 700);
    return res.json({ ok: true, answer, createdAt: new Date().toISOString() });
  } catch (e) {
    console.error('L1 COPILOT IMAGING ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/l1-copilot/ad-intune', async (req, res) => {
  const { deviceName, joinType, compliance, bitlocker, issueSummary, maxTokens } = req.body || {};
  if (!joinType) return res.status(400).json({ ok: false, error: 'joinType required' });
  const prompt = `Device: ${deviceName || 'not provided'}\nJoin type: ${joinType}\nCompliance state: ${compliance || 'unknown'}\n` +
    `BitLocker/escrow status: ${bitlocker || 'unknown'}\nIssue summary: ${issueSummary || 'not provided'}\n\n` +
    `Diagnose the most likely cause of any compliance drift or BitLocker/escrow gap given this state (e.g. sync delay, ` +
    `stale Autopilot record, conditional access policy, missing compliance policy assignment, TPM/escrow failure), the exact ` +
    `path to look up or force a BitLocker recovery key (Entra ID device blade vs on-prem AD DSA), and whether Autopilot ` +
    `re-enrollment or a compliance policy re-push is needed. Be concise and operational.`;
  try {
    const answer = await groqChat(SP.l1support, prompt, maxTokens || 700);
    return res.json({ ok: true, answer, createdAt: new Date().toISOString() });
  } catch (e) {
    console.error('L1 COPILOT AD/INTUNE ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/l1-copilot/sccm', async (req, res) => {
  const { collection, packageName, status, maxTokens } = req.body || {};
  if (!packageName) return res.status(400).json({ ok: false, error: 'packageName required' });
  const prompt = `Collection: ${collection || 'not provided'}\nPackage/Application: ${packageName}\nLast deployment status: ${status || 'unknown'}\n\n` +
    `Diagnose the likely cause of this SCCM/Software Center deployment state (e.g. content not found on distribution point, ` +
    `client cache exhaustion, boundary/collection membership evaluation delay, execution timeout, pending restart chaining), ` +
    `the single next action (retry deployment, re-distribute content, clear ccmcache, manual install via Software Center, or ` +
    `escalate to the SCCM admin team), and whether this is an L1-actionable fix or needs elevated console access. Be concise and operational.`;
  try {
    const answer = await groqChat(SP.l1support, prompt, maxTokens || 700);
    return res.json({ ok: true, answer, createdAt: new Date().toISOString() });
  } catch (e) {
    console.error('L1 COPILOT SCCM ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/l1-copilot/vmware', async (req, res) => {
  const { component, category, environment, input, issueSummary, maxTokens } = req.body || {};
  if (!input) return res.status(400).json({ ok: false, error: 'input required' });
  const prompt = `Component: ${component || 'not specified'}\nIssue category: ${category || 'not specified'}\n` +
    `Environment: ${environment || 'not specified'}\nRelated ticket summary: ${issueSummary || 'none'}\n\n` +
    `Pasted artifact / question:\n${input}\n\n` +
    `Identify what this is, the most probable root cause, the safest remediation (with exact PowerCLI/REST/CLI commands where ` +
    `applicable), operational risk, and whether this is L1/L2-actionable or needs escalation to the VMware admin team.`;
  try {
    const answer = await groqChat(SP.vmware, prompt, maxTokens || 900);
    return res.json({ ok: true, answer, createdAt: new Date().toISOString() });
  } catch (e) {
    console.error('L1 COPILOT VMWARE ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/l1-copilot/vmware-script', async (req, res) => {
  const { scriptType, request, maxTokens } = req.body || {};
  if (!request) return res.status(400).json({ ok: false, error: 'request required' });
  const prompt = `Generate a ${scriptType || 'PowerCLI'} script for the following requirement:\n\n${request}\n\n` +
    `Return complete, runnable code with brief inline comments explaining each step. Include any prerequisite ` +
    `connection/auth commands (e.g. Connect-VIServer) needed for the script to actually run standalone.`;
  try {
    const answer = await groqChat(SP.vmware, prompt, maxTokens || 1100);
    return res.json({ ok: true, answer, createdAt: new Date().toISOString() });
  } catch (e) {
    console.error('L1 COPILOT VMWARE SCRIPT ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/l1-copilot/cloud-ops', async (req, res) => {
  const { provider, service, environment, input, issueSummary, maxTokens } = req.body || {};
  if (!input) return res.status(400).json({ ok: false, error: 'input required' });
  const prompt = `Cloud provider: ${provider || 'not specified'}\nService/resource: ${service || 'not specified'}\n` +
    `Environment: ${environment || 'not specified'}\nRelated ticket summary: ${issueSummary || 'none'}\n\n` +
    `Pasted artifact / question:\n${input}\n\n` +
    `Identify what this is, the most probable root cause, the safest remediation (with exact CLI/portal steps where ` +
    `applicable), blast radius, and whether this is self-service-actionable or needs escalation and to which team.`;
  try {
    const answer = await groqChat(SP.cloudops, prompt, maxTokens || 900);
    return res.json({ ok: true, answer, createdAt: new Date().toISOString() });
  } catch (e) {
    console.error('L1 COPILOT CLOUD OPS ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// --- Cloud Ops real connector (AWS EC2) ---------------------------------
// Real read-only lookup via AWS SDK v3 (server/l1-copilot/cloud-ops-adapter.js)
// — no-ops honestly (503 + ok:false) rather than pretending to work when
// AWS credentials aren't configured. Diagnostic read access only: no
// start/stop/terminate actions are exposed. Distinct from the AI-advisory
// /api/l1-copilot/cloud-ops route above, which reasons over pasted context
// rather than querying a live account.

app.get('/api/l1-copilot/cloud-ops/status', (req, res) => {
  const configured = cloudOpsAdapter.isConfigured();
  res.json({ ok: true, configured, demoMode: (!configured) && demoData.isDemoModeEnabled() });
});

app.get('/api/l1-copilot/cloud-ops/instance/:identifier', async (req, res) => {
  try {
    const instance = await cloudOpsAdapter.getInstance(req.params.identifier);
    if (!instance) return res.status(404).json({ ok: false, error: `No EC2 instance found for "${req.params.identifier}".` });
    res.json({ ok: true, instance });
  } catch (e) {
    if (e.code === 'CLOUD_OPS_NOT_CONFIGURED' && demoData.isDemoModeEnabled()) {
      return res.json({ ok: true, instance: demoData.demoAwsInstance(req.params.identifier), demoMode: true });
    }
    const status = e.code === 'CLOUD_OPS_NOT_CONFIGURED' ? 503 : 502;
    res.status(status).json({ ok: false, error: e.message });
  }
});

// --- Graph/Intune real connector -----------------------------------------
// Real read-only lookup via Microsoft Graph (server/l1-copilot/graph-intune-adapter.js)
// — no-ops honestly (503 + ok:false) rather than pretending to work when
// AZURE_TENANT_ID/AZURE_CLIENT_ID/AZURE_CLIENT_SECRET aren't configured, or
// when the app registration hasn't been granted admin consent yet (surfaces
// as a 502 with Graph's own permission-denied message). Device compliance
// and encryption status only in this pass — BitLocker recovery-key
// retrieval is intentionally not wired up (see adapter file header).

app.get('/api/l1-copilot/graph-intune/status', (req, res) => {
  const configured = graphAdapter.isConfigured();
  res.json({ ok: true, configured, demoMode: (!configured) && demoData.isDemoModeEnabled() });
});

app.get('/api/l1-copilot/graph-intune/device/:identifier', async (req, res) => {
  try {
    const device = await graphAdapter.getDevice(req.params.identifier);
    if (!device) return res.status(404).json({ ok: false, error: `No managed device found for "${req.params.identifier}".` });
    res.json({ ok: true, device });
  } catch (e) {
    if (e.code === 'GRAPH_NOT_CONFIGURED' && demoData.isDemoModeEnabled()) {
      return res.json({ ok: true, device: demoData.demoDevice(req.params.identifier), demoMode: true });
    }
    const status = e.code === 'GRAPH_NOT_CONFIGURED' ? 503 : 502;
    res.status(status).json({ ok: false, error: e.message });
  }
});

// --- Cloud Ops real connector (GCP Compute Engine) ------------------------
// Real read-only lookup via the official Google Cloud SDK
// (server/l1-copilot/gcp-adapter.js) — no-ops honestly (503 + ok:false)
// rather than pretending to work when GCP_PROJECT_ID / service-account
// credentials aren't configured. Diagnostic read access only.

app.get('/api/l1-copilot/gcp/status', (req, res) => {
  const configured = gcpAdapter.isConfigured();
  res.json({ ok: true, configured, demoMode: (!configured) && demoData.isDemoModeEnabled() });
});

app.get('/api/l1-copilot/gcp/instance/:identifier', async (req, res) => {
  try {
    const instance = await gcpAdapter.getInstance(req.params.identifier);
    if (!instance) return res.status(404).json({ ok: false, error: `No Compute Engine instance found for "${req.params.identifier}".` });
    res.json({ ok: true, instance });
  } catch (e) {
    if (e.code === 'GCP_NOT_CONFIGURED' && demoData.isDemoModeEnabled()) {
      return res.json({ ok: true, instance: demoData.demoGcpInstance(req.params.identifier), demoMode: true });
    }
    const status = e.code === 'GCP_NOT_CONFIGURED' ? 503 : 502;
    res.status(status).json({ ok: false, error: e.message });
  }
});

// --- Onboarding: imaging + account provisioning ---------------------------
// TSM FIX (2026-08-30): these two routes didn't exist at all -- the New
// Hire Onboarding tab's "Start Imaging"/"Provision Account" buttons always
// 404'd. No real imaging-platform (MDT/SCCM/Intune/JAMF) or identity-write
// (Entra ID/Okta/Workspace) adapter exists yet, and account provisioning in
// particular is a real write against a live directory -- not something to
// wire to whatever read-only credentials happen to be configured for the
// AD/Intune device-lookup routes above. So these honestly no-op (503) same
// as the other unconfigured connectors, with a demo-mode fallback so the
// tab is fully clickable/demoable. Real wiring needs a dedicated,
// explicitly-configured adapter — see backend spec §3/§5.
const ONBOARDING_IMAGING_CONFIGURED = () => !!process.env.L1_COPILOT_IMAGING_WEBHOOK_URL;
const ONBOARDING_IDENTITY_CONFIGURED = () => !!process.env.L1_COPILOT_PROVISIONING_WEBHOOK_URL;
const onboardingPreflight = require('./server/l1-copilot/onboarding-preflight');

// Ticket lookup used by resolveProvisioningRequester below -- reuses the
// same real-instance-first, demo-fallback pattern as the
// /api/l1-copilot/servicenow/ticket/:incident route rather than a second
// hand-rolled version of it.
async function resolveTicketForRequester(incident) {
  try {
    return await snAdapter.getTicket(incident);
  } catch (e) {
    if (e.code === 'SERVICENOW_NOT_CONFIGURED' && demoData.isDemoModeEnabled()) {
      return demoData.demoTicket(incident);
    }
    throw e;
  }
}

app.post('/api/l1-copilot/onboarding/image', async (req, res) => {
  const { assetTag, profileId } = req.body || {};
  if (!assetTag) return res.status(400).json({ ok: false, error: 'assetTag required' });
  const imgBlockers = await onboardingPreflight.imagingPreflightBlockers(assetTag, { getDeviceSecurityStatus });
  if (imgBlockers.length) return res.status(409).json({ ok: false, blocked: true, blockers: imgBlockers, error: imgBlockers.join(' ') });
  if (!ONBOARDING_IMAGING_CONFIGURED()) {
    if (demoData.isDemoModeEnabled()) {
      return res.json({ ok: true, ...demoData.demoImagingJob(assetTag, profileId), demoMode: true });
    }
    return res.status(503).json({ ok: false, error: 'No imaging platform is configured (set L1_COPILOT_IMAGING_WEBHOOK_URL to your MDT/SCCM/Intune/JAMF trigger).' });
  }
  try {
    const hookRes = await fetch(process.env.L1_COPILOT_IMAGING_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetTag, profileId })
    });
    if (!hookRes.ok) throw new Error('Imaging platform returned ' + hookRes.status);
    const data = await hookRes.json();
    return res.json({ ok: true, jobId: data.jobId, status: data.status || 'Running', percent: data.percent || 10 });
  } catch (e) {
    return res.status(502).json({ ok: false, error: e.message });
  }
});

app.post('/api/l1-copilot/onboarding/provision', async (req, res) => {
  const { name, email, department, role, requester, incident } = req.body || {};
  if (!name || !email) return res.status(400).json({ ok: false, error: 'name and email required' });
  // requester resolution: prefer the ITSM ticket's own requester field
  // (pulled server-side via resolveTicketForRequester, not trusted from the
  // client) when an incident number is given; fall back to the client-
  // supplied requester string only when there's no incident to look up, or
  // the lookup itself can't produce one. Either way, this only tightens the
  // check -- never loosens the 503-when-unconfigured behavior below.
  const resolvedRequester = await onboardingPreflight.resolveProvisioningRequester(
    incident, requester, { getTicket: resolveTicketForRequester }
  );
  const provBlockers = await onboardingPreflight.provisioningPreflightBlockers(resolvedRequester, { getUserSecurityStatus });
  if (provBlockers.length) return res.status(409).json({ ok: false, blocked: true, blockers: provBlockers, error: provBlockers.join(' ') });
  if (!ONBOARDING_IDENTITY_CONFIGURED()) {
    if (demoData.isDemoModeEnabled()) {
      return res.json({ ok: true, ...demoData.demoProvisionedAccount(name, email), demoMode: true });
    }
    return res.status(503).json({ ok: false, error: 'No identity provider write-integration is configured (set L1_COPILOT_PROVISIONING_WEBHOOK_URL to your Entra ID/Okta/Workspace provisioning flow).' });
  }
  try {
    const hookRes = await fetch(process.env.L1_COPILOT_PROVISIONING_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, department, role })
    });
    if (!hookRes.ok) throw new Error('Identity provider returned ' + hookRes.status);
    const data = await hookRes.json();
    return res.json({ ok: true, userId: data.userId, mfaEnrollmentLink: data.mfaEnrollmentLink || null });
  } catch (e) {
    return res.status(502).json({ ok: false, error: e.message });
  }
});

// --- Security Context: zero-trust / IAM lookup -----------------------------
// device-status is genuinely real when Graph/Intune is configured (reuses
// the same tested graph-intune-adapter.js getDevice() call the AD/Intune
// routes above already use) -- complianceState just gets mapped into the
// Title-Case shape this panel expects. user-status has no live-risk-signal
// adapter yet (that needs IdentityRiskyUser.Read.All / auth-methods Graph
// scopes on top of the device-read scope already granted) -- honestly
// no-ops to demo data rather than fabricating a risk score from nothing.
function mapComplianceState(state) {
  if (state === 'compliant') return 'Compliant';
  if (state === 'noncompliant') return 'Non-Compliant';
  return 'Unknown';
}

// Shared helpers so the onboarding preflight checks below (image/provision)
// reason over the SAME live-or-demo data the /security/* panel already
// shows the tech, instead of the routes drifting out of sync or the
// preflight check trusting client-supplied status fields it can't verify.
async function getUserSecurityStatus(query) {
  if (!query) return null;
  if (demoData.isDemoModeEnabled()) {
    return { ...demoData.demoUserSecurityStatus(query), demoMode: !graphAdapter.isConfigured() };
  }
  return null; // no live identity-risk adapter yet -- caller decides how to handle "unknown"
}

async function getDeviceSecurityStatus(asset) {
  if (!asset) return null;
  if (graphAdapter.isConfigured()) {
    try {
      const device = await graphAdapter.getDevice(asset);
      if (!device) return null;
      return { asset, complianceStatus: mapComplianceState(device.complianceState) };
    } catch (e) {
      if (demoData.isDemoModeEnabled()) return { ...demoData.demoDeviceSecurityStatus(asset), demoMode: true };
      throw e;
    }
  }
  if (demoData.isDemoModeEnabled()) return { ...demoData.demoDeviceSecurityStatus(asset), demoMode: true };
  return null;
}

app.get('/api/l1-copilot/security/user-status', async (req, res) => {
  const query = (req.query.query || '').trim();
  if (!query) return res.status(400).json({ ok: false, error: 'query required' });
  const status = await getUserSecurityStatus(query);
  if (status) return res.json({ ok: true, ...status });
  return res.status(503).json({ ok: false, error: 'No identity-risk adapter is configured for live user-status lookups yet.' });
});

app.get('/api/l1-copilot/security/device-status', async (req, res) => {
  const asset = (req.query.asset || '').trim();
  if (!asset) return res.status(400).json({ ok: false, error: 'asset required' });
  if (graphAdapter.isConfigured()) {
    try {
      const status = await getDeviceSecurityStatus(asset);
      if (!status) return res.status(404).json({ ok: false, error: `No managed device found for "${asset}".` });
      return res.json({ ok: true, ...status });
    } catch (e) {
      return res.status(502).json({ ok: false, error: e.message });
    }
  }
  if (demoData.isDemoModeEnabled()) {
    return res.json({ ok: true, ...demoData.demoDeviceSecurityStatus(asset), demoMode: true });
  }
  return res.status(503).json({ ok: false, error: 'Graph/Intune is not configured for live device-status lookups.' });
});

// GCU PILOT FIX 2026-08-26: core Schools endpoint, no auth check.
app.post('/api/schools/query', requireAnyAuth, async (req, res) => {
  try { var a = await groqChat(req.body.system || SP.education, req.body.message || req.body.question || req.body.query || '', req.body.maxTokens || 550); return res.json({ ok: true, answer: a, createdAt: new Date().toISOString() }); }
  catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

// Sovereign Strategist cross-domain query.
// Real per-vertical state is woven in from three honest sources — nothing here is invented:
//   1) TSM_MEMORY.healthcare — server-authoritative, healthcare's richer node/strategist/exec chain
//   2) TSM_MEMORY[vertical].recent — server-authoritative, a capped real log of what every other
//      vertical's own query/analysis endpoint actually asked and answered (see recordVerticalMemory,
//      wired into financial/legal/construction/o2c/crm/noc/mortgage/hotelops/schools/approval/cpq/
//      catalog/insurance/digitalTwin/foundation-decision as of 2026-08-12) — process-wide, so it
//      persists across browser sessions, unlike relayState below
//   3) req.body.relayState — live browser-session relay reads the caller collected via TSM.relay.read()
//      for whatever verticals that browser session has actually touched (see html/strategist-index.html)
// Any vertical with no data in any source is left OUT of the state block rather than padded with a
// placeholder, and the model is told explicitly not to invent state for verticals not listed.
function buildCrossDomainStateBlock(relayState) {
  const lines = [];
  const hc = TSM_MEMORY.healthcare;
  const hcNodeCount = hc ? Object.keys(hc.nodes || {}).length : 0;
  if (hc && (hcNodeCount || hc.hcStrategist || hc.mainStrategist || hc.executive)) {
    lines.push('HEALTHCARE (server memory, ' + hcNodeCount + ' node report(s) on file): ' +
      JSON.stringify({
        nodeCount: hcNodeCount,
        hcStrategist: hc.hcStrategist,
        mainStrategist: hc.mainStrategist,
        executive: hc.executive
      }).slice(0, 2000));
  }
  for (const vertical of Object.keys(TSM_MEMORY)) {
    if (vertical === 'healthcare') continue;
    const mem = TSM_MEMORY[vertical];
    if (!mem || !Array.isArray(mem.recent) || !mem.recent.length) continue;
    const latest = mem.recent[mem.recent.length - 1];
    lines.push(vertical.toUpperCase() + ' (server memory, ' + mem.recent.length + ' recent quer' +
      (mem.recent.length === 1 ? 'y' : 'ies') + ' on file, last updated ' + mem.lastUpdated + '): ' +
      'most recent — asked "' + latest.prompt.slice(0, 150) + '" -> "' + latest.answer.slice(0, 300) + '"');
  }
  if (relayState && typeof relayState === 'object') {
    for (const domain of Object.keys(relayState)) {
      const payload = relayState[domain];
      if (!payload) continue; // no real data for this domain this session — omit, don't fabricate
      lines.push(domain + ' (live relay, current browser session): ' + JSON.stringify(payload).slice(0, 800));
    }
  }
  if (!lines.length) {
    return '\n\nLIVE CROSS-DOMAIN STATE: none available this session — no vertical has produced live ' +
      'relay or memory data yet. Answer from general expertise, and say so plainly if the question ' +
      'depends on figures that would need live data.';
  }
  return '\n\nLIVE CROSS-DOMAIN STATE (real, server- and session-sourced — verticals not listed here ' +
    'have no live data; do not invent figures for them):\n' + lines.join('\n');
}

app.post('/api/strategist/query', async (req, res) => {
  try {
    const question = (req.body.question || req.body.query || req.body.message || '').toString();
    if (!question.trim()) return res.status(400).json({ ok: false, error: 'question required' });
    const maxTokens = req.body.maxTokens || req.body.max_tokens || 700;
    const appContext = (req.body.context || req.body.system || '').toString();
    const systemPrompt = appContext ? SP.strategist + '\n\n' + appContext : SP.strategist;
    const userMessage = question + buildCrossDomainStateBlock(req.body.relayState);

    const a = await groqChat(systemPrompt, userMessage, maxTokens);
    return res.json({ ok: true, answer: a, response: a, content: a, text: a, reply: a, output: a, createdAt: new Date().toISOString() });
  } catch (e) {
    console.error('STRATEGIST QUERY ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── MISC ROUTES ───────────────────────────────────────────────────────────────
// no-store here matches the pattern already used for /healthcare/<node>
// routes (see the loop above that sets Cache-Control on each node page).
// Without it this file was falling through to the plain express.static
// mount for the whole html/ tree, which sends no Cache-Control override at
// all — harmless most of the time, but it meant a real fix pushed and
// deployed to this file could still be served stale from a browser's
// cache with no way to force a revalidation short of a hard refresh.
app.get(['/html/healthcare/poc-html', '/html/healthcare/poc-html/'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.sendFile(path.join(dirPath, 'healthcare', 'hc-academy', 'poc-html', 'index.html'));
});
app.get('/_debug', (_req, res) => res.json({ dirname: __dirname, dirPath, suitesConfigured: suites.length, cacheBust: 'v2-20260607' }));


// ── BUSINESS DEVELOPMENT WAR ROOM ─────────────────────────────
// TSM Outreach Command Center

app.get('/war-room/outreach', (req, res) => {
    res.sendFile(
        path.join(
            __dirname,
            'html',
            'war-rooms',
            'business-development',
            'tsm-outreach-command-center.html'
        )
    );
});

// Hostname → default landing page when a subdomain requests "/".
// Add one line per customer-facing subdomain that should skip the
// doc-search default and land on the full platform hub instead.
const HOSTNAME_LANDING = {
  'insurance.tsmatter.com': 'tsm-platform-hub.html',
};

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  const landing = HOSTNAME_LANDING[req.hostname] || 'tsm-doc-search-multi.html';
  res.sendFile(path.join(dirPath, landing), (err) => {
    if (err) res.sendFile(path.join(dirPath, 'war-rooms', 'bpo-war', 'bpo-war-room.html'));
  });
});


/* ── REAL ESTATE CANONICAL CONTROL PLANE ─────────────────────────────────── */

/**
 * Canonical Real Estate execution path.
 *
 * Request:
 *   Real Estate / property-management facts
 *
 * Flow:
 *   real-estate-engine
 *       → real-estate-control-plane
 *       → canonical vertical-control-plane
 *
 * This route does not mutate source systems.
 * Any executable action remains behind canonical governance.
 */
app.post('/api/real-estate/control-plane', requireAnyAuth, (req, res) => {
  try {
    const input = req.body || {};

    const result = runRealEstateControlPlane({
      ...input,
      actor:
        input.actor ||
        req.tsmSession?.userId ||
        req.tsmSession?.email ||
        'real-estate-api'
    });

    res.json({
      ok: true,
      vertical: 'real_estate',
      engine: 'real-estate-control-plane',
      result
    });
  } catch (err) {
    console.error('[Real Estate Control Plane]', err);

    res.status(500).json({
      ok: false,
      vertical: 'real_estate',
      error: 'Real Estate control-plane execution failed',
      detail: err.message
    });
  }
});

/* ── END REAL ESTATE CANONICAL CONTROL PLANE ─────────────────────────────── */

/* ════════════════════════════════════════════════════════════════
   DOC ROUTER — implementation
   ════════════════════════════════════════════════════════════════ */


/* ── PM INTELLIGENCE V2 ───────────────────────────────────────────────────── */

/**
 * Build one canonical PM intelligence snapshot.
 *
 * The snapshot intentionally feeds the same normalized payload into:
 *   1. Portfolio Digital Twin
 *   2. Risk Engine
 *   3. Forecast Engine
 *
 * No LLM is required for these calculations.
 */
function buildPmIntelligenceSnapshot(payload) {
  const input = payload || {};
  const twin = buildPortfolioTwin(input);
  const risk = calculateRisk(twin, input);
  const projection = forecast(input, twin, risk);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    engine: 'pm-intelligence-v2',
    twin,
    risk,
    forecast: projection,
    governance: {
      mode: 'DETERMINISTIC',
      llmRequired: false,
      humanApprovalRequired: true,
      writeBackToSourceSystems: false
    }
  };
}

app.post('/api/pm/portfolio-intelligence', requireRole(PM_INTERNAL_ROLES), (req, res) => {
  try {
    res.json(buildPmIntelligenceSnapshot(req.body || {}));
  } catch (err) {
    console.error('[PM Portfolio Intelligence]', err);
    res.status(500).json({
      ok: false,
      error: 'PM portfolio intelligence generation failed'
    });
  }
});

app.post('/api/pm/risk', requireRole(PM_INTERNAL_ROLES), (req, res) => {
  try {
    const payload = req.body || {};
    const twin = buildPortfolioTwin(payload);
    res.json({
      ok: true,
      engine: 'pm-risk-engine-v2',
      risk: calculateRisk(twin, payload)
    });
  } catch (err) {
    console.error('[PM Risk Engine]', err);
    res.status(500).json({
      ok: false,
      error: 'PM risk generation failed'
    });
  }
});

app.post('/api/pm/forecast', requireRole(PM_INTERNAL_ROLES), (req, res) => {
  try {
    const payload = req.body || {};
    const twin = buildPortfolioTwin(payload);
    const risk = calculateRisk(twin, payload);

    res.json({
      ok: true,
      engine: 'pm-forecast-engine-v2',
      forecast: forecast(payload, twin, risk)
    });
  } catch (err) {
    console.error('[PM Forecast Engine]', err);
    res.status(500).json({
      ok: false,
      error: 'PM forecast generation failed'
    });
  }
});

/* ── END PM INTELLIGENCE V2 ───────────────────────────────────────────────── */

/* ── PM EXECUTIVE DECISION ENGINE ─────────────────────────────────────────── */
app.post('/api/pm/executive-decisions', requireRole(PM_INTERNAL_ROLES), (req, res) => {
  try {
    const payload = req.body || {};
    const result = buildDecisionPackage(payload);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[PM Executive Decision Engine]', err);
    res.status(500).json({
      ok: false,
      error: 'PM executive decision generation failed'
    });
  }
});
/* ── END PM EXECUTIVE DECISION ENGINE ─────────────────────────────────────── */

/* ── PM INTELLIGENCE V3 ACTION/VERIFICATION ──────────────────────────────── */

/* ── PM PREDICTIVE PORTFOLIO CONTROL ─────────────────────────────────────── */
app.post('/api/pm/predictive-control', requireRole(PM_INTERNAL_ROLES), (req, res) => {
  try {
    res.json(buildPmPredictiveControl(req.body || {}));
  } catch (err) {
    console.error('[PM Predictive Portfolio Control]', err);
    res.status(500).json({
      ok: false,
      error: 'PM predictive portfolio control generation failed'
    });
  }
});
/* ── END PM PREDICTIVE PORTFOLIO CONTROL ──────────────────────────────────── */

app.post('/api/pm/intelligence-v3', requireRole(PM_INTERNAL_ROLES), async (req, res) => {
  try {
    const payload = req.body || {};

    // Canonical PM intelligence path:
    // findings[] → deterministic PM Decision Engine → V3 action/verification layer.
    //
    // If the caller already provides a canonical decision package, preserve it.
    // Otherwise normalize raw PM findings through V1 before V3 consumes them.
    const hasCanonicalDecisions =
      Array.isArray(payload.decisions) &&
      payload.decisions.length > 0;

    const decisionPackage = hasCanonicalDecisions
      ? payload
      : buildDecisionPackage(payload);

    const decisions =
      (decisionPackage.intelligence && decisionPackage.intelligence.decisions) ||
      decisionPackage.decisions ||
      [];

    // Build the queue fresh (deterministic from decisions[]), then overlay
    // any persisted lifecycle status per action id so a reload reflects
    // real progress instead of resetting everything to OPEN.
    const freshActions = pmActionEngine.buildActionQueue(decisions);
    const overlaidActions = await Promise.all(freshActions.map(resolvePmAction));

    res.json(buildPmIntelligenceV3({ ...decisionPackage, actions: overlaidActions }));
  } catch (err) {
    console.error('[PM Intelligence V3]', err);
    res.status(500).json({
      ok: false,
      error: 'PM intelligence v3 generation failed'
    });
  }
});

// ── MORTGAGE INTELLIGENCE V3 (2026-08-28) ───────────────────────────────────
// Same governed decision/action pattern as PM Copilot above, ported via the
// shared decision-engine core (server/shared/decision-engine-core.js) with
// Mortgage's own domain config (server/mortgage/mortgage-domain-config.js).
// Reuses PM's action-engine.js, intelligence-v3.js, and resolvePmAction as-is
// -- none of those three are PM-specific; only the decision engine itself
// varies per vertical. Action ids are prefixed MTG-DEC/ACT-MTG-DEC so they
// cannot collide with PM's PM-DEC ids in the shared pm_action_status
// collection. Reuses PM_INTERNAL_ROLES (admin/manager/analyst) -- there is
// no separate Mortgage-specific internal role set defined in this codebase.
app.post('/api/mortgage/intelligence-v3', requireRole(PM_INTERNAL_ROLES), async (req, res) => {
  try {
    const payload = req.body || {};

    const hasCanonicalDecisions =
      Array.isArray(payload.decisions) &&
      payload.decisions.length > 0;

    const decisionPackage = hasCanonicalDecisions
      ? payload
      : buildMortgageDecisionPackage(payload);

    const decisions =
      (decisionPackage.intelligence && decisionPackage.intelligence.decisions) ||
      decisionPackage.decisions ||
      [];

    const freshActions = pmActionEngine.buildActionQueue(decisions);
    const overlaidActions = await Promise.all(freshActions.map(resolvePmAction));

    res.json(buildPmIntelligenceV3({ ...decisionPackage, actions: overlaidActions }));
  } catch (err) {
    console.error('[Mortgage Intelligence V3]', err);
    res.status(500).json({
      ok: false,
      error: 'Mortgage intelligence v3 generation failed'
    });
  }
});
// ── END MORTGAGE INTELLIGENCE V3 ────────────────────────────────────────────

// ── MORTGAGE PORTFOLIO INTELLIGENCE (2026-08-28) ────────────────────────────
// Read-only dashboard, same role as /api/pm/portfolio-intelligence. Does
// NOT feed the intelligence-v3 decision path above (PM's own twin/risk/
// forecast stack doesn't either -- V3 goes payload -> decision engine
// directly, confirmed by reading server.js's /api/pm/intelligence-v3
// handler). This is a visibility layer: what does the pipeline look like
// right now, normalized from whatever's actually available (currently
// just persisted node-reports; ready for loanFiles/conditions/etc. once
// a real LOS/servicing-system feed exists -- see
// docs/MORTGAGE_CONSTRUCTION_MAPPING_SPEC.md section 2).
app.post('/api/mortgage/portfolio-intelligence', requireRole(PM_INTERNAL_ROLES), async (req, res) => {
  try {
    const payload = req.body || {};
    let nodeReports = [];
    try {
      nodeReports = await tsmLedger.verticalListNodeReports('mortgage');
    } catch (ledgerErr) {
      console.warn('[Mortgage Portfolio Intelligence] ledger read failed, falling back to payload only:', ledgerErr.message);
    }
    const twin = buildMortgagePortfolioTwin(payload, nodeReports);
    res.json({
      ok: true,
      engine: 'mortgage-portfolio-intelligence-v1',
      generatedAt: new Date().toISOString(),
      twin,
      governance: { mode: 'DETERMINISTIC', llmRequired: false, humanApprovalRequired: true, writeBackToSourceSystems: false }
    });
  } catch (err) {
    console.error('[Mortgage Portfolio Intelligence]', err);
    res.status(500).json({ ok: false, error: 'Mortgage portfolio intelligence generation failed' });
  }
});
// ── END MORTGAGE PORTFOLIO INTELLIGENCE ─────────────────────────────────────

// ── CONSTRUCTION INTELLIGENCE V3 (2026-08-28) ───────────────────────────────
// Same pattern as Mortgage Intelligence V3 above, using Construction's own
// domain config (server/construction/construction-domain-config.js). Action
// ids prefixed CON-DEC/ACT-CON-DEC.
app.post('/api/construction/intelligence-v3', requireRole(PM_INTERNAL_ROLES), async (req, res) => {
  try {
    const payload = req.body || {};

    const hasCanonicalDecisions =
      Array.isArray(payload.decisions) &&
      payload.decisions.length > 0;

    const decisionPackage = hasCanonicalDecisions
      ? payload
      : buildConstructionDecisionPackage(payload);

    const decisions =
      (decisionPackage.intelligence && decisionPackage.intelligence.decisions) ||
      decisionPackage.decisions ||
      [];

    const freshActions = pmActionEngine.buildActionQueue(decisions);
    const overlaidActions = await Promise.all(freshActions.map(resolvePmAction));

    res.json(buildPmIntelligenceV3({ ...decisionPackage, actions: overlaidActions }));
  } catch (err) {
    console.error('[Construction Intelligence V3]', err);
    res.status(500).json({
      ok: false,
      error: 'Construction intelligence v3 generation failed'
    });
  }
});
// ── END CONSTRUCTION INTELLIGENCE V3 ────────────────────────────────────────

// ── CONSTRUCTION PORTFOLIO INTELLIGENCE (2026-08-28) ────────────────────────
// Same role as the Mortgage version above.
app.post('/api/construction/portfolio-intelligence', requireRole(PM_INTERNAL_ROLES), async (req, res) => {
  try {
    const payload = req.body || {};
    let nodeReports = [];
    try {
      nodeReports = await tsmLedger.verticalListNodeReports('construction');
    } catch (ledgerErr) {
      console.warn('[Construction Portfolio Intelligence] ledger read failed, falling back to payload only:', ledgerErr.message);
    }
    const twin = buildConstructionPortfolioTwin(payload, nodeReports);
    res.json({
      ok: true,
      engine: 'construction-portfolio-intelligence-v1',
      generatedAt: new Date().toISOString(),
      twin,
      governance: { mode: 'DETERMINISTIC', llmRequired: false, humanApprovalRequired: true, writeBackToSourceSystems: false }
    });
  } catch (err) {
    console.error('[Construction Portfolio Intelligence]', err);
    res.status(500).json({ ok: false, error: 'Construction portfolio intelligence generation failed' });
  }
});
// ── END CONSTRUCTION PORTFOLIO INTELLIGENCE ─────────────────────────────────

// ── HEALTHCARE INTELLIGENCE V3 (2026-08-29) ─────────────────────────────────
// Same governed decision/action pattern as Mortgage/Construction above, ported
// via the shared decision-engine core with HC's own domain config
// (server/healthcare/hc-domain-config.js). Reuses PM's action-engine.js,
// intelligence-v3.js, and resolvePmAction as-is. Action ids prefixed
// HC-DEC/ACT-HC-DEC so they cannot collide with MTG-DEC/CON-DEC in the
// shared pm_action_status collection. Reuses PM_INTERNAL_ROLES -- there is
// no separate HC-specific internal role set defined in this codebase.
app.post('/api/hc/intelligence-v3', requireRole(PM_INTERNAL_ROLES), async (req, res) => {
  try {
    const payload = req.body || {};

    const hasCanonicalDecisions =
      Array.isArray(payload.decisions) &&
      payload.decisions.length > 0;

    const decisionPackage = hasCanonicalDecisions
      ? payload
      : buildHcDecisionPackage(payload);

    const decisions =
      (decisionPackage.intelligence && decisionPackage.intelligence.decisions) ||
      decisionPackage.decisions ||
      [];

    const freshActions = pmActionEngine.buildActionQueue(decisions);
    const overlaidActions = await Promise.all(freshActions.map(resolvePmAction));

    res.json(buildPmIntelligenceV3({ ...decisionPackage, actions: overlaidActions }));
  } catch (err) {
    console.error('[Healthcare Intelligence V3]', err);
    res.status(500).json({
      ok: false,
      error: 'Healthcare intelligence v3 generation failed'
    });
  }
});
// ── END HEALTHCARE INTELLIGENCE V3 ──────────────────────────────────────────

// ── HEALTHCARE PORTFOLIO INTELLIGENCE (2026-08-29) ──────────────────────────
// Same role as the Mortgage/Construction versions above.
app.post('/api/hc/portfolio-intelligence', requireRole(PM_INTERNAL_ROLES), async (req, res) => {
  try {
    const payload = req.body || {};
    let nodeReports = [];
    try {
      nodeReports = await tsmLedger.verticalListNodeReports('hc');
    } catch (ledgerErr) {
      console.warn('[Healthcare Portfolio Intelligence] ledger read failed, falling back to payload only:', ledgerErr.message);
    }
    const twin = buildHcPortfolioTwin(payload, nodeReports);
    res.json({
      ok: true,
      engine: 'hc-portfolio-intelligence-v1',
      generatedAt: new Date().toISOString(),
      twin,
      governance: { mode: 'DETERMINISTIC', llmRequired: false, humanApprovalRequired: true, writeBackToSourceSystems: false }
    });
  } catch (err) {
    console.error('[Healthcare Portfolio Intelligence]', err);
    res.status(500).json({ ok: false, error: 'Healthcare portfolio intelligence generation failed' });
  }
});
// ── END HEALTHCARE PORTFOLIO INTELLIGENCE ───────────────────────────────────

// ── SCHOOLS INTELLIGENCE V3 (2026-08-29) ────────────────────────────────────
// Same pattern as Healthcare above, using Schools' own domain config
// (server/schools/schools-domain-config.js). Action ids prefixed
// SCH-DEC/ACT-SCH-DEC.
app.post('/api/schools/intelligence-v3', requireRole(PM_INTERNAL_ROLES), async (req, res) => {
  try {
    const payload = req.body || {};

    const hasCanonicalDecisions =
      Array.isArray(payload.decisions) &&
      payload.decisions.length > 0;

    const decisionPackage = hasCanonicalDecisions
      ? payload
      : buildSchoolsDecisionPackage(payload);

    const decisions =
      (decisionPackage.intelligence && decisionPackage.intelligence.decisions) ||
      decisionPackage.decisions ||
      [];

    const freshActions = pmActionEngine.buildActionQueue(decisions);
    const overlaidActions = await Promise.all(freshActions.map(resolvePmAction));

    res.json(buildPmIntelligenceV3({ ...decisionPackage, actions: overlaidActions }));
  } catch (err) {
    console.error('[Schools Intelligence V3]', err);
    res.status(500).json({
      ok: false,
      error: 'Schools intelligence v3 generation failed'
    });
  }
});
// ── END SCHOOLS INTELLIGENCE V3 ─────────────────────────────────────────────

// ── SCHOOLS PORTFOLIO INTELLIGENCE (2026-08-29) ─────────────────────────────
// Same role as the Healthcare version above.
app.post('/api/schools/portfolio-intelligence', requireRole(PM_INTERNAL_ROLES), async (req, res) => {
  try {
    const payload = req.body || {};
    let nodeReports = [];
    try {
      nodeReports = await tsmLedger.verticalListNodeReports('schools');
    } catch (ledgerErr) {
      console.warn('[Schools Portfolio Intelligence] ledger read failed, falling back to payload only:', ledgerErr.message);
    }
    const twin = buildSchoolsPortfolioTwin(payload, nodeReports);
    res.json({
      ok: true,
      engine: 'schools-portfolio-intelligence-v1',
      generatedAt: new Date().toISOString(),
      twin,
      governance: { mode: 'DETERMINISTIC', llmRequired: false, humanApprovalRequired: true, writeBackToSourceSystems: false }
    });
  } catch (err) {
    console.error('[Schools Portfolio Intelligence]', err);
    res.status(500).json({ ok: false, error: 'Schools portfolio intelligence generation failed' });
  }
});
// ── END SCHOOLS PORTFOLIO INTELLIGENCE ──────────────────────────────────────

// Advances one action through OPEN -> ACKNOWLEDGED -> IN_PROGRESS -> RESOLVED.
// VERIFIED is deliberately NOT reachable here -- it requires a recorded
// APPROVED decision from PM_APPROVAL_GATE and only /api/pm/actions/verify
// can set it. Resolves current status from pm_action_status (defaulting to
// OPEN for an action never touched before); does not require or trust a
// client-supplied action body, only the id in the URL and the target status.
app.post('/api/pm/actions/:id/transition', requireRole(PM_INTERNAL_ROLES), async (req, res) => {
  try {
    const actionId = req.params.id;
    const body = req.body || {};
    const nextStatus = body.nextStatus;

    if (!nextStatus) {
      return res.status(400).json({ ok: false, error: 'nextStatus is required' });
    }
    if (nextStatus === 'VERIFIED') {
      return res.status(400).json({
        ok: false,
        error: 'VERIFIED cannot be set via /transition -- approve the action, then call /api/pm/actions/verify'
      });
    }

    const actor = (req.tsmSession && (req.tsmSession.label || req.tsmSession.staffId)) || req.tsmSession.role;

    const persisted = await tsmLedger.pmGetActionStatus(actionId);
    const currentStatus = (persisted && persisted.status) || 'OPEN';

    // Throws on an invalid transition (e.g. OPEN -> RESOLVED) -- action-engine's
    // own VALID_TRANSITIONS map is the single source of truth here, same as
    // every other call site in this codebase.
    const updated = pmActionEngine.transition({ status: currentStatus }, nextStatus, {});

    const doc = await tsmLedger.pmUpsertActionStatus(actionId, {
      status: updated.status,
      verification: (persisted && persisted.verification) || null,
      note: body.note || null,
    }, actor);

    res.json({ ok: true, action: doc });
  } catch (err) {
    console.error('[PM Action Transition]', err);
    res.status(400).json({ ok: false, error: err.message || 'PM action transition failed' });
  }
});

// Records an APPROVED/REJECTED decision against one V3 action id, using the
// authenticated caller's own identity (req.tsmSession, set by requireRole)
// as actor -- not a client-supplied name -- so the audit trail can't be
// spoofed by whoever is holding the fetch call. Idempotent to call more
// than once; /api/pm/actions/verify below only checks that the *latest*
// decision for the action id is APPROVED, so a REJECTED action can be
// re-approved after remediation without any special-case code here.
app.post('/api/pm/actions/:id/approve', requireRole(PM_INTERNAL_ROLES), (req, res) => {
  try {
    const actionId = req.params.id;
    const actor = (req.tsmSession && (req.tsmSession.label || req.tsmSession.staffId)) || req.tsmSession.role;
    const decision = PM_APPROVAL_GATE.recordDecision({
      entityId: actionId,
      entityType: 'pm-action',
      decision: 'APPROVED',
      actor,
      meta: req.body && req.body.meta ? req.body.meta : null
    });
    res.json({ ok: true, decision });
  } catch (err) {
    console.error('[PM Action Approval]', err);
    res.status(400).json({ ok: false, error: err.message || 'PM action approval failed' });
  }
});

app.post('/api/pm/actions/:id/reject', requireRole(PM_INTERNAL_ROLES), (req, res) => {
  try {
    const actionId = req.params.id;
    const actor = (req.tsmSession && (req.tsmSession.label || req.tsmSession.staffId)) || req.tsmSession.role;
    const decision = PM_APPROVAL_GATE.recordDecision({
      entityId: actionId,
      entityType: 'pm-action',
      decision: 'REJECTED',
      actor,
      meta: req.body && req.body.meta ? req.body.meta : null
    });
    res.json({ ok: true, decision });
  } catch (err) {
    console.error('[PM Action Rejection]', err);
    res.status(400).json({ ok: false, error: err.message || 'PM action rejection failed' });
  }
});

// Mirrors GET /api/approval/decisions / /api/governance/risk/decisions --
// exec portal can read the log + stats rollup instead of re-deriving an
// approval rate client-side.
app.get('/api/pm/actions/decisions', requireRole(PM_INTERNAL_ROLES), (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 100;
  res.json({ ok: true, log: PM_APPROVAL_GATE.getLog(limit), stats: PM_APPROVAL_GATE.getStats() });
});

app.post('/api/pm/actions/verify', requireRole(PM_INTERNAL_ROLES), async (req, res) => {
  try {
    const body = req.body || {};

    const actionId = (body.action && body.action.id) || body.actionId;
    if (!actionId) {
      return res.status(400).json({
        ok: false,
        error: 'action id is required'
      });
    }

    // Enforcement point: the latest recorded PM_APPROVAL_GATE decision for
    // this action id must be APPROVED. Previously this route trusted
    // whatever `status` the client put on body.action (verifyPmAction only
    // checked status === 'RESOLVED', a field the caller controls), so
    // "human approval required" was never actually required. This looks up
    // the real decision log instead of the request body.
    const priorDecisions = PM_APPROVAL_GATE.getLog(500).filter(d => d.entityId === actionId);
    const latest = priorDecisions[0]; // getLog() is most-recent-first
    if (!latest || latest.decision !== 'APPROVED') {
      return res.status(409).json({
        ok: false,
        error: 'Action requires a recorded APPROVED decision before verification',
        actionId,
        latestDecision: latest || null
      });
    }

    // Resolve the action's authoritative status from pm_action_status, not
    // from body.action.status -- a client that sent a stale/forged body
    // claiming RESOLVED can no longer bypass the real lifecycle here.
    const persisted = await tsmLedger.pmGetActionStatus(actionId);
    const authoritativeAction = {
      ...(body.action || {}),
      id: actionId,
      status: (persisted && persisted.status) || (body.action && body.action.status) || 'OPEN',
    };

    const result = verifyPmAction(
      authoritativeAction,
      Object.assign({}, body.verification, { verifiedBy: latest.actor })
    );

    if (result.ok) {
      // Persist so a reload of /api/pm/intelligence-v3 shows VERIFIED
      // instead of resetting to whatever buildActionQueue() seeds fresh.
      await tsmLedger.pmUpsertActionStatus(actionId, {
        status: 'VERIFIED',
        verification: result.verification,
      }, latest.actor);
    }

    res.json(result);
  } catch (err) {
    console.error('[PM Action Verification]', err);
    res.status(400).json({
      ok: false,
      error: err.message || 'PM action verification failed'
    });
  }
});
/* ── END PM INTELLIGENCE V3 ACTION/VERIFICATION ───────────────────────────── */



// Models — verify current availability in Groq console if these change
const GROQ_TEXT_MODEL = 'openai/gpt-oss-120b';
// TSM FIX 2026-08-27: meta-llama/llama-4-scout-17b-16e-instruct was shut
// down by Groq on 07/17/26 (see https://console.groq.com/docs/deprecations).
// This model powers every image upload (png/jpg/webp) through
// /api/doc-router/classify — the primary path for
// html/tsm-doc-search-multi.html — so every image classification has been
// failing since mid-July, not just hypothetically. openai/gpt-oss-120b is
// NOT a vision model on Groq (text-only) — per Groq's current vision docs
// (console.groq.com/docs/vision), the supported vision models are
// qwen/qwen3.6-27b and qwen/qwen3.8-27b. Using qwen3.6-27b, Groq's
// documented replacement recommendation for Llama 4 Scout.
const GROQ_VISION_MODEL = 'qwen/qwen3.6-27b';

// Valid node IDs per vertical — keep in sync with VERTICALS in
// tsm-document-search.html if you add/rename nodes.
const DOC_ROUTER_NODES = {
  fo: ['fo-financial', 'fo-accounting', 'fo-pitch', 'fo-bpo', 'fo-demo', 'fo-index', 'strategist'],
  ins: ['ins-az', 'ins-hub', 'ins-bpo', 'ins-pitch', 'ins-index', 'strategist'],
  con: ['con-hub', 'con-pitch', 'con-permits', 'con-strategist', 'con-bpo', 'con-demo', 'con-index', 'strategist'],
  bpo: ['bpo-cmd', 'bpo-int1', 'bpo-access', 'bpo-launch', 'bpo-sops', 'bpo-sales', 'bpo-services', 'bpo-website', 'strategist'],
  re: ['re-finance', 're-market', 're-strategist', 're-exec', 're-doc-command', 'strategist'],
  leg: ['leg-index', 'leg-ediscovery', 'leg-strategist', 'leg-exec', 'strategist'],
  hc: ['hc-denial', 'strategist'],
  // Single-intake-node verticals (same shape as hc above) — one real war
  // room node, no sub-desks yet, so sourceNode is always the war-room node
  // unless the doc is itself an escalation (falls to "strategist" per the
  // "not strategist unless nothing else fits" rule below).
  pm: ['pm-war-room', 'strategist'],
  noc: ['noc-war-room', 'strategist'],
};

const DOC_ROUTER_DOC_TYPES = [
  'CLAIM', 'CLAIM APPEAL', 'POLICY', 'VENDOR INVOICE', 'LEDGER',
  'PERMIT', 'REMITTANCE', 'DOCUMENT REPORT', 'ESCALATION',
  'CONTRACT', 'FILING', 'TITLE DOCUMENT', 'DENIAL',
];

const DOC_ROUTER_PROMPT = `You are TSM's document routing classifier. Analyze the document content (and filename) and return ONLY valid JSON — no markdown fences, no preamble, no commentary.

Return JSON matching exactly this schema:
{
  "documentType": one of ${JSON.stringify(DOC_ROUTER_DOC_TYPES)},
  "verticals": array, subset of ["fo","ins","con","bpo","re","leg","hc","pm","noc"] — "pm" is property management (leases, work orders, vendor certificates, unit turnovers, occupancy); "noc" is network operations (incident reports, outages, asset/ticket data, uptime SLAs). Include MULTIPLE verticals if the content is genuinely relevant to more than one (e.g. a vendor invoice tied to a construction project may be relevant to both "con" and "fo"; a property sale with a legal dispute may be relevant to both "re" and "leg"; a claim denial with financial exposure may be relevant to both "hc" and "fo"; a PM vendor invoice may be relevant to both "pm" and "fo"),
  "primaryVertical": one value from "verticals",
  "routing": {
    "<vertical>": { "sourceNode": "<one valid node id for that vertical>", "nodes": ["<valid node ids...>"] }
    ... one entry for EACH vertical listed in "verticals"
  },
  "fileName": suggested filename ending in ".record",
  "vendor": string or "",
  "invoiceNo": string or "",
  "exclusionCode": string or "",
  "amount": number — dollar exposure/value, 0 if none applicable,
  "client": string or "",
  "ref": string or "",
  "summary": one short sentence describing the document,
  "defectFlags": array of short strings — specific issues/exceptions found in the document. For vertical "re", choose ONLY from this fixed set when applicable: ["Financing Failure","Appraisal Gap","Title Defect","Inspection Issues","UW Conditions","Closing Delay"], and use them to inform routing.re.sourceNode (Financing Failure->re-finance, Appraisal Gap->re-market, Title Defect/UW Conditions->re-strategist, Closing Delay->re-exec, Inspection Issues->re-doc-command). For all other verticals, use concise 2-4 word freeform issue labels relevant to the content (e.g. "Coverage Gap", "Code Violation", "Late Filing"), or [] if no issues are present,
  "bnca": boolean - true ONLY if the document represents an anomaly, discrepancy, denial, dispute, or risk that should escalate to BNCA review,
  "entities": {
    "parties": array of strings - named people/organizations referenced (e.g. "Acme Roofing LLC", "Jane Doe"), [] if none,
    "dates": array of strings - dates found in the document in the format they appear, [] if none,
    "amounts": array of strings - every distinct dollar amount mentioned, formatted as written (e.g. "$47,000.00"), [] if none,
    "identifiers": array of strings - reference numbers, policy numbers, claim numbers, permit numbers, case numbers etc. found in the document (label included, e.g. "Policy #: HP-88231"), [] if none
  }
}

Note: do NOT include a "confidence" or "validation" field - those are computed by the server, not the model.

Valid node IDs per vertical:
fo:  ${DOC_ROUTER_NODES.fo.join(', ')}
ins: ${DOC_ROUTER_NODES.ins.join(', ')}
con: ${DOC_ROUTER_NODES.con.join(', ')}
bpo: ${DOC_ROUTER_NODES.bpo.join(', ')}
re:  ${DOC_ROUTER_NODES.re.join(', ')}  — finance/dti/loan/mortgage->re-finance, appraisal/valuation/comps->re-market, title/lien/compliance/disclosure->re-strategist, closing/escrow/hoa/wire->re-exec, intake/upload/extract->re-doc-command
leg: ${DOC_ROUTER_NODES.leg.join(', ')}
hc:  ${DOC_ROUTER_NODES.hc.join(', ')}
pm:  ${DOC_ROUTER_NODES.pm.join(', ')}
noc: ${DOC_ROUTER_NODES.noc.join(', ')}

Rules:
- Always include "strategist" in routing.<vertical>.nodes for every vertical listed.
- If "bnca" is true, also append "bnca-engine" to routing.<vertical>.nodes for every vertical listed.
- "sourceNode" must be the node most directly responsible for this document type (not "strategist" unless nothing else fits).
- If the document doesn't clearly belong anywhere, return "verticals": [] and leave "routing" as {}.
- Be conservative with "bnca" — only flag genuine anomalies, denials, disputes, code violations, SLA breaches, or financial exposure outliers.`;

// -- Deterministic validation + confidence (Phase 4, Mission Preview) --
// Deliberately NOT model-generated: LLM self-reported confidence scores are
// poorly calibrated, and routing correctness is a safety-relevant decision
// (same principle already used for checkStatus in the playbook route below -
// the model proposes content, code decides anything that affects where a
// document actually goes). This just checks the model's own output against
// its own schema and scores completeness; it can't fix a wrong classification,
// only catch a malformed one.
function validateClassification(parsed) {
  const errors = [];
  const verticals = Array.isArray(parsed.verticals) ? parsed.verticals : [];
  const validVerticalIds = Object.keys(DOC_ROUTER_NODES);

  if (!DOC_ROUTER_DOC_TYPES.includes(parsed.documentType)) {
    errors.push('documentType "' + parsed.documentType + '" is not in the allowed set.');
  }

  verticals.forEach((v) => {
    if (!validVerticalIds.includes(v)) {
      errors.push('vertical "' + v + '" is not a recognized vertical.');
      return;
    }
    const r = (parsed.routing && parsed.routing[v]) || null;
    if (!r) {
      errors.push('vertical "' + v + '" is listed but has no routing entry.');
      return;
    }
    const validNodes = DOC_ROUTER_NODES[v];
    if (!validNodes.includes(r.sourceNode)) {
      errors.push('routing.' + v + '.sourceNode "' + r.sourceNode + '" is not a valid node id.');
    }
    const nodes = Array.isArray(r.nodes) ? r.nodes : [];
    nodes.forEach((n) => {
      if (n === 'bnca-engine') return; // cross-cutting node, valid in every vertical when bnca is flagged
      if (!validNodes.includes(n)) {
        errors.push('routing.' + v + '.nodes contains invalid node id "' + n + '".');
      }
    });
    if (!nodes.includes('strategist')) {
      errors.push('routing.' + v + '.nodes is missing required "strategist" entry.');
    }
  });

  if (verticals.length > 0 && !verticals.includes(parsed.primaryVertical)) {
    errors.push('primaryVertical "' + parsed.primaryVertical + '" is not one of the listed verticals.');
  }

  const amountNum = Number(parsed.amount);
  if (parsed.amount !== undefined && (!Number.isFinite(amountNum) || amountNum < 0)) {
    errors.push('amount "' + parsed.amount + '" is not a valid non-negative number.');
  }

  return { valid: errors.length === 0, errors };
}

function scoreConfidence(parsed, validation) {
  if (!validation.valid) {
    // A schema violation means the routing itself can't be trusted;
    // cap confidence low regardless of how "complete" the rest looks.
    return 0.2;
  }

  let score = 0.5; // base score for a structurally valid, in-schema response
  const bump = (cond, amt) => { if (cond) score += amt; };

  bump(!!parsed.vendor, 0.05);
  bump(!!parsed.invoiceNo || !!(parsed.entities && parsed.entities.identifiers && parsed.entities.identifiers.length), 0.05);
  bump(!!parsed.client, 0.05);
  bump(!!parsed.summary && parsed.summary.length > 0, 0.05);
  bump(Number(parsed.amount) > 0, 0.05);
  bump(!!(parsed.entities && parsed.entities.parties && parsed.entities.parties.length), 0.05);
  bump(!!(parsed.entities && parsed.entities.dates && parsed.entities.dates.length), 0.05);
  bump(Array.isArray(parsed.verticals) && parsed.verticals.length === 1, 0.05); // single clear vertical > ambiguous multi-vertical guess
  bump(Array.isArray(parsed.defectFlags) && parsed.defectFlags.length > 0, 0.05);

  return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
}

// -- Phase 8: derived routing recommendations (still deterministic) --
// Solo-owner phase: every vertical routes to Latorrey until a client/team
// subscribes to that vertical specifically. Update TEAM_BY_VERTICAL entries
// as ownership gets assigned out — this map is meant to grow, not stay flat.
const TEAM_BY_VERTICAL = {}; // empty = fall through to default owner below
const DEFAULT_OWNER = 'Latorrey';

function suggestTeam(parsed) {
  if (!parsed.primaryVertical) return DEFAULT_OWNER;
  return TEAM_BY_VERTICAL[parsed.primaryVertical] || DEFAULT_OWNER;
}

function scorePriority(parsed, validation, confidence) {
  const amountNum = Number(parsed.amount) || 0;
  const hasDefects = Array.isArray(parsed.defectFlags) && parsed.defectFlags.length > 0;

  if (!validation.valid) return 'Needs Review';
  if (confidence < 0.5) return 'Needs Review';
  if (hasDefects || amountNum > 25000) return 'High';
  if (amountNum > 5000) return 'Medium';
  return 'Low';
}

// crude in-memory rate limit: 20 requests / 5 min / IP
const docRouterHits = new Map();
function docRouterRateOk(ip) {
  const now = Date.now();
  const hits = (docRouterHits.get(ip) || []).filter(t => now - t < 5 * 60 * 1000);
  if (hits.length >= 20) return false;
  hits.push(now);
  docRouterHits.set(ip, hits);
  return true;
}

app.post('/api/doc-router/classify', async (req, res) => {
  try {
    if (!docRouterRateOk(req.ip)) {
      return res.status(429).json({ error: 'Rate limit exceeded — try again shortly.' });
    }

    const { fileName, mimeType, textContent, imageBase64 } = req.body || {};
    if (!textContent && !imageBase64) {
      return res.status(400).json({ error: 'No content provided.' });
    }

    let userContent;
    let model;

    if (imageBase64) {
      model = GROQ_VISION_MODEL;
      userContent = [
        { type: 'text', text: `Filename: ${fileName || 'unknown'}\n\n${DOC_ROUTER_PROMPT}` },
        { type: 'image_url', image_url: { url: `data:${mimeType || 'image/png'};base64,${imageBase64}` } },
      ];
    } else {
      model = GROQ_TEXT_MODEL;
      userContent = `Filename: ${fileName || 'unknown'}\n\nDocument content:\n${String(textContent).slice(0, 12000)}\n\n${DOC_ROUTER_PROMPT}`;
    }

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'Respond with ONLY valid JSON. No markdown fences, no preamble, no trailing text.' },
          { role: 'user', content: userContent },
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    });

    if (!groqRes.ok) {
      // Match /api/hc/stream's convention: forward Groq's actual message
      // instead of swallowing it into a generic string. Without this, a
      // rate-limit error (which includes the exact wait time, e.g. "try
      // again in 14.257s") and an unrelated 500 both surfaced to the
      // browser as the identical "Classification service error." string,
      // making it impossible to tell them apart without server console
      // access. Same content-type guard as /api/hc/stream: Groq's error
      // body isn't guaranteed to be JSON.
      let msg = 'Classification service error.';
      try {
        const ct = groqRes.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          const errBody = await groqRes.json();
          msg = errBody.error?.message || msg;
        } else {
          const txt = await groqRes.text();
          if (txt) msg = txt.replace(/\s+/g, ' ').trim().slice(0, 300);
        }
      } catch (_) {}
      console.error('[doc-router] Groq error:', groqRes.status, msg);
      return res.status(502).json({ error: msg });
    }

    const data = await groqRes.json();
    let parsed;
    try {
      parsed = JSON.parse(data.choices[0].message.content);
    } catch (e) {
      console.error('[doc-router] Bad JSON from model:', data.choices?.[0]?.message?.content);
      return res.status(502).json({ error: 'Invalid classification response.' });
    }

    // Deterministic pass - never trust the model's own read of its schema
    // compliance. Attached to the response, not thrown, so a malformed doc
    // still reaches the frontend (Mission Preview) with a visible warning
    // instead of a hard failure - same reasoning as the playbook route below.
    const validation = validateClassification(parsed);
    if (!validation.valid) {
      console.warn('[doc-router] classification failed validation:', validation.errors);
    }
    parsed.validation = validation;
    parsed.confidence = scoreConfidence(parsed, validation);
    parsed.suggestedTeam = suggestTeam(parsed);
    parsed.priority = scorePriority(parsed, validation, parsed.confidence);

    res.json(parsed);
  } catch (err) {
    console.error('[doc-router] error:', err);
    res.status(500).json({ error: 'Internal error.' });
  }
});


/* ══════════════════════════════════════════════════════════════════════
   POST /api/doc-router/playbook
   ------------------------------------------------------------------
   Drop-in addition to server.js, placed directly after the existing
   /api/doc-router/classify route (~line 1488) so it can reuse
   GROQ_TEXT_MODEL and the same conventions.

   WHAT THIS DOES
   Takes the already-classified document (documentType, exclusionCode,
   vendor, amount, defectFlags, summary, and — new — the raw extracted
   text) and generates a narrative + action steps + risk assessment
   GROUNDED IN THIS SPECIFIC DOCUMENT, instead of the fixed STEP_SETS
   lookup table in openHcNodeWithDoc() on the frontend.

   WHAT THIS DELIBERATELY DOES NOT DO
   It does NOT decide checkStatus or which node/specialist the doc
   routes to. That stays on the frontend, deterministic, driven by
   HC_CODE_NODE / HC_TYPE_NODE string-matching on the exclusion code —
   unchanged. Routing a denial to the wrong specialist because a model
   miscategorized it is a worse failure than a generic step list, so
   the safety-relevant decision stays rule-based and auditable; only
   the *content* (narrative/steps/risk rationale) is generated. If you
   later want the model to also propose checkStatus, have it return a
   suggestion and diff it against the deterministic value rather than
   trusting it outright — surfacing disagreement is more useful than
   silently overriding a rule you already trust.

   FAILURE MODE
   Unlike /api/doc-router/classify (which 502s on failure — a doc that
   fails to classify just doesn't get filed anywhere, so failing loud
   is correct), this route degrades to the same template steps the
   frontend used before, server-side, so callers always get a 200 with
   *something* clinically usable. This endpoint sits in front of an
   active billing/appeal workflow — returning a hard error mid-triage
   is worse than returning the conservative generic playbook.
   ══════════════════════════════════════════════════════════════════════ */

// Same fixed fallback content as the current frontend STEP_SETS — kept
// here so the server can degrade gracefully without depending on the
// client to have its own copy in sync.
const PLAYBOOK_FALLBACK_STEPS_HC = {
  DENIAL_RISK: ['Pull full EOB/ERA — identify exact CARC/RARC denial codes',
    'Verify CPT/ICD-10 pairing and modifier alignment',
    'Confirm appeal window — timely filing deadline critical',
    'Draft appeal with medical necessity documentation',
    'Submit via payer portal and log tracking number in AR'],
  AUTH_BLOCK: ['Verify current prior auth status for all procedures',
    'Contact payer prior auth line — escalate if wait > 2 hrs',
    'Do NOT bill until auth is confirmed and on file',
    'Document auth number in claim header before submission',
    'Set 48-hr follow-up until resolved'],
  PAYMENT_BLOCK: ['Pull ERA/835 and compare posted amounts to contracted rate',
    'Flag variances >5% as underpayments — initiate appeal',
    'Check for payer hold — contact payer relations if active',
    'Post clean items; quarantine disputed amounts',
    'Escalate unresolved ERA failures within 24 hours'],
  COMPLIANCE_BLOCK: ['Halt billing until all compliance flags are cleared',
    'Obtain updated HIPAA authorization if expired',
    'Verify OIG exclusion list for all providers on this account',
    'Complete documentation checklist before releasing to billing',
    'File compliance resolution memo and update score tracker'],
  LEGAL_HOLD: ['Escalate to legal counsel immediately',
    'Document chain of custody for all related files',
    'Suspend vendor payments pending legal clearance',
    'Prepare regulatory defense memo if requested',
    'Set 48-hr check-in cadence with legal team'],
  DOCUMENTATION_BLOCK: ['Send provider query — 24-hour response expectation',
    'Block claim release for undocumented encounters',
    'Route corrected records to coding for ICD-10 validation',
    'Re-submit to billing queue only after defects resolved'],
  ACTIVE: ['Review document for anomalies', 'Escalate to node specialist',
    'Document findings in AR system', 'Follow up within 48 hours'],
};

const PLAYBOOK_FALLBACK_STEPS_FO = {
  DENIAL_RISK: ['Pull the source ledger entry and identify the exact variance/rejection code',
    'Verify GL account coding and posting period alignment',
    'Confirm reconciliation deadline for this cycle',
    'Draft variance explanation with supporting documentation',
    'Post adjustment and log reference number in the ledger'],
  AUTH_BLOCK: ['Verify current approval status for this transaction',
    'Contact approver/manager — escalate if pending > 2 business days',
    'Do NOT post until approval is confirmed and documented',
    'Attach approval reference before final posting',
    'Set 48-hr follow-up until resolved'],
  PAYMENT_BLOCK: ['Pull AP/AR aging detail and compare to expected terms',
    'Flag variances >5% as discrepancies — initiate review',
    'Check for vendor/client hold — contact AP/AR relations if active',
    'Post clean items; quarantine disputed amounts',
    'Escalate unresolved reconciliation failures within 24 hours'],
  COMPLIANCE_BLOCK: ['Halt posting until all compliance flags are cleared',
    'Obtain updated internal control sign-off if expired',
    'Verify vendor/client standing before proceeding',
    'Complete documentation checklist before releasing to close',
    'File resolution memo and update variance tracker'],
  LEGAL_HOLD: ['Escalate to legal/compliance counsel immediately',
    'Document chain of custody for all related records',
    'Suspend related payments pending legal clearance',
    'Prepare audit defense memo if requested',
    'Set 48-hr check-in cadence with legal/compliance team'],
  DOCUMENTATION_BLOCK: ['Send preparer query — 24-hour response expectation',
    'Block record release for undocumented entries',
    'Route corrected records for GL coding validation',
    'Re-submit to close queue only after defects resolved'],
  ACTIVE: ['Review document for anomalies', 'Escalate to node specialist',
    'Document findings in the ledger', 'Follow up within 48 hours'],
};

const PLAYBOOK_FALLBACK_STEPS_INS = {
  DENIAL_RISK: ['Pull the full claim file and identify exact denial/exception code',
    'Verify coverage terms and policy exclusions against the claim',
    'Confirm appeal/dispute window — timely filing deadline critical',
    'Draft appeal with supporting coverage documentation',
    'Submit via carrier portal and log tracking number'],
  AUTH_BLOCK: ['Verify current underwriting/approval status for this policy',
    'Contact carrier underwriting line — escalate if wait > 2 business days',
    'Do NOT bind or renew until approval is confirmed and on file',
    'Document approval number before proceeding',
    'Set 48-hr follow-up until resolved'],
  PAYMENT_BLOCK: ['Pull remittance detail and compare posted amounts to policy terms',
    'Flag variances >5% as underpayments — initiate dispute',
    'Check for carrier hold — contact carrier relations if active',
    'Post clean items; quarantine disputed amounts',
    'Escalate unresolved remittance failures within 24 hours'],
  COMPLIANCE_BLOCK: ['Halt processing until all compliance flags are cleared',
    'Obtain updated authorization/disclosure if expired',
    'Verify licensing/exclusion status for all parties on this policy',
    'Complete documentation checklist before releasing for binding',
    'File compliance resolution memo and update tracker'],
  LEGAL_HOLD: ['Escalate to legal counsel immediately',
    'Document chain of custody for all related files',
    'Suspend related payments pending legal clearance',
    'Prepare regulatory defense memo if requested',
    'Set 48-hr check-in cadence with legal team'],
  DOCUMENTATION_BLOCK: ['Send insured/agent query — 24-hour response expectation',
    'Block claim release for undocumented items',
    'Route corrected records for underwriting validation',
    'Re-submit to processing queue only after defects resolved'],
  ACTIVE: ['Review document for anomalies', 'Escalate to node specialist',
    'Document findings in the claims system', 'Follow up within 48 hours'],
};

const PLAYBOOK_FALLBACK_STEPS_CON = {
  DENIAL_RISK: ['Pull the full permit/inspection file and identify exact rejection code',
    'Verify plan/spec alignment against the cited violation',
    'Confirm appeal/resubmission window — deadline critical',
    'Draft response with corrected documentation',
    'Submit via jurisdiction portal and log tracking number'],
  AUTH_BLOCK: ['Verify current permit/authorization status for all affected work',
    'Contact permitting office — escalate if wait > 2 business days',
    'Do NOT proceed with work until authorization is confirmed and on file',
    'Document permit number before work resumes',
    'Set 48-hr follow-up until resolved'],
  PAYMENT_BLOCK: ['Pull subcontractor/vendor invoice and compare to contracted rate',
    'Flag variances >5% as discrepancies — initiate dispute',
    'Check for vendor hold — contact AP if active',
    'Post clean items; quarantine disputed amounts',
    'Escalate unresolved billing failures within 24 hours'],
  COMPLIANCE_BLOCK: ['Halt work until all compliance/code flags are cleared',
    'Obtain updated safety/inspection sign-off if expired',
    'Verify licensing/insurance status for all subs on this job',
    'Complete documentation checklist before releasing to next phase',
    'File compliance resolution memo and update tracker'],
  LEGAL_HOLD: ['Escalate to legal counsel immediately',
    'Document chain of custody for all related permits/records',
    'Suspend vendor payments pending legal clearance',
    'Prepare regulatory defense memo if requested',
    'Set 48-hr check-in cadence with legal team'],
  DOCUMENTATION_BLOCK: ['Send site/PM query — 24-hour response expectation',
    'Block phase release for undocumented items',
    'Route corrected records for plan-review validation',
    'Re-submit to permitting queue only after defects resolved'],
  ACTIVE: ['Review document for anomalies', 'Escalate to node specialist',
    'Document findings in the project log', 'Follow up within 48 hours'],
};

const PLAYBOOK_FALLBACK_STEPS_RE = {
  DENIAL_RISK: ['Pull the full title/closing file and identify exact defect code',
    'Verify chain of title and lien status against the report',
    'Confirm cure/resolution window — closing deadline critical',
    'Draft resolution with supporting title documentation',
    'Submit to title company and log tracking number'],
  AUTH_BLOCK: ['Verify current approval status for financing/contingencies',
    'Contact lender/broker — escalate if wait > 2 business days',
    'Do NOT proceed to closing until approval is confirmed and on file',
    'Document approval reference before proceeding',
    'Set 48-hr follow-up until resolved'],
  PAYMENT_BLOCK: ['Pull closing disclosure and compare figures to contract terms',
    'Flag variances >5% as discrepancies — initiate review',
    'Check for escrow hold — contact escrow officer if active',
    'Post clean items; quarantine disputed amounts',
    'Escalate unresolved disclosure failures within 24 hours'],
  COMPLIANCE_BLOCK: ['Halt closing until all compliance/disclosure flags are cleared',
    'Obtain updated inspection/disclosure sign-off if expired',
    'Verify licensing status for all parties on this transaction',
    'Complete documentation checklist before releasing to closing',
    'File compliance resolution memo and update tracker'],
  LEGAL_HOLD: ['Escalate to legal counsel immediately',
    'Document chain of custody for all related title records',
    'Suspend disbursements pending legal clearance',
    'Prepare regulatory defense memo if requested',
    'Set 48-hr check-in cadence with legal team'],
  DOCUMENTATION_BLOCK: ['Send buyer/seller/agent query — 24-hour response expectation',
    'Block closing release for undocumented items',
    'Route corrected records for title validation',
    'Re-submit to closing queue only after defects resolved'],
  ACTIVE: ['Review document for anomalies', 'Escalate to node specialist',
    'Document findings in the transaction file', 'Follow up within 48 hours'],
};

const PLAYBOOK_FALLBACK_STEPS_LEG = {
  DENIAL_RISK: ['Pull the full filing/motion record and identify exact rejection basis',
    'Verify procedural posture and deadline against the docket',
    'Confirm appeal/response window — filing deadline critical',
    'Draft response with supporting case documentation',
    'Submit via court/e-filing portal and log tracking number'],
  AUTH_BLOCK: ['Verify current engagement/authorization status for this matter',
    'Contact supervising attorney — escalate if wait > 2 business days',
    'Do NOT proceed until authorization is confirmed and on file',
    'Document engagement reference before proceeding',
    'Set 48-hr follow-up until resolved'],
  PAYMENT_BLOCK: ['Pull outside counsel invoice and compare to engagement rate',
    'Flag variances >5% as discrepancies — initiate review',
    'Check for billing hold — contact AP if active',
    'Post clean items; quarantine disputed amounts',
    'Escalate unresolved billing failures within 24 hours'],
  COMPLIANCE_BLOCK: ['Halt filing until all compliance/privilege flags are cleared',
    'Obtain updated conflict-check sign-off if expired',
    'Verify privilege/confidentiality status for all documents',
    'Complete documentation checklist before releasing to filing',
    'File compliance resolution memo and update tracker'],
  LEGAL_HOLD: ['Escalate to supervising/outside counsel immediately',
    'Document chain of custody for all related records',
    'Suspend related disbursements pending clearance',
    'Prepare defense memo if requested',
    'Set 48-hr check-in cadence with counsel'],
  DOCUMENTATION_BLOCK: ['Send client/co-counsel query — 24-hour response expectation',
    'Block filing release for undocumented items',
    'Route corrected records for privilege-review validation',
    'Re-submit to filing queue only after defects resolved'],
  ACTIVE: ['Review document for anomalies', 'Escalate to node specialist',
    'Document findings in the case file', 'Follow up within 48 hours'],
};

const PLAYBOOK_FALLBACK_STEPS_BPO = {
  DENIAL_RISK: ['Pull the full SLA/incident record and identify exact breach code',
    'Verify contracted terms and thresholds against the incident',
    'Confirm dispute/response window — client deadline critical',
    'Draft resolution with supporting operational documentation',
    'Submit to client and log tracking number'],
  AUTH_BLOCK: ['Verify current approval status for this engagement/scope change',
    'Contact client/account lead — escalate if wait > 2 business days',
    'Do NOT proceed until approval is confirmed and on file',
    'Document approval reference before proceeding',
    'Set 48-hr follow-up until resolved'],
  PAYMENT_BLOCK: ['Pull vendor/client invoice and compare to contracted rate',
    'Flag variances >5% as discrepancies — initiate review',
    'Check for billing hold — contact AP if active',
    'Post clean items; quarantine disputed amounts',
    'Escalate unresolved billing failures within 24 hours'],
  COMPLIANCE_BLOCK: ['Halt delivery until all compliance/SOP flags are cleared',
    'Obtain updated policy sign-off if expired',
    'Verify vendor/staff standing for all parties on this engagement',
    'Complete documentation checklist before releasing to delivery',
    'File compliance resolution memo and update tracker'],
  LEGAL_HOLD: ['Escalate to legal counsel immediately',
    'Document chain of custody for all related records',
    'Suspend vendor payments pending legal clearance',
    'Prepare regulatory defense memo if requested',
    'Set 48-hr check-in cadence with legal team'],
  DOCUMENTATION_BLOCK: ['Send client/ops query — 24-hour response expectation',
    'Block delivery release for undocumented items',
    'Route corrected records for SOP validation',
    'Re-submit to delivery queue only after defects resolved'],
  ACTIVE: ['Review document for anomalies', 'Escalate to node specialist',
    'Document findings in the ops log', 'Follow up within 48 hours'],
};

const PLAYBOOK_FALLBACK_STEPS_BY_VERTICAL = {
  hc: PLAYBOOK_FALLBACK_STEPS_HC,
  fo: PLAYBOOK_FALLBACK_STEPS_FO,
  ins: PLAYBOOK_FALLBACK_STEPS_INS,
  con: PLAYBOOK_FALLBACK_STEPS_CON,
  re: PLAYBOOK_FALLBACK_STEPS_RE,
  leg: PLAYBOOK_FALLBACK_STEPS_LEG,
  bpo: PLAYBOOK_FALLBACK_STEPS_BPO,
};

// vertical -> { role: what kind of specialist, domain: short hint about the

// document universe, so the model grounds itself in the right vocabulary
// (CPT/ICD-10 for HC, CARC/RARC codes, vs. permits/change-orders for
// construction, vs. title/escrow for real estate, etc.) without needing a
// fully separate prompt per vertical.
const PLAYBOOK_VERTICAL_CONTEXT = {
  hc:  { role: 'billing specialist', domain: 'medical billing, payer denials/appeals, prior authorization, and clinical documentation (CPT/ICD-10, CARC/RARC denial codes, HIPAA)' },
  fo:  { role: 'FinOps analyst', domain: 'general ledger reconciliation, AP/AR, budget variance, and financial controls' },
  ins: { role: 'insurance claims/policy specialist', domain: 'claims adjudication, policy underwriting, coverage disputes, and carrier remittances' },
  con: { role: 'construction operations lead', domain: 'permits, subcontractor invoices, change orders, and compliance/code violations' },
  re:  { role: 'real estate transaction coordinator', domain: 'title defects, escrow/closing disclosures, listing agreements, and inspection findings' },
  leg: { role: 'legal operations specialist', domain: 'case filings, discovery/privilege review, engagement agreements, and outside counsel invoices' },
  bpo: { role: 'BPO operations manager', domain: 'SLA compliance, client onboarding, vendor invoices, and internal SOP adherence' },
};

function buildPlaybookPrompt(vertical) {
  const ctx = PLAYBOOK_VERTICAL_CONTEXT[vertical] || PLAYBOOK_VERTICAL_CONTEXT.hc;
  return `You are TSM's ${ctx.role} triage assistant, working in the domain of ${ctx.domain}. You are given a document that has already been classified and routed — your only job is to write the specific, actionable playbook a ${ctx.role} should follow for THIS document, grounded in its actual content. Do not invent facts not present in the input. Return ONLY valid JSON, no markdown fences, no commentary.

Return JSON matching exactly this schema:
{
  "narrative": one or two sentences stating what's wrong, citing the specific vendor/code/policy/amount from the input — not a generic category description,
  "steps": array of 3-6 short, specific, actionable steps a ${ctx.role} would actually do next for THIS document. Reference the specific code, policy, missing documentation, or detail mentioned in the input wherever the input contains one. Do not output generic steps that would apply to any document in this category if the input gives you something more specific to say,
  "risk": integer 0-100 — likelihood-weighted financial/compliance risk if this is not resolved, considering dollar exposure AND how strong the underlying issue appears to be from the input (not dollar amount alone),
  "riskRationale": one sentence explaining the risk number}`;
}

// Kept as a named export-equivalent for anything still referencing the old
// HC-only constant directly.
const PLAYBOOK_PROMPT = buildPlaybookPrompt('hc');

// Separate limiter from classify's — this fires far less often (only when
// an operator opens a routed doc into its war room node) and shouldn't
// compete with upload-time classification traffic for the same budget.
const docRouterPlaybookHits = new Map();
function docRouterPlaybookRateOk(ip) {
  const now = Date.now();
  const hits = (docRouterPlaybookHits.get(ip) || []).filter(t => now - t < 5 * 60 * 1000);
  if (hits.length >= 20) return false;
  hits.push(now);
  docRouterPlaybookHits.set(ip, hits);
  return true;
}

function fallbackPlaybook(checkStatus, defectFlags, vertical) {
  const stepSet = PLAYBOOK_FALLBACK_STEPS_BY_VERTICAL[vertical] || PLAYBOOK_FALLBACK_STEPS_HC;
  const steps = stepSet[checkStatus] || stepSet.ACTIVE;
  return {
    narrative: 'Anomaly detected — review required.',
    steps: (defectFlags && defectFlags.length)
      ? ['Identify defects: ' + defectFlags.join(', '), ...steps.slice(0, 3)]
      : steps,
    risk: 55,
    riskRationale: 'Fallback estimate — generative playbook unavailable, using category default.',
    generated: false,
  };
}

app.post('/api/doc-router/playbook', async (req, res) => {
  const {
    checkStatus, documentType, exclusionCode, vendor, invoiceNo,
    amount, client, ref, summary, defectFlags, rawText, vertical,
  } = req.body || {};

  // Default to 'hc' when omitted -- preserves exact prior behavior for
  // any caller (e.g. cached frontend bundles) that hasn't been updated
  // to send vertical yet.
  const v = (vertical && PLAYBOOK_VERTICAL_CONTEXT[vertical]) ? vertical : 'hc';

  if (!checkStatus) {
    return res.status(400).json({ error: 'checkStatus is required.' });
  }

  if (!docRouterPlaybookRateOk(req.ip)) {
    // Degrade, don't 429 — an operator waiting on this is mid-workflow.
    return res.json(fallbackPlaybook(checkStatus, defectFlags, v));
  }

  const inputSummary = `
checkStatus: ${checkStatus}
documentType: ${documentType || ''}
exclusionCode: ${exclusionCode || ''}
vendor: ${vendor || ''}
invoiceNo: ${invoiceNo || ''}
amount: ${amount || 0}
client: ${client || ''}
ref: ${ref || ''}
summary: ${summary || ''}
defectFlags: ${(defectFlags || []).join(', ')}
${rawText ? '\nOriginal document text (truncated):\n' + String(rawText).slice(0, 6000) : ''}`.trim();

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_TEXT_MODEL,
        messages: [
          { role: 'system', content: 'Respond with ONLY valid JSON. No markdown fences, no preamble, no trailing text.' },
          { role: 'user', content: `${buildPlaybookPrompt(v)}\n\nInput:\n${inputSummary}` },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
    });

    if (!groqRes.ok) {
      console.error('[doc-router/playbook] Groq error:', groqRes.status, await groqRes.text());
      return res.json(fallbackPlaybook(checkStatus, defectFlags, v));
    }

    const data = await groqRes.json();
    let parsed;
    try {
      parsed = JSON.parse(data.choices[0].message.content);
    } catch (e) {
      console.error('[doc-router/playbook] Bad JSON from model:', data.choices?.[0]?.message?.content);
      return res.json(fallbackPlaybook(checkStatus, defectFlags, v));
    }

    if (!Array.isArray(parsed.steps) || !parsed.steps.length || typeof parsed.narrative !== 'string') {
      console.error('[doc-router/playbook] Malformed model output, falling back:', parsed);
      return res.json(fallbackPlaybook(checkStatus, defectFlags, v));
    }

    res.json({
      narrative: parsed.narrative,
      steps: parsed.steps.slice(0, 6),
      risk: Number.isFinite(parsed.risk) ? Math.max(0, Math.min(100, Math.round(parsed.risk))) : 55,
      riskRationale: parsed.riskRationale || '',
      generated: true,
    });
  } catch (err) {
    console.error('[doc-router/playbook] error:', err);
    res.json(fallbackPlaybook(checkStatus, defectFlags, v));
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ── COLLECTIVE BNCA ───────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

const COLLECTIVE_VERTICALS = ['healthcare', 'finops', 'bpo', 'legal', 'real-estate', 'insurance', 'construction', 'hotelops', 'o2c', 'crm', 'cpq', 'approval'];

// Persistence moved to Mongo (server/tsm-ledger-service.js — collective_signals
// / collective_bnca collections), mirroring the bpo_notes / bpo_bnca_reports
// pattern. The plain JS arrays this replaced didn't survive a dyno restart,
// which meant every synthesis and signal vanished on every Fly.io deploy.

// POST /api/collective/signal — war rooms push their BNCA signal here.
// Accepts both the legacy 3-field shape (vertical, signal, severity) and the
// richer war-room payload (warRoom, bnca, confidence, riskLevel, topIssue,
// ownerLanes, hitlRequired, actions, impactDelta, kpi).
app.post('/api/collective/signal', requireAnyAuth, async (req, res) => {
  try {
    const {
      vertical, signal, severity, source,
      warRoom, bnca, confidence, riskLevel, topIssue,
      ownerLanes, hitlRequired, actions, impactDelta, kpi
    } = req.body || {};
    if (!vertical) return res.status(400).json({ ok: false, error: 'vertical required' });
    // Client sessions can only write under their own identity — the body
    // can't override this. Admin sessions may tag a clientId explicitly
    // (e.g. seeding demo data) or fall back to 'internal'.
    const clientId = req.tsmSession.role === 'client'
      ? req.tsmSession.clientId
      : (req.body.clientId || 'internal');
    const timestamp = Date.now();
    const entry = await tsmLedger.collectiveAddSignal({
      vertical,
      clientId,
      signal: signal || topIssue || (typeof bnca === 'string' ? bnca.slice(0, 200) : '') || 'War room signal received',
      severity: severity || riskLevel || 'MEDIUM',
      riskLevel: riskLevel || severity || 'WATCH',
      confidence: confidence != null ? confidence : null,
      topIssue: topIssue || '',
      warRoom: warRoom || '',
      bnca: bnca || '',
      ownerLanes: ownerLanes || [],
      hitlRequired: !!hitlRequired,
      actions: actions || [],
      impactDelta: impactDelta || '',
      kpi: kpi || {},
      source: source || '',
      timestamp,
      receivedAt: timestamp // tsm-collective-bnca.html reads receivedAt, not timestamp — keep both to avoid breaking other callers
    });
    res.json({ ok: true, entry });
  } catch (err) {
    console.error('[collective/signal] error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/collective/signals — client sessions only ever see their own
// entries; admin sessions see everything (optionally filtered via ?clientId=
// for drill-down, since the "All Clients" rollup view is admin-only anyway).
app.get('/api/collective/signals', requireAnyAuth, async (req, res) => {
  try {
    const clientId = req.tsmSession.role === 'client'
      ? req.tsmSession.clientId
      : (req.query.clientId || null);
    const signals = await tsmLedger.collectiveListSignals({ clientId });
    res.json({ ok: true, signals });
  } catch (err) {
    console.error('[collective/signals] error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/collective/signals — admin only. Without ?clientId= this wipes
// everything (kept for existing demo/reset scripts); pass ?clientId= to
// clear just one client's entries instead of nuking shared state.
app.delete('/api/collective/signals', requireAdmin, async (req, res) => {
  try {
    const removed = await tsmLedger.collectiveDeleteSignals({ clientId: req.query.clientId || null });
    res.json({ ok: true, removed });
  } catch (err) {
    console.error('[collective/signals delete] error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/collective/bnca — run cross-vertical synthesis via Groq
app.post('/api/collective/bnca', requireAnyAuth, async (req, res) => {
  try {
    // Client sessions synthesize only their own signals — the cross-client
    // "admin rollup" synthesis stays admin-only, same boundary as the
    // signals list itself.
    const scopedSignals = await tsmLedger.collectiveListSignals({
      clientId: req.tsmSession.role === 'client' ? req.tsmSession.clientId : null
    });
    if (!scopedSignals.length) return res.status(400).json({ ok: false, error: 'No signals to synthesize' });
    // Schema below must match what html/tsm-collective-bnca.html actually
    // reads (r.overallRisk, r.collectiveBNCA, r.confidence, r.verticalsActive,
    // r.priorityActions[], r.hitlQueue[], r.crossVerticalRisks[],
    // r.synergyOpportunities[]) — the old {conflicts,synergies,hitlQueue,summary}
    // shape never matched the front end and every synthesis silently failed.
    const prompt = `You are TSM's cross-vertical BNCA synthesizer. Given the following signals from multiple verticals, produce a synthesis. Respond ONLY in valid JSON with EXACTLY these keys:
{
  "overallRisk": "READY" | "WATCH" | "RISK" | "URGENT",
  "collectiveBNCA": "2-4 sentence narrative summary of the overall cross-vertical picture",
  "confidence": <integer 0-100>,
  "verticalsActive": <integer, count of distinct verticals represented in the signals>,
  "priorityActions": [ { "rank": <integer>, "action": "string", "owner": "string", "deadline": "string", "expectedOutcome": "string", "vertical": "string" } ],
  "hitlQueue": [ { "decision": "string", "context": "string", "options": ["string", ...], "recommendedOption": "string (must match one entry in options)", "owner": "string" } ],
  "crossVerticalRisks": [ { "risk": "string", "urgency": "HIGH" | "MEDIUM" | "LOW", "impact": "string", "verticals": ["string", ...] } ],
  "synergyOpportunities": [ { "opportunity": "string", "verticals": ["string", ...], "estimatedImpact": "string" } ]
}
Do not include any other keys. Empty arrays are fine if nothing qualifies.

Signals:
${JSON.stringify(scopedSignals.slice(0, 50), null, 2)}`;
    // Retry transient Groq failures instead of a single-shot 502 — same
    // retryable-status set, backoff, and Retry-After parsing as tsmAIJSON(),
    // since this was the last strategist-adjacent AI call still failing on
    // the first rate-limit or momentary 5xx with no retry at all.
    let data, lastErrMsg = 'Groq error';
    for (let attempt = 0; attempt <= TSM_AI_MAX_RETRIES; attempt++) {
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          messages: [
            { role: 'system', content: 'Respond with ONLY valid JSON. No markdown fences, no preamble.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.2,
          response_format: { type: 'json_object' }
        })
      });
      if (groqRes.ok) { data = await groqRes.json(); break; }
      try {
        const ct = groqRes.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          const errBody = await groqRes.json();
          lastErrMsg = errBody.error?.message || lastErrMsg;
        } else {
          const txt = await groqRes.text();
          if (txt) lastErrMsg = txt.replace(/\s+/g, ' ').trim().slice(0, 300);
        }
      } catch (_) {}
      if (!TSM_AI_RETRYABLE_STATUSES.includes(groqRes.status)) {
        console.error('[collective/bnca] non-retryable Groq error ' + groqRes.status + ':', lastErrMsg);
        return res.status(502).json({ ok: false, error: lastErrMsg });
      }
      if (attempt < TSM_AI_MAX_RETRIES) {
        const delay = tsmAIParseRetryDelayMs(lastErrMsg);
        console.warn('[collective/bnca] Groq returned ' + groqRes.status + ' (attempt ' + (attempt + 1) + '/' + (TSM_AI_MAX_RETRIES + 1) + '): ' + lastErrMsg + ' -- retrying in ' + delay + 'ms');
        await new Promise(r => setTimeout(r, delay));
      }
    }
    if (!data) {
      console.error('[collective/bnca] falling back after ' + (TSM_AI_MAX_RETRIES + 1) + ' attempts:', lastErrMsg);
      return res.status(502).json({ ok: false, error: lastErrMsg });
    }
    const parsed = JSON.parse(data.choices[0].message.content);
    const result = {
      overallRisk: parsed.overallRisk || 'WATCH',
      collectiveBNCA: parsed.collectiveBNCA || '',
      confidence: Number.isFinite(parsed.confidence) ? Math.max(0, Math.min(100, Math.round(parsed.confidence))) : 0,
      verticalsActive: Number.isFinite(parsed.verticalsActive) ? parsed.verticalsActive : new Set(scopedSignals.map(s => s.vertical)).size,
      priorityActions: Array.isArray(parsed.priorityActions) ? parsed.priorityActions : [],
      hitlQueue: Array.isArray(parsed.hitlQueue) ? parsed.hitlQueue : [],
      crossVerticalRisks: Array.isArray(parsed.crossVerticalRisks) ? parsed.crossVerticalRisks : [],
      synergyOpportunities: Array.isArray(parsed.synergyOpportunities) ? parsed.synergyOpportunities : [],
      timestamp: Date.now(),
      signalCount: scopedSignals.length,
      clientId: req.tsmSession.role === 'client' ? req.tsmSession.clientId : 'internal',
    };
    await tsmLedger.collectiveAddBncaResult(result);
    res.json({ ok: true, result, signals: scopedSignals });
  } catch (err) {
    console.error('[collective/bnca] error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/collective/bnca/latest — fetch most recent synthesis. Client
// sessions get their own most recent scoped synthesis, not whatever any
// other client (or the admin rollup) generated last.
app.get('/api/collective/bnca/latest', requireAnyAuth, async (req, res) => {
  try {
    const latest = await tsmLedger.collectiveLatestBnca({
      clientId: req.tsmSession.role === 'client' ? req.tsmSession.clientId : null
    });
    res.json({ ok: true, result: latest || null });
  } catch (err) {
    console.error('[collective/bnca/latest] error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ── END COLLECTIVE BNCA ───────────────════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// ── WIP / EXECUTION COMMAND CENTER ────────────────────────────────────────────
// Per-vertical: WIP tasks, readiness score, data quality, decision queue, trends.
// ══════════════════════════════════════════════════════════════════════════════


// ── WIP PERSISTENCE LAYER ────────────────────────────────────────────────────
// Backed by Fly Volume mounted at /app/data (see fly.toml [mounts]).
// Falls back to local ./data if volume path is unavailable (local dev).
const WIP_DATA_DIR = fs.existsSync('/app/data') ? '/app/data' : path.join(__dirname, 'data');
if (!fs.existsSync(WIP_DATA_DIR)) fs.mkdirSync(WIP_DATA_DIR, { recursive: true });
const WIP_STATE_FILE = path.join(WIP_DATA_DIR, 'wip-master.json');

function loadWipState() {
  try {
    if (fs.existsSync(WIP_STATE_FILE)) {
      const raw = fs.readFileSync(WIP_STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        tasks: parsed.tasks || {},
        readiness: parsed.readiness || {},
        dataQuality: parsed.dataQuality || {},
        decisions: parsed.decisions || {},
        trends: parsed.trends || {}
      };
    }
  } catch (err) {
    console.error('[wip-persistence] load failed, starting empty:', err.message);
  }
  return { tasks: {}, readiness: {}, dataQuality: {}, decisions: {}, trends: {} };
}

let wipSaveTimer = null;
function saveWipState() {
  // debounce rapid writes
  if (wipSaveTimer) clearTimeout(wipSaveTimer);
  wipSaveTimer = setTimeout(() => {
    try {
      const snapshot = {
        tasks: WIP_TASKS, readiness: WIP_READINESS, dataQuality: WIP_DATA_QUALITY,
        decisions: WIP_DECISIONS, trends: WIP_TRENDS, savedAt: Date.now()
      };
      fs.writeFileSync(WIP_STATE_FILE, JSON.stringify(snapshot, null, 2));
    } catch (err) {
      console.error('[wip-persistence] save failed:', err.message);
    }
  }, 250);
}

const _WIP_LOADED = loadWipState();
const WIP_TASKS = _WIP_LOADED.tasks;         // vertical -> [ {id, action, owner, status, due, risk, createdAt, updatedAt} ]
const WIP_READINESS = _WIP_LOADED.readiness;     // vertical -> { dataCompleteness, stakeholderCoverage, mitigationPlans, resourceAvailability, openRisks, updatedAt }
const WIP_DATA_QUALITY = _WIP_LOADED.dataQuality;  // vertical -> [ {id, source, status, updatedAt} ]
const WIP_DECISIONS = _WIP_LOADED.decisions;     // vertical -> [ {id, title, impact, cost, recommendation, confidence, status, createdAt, decidedAt} ]
const WIP_TRENDS = _WIP_LOADED.trends;        // vertical -> [ {id, event, date, resolutionHours, notes, createdAt} ]

function ensureWipVertical(v) {
  if (!COLLECTIVE_VERTICALS.includes(v)) return false;
  if (!WIP_TASKS[v]) WIP_TASKS[v] = [];
  if (!WIP_DATA_QUALITY[v]) WIP_DATA_QUALITY[v] = [];
  if (!WIP_DECISIONS[v]) WIP_DECISIONS[v] = [];
  if (!WIP_TRENDS[v]) WIP_TRENDS[v] = [];
  return true;
}

function computeReadinessOverall(r) {
  if (!r) return null;
  const fields = ['dataCompleteness', 'stakeholderCoverage', 'mitigationPlans', 'resourceAvailability', 'openRisks'];
  const vals = fields.map(f => Number(r[f])).filter(n => !isNaN(n));
  if (!vals.length) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

// Map WIP verticals to live-data-store domains, where one exists.
// Only the 4 SAP-phase verticals that share the live-data-store pipeline
// have a real signal here — the other 6 (healthcare, finops, legal,
// real-estate, insurance, construction) have no server-side data source
// and stay manual-entry. This does not fabricate a value for them.
const WIP_LIVE_DATA_DOMAIN = { bpo: 'bpo', o2c: 'o2c', crm: 'crm', cpq: 'cpq' };

function getWipLiveSignal(vertical) {
  const domain = WIP_LIVE_DATA_DOMAIN[vertical];
  if (!domain) return { available: false };
  try {
    const stored = liveDataModule.readStore(domain);
    if (!stored || !Array.isArray(stored.records) || !stored.records.length) {
      return { available: false, domain };
    }
    return {
      available: true,
      domain,
      filename: stored.filename || null,
      uploadedAt: stored.uploaded_at || null,
      recordCount: stored.records.length
    };
  } catch (e) {
    return { available: false, domain };
  }
}

function wipId(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

// GET /api/wip/board?vertical=healthcare — combined read for the WIP Command Center page
app.get('/api/wip/board', (req, res) => {
  const v = req.query.vertical;
  if (!ensureWipVertical(v)) return res.status(400).json({ ok: false, error: `vertical must be one of: ${COLLECTIVE_VERTICALS.join(', ')}` });
  const liveSignal = getWipLiveSignal(v);
  let readiness = WIP_READINESS[v] || null;
  // Where a real live-data upload exists for this vertical, data completeness
  // is a known fact (data was actually supplied), not a guess -- override the
  // display value. Manual entries for the other 4 subjective fields are left
  // untouched; those aren't derivable from uploaded records.
  if (liveSignal.available) {
    readiness = Object.assign({}, readiness, { dataCompleteness: 100, dataCompletenessAuto: true });
  }
  res.json({
    ok: true,
    vertical: v,
    tasks: WIP_TASKS[v],
    readiness,
    readinessOverall: computeReadinessOverall(readiness),
    liveSignal,
    dataQuality: WIP_DATA_QUALITY[v],
    decisions: WIP_DECISIONS[v],
    trends: WIP_TRENDS[v]
  });
});

// ── WIP TASKS ──────────────────────────────────────────────────────────────────
app.post('/api/wip/task', (req, res) => {
  const { vertical, action, owner, status, due, risk } = req.body || {};
  if (!ensureWipVertical(vertical)) return res.status(400).json({ ok: false, error: 'valid vertical required' });
  if (!action) return res.status(400).json({ ok: false, error: 'action required' });
  const task = {
    id: wipId('wip'), action, owner: owner || 'Unassigned', status: status || 'TO DO',
    due: due || '', risk: risk || 'LOW', createdAt: Date.now(), updatedAt: Date.now()
  };
  WIP_TASKS[vertical].unshift(task);
  saveWipState();
  res.json({ ok: true, task });
});

app.patch('/api/wip/task/:id', (req, res) => {
  const { vertical } = req.body || {};
  if (!ensureWipVertical(vertical)) return res.status(400).json({ ok: false, error: 'valid vertical required' });
  const task = WIP_TASKS[vertical].find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ ok: false, error: 'task not found' });
  Object.assign(task, req.body, { id: task.id, vertical: undefined, updatedAt: Date.now() });
  delete task.vertical;
  saveWipState();
  res.json({ ok: true, task });
});

app.delete('/api/wip/task/:id', (req, res) => {
  const { vertical } = req.body || req.query || {};
  if (!ensureWipVertical(vertical)) return res.status(400).json({ ok: false, error: 'valid vertical required' });
  WIP_TASKS[vertical] = WIP_TASKS[vertical].filter(t => t.id !== req.params.id);
  saveWipState();
  res.json({ ok: true, deleted: req.params.id });
});

// ── READINESS SCORE ────────────────────────────────────────────────────────────
app.post('/api/wip/readiness', (req, res) => {
  const { vertical, dataCompleteness, stakeholderCoverage, mitigationPlans, resourceAvailability, openRisks } = req.body || {};
  if (!ensureWipVertical(vertical)) return res.status(400).json({ ok: false, error: 'valid vertical required' });
  const liveSignal = getWipLiveSignal(vertical);
  // If live data exists for this vertical, dataCompleteness is a known fact, not
  // a manual estimate -- always store 100 rather than whatever (or nothing) the
  // now-disabled slider on the client sent.
  const effectiveDataCompleteness = liveSignal.available ? 100 : dataCompleteness;
  WIP_READINESS[vertical] = { dataCompleteness: effectiveDataCompleteness, stakeholderCoverage, mitigationPlans, resourceAvailability, openRisks, updatedAt: Date.now() };
  saveWipState();
  const readiness = liveSignal.available
    ? Object.assign({}, WIP_READINESS[vertical], { dataCompletenessAuto: true })
    : WIP_READINESS[vertical];
  res.json({ ok: true, readiness, overall: computeReadinessOverall(readiness), liveSignal });
});

// ── DATA QUALITY ───────────────────────────────────────────────────────────────
app.post('/api/wip/data-quality', (req, res) => {
  const { vertical, source, status } = req.body || {};
  if (!ensureWipVertical(vertical)) return res.status(400).json({ ok: false, error: 'valid vertical required' });
  if (!source) return res.status(400).json({ ok: false, error: 'source required' });
  const list = WIP_DATA_QUALITY[vertical];
  const existing = list.find(d => d.source.toLowerCase() === String(source).toLowerCase());
  if (existing) {
    existing.status = status || existing.status;
    existing.updatedAt = Date.now();
    return res.json({ ok: true, entry: existing });
  }
  const entry = { id: wipId('dq'), source, status: status || 'UNKNOWN', updatedAt: Date.now() };
  list.unshift(entry);
  saveWipState();
  res.json({ ok: true, entry });
});

app.delete('/api/wip/data-quality/:id', (req, res) => {
  const { vertical } = req.body || req.query || {};
  if (!ensureWipVertical(vertical)) return res.status(400).json({ ok: false, error: 'valid vertical required' });
  WIP_DATA_QUALITY[vertical] = WIP_DATA_QUALITY[vertical].filter(d => d.id !== req.params.id);
  saveWipState();
  res.json({ ok: true, deleted: req.params.id });
});

// ── EXECUTIVE DECISION QUEUE ────────────────────────────────────────────────────
app.post('/api/wip/decision', (req, res) => {
  const { vertical, title, impact, cost, recommendation, confidence } = req.body || {};
  if (!ensureWipVertical(vertical)) return res.status(400).json({ ok: false, error: 'valid vertical required' });
  if (!title) return res.status(400).json({ ok: false, error: 'title required' });
  const decision = {
    id: wipId('dec'), title, impact: impact || '', cost: cost || '', recommendation: recommendation || '',
    confidence: confidence != null ? confidence : 80, status: 'PENDING', createdAt: Date.now(), decidedAt: null
  };
  WIP_DECISIONS[vertical].unshift(decision);
  saveWipState();
  res.json({ ok: true, decision });
});

app.patch('/api/wip/decision/:id', requireAuth, (req, res) => {
  const { vertical, status } = req.body || {};
  if (!ensureWipVertical(vertical)) return res.status(400).json({ ok: false, error: 'valid vertical required' });
  if (!['APPROVED', 'REJECTED', 'PENDING'].includes(status)) return res.status(400).json({ ok: false, error: 'status must be APPROVED, REJECTED, or PENDING' });
  const decision = WIP_DECISIONS[vertical].find(d => d.id === req.params.id);
  if (!decision) return res.status(404).json({ ok: false, error: 'decision not found' });
  decision.status = status;
  decision.decidedAt = status === 'PENDING' ? null : Date.now();
  saveWipState();
  res.json({ ok: true, decision });
});

// ── TREND INTELLIGENCE ─────────────────────────────────────────────────────────
app.post('/api/wip/trend', requireRole(ENTERPRISE_INTERNAL_ROLES), (req, res) => {
  const { vertical, event, date, resolutionHours, notes } = req.body || {};
  if (!ensureWipVertical(vertical)) return res.status(400).json({ ok: false, error: 'valid vertical required' });
  if (!event) return res.status(400).json({ ok: false, error: 'event required' });
  const trend = {
    id: wipId('trend'), event, date: date || new Date().toISOString().slice(0, 10),
    resolutionHours: resolutionHours != null ? resolutionHours : null, notes: notes || '', createdAt: Date.now()
  };
  WIP_TRENDS[vertical].unshift(trend);
  saveWipState();
  res.json({ ok: true, trend });
});

// ══════════════════════════════════════════════════════════════════════════════
// ── END WIP / EXECUTION COMMAND CENTER ────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

// ── PHASE 10: ENTERPRISE DIGITAL TWIN ──────────────────────────────────────────
// Rolls up existing WIP + Governance + MDM state into one executive snapshot.
// Deliberately does NOT invent a parallel simulation dataset -- it reflects
// the same state every other war room already writes to, so the numbers
// stay consistent everywhere they're shown.
app.get('/api/digital-twin/snapshot', (req, res) => {
  const wipVerticals = Object.keys(typeof WIP_DECISIONS !== 'undefined' ? WIP_DECISIONS : {});
  const openRisks = (typeof GOVERNANCE_RISK_REGISTER !== 'undefined' ? GOVERNANCE_RISK_REGISTER : [])
    .filter(r => r.status === 'OPEN').length;
  const mdmDomains = typeof MDM_SEED_DATA !== 'undefined' ? Object.keys(MDM_SEED_DATA) : [];

  // AI Decision Intelligence Layer rollup: MDM (Phase 5) only. CRM/CPQ/O2C/
  // Approval/Catalog are analyze(context) services consumed by the Industry
  // War Rooms, not standalone capabilities with their own decision engines —
  // no rollup entry for them here by design.
  let mdmOpenRecs = 0;
  try {
    mdmOpenRecs = generateRecommendations(MDM_SEED_DATA, MDM_RESOLVED_RECS).length;
  } catch (e) { /* MDM engine not loaded yet at snapshot time — leave at 0 */ }
  const capabilityEngines = { mdm: mdmOpenRecs };
  const capabilityOpenTotal = mdmOpenRecs;

  res.json({
    ok: true,
    generatedAt: Date.now(),
    wip: { verticalsTracked: wipVerticals.length, verticals: wipVerticals },
    governance: { openRisks },
    mdm: { domainsTracked: mdmDomains.length, domains: mdmDomains },
    decisionIntelligence: {
      enginesLive: Object.keys(capabilityEngines).length,
      totalCapabilityRows: 10,
      openRecommendations: capabilityOpenTotal,
      byCapability: capabilityEngines
    },
  });
});

app.post('/api/digital-twin/query', async (req, res) => {
  const { domains, signals, forecasts, health_score, maxTokens } = req.body || {};
  if (!Array.isArray(domains)) return res.status(400).json({ ok: false, error: 'domains array required' });
  const summary = JSON.stringify({
    health_score,
    domains: domains.map(d => ({ name: d.name, score: d.score, delta: d.delta })),
    recent_signals: (signals || []).slice(0, 15).map(s => ({ text: s.text, src: s.src, time: s.time })),
    forecasts: (forecasts || []).map(f => ({ label: f.label, value: f.value, trend: f.trend }))
  }, null, 2);
  const prompt = `Current Enterprise Digital Twin snapshot:\n${summary}\n\nSynthesize an executive brief: identify the domains driving the biggest swings in enterprise health, the highest-priority cross-domain risk, and the single most important executive action this week. Reference domain names and specific figures. Be specific and operational.`;
  try {
    const answer = await groqChat(SP.digitalTwin, prompt, maxTokens || 1400);
    recordVerticalMemory('digitalTwin', prompt, answer);
    return res.json({ ok: true, answer, createdAt: new Date().toISOString() });
  } catch (e) {
    console.error('DIGITAL TWIN GROQ ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});


// ── PHASE 8: GOVERNANCE & COMPLIANCE ───────────────────────────────────────────
const { createGate: createHitlGate } = require('./html/shared/tsm-hitl-gate.js');
const tsmLedger = require('./server/tsm-ledger-service.js');
const conciergeRouter = require('./server/services/concierge-transport-adapter.js').defaultRouter;
const GOVERNANCE_AUDIT_LOG = [];
const GOVERNANCE_RISK_REGISTER = [];
// Standardized HITL approval gate (BPO Enterprise Roadmap #4). Replaces the
// prior one-step resolve with an explicit approve/reject decision + actor,
// using the same pattern already proven in MDM's recommendation approvals.
// Backed by MongoDB (server/tsm-ledger-service.js, hitl_decisions collection)
// via the adapter below -- previously decisionLog was in-memory only and
// every decision was lost on restart. hydrate() below repopulates it from
// prior history; if MONGODB_URI isn't set, both the write and the hydrate
// fail closed (logged, not thrown) and the gate behaves exactly as it did
// before -- in-memory only for the life of this process.
const GOVERNANCE_HITL_GATE = createHitlGate('GOV', tsmLedger.hitlAdapter('GOV'));
GOVERNANCE_HITL_GATE.hydrate().then(n => { if (n) console.log(`[HITL] GOV gate hydrated ${n} prior decisions`); });

// PM Intelligence V3 per-action approval gate. Distinct from the portfolio-
// level ACKNOWLEDGE/ESCALATE sign-off already recorded by
// /api/exec-portal/pm/decide (see pm-exec-portal.html's recordExecAction) --
// that gate approves/rejects the *snapshot as a whole*; this one approves/
// rejects one specific PM_INTELLIGENCE_V3 action (ACT-PM-DEC-...) before it
// may be marked VERIFIED. Without this, /api/pm/actions/verify accepted
// whatever `status` the caller put in the request body, so a client could
// claim an action was RESOLVED and skip straight to VERIFIED -- the
// `humanApprovalRequired: true` field on decision/action/predictive-control
// responses was a label with nothing behind it. Same createHitlGate +
// tsmLedger.hitlAdapter pattern as GOV, so it persists to Mongo (hitl_decisions,
// partitioned by gatePrefix 'PM') and survives a restart via hydrate().
const PM_APPROVAL_GATE = createHitlGate('PM', tsmLedger.hitlAdapter('PM'));
PM_APPROVAL_GATE.hydrate().then(n => { if (n) console.log(`[HITL] PM gate hydrated ${n} prior decisions`); });

function governanceId(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

app.post('/api/governance/audit', requireRole(ENTERPRISE_INTERNAL_ROLES), (req, res) => {
  const { action, resource, vertical } = req.body || {};
  if (!action) return res.status(400).json({ ok: false, error: "action required" });
  const actor = req.tsmSession.label || req.tsmSession.role;
  const entry = { id: governanceId('audit'), actor, action, resource: resource || null, vertical: vertical || null, ts: Date.now() };
  GOVERNANCE_AUDIT_LOG.push(entry);
  res.json({ ok: true, entry });
});

app.get('/api/governance/audit', requireRole(ENTERPRISE_INTERNAL_ROLES), (req, res) => {
  const { vertical, limit } = req.query;
  let entries = GOVERNANCE_AUDIT_LOG;
  if (vertical) entries = entries.filter(e => e.vertical === vertical);
  entries = entries.slice(-1 * (parseInt(limit, 10) || 100));
  res.json({ ok: true, entries });
});

app.post('/api/governance/risk', (req, res) => {
  const { title, severity, owner, vertical } = req.body || {};
  if (!title || !severity) return res.status(400).json({ ok: false, error: "title and severity required" });
  const risk = { id: governanceId('risk'), title, severity, owner: owner || 'Unassigned', vertical: vertical || null, status: 'OPEN', createdAt: Date.now() };
  GOVERNANCE_RISK_REGISTER.push(risk);
  res.json({ ok: true, risk });
});

app.get('/api/governance/risk', (req, res) => {
  res.json({ ok: true, risks: GOVERNANCE_RISK_REGISTER });
});

// Two-step HITL gate: approve or reject a risk, with an explicit actor and
// an audit-trail entry recorded before the underlying status changes. This
// replaces the old single /resolve route (no frontend called it, so this is
// a safe swap, not a breaking change) with the same pattern MDM already uses
// for recommendation approvals.
app.post('/api/governance/risk/:id/approve', requireRole(ENTERPRISE_INTERNAL_ROLES), (req, res) => {
  const actor = req.tsmSession.label || req.tsmSession.role;
  const risk = GOVERNANCE_RISK_REGISTER.find(r => r.id === req.params.id);
  if (!risk) return res.status(404).json({ ok: false, error: "Risk not found" });
  if (risk.status !== 'OPEN') return res.status(409).json({ ok: false, error: `Risk already ${risk.status}` });

  risk.status = 'RESOLVED';
  risk.resolvedAt = Date.now();
  const decision = GOVERNANCE_HITL_GATE.recordDecision({
    entityId: risk.id, entityType: 'risk', decision: 'APPROVED',
    actor, meta: { title: risk.title, severity: risk.severity, vertical: risk.vertical }
  });
  res.json({ ok: true, risk, decision });
});

app.post('/api/governance/risk/:id/reject', requireRole(ENTERPRISE_INTERNAL_ROLES), (req, res) => {
  const actor = req.tsmSession.label || req.tsmSession.role;
  const risk = GOVERNANCE_RISK_REGISTER.find(r => r.id === req.params.id);
  if (!risk) return res.status(404).json({ ok: false, error: "Risk not found" });
  if (risk.status !== 'OPEN') return res.status(409).json({ ok: false, error: `Risk already ${risk.status}` });

  risk.status = 'DISMISSED';
  risk.resolvedAt = Date.now();
  const decision = GOVERNANCE_HITL_GATE.recordDecision({
    entityId: risk.id, entityType: 'risk', decision: 'REJECTED',
    actor, meta: { title: risk.title, severity: risk.severity, vertical: risk.vertical }
  });
  res.json({ ok: true, risk, decision });
});

app.get('/api/governance/risk/decisions', (req, res) => {
  const { limit } = req.query;
  res.json({
    ok: true,
    log: GOVERNANCE_HITL_GATE.getLog(parseInt(limit, 10) || 100),
    stats: GOVERNANCE_HITL_GATE.getStats()
  });
});

app.post('/api/governance/query', async (req, res) => {
  const { controls, risks, audit, kpis, maxTokens } = req.body || {};
  if (!Array.isArray(controls)) return res.status(400).json({ ok: false, error: 'controls array required' });
  const summary = JSON.stringify({
    kpis,
    failing_or_review_controls: (controls || []).filter(c => c.status !== 'PASS'),
    at_risk: (risks || []).filter(r => r.status === 'OPEN' || r.severity >= 70),
    flagged_or_blocked_audit_events: (audit || []).filter(a => a.result !== 'OK')
  }, null, 2);
  const prompt = `Current governance & compliance snapshot:\n${summary}\n\nIdentify the highest-priority failing or at-risk controls, the risks most likely to escalate, and any suspicious or flagged audit events requiring follow-up. Reference control IDs and risk IDs. Recommend the specific next action for each. Be specific and operational.`;
  try {
    const answer = await groqChat(SP.governance, prompt, maxTokens || 1200);
    return res.json({ ok: true, answer, createdAt: new Date().toISOString() });
  } catch (e) {
    console.error('GOVERNANCE GROQ ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});


// ── PHASE 7: ENTERPRISE INTEGRATION HUB ────────────────────────────────────────
// Standardized HITL approval gate (BPO Enterprise Roadmap #4), same shared
// module Governance uses. A degraded integration needs a human decision
// before it's either remediated (approved) or escalated (rejected) --
// previously /sync just silently reset status to 'healthy' with no record
// of who decided that, or whether the underlying issue was actually fixed.
const INTEGRATION_HITL_GATE = createHitlGate('IHUB', tsmLedger.hitlAdapter('IHUB'));
INTEGRATION_HITL_GATE.hydrate().then(n => { if (n) console.log(`[HITL] IHUB gate hydrated ${n} prior decisions`); });
let INTEGRATION_CATALOG = [
  {
    "id": "int-01",
    "system": "CRM",
    "status": "healthy",
    "lastSync": null,
    "errorCount": 0
  },
  {
    "id": "int-02",
    "system": "ERP",
    "status": "healthy",
    "lastSync": null,
    "errorCount": 0
  },
  {
    "id": "int-03",
    "system": "HR",
    "status": "healthy",
    "lastSync": null,
    "errorCount": 0
  },
  {
    "id": "int-04",
    "system": "Finance",
    "status": "healthy",
    "lastSync": null,
    "errorCount": 0
  },
  {
    "id": "int-05",
    "system": "Supply Chain",
    "status": "healthy",
    "lastSync": null,
    "errorCount": 0
  },
  {
    "id": "int-06",
    "system": "Manufacturing",
    "status": "healthy",
    "lastSync": null,
    "errorCount": 0
  },
  {
    "id": "int-07",
    "system": "BI",
    "status": "healthy",
    "lastSync": null,
    "errorCount": 0
  },
  {
    "id": "int-08",
    "system": "AI",
    "status": "healthy",
    "lastSync": null,
    "errorCount": 0
  }
];

// Returns whichever catalog is currently "active": the live-uploaded one if
// a file has been uploaded via /api/live-data/integration-hub/upload, else
// the hardcoded sample INTEGRATION_CATALOG above.
function getActiveIntegrationCatalog() {
  try {
    const stored = liveDataModule.readStore('integration-hub');
    if (stored && Array.isArray(stored.records) && stored.records.length) {
      const normalized = stored.records.map((r, i) => ({
        id: r.id || `int-live-${i + 1}`,
        system: r.system || r.name || `System ${i + 1}`,
        status: r.status || 'healthy',
        lastSync: r.lastSync || null,
        errorCount: typeof r.errorCount === 'number' ? r.errorCount : 0
      }));
      return { records: normalized, live: true };
    }
  } catch (e) { /* fall through to sample */ }
  return { records: INTEGRATION_CATALOG, live: false };
}

// Persists a mutation (sync/error) back to wherever the record actually
// lives, so live-uploaded data doesn't silently revert to the file on the
// next request.
function persistIntegrationCatalog(records, live) {
  if (live) {
    const stored = liveDataModule.readStore('integration-hub') || {};
    stored.records = records;
    liveDataModule.writeStore('integration-hub', stored);
  } else {
    INTEGRATION_CATALOG = records;
  }
}

app.get('/api/integration/catalog', (req, res) => {
  const { records } = getActiveIntegrationCatalog();
  res.json({ ok: true, integrations: records });
});

app.post('/api/integration/:id/sync', requireAuth, (req, res) => {
  const { records, live } = getActiveIntegrationCatalog();
  const item = records.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ ok: false, error: "Integration not found" });
  item.lastSync = Date.now();
  item.status = 'healthy';
  persistIntegrationCatalog(records, live);
  res.json({ ok: true, integration: item });
});

app.post('/api/integration/:id/error', requireRole(ENTERPRISE_INTERNAL_ROLES), (req, res) => {
  const { records, live } = getActiveIntegrationCatalog();
  const item = records.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ ok: false, error: "Integration not found" });
  item.errorCount = (item.errorCount || 0) + 1;
  item.status = item.errorCount >= 3 ? 'degraded' : 'warning';
  const message = (req.body && req.body.message) || `Sync error on ${item.system}`;
  INTEGRATION_ERROR_LOG.push({ id: `err-${Date.now()}`, ts: new Date().toISOString(), system: item.system, flowId: null, message });
  persistIntegrationCatalog(records, live);
  res.json({ ok: true, integration: item });
});

app.get('/api/integration/health', (req, res) => {
  const { records } = getActiveIntegrationCatalog();
  const healthy = records.filter(i => i.status === 'healthy').length;
  res.json({ ok: true, total: records.length, healthy, degraded: records.length - healthy });
});

// Two-step HITL gate for degraded integrations: approve = remediate (reset
// to healthy, clear error count, log the actor who signed off), reject =
// escalate (leave broken, but on record as a human decision rather than a
// silent auto-heal). Only applies to integrations currently 'degraded';
// 'healthy' or 'warning' items aren't gated since they don't need a
// go/no-go decision yet.
app.post('/api/integration/:id/remediate/approve', requireRole(ENTERPRISE_INTERNAL_ROLES), (req, res) => {
  const actor = req.tsmSession.label || req.tsmSession.role;
  const { records, live } = getActiveIntegrationCatalog();
  const item = records.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ ok: false, error: "Integration not found" });
  if (item.status !== 'degraded') return res.status(409).json({ ok: false, error: `Integration is not degraded (current status: ${item.status})` });

  item.status = 'healthy';
  item.errorCount = 0;
  item.lastSync = Date.now();
  persistIntegrationCatalog(records, live);
  const decision = INTEGRATION_HITL_GATE.recordDecision({
    entityId: item.id, entityType: 'integration', decision: 'APPROVED',
    actor, meta: { system: item.system }
  });
  res.json({ ok: true, integration: item, decision });
});

app.post('/api/integration/:id/remediate/reject', requireRole(ENTERPRISE_INTERNAL_ROLES), (req, res) => {
  const actor = req.tsmSession.label || req.tsmSession.role;
  const { records, live } = getActiveIntegrationCatalog();
  const item = records.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ ok: false, error: "Integration not found" });
  if (item.status !== 'degraded') return res.status(409).json({ ok: false, error: `Integration is not degraded (current status: ${item.status})` });

  item.status = 'escalated';
  persistIntegrationCatalog(records, live);
  const decision = INTEGRATION_HITL_GATE.recordDecision({
    entityId: item.id, entityType: 'integration', decision: 'REJECTED',
    actor, meta: { system: item.system }
  });
  res.json({ ok: true, integration: item, decision });
});

app.get('/api/integration/decisions', (req, res) => {
  const { limit } = req.query;
  res.json({
    ok: true,
    log: INTEGRATION_HITL_GATE.getLog(parseInt(limit, 10) || 100),
    stats: INTEGRATION_HITL_GATE.getStats()
  });
});

// ── EXEC PORTAL DECISION CENTER (shared client-side driver: html/shared/
// tsm-exec-portal-upgrade.js, injected into healthcare, finops, insurance,
// construction, legal, realestate, and bpo executive portals) ─────────────
// Previously decide() in that shared script only mutated the DOM (a fake
// audit table + TSMState push) -- nothing was written to a server, so every
// approve/reject/hold vanished on reload and there was no real decision log
// to compute an approval/improvement rate from. One HITL gate per vertical,
// same shared factory Governance/Integration Hub/Approval Chain already use,
// so all four "Decision Center" implementations in the platform now share
// one persistence pattern.
// mortgage added 2026-08-12: its exec portal has its own real ACKNOWLEDGE/
// ESCALATE actions (ExecPortal_recordExecAction() in mortgage-executive-
// portal.html) rather than the shared tsm-exec-portal-upgrade.js Decision
// Center used by the other seven verticals below -- so mortgage does NOT
// get that shared script's fabricated KPI cards / placeholder decision
// items injected. It reuses only this real server-side HITL gate + the
// genuine Approval Improvement Rate panel, wired directly into its own
// existing action buttons.
// pm added 2026-08-14: same "own real ACKNOWLEDGE/ESCALATE actions, not the
// shared tsm-exec-portal-upgrade.js Decision Center" pattern as mortgage --
// pm-exec-portal.html wires directly into this gate via its own action
// buttons, not the shared script's fabricated placeholder items.
// l1-copilot added 2026-08-21: same "own real action buttons, not the shared
// tsm-exec-portal-upgrade.js Decision Center" pattern as Mortgage/PM -- the
// L1 Ticket Copilot's Human Decision step wires ACCEPT / KEEP CURRENT
// PRIORITY / SEND FOR REVIEW directly into this gate.
const EXEC_PORTAL_VERTICALS = ['healthcare', 'finops', 'insurance', 'construction', 'legal', 'realestate', 'bpo', 'mortgage', 'pm', 'l1-copilot', 'schools', 'hotelops', 'honeywell'];
const EXEC_PORTAL_GATE_PREFIX = { healthcare: 'HC', finops: 'FIN', insurance: 'INS', construction: 'CON', legal: 'LEG', realestate: 'RE', bpo: 'BPO', mortgage: 'MTG', pm: 'PM', 'l1-copilot': 'L1', schools: 'SCH', hotelops: 'HTL', honeywell: 'HW' };
const EXEC_PORTAL_HITL_GATES = {};
EXEC_PORTAL_VERTICALS.forEach(v => {
  const gatePrefix = EXEC_PORTAL_GATE_PREFIX[v] || 'EXEC';
  const gate = createHitlGate(gatePrefix, tsmLedger.hitlAdapter(gatePrefix));
  gate.hydrate().then(n => { if (n) console.log(`[HITL] ${gatePrefix} gate hydrated ${n} prior decisions`); });
  EXEC_PORTAL_HITL_GATES[v] = gate;
});

// index is the decision's position in that vertical's Decision Center list
// (assigned client-side by tsm-exec-portal-upgrade.js) -- combined with
// vertical it forms a stable entityId so re-deciding the same item (e.g. a
// hold later upgraded to approve) is traceable to one entity across calls.
// GCU PILOT FIX 2026-08-26: exec decisions across all verticals, no auth check.
app.post('/api/exec-portal/:vertical/decide', requireAnyAuth, async (req, res) => {
  const vertical = req.params.vertical;
  const gate = EXEC_PORTAL_HITL_GATES[vertical];
  if (!gate) return res.status(404).json({ ok: false, error: `Unknown vertical: ${vertical}` });

  const { index, verdict, text, meta, tenantId } = req.body || {};
  if (index === undefined || index === null) return res.status(400).json({ ok: false, error: 'index required' });
  if (!['approved', 'rejected', 'hold'].includes(verdict)) {
    return res.status(400).json({ ok: false, error: "verdict must be 'approved', 'rejected', or 'hold'" });
  }

  // Identity comes from the verified session (req.tsmSession, set by
  // requireAnyAuth), never from the request body. The endpoint previously
  // trusted a client-supplied `actor` field with a fallback to the literal
  // string 'Executive' — any authenticated session (including a client-role
  // one) could attribute a decision to any name, and approved decisions
  // auto-relay into the BPO ledger below, so a spoofed actor propagated
  // into real downstream work items.
  const actor = req.tsmSession.label
    || req.tsmSession.staffId
    || (req.tsmSession.role === 'admin' ? 'Admin' : null)
    || 'Unknown';

  const entityId = `exec-${vertical}-${index}`;

  // 'hold' isn't a terminal decision -- the shared HITL gate's log/stats
  // (and its approvalRate math) are for approve-vs-reject outcomes only, so
  // holds are acknowledged here but not written to the gate. This keeps the
  // improvement-rate stat meaningful (a pile of holds shouldn't dilute it)
  // while still giving the frontend one endpoint for all three verdicts.
  if (verdict === 'hold') {
    return res.json({ ok: true, recorded: false, verdict, entityId });
  }

  const decision = gate.recordDecision({
    entityId,
    entityType: 'exec-decision',
    decision: verdict === 'approved' ? 'APPROVED' : 'REJECTED',
    actor,
    meta: Object.assign({ text: text || null, vertical, index }, meta || {})
  });

  // Auto-relay into the BPO ledger (manual's Section 9, Step 2->3): an
  // approved exec decision on a non-BPO vertical now creates/updates a BPO
  // work item automatically, instead of requiring an analyst to re-key it
  // from the exported Client Package JSON. BPO's own vertical is excluded
  // -- it already writes its own work items directly via its dedicated
  // endpoint (bpo-executive-portal.html's markExecuted()), so relaying here
  // too would double-write the same case.
  //
  // clientId resolution: an optional client-supplied `tenantId` (sourced
  // from TSMActiveMember.getId() -- never guessed, see tsm-active-member.js)
  // is looked up against bpo_clients here, server-side, so a spoofed/invalid
  // tenantId just resolves to no match rather than an attacker-chosen
  // clientId. No tenantId, or no client linked to it, leaves clientId null
  // exactly as before -- the "never guess" contract this relay started with
  // is unchanged, this only adds a real (non-guessed) resolution path on
  // top of it. Safe to leave null on repeat calls too: PR #119 made
  // clientId sticky in bpoUpsertWorkItem, so a later omit no longer
  // overwrites a clientId an analyst (or this resolution) has since set.
  if (verdict === 'approved' && vertical !== 'bpo') {
    let resolvedClientId = null;
    if (tenantId) {
      try {
        const client = await tsmLedger.bpoGetClientByTenantId(tenantId);
        if (client) resolvedClientId = client.id;
      } catch (e) {
        console.warn(`[bpo-relay] tenantId lookup failed for ${vertical} decision ${index}:`, e.message);
      }
    }
    tsmLedger.bpoUpsertWorkItem(
      `${vertical.toUpperCase()}-${index}`,
      {
        clientId: resolvedClientId,
        vertical,
        stage: 'exec-approved',
        status: 'open',
        payload: { text: text || null, sourceVertical: vertical, sourceIndex: index, meta: meta || {} },
      },
      actor
    ).catch(err => console.warn(`[bpo-relay] failed to relay ${vertical} decision ${index} into BPO ledger:`, err.message));
  }

  res.json({ ok: true, recorded: true, decision });
});

// TSM FIX 2026-08-27: decision log + approval stats (all verticals incl.
// honeywell) had no auth, even though the paired POST .../decide was gated
// in the 2026-08-26 GCU pilot sweep (47aea602). Closing the read-side gap.
app.get('/api/exec-portal/:vertical/decisions', requireAnyAuth, (req, res) => {
  const vertical = req.params.vertical;
  const gate = EXEC_PORTAL_HITL_GATES[vertical];
  if (!gate) return res.status(404).json({ ok: false, error: `Unknown vertical: ${vertical}` });
  const { limit } = req.query;
  res.json({
    ok: true,
    log: gate.getLog(parseInt(limit, 10) || 100),
    stats: gate.getStats()
  });
});

// Point-to-point integration flows between systems — this IS the "integration catalog"
// and event bus visualization the doc calls for. INTEGRATION_CATALOG above is really a
// systems list; this is the actual connections between them, which the war room UI
// previously hardcoded client-side instead of asking the server for.
const INTEGRATION_FLOWS = [
  { id: 'flow-01', from: 'CRM', to: 'ERP', type: 'REST API', status: 'ok', throughputPerHr: 1240, latencyMs: 42 },
  { id: 'flow-02', from: 'ERP', to: 'Finance', type: 'IDOC', status: 'warning', throughputPerHr: 3310, latencyMs: 210 },
  { id: 'flow-03', from: 'Supply Chain', to: 'ERP', type: 'EDI', status: 'ok', throughputPerHr: 2180, latencyMs: 68 },
  { id: 'flow-04', from: 'Manufacturing', to: 'BI', type: 'Event Stream', status: 'ok', throughputPerHr: 5520, latencyMs: 33 },
  { id: 'flow-05', from: 'HR', to: 'Finance', type: 'REST API', status: 'ok', throughputPerHr: 440, latencyMs: 55 },
  { id: 'flow-06', from: 'AI', to: 'CRM', type: 'Webhook', status: 'ok', throughputPerHr: 670, latencyMs: 180 },
  { id: 'flow-07', from: 'BI', to: 'AI', type: 'GraphQL', status: 'warning', throughputPerHr: 920, latencyMs: 340 }
];

// Message queue monitor: backlog depth per flow. Depth/age drift a bit on each poll so
// the dashboard reads as live rather than static.
const MESSAGE_QUEUES = [
  { id: 'q-crm-erp', name: 'crm.orders.sync', flowId: 'flow-01', depth: 12, consumers: 3, oldestMsgAgeSec: 4 },
  { id: 'q-erp-fin', name: 'erp.finance.postings', flowId: 'flow-02', depth: 340, consumers: 2, oldestMsgAgeSec: 610 },
  { id: 'q-supply-erp', name: 'supply.inventory.updates', flowId: 'flow-03', depth: 28, consumers: 4, oldestMsgAgeSec: 9 },
  { id: 'q-mfg-bi', name: 'mfg.production.events', flowId: 'flow-04', depth: 5, consumers: 6, oldestMsgAgeSec: 1 },
  { id: 'q-bi-ai', name: 'bi.anomaly.signals', flowId: 'flow-07', depth: 87, consumers: 1, oldestMsgAgeSec: 420 }
];

// ETL job status
const ETL_JOBS = [
  { id: 'etl-01', name: 'Nightly GL Sync', system: 'ERP → Finance', status: 'success', lastRunISO: '2026-07-01T04:00:00Z', durationSec: 812, rowsProcessed: 48210 },
  { id: 'etl-02', name: 'CRM Contact Dedup Load', system: 'CRM → MDM', status: 'running', lastRunISO: '2026-07-01T13:40:00Z', durationSec: null, rowsProcessed: 12040 },
  { id: 'etl-03', name: 'Supply Chain Inventory Refresh', system: 'Supply Chain → ERP', status: 'failed', lastRunISO: '2026-07-01T02:15:00Z', durationSec: 94, rowsProcessed: 0, errorMsg: 'Timeout connecting to warehouse feed (10.2.4.18:443)' },
  { id: 'etl-04', name: 'BI Warehouse Aggregation', system: 'Manufacturing/Finance → BI', status: 'success', lastRunISO: '2026-07-01T05:30:00Z', durationSec: 2140, rowsProcessed: 918400 }
];

// Data lineage: which systems feed which shared entities, and where those entities flow
// downstream. Simple upstream/downstream graph, not a full column-level lineage engine —
// enough to answer "if CRM customer data is wrong, what else breaks downstream."
const DATA_LINEAGE = [
  { entity: 'Customer Master', upstream: ['CRM'], downstream: ['ERP', 'Finance', 'BI'] },
  { entity: 'Sales Order', upstream: ['CRM', 'ERP'], downstream: ['Finance', 'Supply Chain', 'BI'] },
  { entity: 'GL Posting', upstream: ['ERP'], downstream: ['Finance', 'BI'] },
  { entity: 'Production Event', upstream: ['Manufacturing'], downstream: ['BI', 'Supply Chain'] },
  { entity: 'Employee Record', upstream: ['HR'], downstream: ['Finance', 'BI'] }
];

// Real error log — /api/integration/:id/error below appends here, so the Error Handling
// Dashboard shows an actual event history, not just a bumped counter with no detail.
const INTEGRATION_ERROR_LOG = [
  { id: 'err-01', ts: '2026-07-01T13:12:00Z', system: 'Finance', flowId: 'flow-02', message: 'IDOC segment E1EDK01 rejected: missing required field WERKS' },
  { id: 'err-02', ts: '2026-07-01T11:48:00Z', system: 'BI', flowId: 'flow-07', message: 'GraphQL query timeout after 30000ms — anomaly-signals endpoint' }
];

app.get('/api/integration/detail', (req, res) => {
  const { records, live } = getActiveIntegrationCatalog();
  res.json({
    ok: true,
    systems: records,
    systems_source: live ? 'live' : 'sample',
    flows: INTEGRATION_FLOWS,
    queues: MESSAGE_QUEUES,
    etlJobs: ETL_JOBS,
    lineage: DATA_LINEAGE,
    errorLog: INTEGRATION_ERROR_LOG.slice(-100).reverse()
  });
});

app.post('/api/integration/query', async (req, res) => {
  const { systems, flows, queues, etlJobs, errorLog, kpis, maxTokens } = req.body || {};
  const summary = JSON.stringify({
    kpis,
    systems_summary: (systems || []).map(s => ({ system: s.system, status: s.status, errorCount: s.errorCount })),
    flow_bottlenecks: (flows || []).filter(f => f.status !== 'ok' || f.latencyMs > 150),
    queue_backlogs: (queues || []).filter(q => q.depth > 50 || q.oldestMsgAgeSec > 60),
    failed_etl: (etlJobs || []).filter(j => j.status === 'failed'),
    recent_errors: (errorLog || []).slice(0, 20)
  }, null, 2);
  const prompt = `Current integration hub snapshot:\n${summary}\n\nIdentify the highest-risk integration failures or bottlenecks right now, trace likely root cause across the affected flow/queue/ETL chain, and recommend specific remediation. Reference system and flow IDs. Be specific and operational.`;
  try {
    const answer = await groqChat(SP.integration, prompt, maxTokens || 1200);
    return res.json({ ok: true, answer, createdAt: new Date().toISOString() });
  } catch (e) {
    console.error('INTEGRATION GROQ ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});


// ── PHASE 6: MASTER DATA MANAGEMENT (MDM) ──────────────────────────────────────
const { findDuplicates: mdmFindDuplicates, scoreDataset: mdmScoreDataset } = require('./html/mdm-suite/mdm-core.js');
const TSMQualityScoreEngine = require('./html/shared/tsm-quality-score-engine.js');
const MDM_SEED_DATA = require('./html/mdm-suite/mdm-seed-data.json');
// Deep-cloned at load time, before any merge can mutate MDM_SEED_DATA, so a real
// reset is possible (restores retired records and clears the decision log).
const MDM_SEED_DATA_ORIGINAL = JSON.parse(JSON.stringify(MDM_SEED_DATA));

app.get('/api/mdm/analysis/:domain', (req, res) => {
  const domain = req.params.domain;
  const records = MDM_SEED_DATA[domain];
  if (!records) return res.status(404).json({ ok: false, error: `Unknown domain. Valid domains: ${Object.keys(MDM_SEED_DATA).join(', ')}` });
  res.json({
    ok: true,
    domain,
    duplicates: mdmFindDuplicates(records, domain),
    quality: mdmScoreDataset(records, domain)
  });
});

app.get('/api/mdm/summary', (req, res) => {
  const domains = Object.keys(MDM_SEED_DATA);
  const summary = domains.map(d => {
    const q = mdmScoreDataset(MDM_SEED_DATA[d], d);
    const dupes = mdmFindDuplicates(MDM_SEED_DATA[d], d);
    return { domain: d, avgQualityScore: q.avgScore, recordCount: q.recordCount, duplicateCount: dupes.length };
  });
  const overallScore = Math.round(summary.reduce((s, d) => s + d.avgQualityScore, 0) / (summary.length || 1));
  res.json({ ok: true, overallScore, domains: summary });
});

// TSM Quality Score Engine wired into live MDM data (BPO Enterprise Roadmap #2:
// Quality Assurance Command Center). Runs the existing mdmScoreDataset() output
// through TSMQualityScoreEngine.fromMdmScore() to get the unified
// accuracy/completeness/compliance/confidence/overall/band shape per domain,
// then rolls those up into a single platform-level score.
app.get('/api/mdm/quality-score', (req, res) => {
  const domains = Object.keys(MDM_SEED_DATA);
  const perDomain = domains.map(d => {
    const scored = mdmScoreDataset(MDM_SEED_DATA[d], d);
    const engineScore = TSMQualityScoreEngine.fromMdmScore(scored);
    return Object.assign({ domain: d }, engineScore);
  });
  const overall = TSMQualityScoreEngine.rollup(perDomain);
  res.json({ ok: true, overall, domains: perDomain });
});

// Full detail across all domains: records + per-record quality/issues + duplicate clusters.
// This is the real single-source-of-truth feed the war room UI renders from.
app.get('/api/mdm/detail', (req, res) => {
  const domains = Object.keys(MDM_SEED_DATA);
  const records = [];
  const duplicates = [];
  domains.forEach(d => {
    const raw = MDM_SEED_DATA[d];
    const scored = mdmScoreDataset(raw, d);
    const dupes = mdmFindDuplicates(raw, d);
    const dupCountByRecordId = {};
    dupes.forEach(m => {
      dupCountByRecordId[m.recordA.id] = (dupCountByRecordId[m.recordA.id] || 0) + 1;
      dupCountByRecordId[m.recordB.id] = (dupCountByRecordId[m.recordB.id] || 0) + 1;
    });
    raw.forEach(r => {
      const s = scored.scores.find(x => x.recordId === r.id) || {};
      const dupCount = dupCountByRecordId[r.id] || 0;
      const status = dupCount > 0 ? 'DUPLICATE' : (s.overall < 70 ? 'INCOMPLETE' : 'CLEAN');
      records.push({
        id: r.id, domain: d, name: r.name,
        quality: s.overall ?? 0, duplicates: dupCount, status,
        issues: s.issues || [],
        steward: MDM_STEWARDS[d] || 'Unassigned',
        last_validated: MDM_LAST_VALIDATED[r.id] || 'Never'
      });
    });
    dupes.forEach(m => duplicates.push({ ...m, id: `${m.recordA.id}~${m.recordB.id}` }));
  });
  res.json({ ok: true, records, duplicates, mergeLog: MDM_MERGE_LOG.slice(-100).reverse() });
});

// Deterministic steward assignment + fake-but-stable "last validated" dates so the
// UI has something consistent to render without inventing new fabricated state each call.
const MDM_STEWARDS = {
  customer: 'R. Whitfield', vendor: 'M. Chen', gl: 'T. Osei',
  product: 'K. Park', employee: 'S. Novak', asset: 'D. Ibrahim',
  location: 'R. Whitfield', orgunit: 'M. Chen', costcenter: 'T. Osei', profitcenter: 'K. Park'
};
const MDM_LAST_VALIDATED = {};
(function seedValidatedDates(){
  const base = new Date('2026-06-20').getTime();
  let i = 0;
  Object.values(MDM_SEED_DATA).flat().forEach(r => {
    MDM_LAST_VALIDATED[r.id] = new Date(base + (i++ * 36e5 * 7)).toISOString().slice(0,10);
  });
})();

// In-memory version history / change-approval log. Every merge decision (approved or
// rejected) is appended here — this IS the audit trail for Phase 6's "version history"
// and "change approvals" requirements. Survives process lifetime, not restarts (matches
// the rest of the platform's in-memory-state pattern; swap for the Fly volume if needed).
const MDM_MERGE_LOG = [];

app.post('/api/mdm/merge', requireRole(ENTERPRISE_INTERNAL_ROLES), (req, res) => {
  const { domain, survivorId, mergedId, decision } = req.body || {};
  const actor = req.tsmSession.label || req.tsmSession.role;
  if (!domain || !survivorId || !mergedId) {
    return res.status(400).json({ ok: false, error: 'domain, survivorId, mergedId required' });
  }
  const raw = MDM_SEED_DATA[domain];
  if (!raw) return res.status(404).json({ ok: false, error: 'Unknown domain' });
  const survivor = raw.find(r => r.id === survivorId);
  const merged = raw.find(r => r.id === mergedId);
  if (!survivor || !merged) return res.status(404).json({ ok: false, error: 'Record not found in domain' });

  const entry = {
    id: `MRG-${Date.now()}-${Math.floor(Math.random()*1000)}`,
    domain, survivorId, mergedId,
    survivorName: survivor.name, mergedName: merged.name,
    decision: decision === 'REJECTED' ? 'REJECTED' : 'APPROVED',
    actor,
    ts: new Date().toISOString()
  };
  MDM_MERGE_LOG.push(entry);

  // Approved merge actually retires the losing record from the working dataset —
  // this is what makes it a real golden-record operation, not just a log entry.
  if (entry.decision === 'APPROVED') {
    MDM_SEED_DATA[domain] = raw.filter(r => r.id !== mergedId);
  }

  res.json({ ok: true, entry });
});

app.get('/api/mdm/merge-history', (req, res) => {
  res.json({ ok: true, log: MDM_MERGE_LOG.slice(-200).reverse() });
});

// ── PHASE 5: MDM DECISION ENGINE (recommendations + approve/reject) ───────────
const { generateRecommendations } = require('./html/mdm-suite/mdm-decision-engine.js');
// Tracks recommendation ids explicitly acted on. Merge recs don't strictly need
// this (retiring a record naturally removes the pair from regeneration), but
// quality-review recs flag a record without mutating it, so without this set
// a reviewed-and-dismissed item would just reappear on the next fetch.
const MDM_RESOLVED_RECS = new Set();
const MDM_RECOMMENDATION_DECISIONS = [];
// Tracks which duplicate-record pairs have already been escalated to Governance
// via /api/mdm/cross-domain-scan, so re-running the scan doesn't create a
// second risk for the same pair every time (mirrors the resolve-once pattern
// MDM already uses for recommendation decisions above).
const MDM_CROSS_DOMAIN_FLAGGED = new Set();

app.get('/api/mdm/recommendations', (req, res) => {
  const recs = generateRecommendations(MDM_SEED_DATA, MDM_RESOLVED_RECS);
  res.json({ ok: true, count: recs.length, recommendations: recs });
});

app.post('/api/mdm/recommendations/:id/approve', requireRole(ENTERPRISE_INTERNAL_ROLES), (req, res) => {
  const actor = req.tsmSession.label || req.tsmSession.role;
  const recs = generateRecommendations(MDM_SEED_DATA, MDM_RESOLVED_RECS);
  const rec = recs.find(r => r.id === req.params.id);
  if (!rec) return res.status(404).json({ ok: false, error: 'Recommendation not found or already resolved' });

  if (rec.type === 'merge') {
    const raw = MDM_SEED_DATA[rec.domain];
    const survivor = raw.find(r => r.id === rec.survivorId);
    const merged = raw.find(r => r.id === rec.mergedId);
    if (!survivor || !merged) return res.status(404).json({ ok: false, error: 'Underlying record no longer exists' });
    const entry = {
      id: `MRG-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      domain: rec.domain, survivorId: rec.survivorId, mergedId: rec.mergedId,
      survivorName: survivor.name, mergedName: merged.name,
      decision: 'APPROVED', actor, ts: new Date().toISOString(),
      recommendationId: rec.id
    };
    MDM_MERGE_LOG.push(entry);
    MDM_SEED_DATA[rec.domain] = raw.filter(r => r.id !== rec.mergedId);
  }

  MDM_RESOLVED_RECS.add(rec.id);
  MDM_MISSION_CLAIMS.delete(rec.id);
  MDM_RECOMMENDATION_DECISIONS.push({
    id: `DEC-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    recommendationId: rec.id, domain: rec.domain, type: rec.type,
    decision: 'APPROVED', actor, ts: new Date().toISOString()
  });
  res.json({ ok: true, resolved: rec });
});

app.post('/api/mdm/recommendations/:id/reject', requireRole(ENTERPRISE_INTERNAL_ROLES), (req, res) => {
  const actor = req.tsmSession.label || req.tsmSession.role;
  const recs = generateRecommendations(MDM_SEED_DATA, MDM_RESOLVED_RECS);
  const rec = recs.find(r => r.id === req.params.id);
  if (!rec) return res.status(404).json({ ok: false, error: 'Recommendation not found or already resolved' });

  if (rec.type === 'merge') {
    MDM_MERGE_LOG.push({
      id: `MRG-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      domain: rec.domain, survivorId: rec.survivorId, mergedId: rec.mergedId,
      survivorName: rec.survivorName, mergedName: rec.mergedName,
      decision: 'REJECTED', actor, ts: new Date().toISOString(),
      recommendationId: rec.id
    });
  }

  MDM_RESOLVED_RECS.add(rec.id);
  MDM_MISSION_CLAIMS.delete(rec.id);
  MDM_RECOMMENDATION_DECISIONS.push({
    id: `DEC-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    recommendationId: rec.id, domain: rec.domain, type: rec.type,
    decision: 'REJECTED', actor, ts: new Date().toISOString()
  });
  res.json({ ok: true, resolved: rec });
});

app.get('/api/mdm/recommendation-decisions', (req, res) => {
  res.json({ ok: true, log: MDM_RECOMMENDATION_DECISIONS.slice(-200).reverse() });
});

// ── PHASE 6: MDM EXECUTIVE PORTAL ──────────────────────────────────────────
// Real governance KPI rollup, computed fresh from live MDM_SEED_DATA + the
// Phase 5 decision engine + the merge/decision logs -- no relay dependency,
// no AI dependency. This is the single-source-of-truth feed the executive
// portal renders from; the war-room-to-portal sessionStorage relay is kept
// as a fallback only (e.g. if this endpoint is ever unreachable client-side).
app.get('/api/mdm/executive-summary', (req, res) => {
  const domains = Object.keys(MDM_SEED_DATA);
  const domainSummaries = domains.map(d => {
    const q = mdmScoreDataset(MDM_SEED_DATA[d], d);
    const dupes = mdmFindDuplicates(MDM_SEED_DATA[d], d);
    return {
      domain: d,
      avgQualityScore: q.avgScore,
      recordCount: q.recordCount,
      duplicateCount: dupes.length,
      steward: MDM_STEWARDS[d] || 'Unassigned'
    };
  });

  const totalRecords = domainSummaries.reduce((s, d) => s + d.recordCount, 0);
  const totalDuplicates = domainSummaries.reduce((s, d) => s + d.duplicateCount, 0);
  const overallQuality = Math.round(
    domainSummaries.reduce((s, d) => s + d.avgQualityScore, 0) / (domainSummaries.length || 1)
  );

  const recs = generateRecommendations(MDM_SEED_DATA, MDM_RESOLVED_RECS);
  const riskBreakdown = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  recs.forEach(r => { riskBreakdown[r.risk] = (riskBreakdown[r.risk] || 0) + 1; });

  res.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    kpis: {
      total_records: totalRecords,
      duplicate_count: totalDuplicates,
      quality_score: overallQuality,
      pending_approvals: recs.length,
      anomalies: riskBreakdown.HIGH,
      stewards_active: new Set(Object.values(MDM_STEWARDS)).size
    },
    riskBreakdown,
    domains: domainSummaries.sort((a, b) => a.avgQualityScore - b.avgQualityScore),
    openRecommendations: recs.slice(0, 15),
    recentDecisions: MDM_RECOMMENDATION_DECISIONS.slice(-10).reverse()
  });
});

// ── Client Trust Package ────────────────────────────────────────────────────
// Bundles the reports a real BPO client expects as ONE deliverable, instead
// of the client having to piece it together from 6 separate API calls
// themselves. Every section below reuses data that already exists elsewhere
// in this file (quality scoring, duplicate detection, the Governance risks
// created by /api/mdm/cross-domain-scan, and the HITL decision log) --
// this is an assembly/packaging endpoint, not new business logic.
//
// "Processed Documents" is deliberately named "recordsProcessed" here rather
// than fabricating document metadata that doesn't exist -- MDM's real input
// is structured master-data records, not scanned documents, and inventing
// fake document counts would be the same kind of dishonest scaffolding this
// session has been finding and removing all night.
app.get('/api/mdm/trust-package', (req, res) => {
  const domains = Object.keys(MDM_SEED_DATA);

  // Quality Report -- reuses the same engine as /api/mdm/quality-score
  const qualityByDomain = domains.map(d => {
    const scored = mdmScoreDataset(MDM_SEED_DATA[d], d);
    return Object.assign({ domain: d }, TSMQualityScoreEngine.fromMdmScore(scored));
  });
  const qualityOverall = TSMQualityScoreEngine.rollup(qualityByDomain);

  // Exception Report -- every high-confidence duplicate across all domains,
  // same detection used by /api/mdm/cross-domain-scan, shown here even for
  // pairs that scored below the auto-escalation threshold so the client can
  // see everything that was reviewed, not just what got escalated.
  const exceptions = [];
  domains.forEach(d => {
    mdmFindDuplicates(MDM_SEED_DATA[d], d).forEach(m => {
      exceptions.push({
        domain: d,
        recordA: m.recordA.name, recordB: m.recordB.name,
        matchScore: m.matchScore, matchReason: m.matchReason, matchField: m.matchField,
        escalatedToGovernance: m.matchScore >= 90,
      });
    });
  });

  // Risk Report -- only risks this package's own pipeline (MDM -> Governance)
  // actually created, not the whole Governance register (which may hold
  // risks from other verticals entirely unrelated to this deliverable).
  const risks = GOVERNANCE_RISK_REGISTER.filter(r => r.source && r.source.system === 'mdm');

  // Audit Trail -- HITL decisions on those specific risks, plus MDM's own
  // merge/recommendation decision logs.
  const riskIds = new Set(risks.map(r => r.id));
  const riskDecisions = GOVERNANCE_HITL_GATE.getLog(200).filter(d => riskIds.has(d.entityId));

  // Recommended Actions + Executive Summary -- reuse the same recommendation
  // engine as /api/mdm/executive-summary.
  const recs = generateRecommendations(MDM_SEED_DATA, MDM_RESOLVED_RECS);

  res.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    package: 'TSM Client Trust Package v1.0',
    recordsProcessed: {
      totalRecords: domains.reduce((s, d) => s + MDM_SEED_DATA[d].length, 0),
      byDomain: domains.map(d => ({ domain: d, count: MDM_SEED_DATA[d].length })),
    },
    qualityReport: { overall: qualityOverall, byDomain: qualityByDomain },
    exceptionReport: { total: exceptions.length, escalatedCount: exceptions.filter(e => e.escalatedToGovernance).length, exceptions },
    riskReport: { total: risks.length, open: risks.filter(r => r.status === 'OPEN').length, risks },
    auditTrail: { riskDecisions, mdmMergeLog: MDM_MERGE_LOG.slice(-50).reverse(), mdmRecommendationDecisions: MDM_RECOMMENDATION_DECISIONS.slice(-50).reverse() },
    recommendedActions: recs,
    executiveSummary: {
      overallQualityScore: qualityOverall.overall,
      totalExceptions: exceptions.length,
      openRisks: risks.filter(r => r.status === 'OPEN').length,
      pendingRecommendations: recs.length,
    },
  });
});

// ── PHASE 7: MDM MISSION QUEUE ──────────────────────────────────────────────
// A "mission" is an open Phase 5 recommendation plus claim/assignment state.
// No separate resolve step -- approving/rejecting the underlying recommendation
// (existing Phase 5 routes) is what retires a mission, so the queue can never
// drift out of sync with what recommendations actually exist.
const { buildQueue: mdmBuildQueue, summarize: mdmSummarizeQueue } = require('./html/mdm-suite/mdm-mission-queue.js');
const MDM_MISSION_CLAIMS = new Map(); // recommendationId -> { actor, claimedAt }
// Phase 7.1 -- Exception Intelligence. Optional per-domain dollar estimate
// for a single duplicate/quality-review item at 100% confidence -- e.g.
// { vendor: 50000 } if finance/ops has sourced "a bad vendor record costs
// ~$50k to clean up/reconcile." Left empty until those figures are actually
// supplied: mdm-mission-queue.js reports estimatedImpact: null for every
// mission rather than a fabricated number when a domain has no weight here.
const MDM_DOMAIN_IMPACT_WEIGHTS = {};

app.get('/api/mdm/mission-queue', (req, res) => {
  const queue = mdmBuildQueue(MDM_SEED_DATA, MDM_RESOLVED_RECS, MDM_MISSION_CLAIMS, { domainImpactWeights: MDM_DOMAIN_IMPACT_WEIGHTS });
  res.json({ ok: true, summary: mdmSummarizeQueue(queue), queue });
});

app.post('/api/mdm/mission-queue/:id/claim', requireRole(ENTERPRISE_INTERNAL_ROLES), (req, res) => {
  const actor = req.tsmSession.label || req.tsmSession.role;
  const queue = mdmBuildQueue(MDM_SEED_DATA, MDM_RESOLVED_RECS, MDM_MISSION_CLAIMS);
  const mission = queue.find(m => m.id === req.params.id);
  if (!mission) return res.status(404).json({ ok: false, error: 'Mission not found or already resolved' });
  if (mission.claimedBy && mission.claimedBy !== actor) {
    return res.status(409).json({ ok: false, error: `Already claimed by ${mission.claimedBy}` });
  }
  MDM_MISSION_CLAIMS.set(mission.id, { actor, claimedAt: new Date().toISOString() });
  res.json({ ok: true, mission: { ...mission, missionStatus: 'CLAIMED', claimedBy: actor } });
});

app.post('/api/mdm/mission-queue/:id/release', requireAuth, (req, res) => {
  const existed = MDM_MISSION_CLAIMS.delete(req.params.id);
  if (!existed) return res.status(404).json({ ok: false, error: 'Mission was not claimed' });
  res.json({ ok: true, released: req.params.id });
});

// Real reset: restores every domain to its original seeded state (undoes any
// approved merges) and clears the decision log. Previously "RESET DATA" just
// re-fetched current state with no way to actually undo anything.
app.post('/api/mdm/reset', requireRole(ENTERPRISE_INTERNAL_ROLES), (req, res) => {
  Object.keys(MDM_SEED_DATA_ORIGINAL).forEach(domain => {
    MDM_SEED_DATA[domain] = JSON.parse(JSON.stringify(MDM_SEED_DATA_ORIGINAL[domain]));
  });
  MDM_MERGE_LOG.length = 0;
  MDM_RESOLVED_RECS.clear();
  MDM_RECOMMENDATION_DECISIONS.length = 0;
  MDM_MISSION_CLAIMS.clear();
  MDM_CROSS_DOMAIN_FLAGGED.clear();
  res.json({ ok: true, reset: true });
});

// ── Cross-War-Room Intelligence: MDM duplicate detection → Governance risk ──
// Real example this implements: MDM finds a duplicate vendor master record
// (e.g. shared tax ID) → that's a live financial risk (potential duplicate
// payment) → Governance should have it on record as a risk needing a human
// decision, without someone manually re-typing it in from the MDM screen.
//
// Only high-confidence matches (score >= 90, i.e. a shared identifier like
// tax ID, not just a fuzzy name match) create a risk — a fuzzy name-only
// match is too weak to escalate automatically and would just add noise to
// Governance's queue.
app.post('/api/mdm/cross-domain-scan', requireAuth, (req, res) => {
  const requestedDomain = req.body && req.body.domain;
  const domains = requestedDomain ? [requestedDomain] : Object.keys(MDM_SEED_DATA);

  const created = [];
  let skippedAlreadyFlagged = 0;
  let skippedLowConfidence = 0;

  domains.forEach(domain => {
    const records = MDM_SEED_DATA[domain];
    if (!records) return;

    mdmFindDuplicates(records, domain).forEach(match => {
      if (match.matchScore < 90) { skippedLowConfidence++; return; }

      const pairKey = domain + ':' + [match.recordA.id, match.recordB.id].sort().join(':');
      if (MDM_CROSS_DOMAIN_FLAGGED.has(pairKey)) { skippedAlreadyFlagged++; return; }
      MDM_CROSS_DOMAIN_FLAGGED.add(pairKey);

      const risk = {
        id:        governanceId('risk'),
        title:     `Duplicate ${domain} master record: "${match.recordA.name}" / "${match.recordB.name}" ` +
                   `(shared ${match.matchField || 'multiple fields'}) — duplicate payment/processing risk`,
        severity:  match.matchScore >= 95 ? 'critical' : 'high',
        owner:     MDM_STEWARDS[domain] || 'Unassigned',
        vertical:  domain,
        status:    'OPEN',
        createdAt: Date.now(),
        source:    { system: 'mdm', matchScore: match.matchScore, matchReason: match.matchReason, recordIds: [match.recordA.id, match.recordB.id] },
      };
      GOVERNANCE_RISK_REGISTER.push(risk);
      created.push(risk);
    });
  });

  res.json({ ok: true, created, skippedAlreadyFlagged, skippedLowConfidence });
});

app.post('/api/mdm/query', async (req, res) => {
  const { records, duplicates, kpis, context, maxTokens } = req.body || {};
  if (!Array.isArray(records)) return res.status(400).json({ ok: false, error: 'records array required' });
  const summary = JSON.stringify({
    kpis,
    record_count: records.length,
    duplicate_clusters: (duplicates || []).slice(0, 20).map(d => ({
      recordA: d.recordA?.id, recordB: d.recordB?.id, matchScore: d.matchScore, domain: d.domain
    })),
    flagged_records: records.filter(r => r.status !== 'CLEAN').slice(0, 30).map(r => ({
      id: r.id, domain: r.domain, status: r.status, quality: r.quality, issues: r.issues
    }))
  }, null, 2);
  const prompt = `Current MDM snapshot:\n${summary}\n\n` +
    (context ? `Additional context: ${context}\n\n` : '') +
    `Identify the highest-risk data anomalies, recommend which record should survive in each duplicate cluster and why, and flag any validation/stewardship gaps. Reference record IDs. Be specific and operational.`;
  try {
    const answer = await groqChat(SP.mdm, prompt, maxTokens || 1200);
    return res.json({ ok: true, answer, createdAt: new Date().toISOString() });
  } catch (e) {
    console.error('MDM GROQ ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── SENTINEL: real document analysis ─────────────────────────────────────────
// Accepts a real uploaded file (multipart/form-data, field name "document"),
// extracts its text, and runs it through the same groqChat/SP pattern the rest
// of the platform already uses (see /api/mdm/query above). No new AI provider,
// no separate service — this is the "minimal proxy" we discussed, just built
// as a route on the backend that already exists instead of a standalone server.
app.post('/api/sentinel/analyze', sentinelUpload.single('document'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ ok: false, error: 'document file required (field name "document")' });

  const vertical = (req.body && req.body.vertical) || 'enterprise';
  const promptKey = SP[vertical] ? vertical : 'enterprise';
  const name = file.originalname || 'uploaded document';
  const ext = (name.split('.').pop() || '').toLowerCase();

  let text = '';
  try {
    if (ext === 'pdf') {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(file.buffer);
      text = data.text || '';
    } else if (ext === 'docx') {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      text = result.value || '';
    } else {
      // txt, csv, and anything else plain-text
      text = file.buffer.toString('utf8');
    }
  } catch (e) {
    return res.status(422).json({ ok: false, error: 'Could not extract text from ' + name + ': ' + e.message });
  }

  if (!text.trim()) {
    return res.status(422).json({ ok: false, error: 'No extractable text found in ' + name });
  }

  // Keep the prompt bounded — long contracts get truncated, not rejected
  const truncated = text.length > 12000;
  const excerpt = text.slice(0, 12000);

  const system = SP[promptKey];
  const userPrompt =
    `Analyze the following real document uploaded by the user for a small-business risk-intelligence ` +
    `platform. Return ONLY valid JSON — no markdown code fences, no prose outside the JSON — matching ` +
    `exactly this schema:\n` +
    `{\n` +
    `  "findingTitle": "short headline under 10 words describing the core finding",\n` +
    `  "findingBody": "2-4 sentences explaining what was found, citing specific evidence (a clause, line, or figure) from the document",\n` +
    `  "impactTag": "short dollar or metric impact string, e.g. '$13,020 unbilled exposure' or '9-day average delay'",\n` +
    `  "missionTitle": "one specific, actionable corrective step under 15 words",\n` +
    `  "missionOwner": "the role best suited to own this, e.g. CFO, Compliance Officer, Operations Manager, Project Manager",\n` +
    `  "missionRisk": "High, Medium, or Low"\n` +
    `}\n\n` +
    `DOCUMENT: ${name}\n\n${excerpt}`;

  try {
    const raw = await groqChat(system, userPrompt, 1200, null, true);

    let structured = null;
    try {
      structured = JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch (e) {
      // Model wrapped the JSON in extra prose despite instructions — pull out
      // the first {...} block and try again before giving up on structured data
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        try { structured = JSON.parse(match[0]); } catch (e2) { structured = null; }
      }
    }

    const finding = structured
      ? `${structured.findingTitle}\n\n${structured.findingBody}\n\n` +
        `Impact: ${structured.impactTag}\n\n` +
        `Recommended action: ${structured.missionTitle} (Owner: ${structured.missionOwner}, Risk: ${structured.missionRisk})`
      : raw;

    res.json({
      ok: true,
      vertical: promptKey,
      sourceFile: name,
      extractedChars: text.length,
      truncated,
      finding,
      structured,
      createdAt: new Date().toISOString()
    });
  } catch (e) {
    console.error('SENTINEL AI ERROR:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});


// ── HEALTH & STUB ROUTES ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[TSM GLOBAL ERROR]', err.message, err.stack);
  if (res.headersSent) return next(err);
  res.status(500).json({ ok: false, error: err.message || 'Internal server error' });
});

// TSM Screenshot Assets
app.use(
  "/screenshots",
  express.static(path.join(__dirname, "public/screenshots"))
);

// TSM Demo Presentation Screenshots (per-vertical, numbered PNGs from
// tests/e2e/demo/*.spec.js) -- served at a fixed absolute path so
// presentations/assets/engine.js doesn't have to know how deep its own
// HTML file lives on disk.
app.use(
  "/demo-screenshots",
  express.static(path.join(__dirname, "tests/e2e/demo/screenshots"))
);

// ── START ─────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`TSM Platform Core Engine listening on port ${PORT}`);
});

server.on('error', (err) => {
  console.error('💥 SERVER ERROR:', err.message, err.stack);
});