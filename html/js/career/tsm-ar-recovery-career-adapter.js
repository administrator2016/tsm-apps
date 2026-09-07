(function (global) {
  'use strict';

  /*
   * TSM A/R RECOVERY CAREER ADAPTER
   *
   * Purpose:
   *   Thin training adapter between the operational A/R War Room
   *   and the shared TSM RCM Career Engine.
   *
   * Architecture:
   *
   *   A/R War Room
   *        |
   *        v
   *   TSMARRecoveryCareer
   *        |
   *        v
   *   TSMRCMEngine
   *
   * This adapter owns NO separate persistence layer.
   */

  var VERSION = '1.0.0';

  var SCENARIO = {
    id: 'AR-QUEUE-001',
    title: 'A/R Recovery Queue Prioritization',
    domain: 'ar_recovery',
    competency: 'prioritization',
    prompt:
      'You have an A/R recovery queue. Select the three accounts you would work first and explain why.',
    competencies: [
      'ar_prioritization',
      'aging_analysis',
      'financial_exposure',
      'recovery_strategy',
      'payer_strategy',
      'reasoning'
    ]
  };

  function engine() {
    return global.TSMRCMEngine || null;
  }

  function money(value) {
    var n = Number(value) || 0;
    return '$' + n.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    });
  }

  function normalize(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseMoney(text) {
    var cleaned = String(text || '')
      .replace(/[$,\s]/g, '')
      .replace(/[^\d.-]/g, '');

    var value = parseFloat(cleaned);
    return Number.isFinite(value) ? value : 0;
  }

  function parseAge(text) {
    var match = String(text || '').match(/(\d{1,4})/);
    return match ? parseInt(match[1], 10) : 0;
  }

  function agingBucket(days) {
    if (days <= 30) return '0-30';
    if (days <= 60) return '31-60';
    if (days <= 90) return '61-90';
    if (days <= 120) return '91-120';
    return '120+';
  }

  function agingMultiplier(days) {
    if (days <= 30) return 1.0;
    if (days <= 60) return 1.3;
    if (days <= 90) return 1.7;
    if (days <= 120) return 2.2;
    return 3.0;
  }

  function priorityScore(account) {
    return (Number(account.balance) || 0) *
           agingMultiplier(Number(account.age_days) || 0);
  }

  /*
   * Discover the operational A/R queue without requiring the War Room
   * to adopt another storage system.
   */
  function discoverAccounts() {
    var tables = Array.prototype.slice.call(
      document.querySelectorAll('table')
    );

    for (var t = 0; t < tables.length; t++) {
      var table = tables[t];

      var headerRow = table.querySelector('thead tr') ||
                      table.querySelector('tr');

      if (!headerRow) continue;

      var headers = Array.prototype.slice.call(
        headerRow.querySelectorAll('th,td')
      ).map(function (cell) {
        return normalize(cell.textContent).toLowerCase();
      });

      var accountIndex = headers.findIndex(function (h) {
        return h.indexOf('account') >= 0 ||
               h.indexOf('mrn') >= 0;
      });

      var payerIndex = headers.findIndex(function (h) {
        return h.indexOf('payer') >= 0 ||
               h.indexOf('insurer') >= 0;
      });

      var balanceIndex = headers.findIndex(function (h) {
        return h.indexOf('balance') >= 0 ||
               h.indexOf('amount') >= 0;
      });

      var agingIndex = headers.findIndex(function (h) {
        return h.indexOf('aging') >= 0 ||
               h.indexOf('age') >= 0 ||
               h.indexOf('days') >= 0;
      });

      /*
       * Resolve the actual operational status/issue column.
       * Never assume the final column is status because the
       * queue may end with Recommended Action.
       */
      var statusIndex = headers.findIndex(function (h) {
        return h === 'status' ||
               h.indexOf('status') >= 0 ||
               h.indexOf('reason') >= 0 ||
               h.indexOf('issue') >= 0 ||
               h.indexOf('denial') >= 0;
      });

      var actionIndex = headers.findIndex(function (h) {
        return h.indexOf('recommended action') >= 0 ||
               h.indexOf('recovery action') >= 0 ||
               h === 'action';
      });

      if (accountIndex < 0 || balanceIndex < 0 || agingIndex < 0) {
        continue;
      }

      var rows = Array.prototype.slice.call(
        table.querySelectorAll('tbody tr')
      );

      if (!rows.length) {
        rows = Array.prototype.slice.call(table.querySelectorAll('tr'))
          .slice(1);
      }

      var accounts = [];

      rows.forEach(function (row) {
        var cells = Array.prototype.slice.call(
          row.querySelectorAll('td')
        );

        if (!cells.length) return;

        var accountId = normalize(
          cells[accountIndex] ? cells[accountIndex].textContent : ''
        );

        var payer = normalize(
          cells[payerIndex] ? cells[payerIndex].textContent : ''
        );

        var balance = parseMoney(
          cells[balanceIndex] ? cells[balanceIndex].textContent : ''
        );

        var ageDays = parseAge(
          cells[agingIndex] ? cells[agingIndex].textContent : ''
        );

        if (!accountId || !balance || !ageDays) return;

        var status = '';

        /*
         * Primary source: actual Status / Issue / Denial column.
         */
        if (statusIndex >= 0 && cells[statusIndex]) {
          status = normalize(cells[statusIndex].textContent);
        }

        /*
         * Legacy fallback only when there is no status-like header.
         * This preserves compatibility without confusing the normal
         * Recommended Action column with the account status.
         */
        if (
          !status &&
          statusIndex < 0 &&
          actionIndex >= 0 &&
          cells[actionIndex]
        ) {
          status = normalize(cells[actionIndex].textContent);
        }

        accounts.push({
          account_id: accountId,
          payer: payer,
          balance: balance,
          age_days: ageDays,
          aging_bucket: agingBucket(ageDays),
          priority_score: priorityScore({
            balance: balance,
            age_days: ageDays
          }),
          status: status
        });
      });

      if (accounts.length) return accounts;
    }

    /*
     * Fallback: allow the operational page to expose its queue directly
     * if it already has one of these globals.
     */
    var candidates = [
      global.TSM_AR_RECOVERY_QUEUE,
      global.arRecoveryQueue,
      global.arAccounts,
      global.accounts
    ];

    for (var i = 0; i < candidates.length; i++) {
      if (Array.isArray(candidates[i]) && candidates[i].length) {
        return candidates[i].map(function (a) {
          var copy = Object.assign({}, a);

          copy.account_id =
            copy.account_id ||
            copy.accountId ||
            copy.id ||
            '';

          copy.balance =
            Number(copy.balance) ||
            Number(copy.amount) ||
            0;

          copy.age_days =
            Number(copy.age_days) ||
            Number(copy.ageDays) ||
            Number(copy.age) ||
            0;

          copy.priority_score =
            Number(copy.priority_score) ||
            priorityScore(copy);

          return copy;
        });
      }
    }

    return [];
  }

  function expectedRanking(accounts) {
    return accounts
      .slice()
      .sort(function (a, b) {
        return Number(b.priority_score || 0) -
               Number(a.priority_score || 0);
      });
  }

  function scoreSelection(accounts, selectedIds) {
    var selected = selectedIds
      .map(function (id) {
        return normalize(id).toLowerCase();
      })
      .filter(Boolean);

    var ranking = expectedRanking(accounts);

    var topIds = ranking
      .slice(0, 3)
      .map(function (a) {
        return normalize(a.account_id).toLowerCase();
      });

    var hits = 0;

    selected.forEach(function (id) {
      if (topIds.indexOf(id) >= 0) hits++;
    });

    /*
     * Core prioritization score:
     *   3/3 correct = 100
     *   2/3         = 80
     *   1/3         = 60
     *   0/3         = 40
     *
     * We intentionally avoid requiring the exact same ordering because
     * a real RCM professional may reasonably reorder two high-risk cases.
     */
    var base = 40 + (hits * 20);

    /*
     * Reward selecting genuinely high-exposure accounts even when the
     * exact top three differ.
     */
    var selectedAccounts = accounts.filter(function (a) {
      return selected.indexOf(
        normalize(a.account_id).toLowerCase()
      ) >= 0;
    });

    var selectedExposure = selectedAccounts.reduce(function (sum, a) {
      return sum + (Number(a.priority_score) || 0);
    }, 0);

    var topExposure = ranking.slice(0, 3).reduce(function (sum, a) {
      return sum + (Number(a.priority_score) || 0);
    }, 0);

    var exposureRatio = topExposure
      ? Math.min(selectedExposure / topExposure, 1)
      : 0;

    var score = Math.round(
      Math.min(100, base * 0.70 + exposureRatio * 30)
    );

    return {
      score: score,
      hits: hits,
      selected: selectedAccounts,
      expected: ranking.slice(0, 3),
      selectedExposure: selectedExposure,
      expectedExposure: topExposure
    };
  }

  function scoreReasoning(text, selectedAccounts) {
    var reasoning = normalize(text).toLowerCase();

    if (!reasoning) {
      return {
        score: 0,
        matched: []
      };
    }

    var concepts = [
      {
        name: 'aging',
        terms: ['aging', 'aged', 'days', '120', '91', '90']
      },
      {
        name: 'financial exposure',
        terms: ['balance', 'dollar', 'exposure', 'amount', 'revenue']
      },
      {
        name: 'urgency',
        terms: ['deadline', 'timely filing', 'write-off', 'urgent', 'risk']
      },
      {
        name: 'root cause',
        terms: ['denial', 'authorization', 'underpaid', 'eligibility', 'cob', 'duplicate']
      },
      {
        name: 'recovery',
        terms: ['recover', 'appeal', 'dispute', 'rebill', 'escalate', 'collect']
      }
    ];

    var matched = [];

    concepts.forEach(function (concept) {
      var found = concept.terms.some(function (term) {
        return reasoning.indexOf(term) >= 0;
      });

      if (found) matched.push(concept.name);
    });

    /*
     * 5 concepts = 100.
     * Minimum meaningful reasoning starts at 20.
     */
    var score = Math.min(100, matched.length * 20);

    if (selectedAccounts.length >= 3 && matched.length >= 3) {
      score = Math.min(100, score + 5);
    }

    return {
      score: score,
      matched: matched
    };
  }

  function recordResult(result) {
    var api = engine();

    if (!api) return false;

    if (typeof api.recordAttempt === 'function') {
      api.recordAttempt({
        domain: 'ar_recovery',
        concept: 'prioritization',
        competency: 'ar_prioritization',
        score: result.prioritizationScore / 100,
        scenario: SCENARIO.id
      });

      api.recordAttempt({
        domain: 'ar_recovery',
        concept: 'reasoning',
        competency: 'reasoning',
        score: result.reasoningScore / 100,
        scenario: SCENARIO.id
      });
    }

    if (typeof api.recordDecision === 'function') {
      api.recordDecision({
        scenario: SCENARIO.id,
        selectedAccounts: result.selectedIds,
        reasoningScore: result.reasoningScore / 100,
        recoveryActionScore: result.prioritizationScore / 100
      });
    }

    return true;
  }

  function getReadiness() {
    var api = engine();

    if (!api || typeof api.getReadiness !== 'function') {
      return null;
    }

    try {
      return api.getReadiness();
    } catch (err) {
      return null;
    }
  }

  function renderResult(container, result) {
    var readiness = getReadiness();

    var matchedText = result.reasoningMatched.length
      ? result.reasoningMatched.join(', ')
      : 'No core reasoning concepts detected yet.';

    var expected = result.expected.map(function (a) {
      return a.account_id;
    }).join(', ');

    container.innerHTML =
      '<div class="tsm-ar-career-result">' +
        '<div style="font-weight:800;font-size:18px;margin-bottom:10px;">' +
          'Scenario Result' +
        '</div>' +

        '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:12px;">' +

          '<div style="padding:10px;border:1px solid rgba(255,255,255,.12);border-radius:8px;">' +
            '<div style="font-size:11px;opacity:.7;">PRIORITIZATION</div>' +
            '<div style="font-size:24px;font-weight:800;">' +
              result.prioritizationScore + '%' +
            '</div>' +
          '</div>' +

          '<div style="padding:10px;border:1px solid rgba(255,255,255,.12);border-radius:8px;">' +
            '<div style="font-size:11px;opacity:.7;">REASONING</div>' +
            '<div style="font-size:24px;font-weight:800;">' +
              result.reasoningScore + '%' +
            '</div>' +
          '</div>' +

          '<div style="padding:10px;border:1px solid rgba(255,255,255,.12);border-radius:8px;">' +
            '<div style="font-size:11px;opacity:.7;">TOP-3 MATCHES</div>' +
            '<div style="font-size:24px;font-weight:800;">' +
              result.hits + '/3' +
            '</div>' +
          '</div>' +

        '</div>' +

        '<div style="margin:8px 0;">' +
          '<strong>Expected high-priority accounts:</strong> ' +
          expected +
        '</div>' +

        '<div style="margin:8px 0;">' +
          '<strong>Reasoning concepts detected:</strong> ' +
          matchedText +
        '</div>' +

        '<div style="margin:8px 0;">' +
          '<strong>Decision recorded:</strong> ' +
          (result.recorded ? 'YES' : 'NO') +
        '</div>' +

        (readiness
          ? '<div style="margin-top:12px;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,.12);">' +
              '<strong>Career readiness updated.</strong>' +
              '<div style="margin-top:4px;font-size:12px;opacity:.75;">' +
                'The result has been fed into the shared TSM RCM Career Engine.' +
              '</div>' +
            '</div>'
          : '') +

      '</div>';
  }

  function render(container) {
    if (!container) return;

    var accounts = discoverAccounts();

    container.innerHTML =
      '<div class="tsm-ar-career-practice" style="margin-top:14px;">' +

        '<div style="font-size:12px;letter-spacing:.08em;opacity:.7;">' +
          'CAREER PRACTICE · AR-QUEUE-001' +
        '</div>' +

        '<h3 style="margin:6px 0 8px;">A/R Recovery Queue Prioritization</h3>' +

        '<p style="margin:0 0 12px;line-height:1.5;">' +
          SCENARIO.prompt +
          ' Use balance, aging, urgency, root cause, and recovery opportunity—not just the largest balance.' +
        '</p>' +

        '<div style="margin-bottom:12px;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,.12);">' +
          '<strong>Accounts available:</strong> ' +
          accounts.length +
          (accounts.length
            ? ' · Live queue detected.'
            : ' · Load an A/R sample or queue first.') +
        '</div>' +

        '<label style="display:block;font-weight:700;margin-bottom:5px;">' +
          'Select your top 3 account IDs' +
        '</label>' +

        '<input id="tsmArCareerSelection" type="text" ' +
          'placeholder="Example: MRN-89144, MRN-88450, MRN-88213" ' +
          'style="width:100%;box-sizing:border-box;padding:10px;margin-bottom:12px;" />' +

        '<label style="display:block;font-weight:700;margin-bottom:5px;">' +
          'Why did you choose these accounts?' +
        '</label>' +

        '<textarea id="tsmArCareerReasoning" rows="5" ' +
          'placeholder="Explain your prioritization using aging, balance/exposure, urgency, root cause, and recovery strategy..." ' +
          'style="width:100%;box-sizing:border-box;padding:10px;margin-bottom:12px;"></textarea>' +

        '<button id="tsmArCareerScoreBtn" type="button" ' +
          'style="cursor:pointer;padding:10px 16px;font-weight:800;">' +
          'Score My Decision' +
        '</button>' +

        '<div id="tsmArCareerResult" style="margin-top:14px;"></div>' +

      '</div>';

    var scoreButton =
      document.getElementById('tsmArCareerScoreBtn');

    if (!scoreButton) return;

    scoreButton.addEventListener('click', function () {
      var selectionInput =
        document.getElementById('tsmArCareerSelection');

      var reasoningInput =
        document.getElementById('tsmArCareerReasoning');

      var resultContainer =
        document.getElementById('tsmArCareerResult');

      var selectedIds = normalize(
        selectionInput ? selectionInput.value : ''
      )
        .split(',')
        .map(function (id) { return normalize(id); })
        .filter(Boolean)
        .slice(0, 3);

      var reasoning =
        reasoningInput ? reasoningInput.value : '';

      if (selectedIds.length !== 3) {
        resultContainer.innerHTML =
          '<div style="padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,.15);">' +
            '<strong>Select exactly 3 accounts.</strong>' +
          '</div>';
        return;
      }

      var selectionResult =
        scoreSelection(accounts, selectedIds);

      var reasoningResult =
        scoreReasoning(reasoning, selectionResult.selected);

      var result = {
        selectedIds: selectedIds,
        selected: selectionResult.selected,
        expected: selectionResult.expected,
        hits: selectionResult.hits,
        prioritizationScore: selectionResult.score,
        reasoningScore: reasoningResult.score,
        reasoningMatched: reasoningResult.matched,
        recorded: false
      };

      result.recorded = recordResult(result);

      renderResult(resultContainer, result);
    });
  }

  function mount() {
    var existing =
      document.getElementById('tsmRcmCareerPanel');

    if (!existing) return false;

    if (document.getElementById('tsmArCareerPractice')) {
      return true;
    }

    var section = document.createElement('section');

    section.id = 'tsmArCareerPractice';

    section.style.cssText =
      'margin-top:18px;padding:16px;border-radius:10px;' +
      'border:1px solid rgba(255,255,255,.14);';

    existing.appendChild(section);

    render(section);

    return true;
  }

  /*
   * Career Training Platform contract.
   *
   * Reuse the canonical AR-QUEUE-001 scenario definition already owned
   * by this adapter. Do not create a second scenario definition.
   */


  /*
   * ============================================================
   * AR-ACTION-001 — RECOVERY ACTION TRAINING
   * ============================================================
   *
   * This scenario extends the same operational A/R queue used by
   * AR-QUEUE-001. It deliberately does NOT create a second storage
   * or mastery system.
   */

  var ACTION_SCENARIO = {
    id: 'AR-ACTION-001',
    domain: 'ar_recovery',
    competency: 'recovery_strategy',
    title: 'A/R Recovery Action Selection',
    prompt:
      'Select the recovery action that gives the account the strongest ' +
      'realistic path to payment. Then identify the documentation and urgency.',
    choices: [
      {
        id: 'appeal',
        label: 'Appeal / clinical appeal'
      },
      {
        id: 'variance',
        label: 'Payer variance dispute'
      },
      {
        id: 'corrected_claim',
        label: 'Corrected claim / rebill'
      },
      {
        id: 'eligibility_cob',
        label: 'Resolve eligibility / COB and rebill'
      },
      {
        id: 'escalate',
        label: 'Payer call + written escalation'
      },
      {
        id: 'standard_followup',
        label: 'Standard follow-up'
      }
    ]
  };

  global.TSM_AR_TRAINING_SCENARIOS =
    global.TSM_AR_TRAINING_SCENARIOS || {};

  global.TSM_AR_TRAINING_SCENARIOS[SCENARIO.id] = SCENARIO;
  global.TSM_AR_TRAINING_SCENARIOS[ACTION_SCENARIO.id] = ACTION_SCENARIO;

  function normalizeActionText(value) {
    return String(value || '').toLowerCase().trim();
  }

  function expectedRecoveryAction(account) {
    if (!account) {
      return {
        action: 'standard_followup',
        urgency: 'MEDIUM',
        documentation: ['Account notes', 'Payer correspondence']
      };
    }

    var status = normalizeActionText(account.status);
    var age = Number(account.age_days || 0);

    if (
      status.indexOf('timely filing') !== -1 ||
      status.indexOf('appeal deadline') !== -1
    ) {
      return {
        action: 'appeal',
        urgency: 'CRITICAL',
        documentation: [
          'Payer denial/remittance',
          'Timely filing or appeal documentation',
          'Supporting clinical or claim documentation'
        ]
      };
    }

    if (
      status.indexOf('medical necessity') !== -1 ||
      status.indexOf('denied') !== -1 ||
      status.indexOf('denial') !== -1
    ) {
      return {
        action: 'appeal',
        urgency: age >= 91 ? 'HIGH' : 'MEDIUM',
        documentation: [
          'Denial/remittance',
          'Clinical notes',
          'Medical necessity or supporting documentation'
        ]
      };
    }

    if (
      status.indexOf('underpaid') !== -1 ||
      status.indexOf('variance') !== -1 ||
      status.indexOf('contracted rate') !== -1
    ) {
      return {
        action: 'variance',
        urgency: age >= 91 ? 'HIGH' : 'MEDIUM',
        documentation: [
          'Remittance advice',
          'Contracted rate',
          'Payment variance calculation'
        ]
      };
    }

    if (
      status.indexOf('duplicate') !== -1 ||
      status.indexOf('rejection') !== -1
    ) {
      return {
        action: 'corrected_claim',
        urgency: age >= 91 ? 'HIGH' : 'MEDIUM',
        documentation: [
          'Rejected claim',
          'Original claim details',
          'Corrected claim information'
        ]
      };
    }

    if (
      status.indexOf('cob') !== -1 ||
      status.indexOf('coordination') !== -1
    ) {
      return {
        action: 'eligibility_cob',
        urgency: age >= 91 ? 'HIGH' : 'MEDIUM',
        documentation: [
          'Eligibility verification',
          'COB information',
          'Updated claim/billing documentation'
        ]
      };
    }

    if (
      status.indexOf('eligibility') !== -1
    ) {
      return {
        action: 'eligibility_cob',
        urgency: age >= 91 ? 'HIGH' : 'MEDIUM',
        documentation: [
          'Eligibility verification',
          'Coverage information',
          'Rebilling documentation'
        ]
      };
    }

    if (
      status.indexOf('no response') !== -1 ||
      status.indexOf('write-off') !== -1 ||
      status.indexOf('write off') !== -1
    ) {
      return {
        action: 'escalate',
        urgency: age >= 120 ? 'CRITICAL' : 'HIGH',
        documentation: [
          'Payer call history',
          'Prior written follow-up',
          'Account escalation notes'
        ]
      };
    }

    if (age >= 120) {
      return {
        action: 'escalate',
        urgency: 'CRITICAL',
        documentation: [
          'Account history',
          'Payer correspondence',
          'Escalation/write-off prevention documentation'
        ]
      };
    }

    if (age >= 91) {
      return {
        action: 'escalate',
        urgency: 'HIGH',
        documentation: [
          'Account notes',
          'Payer correspondence',
          'Follow-up documentation'
        ]
      };
    }

    return {
      action: 'standard_followup',
      urgency: age >= 61 ? 'MEDIUM' : 'LOW',
      documentation: [
        'Account notes',
        'Payer correspondence'
      ]
    };
  }

  function scoreRecoveryAction(account, selectedAction) {
    var expected = expectedRecoveryAction(account);
    var actual = normalizeActionText(selectedAction);

    var score = actual === expected.action ? 1 : 0;

    return {
      score: score,
      percentage: Math.round(score * 100),
      expectedAction: expected.action,
      selectedAction: actual,
      urgency: expected.urgency,
      documentation: expected.documentation,
      correct: score === 1
    };
  }

  function scoreActionReasoning(text, account, selectedAction) {
    var value = normalizeActionText(text);
    var expected = expectedRecoveryAction(account);
    var concepts = 0;

    var terms = [
      'denial',
      'appeal',
      'deadline',
      'payer',
      'aging',
      'balance',
      'documentation',
      'medical necessity',
      'underpaid',
      'variance',
      'eligibility',
      'cob',
      'recovery',
      'write-off',
      'write off',
      'urgency'
    ];

    terms.forEach(function (term) {
      if (value.indexOf(term) !== -1) concepts += 1;
    });

    var score = Math.min(1, concepts / 3);

    if (
      value.indexOf(expected.action.replace('_', ' ')) !== -1 ||
      (expected.action === 'appeal' && value.indexOf('appeal') !== -1) ||
      (expected.action === 'variance' && value.indexOf('variance') !== -1) ||
      (expected.action === 'corrected_claim' &&
        (value.indexOf('corrected') !== -1 ||
          value.indexOf('rebill') !== -1)) ||
      (expected.action === 'eligibility_cob' &&
        (value.indexOf('eligibility') !== -1 ||
          value.indexOf('cob') !== -1)) ||
      (expected.action === 'escalate' &&
        (value.indexOf('escalat') !== -1 ||
          value.indexOf('payer call') !== -1))
    ) {
      score = Math.min(1, score + 0.25);
    }

    return {
      score: score,
      percentage: Math.round(score * 100),
      concepts: concepts
    };
  }

  function scoreDocumentation(selectedDocumentation, account) {
    var expected = expectedRecoveryAction(account);
    var supplied = Array.isArray(selectedDocumentation)
      ? selectedDocumentation
      : [];

    var suppliedNormalized = supplied
      .map(function (doc) {
        return normalizeActionText(doc);
      })
      .filter(Boolean);

    var matched = expected.documentation.filter(function (item) {
      var target = normalizeActionText(item);

      /*
       * Direct/fuzzy matching.
       */
      if (suppliedNormalized.some(function (doc) {
        return doc.indexOf(target) !== -1 ||
               target.indexOf(doc) !== -1;
      })) {
        return true;
      }

      /*
       * Medical-necessity synonyms.
       */
      if (
        target.indexOf('medical necessity') !== -1 &&
        suppliedNormalized.some(function (doc) {
          return doc.indexOf('medical necessity') !== -1;
        })
      ) {
        return true;
      }

      /*
       * Clinical/supporting documentation are valid equivalents
       * when the expected requirement is broad clinical support.
       */
      if (
        target.indexOf('clinical') !== -1 &&
        suppliedNormalized.some(function (doc) {
          return doc.indexOf('clinical') !== -1;
        })
      ) {
        return true;
      }

      if (
        target.indexOf('supporting') !== -1 &&
        suppliedNormalized.some(function (doc) {
          return doc.indexOf('supporting') !== -1 ||
                 doc.indexOf('medical necessity') !== -1 ||
                 doc.indexOf('clinical') !== -1;
        })
      ) {
        return true;
      }

      /*
       * Denial/remittance terminology.
       */
      if (
        target.indexOf('denial') !== -1 &&
        suppliedNormalized.some(function (doc) {
          return doc.indexOf('denial') !== -1 ||
                 doc.indexOf('remittance') !== -1;
        })
      ) {
        return true;
      }

      /*
       * Appeal/timely-filing terminology.
       */
      if (
        target.indexOf('appeal') !== -1 &&
        suppliedNormalized.some(function (doc) {
          return doc.indexOf('appeal') !== -1 ||
                 doc.indexOf('timely filing') !== -1;
        })
      ) {
        return true;
      }

      return false;
    });

    var score =
      matched.length / Math.max(1, expected.documentation.length);

    return {
      score: score,
      percentage: Math.round(score * 100),
      matched: matched
    };
  }

  function recordActionResult(result) {
    result = result || {};

    var account = result.account || null;
    var actionScore = scoreRecoveryAction(
      account,
      result.selectedAction
    );

    var reasoningScore = scoreActionReasoning(
      result.reasoning,
      account,
      result.selectedAction
    );

    var documentationScore = scoreDocumentation(
      result.documentation,
      account
    );

    var recorded = [];

    var engine =
      global.TSMRCMEngine ||
      null;

    /*
     * IMPORTANT ORDER:
     *
     * recordDecision() internally records:
     *   1. decision_reasoning
     *   2. recovery_action
     *
     * We intentionally execute it FIRST.
     *
     * The three explicit AR-ACTION competency attempts then become
     * the latest three attempts:
     *   1. recovery_strategy
     *   2. payer_strategy
     *   3. documentation
     *
     * This keeps the Career Mastery history aligned with the
     * AR-ACTION-001 competency contract.
     */
    if (engine && typeof engine.recordDecision === 'function') {
      recorded.push(
        engine.recordDecision({
          scenario: ACTION_SCENARIO.id,
          selectedAccounts: account ? [account] : [],
          reasoningScore: reasoningScore.score,
          recoveryActionScore: actionScore.score
        })
      );
    }

    if (engine && typeof engine.recordAttempt === 'function') {
      recorded.push(
        engine.recordAttempt({
          domain: 'ar_recovery',
          concept: 'recovery_strategy',
          competency: 'recovery_strategy',
          score: actionScore.score,
          scenario: ACTION_SCENARIO.id
        })
      );

      recorded.push(
        engine.recordAttempt({
          domain: 'ar_recovery',
          concept: 'payer_strategy',
          competency: 'payer_strategy',
          score: reasoningScore.score,
          scenario: ACTION_SCENARIO.id
        })
      );

      recorded.push(
        engine.recordAttempt({
          domain: 'ar_recovery',
          concept: 'documentation',
          competency: 'documentation',
          score: documentationScore.score,
          scenario: ACTION_SCENARIO.id
        })
      );
    }

    return {
      scenario: ACTION_SCENARIO.id,
      account_id: account ? account.account_id : null,
      actionScore: actionScore,
      reasoningScore: reasoningScore,
      documentationScore: documentationScore,
      overallScore:
        Math.round(
          (
            actionScore.score +
            reasoningScore.score +
            documentationScore.score
          ) / 3 * 100
        ) / 100,
      recorded: recorded.length > 0
    };
  }

  global.TSMARRecoveryCareer = {
    version: VERSION,
    scenario: SCENARIO,
    actionScenario: ACTION_SCENARIO,
    discoverAccounts: discoverAccounts,
    scoreSelection: scoreSelection,
    scoreReasoning: scoreReasoning,
    recordResult: recordResult,
    expectedRecoveryAction: expectedRecoveryAction,
    scoreRecoveryAction: scoreRecoveryAction,
    scoreActionReasoning: scoreActionReasoning,
    scoreDocumentation: scoreDocumentation,
    recordActionResult: recordActionResult,
    getReadiness: getReadiness,
    mount: mount
  };

  function boot() {
    if (mount()) return;

    /*
     * The A/R page may render its career panel after initial load.
     * Retry briefly without creating a permanent polling loop.
     */
    var attempts = 0;

    var timer = setInterval(function () {
      attempts++;

      if (mount() || attempts >= 20) {
        clearInterval(timer);
      }
    }, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})(window);
