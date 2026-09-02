
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
app.listen(PORT, "0.0.0.0", () => {
  console.log(`TSM Platform Core Engine listening on port ${PORT}`);
});
