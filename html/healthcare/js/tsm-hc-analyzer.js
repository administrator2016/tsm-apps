/**
 * TSM Healthcare Sector Analyzer v1.0
 * Sector plugin — bridges the HC 5-engine Denial War Room to the Mission Engine.
 *
 * Drop into html/healthcare/ and load after core scripts + war room inline scripts.
 * Zero breakage — intercepts sessionStorage write after all 5 engines complete.
 *
 * Dependencies: tsm-event-bus.js · tsm-state.js · tsm-mission-engine.js
 */

(function (global) {
  'use strict';

  const SECTOR = 'healthcare';

  // ── HC-specific field extractors ──────────────────────────────────────────

  function extract(key, text) {
    if (!text) return null;
    const re = new RegExp(key + '[:\\s]+([^\\n]+)', 'i');
    const m = text.match(re);
    return m ? m[1].trim() : null;
  }

  function extractNum(key, text) {
    const val = extract(key, text);
    if (!val) return null;
    const n = parseFloat(val.replace(/[^0-9.]/g, ''));
    return isNaN(n) ? null : n;
  }

  function parseDollar(str) {
    if (!str) return null;
    const nums = String(str).replace(/[^0-9.,\-–]/g, ' ')
      .trim().split(/[\-–]/)
      .map(s => parseFloat(s.replace(/,/g, '')))
      .filter(n => !isNaN(n));
    if (!nums.length) return null;
    return nums.length === 1 ? nums[0] : Math.round((nums[0] + nums[1]) / 2);
  }

  function riskToPriority(text) {
    if (!text) return 'medium';
    const t = String(text).toLowerCase();
    if (t.includes('critical') || t.includes('high')) return 'high';
    if (t.includes('low'))  return 'low';
    return 'medium';
  }

  // TSM FIX: same class of bug already fixed in hc-denial-war-room.html's
  // buildHCStructuredCase() and hc-main-strategist.html's
  // wrGeneratePhysicianEMTemplate — engine outputs are raw LLM text that's
  // frequently markdown-formatted ("**Claim ID:** HC-...", or a bold
  // section heading on its own line with the real content on the next
  // line) even when the system prompt asks for plain "Label: value"
  // bullets. extract()'s regex expects "label[:\s]+value" immediately
  // after the label with no markdown in between, so a bold marker breaks
  // the match — e.g. claimId ended up capturing just the trailing "ID"
  // (rendered downstream as the duplicated, meaningless "Claim ID"), and
  // parseE2's denial-reason line ended up as the raw "**Denial Reason**"
  // heading instead of the real explanation. This third copy of the
  // extraction logic never got the fix that landed on the other two.
  // Strip markdown once, before any field regex runs.
  function stripMd(text) {
    if (!text) return text;
    return text
      .replace(/\*\*(.*?)\*\*/g, '$1')   // **bold**
      .replace(/\*(.*?)\*/g, '$1')       // *italic*
      .replace(/__(.*?)__/g, '$1')       // __bold__
      .replace(/_(.*?)_/g, '$1')         // _italic_
      .replace(/`(.*?)`/g, '$1')         // `code`
      .replace(/^#{1,6}\s+/gm, '')       // # headings
      .replace(/^\s*[-*+]\s+/gm, '');    // - / * / + bullet markers
  }

  // ── Engine parsers ────────────────────────────────────────────────────────

  // Engine 1 — Document Intel
  function parseE1(text) {
    if (!text) return { findings: [], claimId: null, cptCodes: [], denialCodes: [], billedAmount: null, payer: null, provider: null };
    const claimId      = extract('Claim ID', text)     || extract('claim id', text);
    const cptMatch     = text.match(/CPT[^:]*:?\s*([0-9, ]+)/i);
    const cptCodes     = cptMatch ? cptMatch[1].split(',').map(s => s.trim()).filter(Boolean) : [];
    const denialMatch  = text.match(/(?:Denial Code|CO-|PR-)[\s:]*([A-Z0-9\-,\s]+)/i);
    const denialCodes  = denialMatch ? denialMatch[1].split(',').map(s => s.trim()).filter(Boolean) : [];
    const billedAmount = parseDollar(extract('Billed Amount', text) || extract('billed', text));
    const payer        = extract('Payer', text);
    const provider     = extract('Provider', text);
    const appealDeadline = extract('Appeal Deadline', text) || extract('appeal deadline', text);

    const findings = [];
    if (denialCodes.length) findings.push({
      title: `Denial codes: ${denialCodes.join(', ')}`,
      severity: 'high',
      detail: text.slice(0, 200),
    });
    if (appealDeadline) findings.push({
      title: `Appeal deadline: ${appealDeadline}`,
      severity: 'critical',
      detail: 'Timely filing risk',
    });

    return { findings, claimId, cptCodes, denialCodes, billedAmount, payer, provider, appealDeadline };
  }

  // Engine 2 — Root Cause
  function parseE2(text) {
    if (!text) return [];
    return [
      extract('denial reason', text)         || extract('denial', text),
      extract('payer policy', text)          || extract('policy violated', text),
      extract('documentation gap', text)     || extract('documentation', text),
      extract('coding error', text)          || extract('coding', text),
    ].filter(Boolean).map(detail => ({
      title: 'Root Cause: ' + detail.split(':')[0].trim(),
      severity: 'high',
      detail,
    }));
  }

  // Engine 3 — Financial Impact
  function parseE3(text) {
    if (!text) return { findings: [], exposure: null };
    const exposureStr  = extract('revenue at risk', text)
                      || extract('financial exposure', text)
                      || extract('total exposure', text);
    const exposure = parseDollar(exposureStr);
    return {
      exposure,
      findings: [
        exposureStr  ? { title: 'Revenue at risk: ' + exposureStr, severity: 'high', detail: exposureStr, exposure } : null,
        extract('timely filing', text)  ? { title: 'Timely filing risk', severity: 'critical', detail: extract('timely filing', text) } : null,
      ].filter(Boolean),
    };
  }

  // Engine 4 — Recovery Plan
  function parseE4(text) {
    if (!text) return { findings: [], actions: [] };
    const actions = [];
    text.split('\n')
      .filter(l => /^\d+[\.\)]\s/.test(l.trim()))
      .slice(0, 5)
      .forEach(l => {
        const clean = l.replace(/^\d+[\.\)]\s*/, '').trim();
        if (clean) actions.push({ title: clean, priority: 'high' });
      });

    return {
      actions,
      findings: [{
        title: 'Recovery plan generated',
        severity: 'medium',
        detail: actions[0]?.title || 'See recovery plan',
      }],
    };
  }

  // Engine 5 — Recovery Navigator
  function parseE5(text) {
    if (!text) return { summary: null, risks: [], confidence: 70 };
    const steps = text.split('\n')
      .filter(l => /^\d+[\.\)]\s/.test(l.trim()))
      .slice(0, 3)
      .map(l => l.replace(/^\d+[\.\)]\s*/, '').trim());

    // Confidence: inverse of denial complexity
    const hasCritical = /critical|immediately|urgent/i.test(text);
    const confidence  = hasCritical ? 55 : 72;

    return {
      summary: text.slice(0, 400),
      risks: steps.length ? [{ title: 'Immediate action required', likelihood: 'high', impact: steps[0] }] : [],
      confidence,
    };
  }

  // ── Package all engines into a Mission ────────────────────────────────────

  function packageMission(docText, outputs) {
    // outputs is array [e1, e2, e3, e4, e5] (0-indexed)
    const e1Text = stripMd(outputs[0] || '');
    const e2Text = stripMd(outputs[1] || '');
    const e3Text = stripMd(outputs[2] || '');
    const e4Text = stripMd(outputs[3] || '');
    const e5Text = stripMd(outputs[4] || '');

    const doc  = parseE1(e1Text);
    const rc   = parseE2(e2Text);
    const fin  = parseE3(e3Text);
    const rec  = parseE4(e4Text);
    const nav  = parseE5(e5Text);

    const allFindings = [...doc.findings, ...rc, ...fin.findings, ...rec.findings];
    const hasCritical = allFindings.some(f => f.severity === 'critical');
    const priority    = hasCritical ? 'critical'
                      : fin.exposure && fin.exposure > 50000 ? 'high' : 'medium';

    // Create mission
    const mission = global.TSMMission.create({
      sector:     SECTOR,
      owner:      doc.provider || null,
      priority,
      exposure:   fin.exposure || (doc.billedAmount ? doc.billedAmount * 1.2 : null),
      confidence: nav.confidence,
      source:     'HC Denial',
      meta: {
        claimId:         doc.claimId,
        cptCodes:        doc.cptCodes,
        denialCodes:     doc.denialCodes,
        payer:           doc.payer,
        provider:        doc.provider,
        billedAmount:    doc.billedAmount,
        appealDeadline:  doc.appealDeadline,
        docLength:       docText ? docText.length : 0,
      },
    });

    // Evidence
    global.TSMMission.addEvidence(mission.id, {
      type:    'document',
      ref:     doc.claimId || 'HC Denial Claim',
      summary: `${doc.payer || 'Payer'} — ${doc.denialCodes.join(', ') || 'denial'} — ${doc.billedAmount ? '$' + doc.billedAmount.toLocaleString() : 'see doc'}`,
    });
    if (doc.appealDeadline) {
      global.TSMMission.addEvidence(mission.id, {
        type:    'log',
        ref:     'Appeal Deadline',
        summary: doc.appealDeadline,
      });
    }

    // Explainability
    global.TSMMission.setExplainability(mission.id, {
      confidence:        nav.confidence,
      recommendedAction: rec.actions[0]?.title || 'File appeal immediately',
      reasoning:         allFindings.map(f => f.title).slice(0, 6),
      governance: {
        approvalRequired: priority === 'critical' || (fin.exposure && fin.exposure > 100000),
        policy: priority === 'critical' ? 'Critical denial: executive review required' : null,
      },
    });

    // Add tasks from recovery plan
    rec.actions.slice(0, 4).forEach(a => {
      global.TSMMission.addTask(mission.id, { title: a.title, priority: 'high' });
    });

    // Publish analysis → fires WARROOM_FINDINGS_READY + STRATEGIST_READY
    global.TSMMission.publishAnalysis(mission.id, {
      summary:    nav.summary,
      findings:   allFindings,
      risks:      nav.risks,
      actions:    rec.actions,
      confidence: nav.confidence,
    });


    console.info(`[TSM HC] Mission packaged: ${mission.id} | priority:${priority} | findings:${allFindings.length} | exposure:${fin.exposure}`);
    return mission;
  }

  // ── Wire to war room ──────────────────────────────────────────────────────

  function wireToWarRoom() {
    // Intercept sessionStorage.setItem for 'tsmHcWarRoom'
    const _origSS = sessionStorage.setItem.bind(sessionStorage);
    sessionStorage.setItem = function (key, value) {
      _origSS(key, value);
      if (key === 'tsmHcWarRoom') {
        try {
          const data = JSON.parse(value);
          if (!data.missionId && data.engineOutputs && global.TSMMission) {
            const mission = packageMission(data.docText || '', data.engineOutputs);

            // Signal completion on the bus (mirrors BPO_ANALYSIS_COMPLETE pattern).
            // missionId is included so this file's own listener below skips
            // re-processing this same payload (prevents an emit/on loop).
            if (global.TSMBus && mission) {
              global.TSMBus.emit('WARROOM_COMPLETE', {
                sector:        SECTOR,
                missionId:     mission.id,
                docText:       data.docText || '',
                engineOutputs: data.engineOutputs,
              });
            }
          }
        } catch (err) {
          console.warn('[TSM HC] Intercept parse error:', err);
        }
      }
    };

    // Direct call interface for refactored war room
    global.TSMHealthcare = {
      packageMission,
      parseE1, parseE2, parseE3, parseE4, parseE5,
      SECTOR,
    };

    // Bus listener (plain string event name — no TSMBus.EVENTS map exists
    // anywhere in this platform, so this matches the codebase convention)
    if (global.TSMBus) {
      global.TSMBus.on('WARROOM_COMPLETE', (payload) => {
        if (payload.sector === SECTOR && !payload.missionId) {
          packageMission(payload.docText || '', payload.engineOutputs || []);
        }
      });
    }

    console.info('[TSM Healthcare] Analyzer wired.');
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  if (global.TSMMission && global.TSMBus) {
    wireToWarRoom();
  } else {
    document.addEventListener('DOMContentLoaded', () => setTimeout(wireToWarRoom, 100));
  }

})(window);