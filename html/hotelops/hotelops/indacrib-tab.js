// InDaCrib guest game tab — lets front desk set the deployed game URL once,
// then shows a QR code + shareable link staff can project, print, or text
// to guests. The URL is saved locally per-device (front desk terminal),
// not synced anywhere — this is an admin convenience, not guest data.
const INDACRIB_URL_KEY = 'hotelops_indacrib_url';

function renderIndaCribTab() {
  const panel = document.getElementById('panel-indacrib-body');
  if (!panel) return;

  const savedUrl = localStorage.getItem(INDACRIB_URL_KEY) || '';

  panel.innerHTML = `
    <div style="padding:20px;max-width:520px;">
      <p style="font-family:var(--mono);font-size:.65rem;color:var(--muted);margin-bottom:14px;">
        Set the deployed InDaCrib URL once — the QR code and link below update automatically.
        Guests scan to join or start a new game; no login required on their end.
      </p>
      <label style="display:block;font-family:var(--mono);font-size:.6rem;color:var(--muted);margin-bottom:6px;">GAME URL</label>
      <input id="indacribUrlInput" type="text" placeholder="https://your-indacrib-deploy.example.com"
        value="${savedUrl.replace(/"/g, '&quot;')}"
        style="width:100%;background:var(--bg3);border:1px solid var(--border);color:var(--white);font-family:var(--mono);font-size:.6rem;padding:8px;margin-bottom:8px;">
      <button class="btn" id="indacribSaveBtn" style="margin-bottom:20px;">SAVE &amp; GENERATE QR</button>
      <div id="indacribOutput"></div>
    </div>
  `;

  const input = document.getElementById('indacribUrlInput');
  const saveBtn = document.getElementById('indacribSaveBtn');
  const output = document.getElementById('indacribOutput');

  function draw(url) {
    if (!url) {
      output.innerHTML = '<div class="mission-item"><span class="mmeta">Enter the game URL above to generate a QR code.</span></div>';
      return;
    }
    output.innerHTML = `
      <div id="indacribQr" style="background:#fff;padding:12px;display:inline-block;border-radius:6px;"></div>
      <div style="font-family:var(--mono);font-size:.6rem;color:var(--white);margin-top:10px;word-break:break-all;">${url}</div>
      <div style="margin-top:10px;">
        <a href="${url}" target="_blank" rel="noopener" class="btn ghost" style="text-decoration:none;display:inline-block;">OPEN GAME</a>
      </div>
    `;
    if (typeof QRCode !== 'undefined') {
      new QRCode(document.getElementById('indacribQr'), { text: url, width: 180, height: 180 });
    }
  }

  saveBtn.addEventListener('click', function () {
    const url = input.value.trim();
    if (!url) return;
    localStorage.setItem(INDACRIB_URL_KEY, url);
    draw(url);
  });

  draw(savedUrl);
}

// Concierge Transport — shell link into the existing Concierge portal while
// the deeper functional merge (shared nav/engine) is scoped out separately.
function renderConciergeTransportTab() {
  const panel = document.getElementById('panel-concierge-transport-body');
  if (!panel) return;

  panel.innerHTML = `
    <div style="padding:20px;max-width:520px;">
      <p style="font-family:var(--mono);font-size:.65rem;color:var(--muted);margin-bottom:16px;">
        Concierge Transport is being folded into HotelOps. For now this opens the existing
        Concierge portal in a new tab; a fully embedded version (shared sidebar, shared data)
        is the next step once this shell is confirmed.
      </p>
      <a href="/html/concierge/concierge-executive-portal.html" target="_blank" rel="noopener"
        class="btn" style="text-decoration:none;display:inline-block;">OPEN CONCIERGE TRANSPORT PORTAL</a>
    </div>
  `;
}
