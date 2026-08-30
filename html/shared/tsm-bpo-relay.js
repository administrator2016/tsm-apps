'use strict';

/*
 * TSM Executive Portal → BPO Relay
 *
 * Shared browser-side transport for vertical Executive Portals.
 *
 * Responsibilities:
 *   1. Load active BPO clients.
 *   2. Let the operator choose the destination client.
 *   3. Upsert the delivery package as a BPO work item.
 *   4. Upload the same package as a real JSON document.
 *
 * Server remains authoritative for:
 *   - authentication
 *   - authorization
 *   - client ownership
 *   - persistence
 *   - document encryption
 *   - audit
 */

(function (window, document) {
  'use strict';

  function assertPackage(pkg) {
    if (!pkg || typeof pkg !== 'object') {
      throw new Error('Delivery package is required.');
    }

    if (!pkg.domain) {
      throw new Error('Delivery package domain is required.');
    }
  }

  async function listClients() {
    const response = await fetch('/api/bpo/clients?status=active', {
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json'
      }
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok || !body.ok) {
      throw new Error(body.error || 'Unable to load BPO clients.');
    }

    return Array.isArray(body.clients) ? body.clients : [];
  }

  function makeCaseId(pkg, vertical) {
    const sourceId =
      pkg.packageId ||
      pkg.sessionId ||
      pkg.id ||
      Date.now();

    const normalizedVertical = String(vertical || pkg.domain || 'unknown')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toUpperCase();

    return `TSM-${normalizedVertical}-${sourceId}`;
  }

  async function relayToBPO(pkg, clientId, options = {}) {
    assertPackage(pkg);

    if (!clientId) {
      throw new Error('A BPO clientId is required.');
    }

    const vertical = options.vertical || pkg.domain || 'unknown';

    const caseId =
      options.caseId ||
      pkg.bpoCaseId ||
      makeCaseId(pkg, vertical);

    const payload = {
      ...pkg,

      tsmRelay: {
        sourceSystem: options.sourceSystem || 'tsm-executive-portal',
        sourceVertical: vertical,
        sourcePackageId: pkg.packageId || null,
        relayedAt: new Date().toISOString()
      }
    };

    /*
     * STEP 1
     * Create/update the BPO work item.
     */
    const workItemResponse = await fetch(
      `/api/bpo/work-items/${encodeURIComponent(caseId)}`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          vertical,
          clientId,
          payload,
          stage: options.stage || 'ready-for-review',
          status: options.status || 'open'
        })
      }
    );

    const workItemBody =
      await workItemResponse.json().catch(() => ({}));

    if (!workItemResponse.ok || !workItemBody.ok) {
      throw new Error(
        workItemBody.error || 'BPO work-item relay failed.'
      );
    }

    /*
     * STEP 2
     * Store the package as an actual BPO document.
     */
    const filename =
      options.filename ||
      `tsm-${String(vertical)
        .replace(/[^A-Za-z0-9]+/g, '-')
        .toLowerCase()}-client-package.json`;

    const form = new FormData();

    form.append('clientId', clientId);

    form.append(
      'file',
      new Blob(
        [JSON.stringify(payload, null, 2)],
        { type: 'application/json' }
      ),
      filename
    );

    const documentResponse = await fetch(
      `/api/bpo/work-items/${encodeURIComponent(caseId)}/documents`,
      {
        method: 'POST',
        credentials: 'same-origin',
        body: form
      }
    );

    const documentBody =
      await documentResponse.json().catch(() => ({}));

    if (!documentResponse.ok || !documentBody.ok) {
      throw new Error(
        documentBody.error || 'BPO document relay failed.'
      );
    }

    return {
      ok: true,
      caseId,
      clientId,
      vertical,
      workItem: workItemBody.workItem || null,
      document: documentBody.document || null
    };
  }

  function closeOverlay(overlay) {
    if (overlay && overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
  }

  async function openBpoRelayPicker(pkg, options = {}) {
    assertPackage(pkg);

    const clients = await listClients();

    if (!clients.length) {
      throw new Error(
        'No active BPO clients are available for relay.'
      );
    }

    return new Promise((resolve, reject) => {
      const overlay = document.createElement('div');

      overlay.style.cssText = [
        'position:fixed',
        'inset:0',
        'z-index:2147483646',
        'background:rgba(0,0,0,.72)',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'padding:20px',
        'font-family:ui-monospace,monospace'
      ].join(';');

      const card = document.createElement('div');

      card.style.cssText = [
        'width:min(560px,100%)',
        'background:#0a0f22',
        'color:#dde5f4',
        'border:1px solid rgba(0,229,255,.25)',
        'border-radius:10px',
        'padding:22px',
        'box-shadow:0 20px 70px rgba(0,0,0,.5)'
      ].join(';');

      const title = document.createElement('div');
      title.textContent = 'RELAY EXECUTIVE PACKAGE TO BPO';
      title.style.cssText =
        'font-weight:700;letter-spacing:1.5px;font-size:12px;margin-bottom:8px;';

      const detail = document.createElement('div');
      detail.textContent =
        `${options.vertical || pkg.domain} → BPO`;
      detail.style.cssText =
        'font-size:11px;color:#7f91ad;margin-bottom:16px;';

      const select = document.createElement('select');

      select.style.cssText = [
        'width:100%',
        'padding:10px',
        'background:#06091a',
        'color:#dde5f4',
        'border:1px solid rgba(255,255,255,.15)',
        'border-radius:6px',
        'font:inherit',
        'margin-bottom:16px'
      ].join(';');

      clients.forEach(client => {
        const clientId =
          client.id ||
          client.clientId ||
          client._id ||
          '';

        if (!clientId) return;

        const option = document.createElement('option');

        option.value = clientId;

        option.textContent =
          `${client.name || clientId} · ${clientId}`;

        select.appendChild(option);
      });

      const status = document.createElement('div');

      status.style.cssText =
        'min-height:18px;font-size:10px;color:#7f91ad;margin-bottom:12px;';

      const actions = document.createElement('div');

      actions.style.cssText =
        'display:flex;gap:8px;justify-content:flex-end;';

      const cancel = document.createElement('button');

      cancel.textContent = 'CANCEL';

      const relay = document.createElement('button');

      relay.textContent = 'RELAY TO BPO';

      [cancel, relay].forEach(button => {
        button.style.cssText =
          'padding:9px 14px;border-radius:5px;font:inherit;font-size:10px;cursor:pointer;';
      });

      cancel.style.background = 'transparent';
      cancel.style.color = '#9aa8bd';
      cancel.style.border =
        '1px solid rgba(255,255,255,.15)';

      relay.style.background =
        'rgba(0,229,255,.10)';
      relay.style.color = '#00e5ff';
      relay.style.border =
        '1px solid rgba(0,229,255,.35)';

      actions.appendChild(cancel);
      actions.appendChild(relay);

      card.appendChild(title);
      card.appendChild(detail);
      card.appendChild(select);
      card.appendChild(status);
      card.appendChild(actions);

      overlay.appendChild(card);
      document.body.appendChild(overlay);

      cancel.onclick = () => {
        closeOverlay(overlay);

        resolve({
          ok: false,
          cancelled: true
        });
      };

      relay.onclick = async () => {
        relay.disabled = true;
        cancel.disabled = true;

        status.textContent =
          'Relaying work item + document…';

        try {
          const result = await relayToBPO(
            pkg,
            select.value,
            options
          );

          status.textContent =
            `Relayed as ${result.caseId}.`;

          setTimeout(() => {
            closeOverlay(overlay);
            resolve(result);
          }, 400);

        } catch (error) {
          status.textContent =
            error && error.message
              ? error.message
              : 'Relay failed.';

          relay.disabled = false;
          cancel.disabled = false;

          reject(error);
        }
      };
    });
  }

  /*
   * Preserve the existing local-download behavior as an explicit utility.
   */
  function downloadPackage(pkg, filename) {
    assertPackage(pkg);

    const blob = new Blob(
      [JSON.stringify(pkg, null, 2)],
      { type: 'application/json' }
    );

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;

    anchor.download =
      filename ||
      `tsm-client-package-${Date.now()}.json`;

    anchor.click();

    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 0);
  }

  window.relayToBPO = relayToBPO;

  window.TSMBpoRelay = {
    listClients,
    relayToBPO,
    openBpoRelayPicker,
    downloadPackage
  };

})(window, document);
