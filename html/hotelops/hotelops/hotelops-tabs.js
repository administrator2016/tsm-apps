(function () {
  function slugify(t) {
    return t.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  document.addEventListener('DOMContentLoaded', function () {
    var main = document.getElementById('main');
    var modules = document.querySelectorAll('#sidebar .module');
    if (!main || !modules.length) return;

    var firstSlug = slugify(modules[0].textContent);
    var existingWrap = document.createElement('div');
    existingWrap.id = 'tabpanel-' + firstSlug;
    existingWrap.className = 'tabpanel';
    while (main.firstChild) existingWrap.appendChild(main.firstChild);
    main.appendChild(existingWrap);

    modules.forEach(function (mod, i) {
      var slug = slugify(mod.textContent);
      mod.setAttribute('data-tab', slug);
      if (i === 0) return;

      var panel = document.createElement('div');
      panel.id = 'tabpanel-' + slug;
      panel.className = 'tabpanel';
      panel.style.display = 'none';

      if (slug === 'maintenance') {
        panel.innerHTML =
          '<div class="panel"><div class="panel-hdr">MAINTENANCE</div>' +
          '<div class="panel-body" id="panel-maintenance-body" style="padding:0;">Loading&hellip;</div></div>';
      } else if (slug === 'document-intake') {
        // The real Document Intake & AI Analysis panel already lives in
        // the Guest Intelligence tab (it was the page's original default
        // content, wrapped into tabpanel-guest-intelligence above). Don't
        // duplicate it here — that would clone #docIntake/#btnAnalyze/
        // #btnRelay/#aiOutput ids and break the click handlers already
        // wired to them. Just skip creating a panel for this slug; the
        // click handler below redirects it to the Guest Intelligence panel.
        return;
      } else if (slug === 'reservations') {
        panel.innerHTML =
          '<div class="panel"><div class="panel-hdr">RESERVATIONS</div>' +
          '<div class="panel-body" id="panel-reservations-body" style="padding:0;">Loading&hellip;</div></div>';
      } else if (slug === 'front-desk') {
        panel.innerHTML =
          '<div class="panel"><div class="panel-hdr">FRONT DESK</div>' +
          '<div class="panel-body" id="panel-front-desk-body" style="padding:0;">Loading&hellip;</div></div>';
      } else if (slug === 'vip-arrivals') {
        panel.innerHTML =
          '<div class="panel"><div class="panel-hdr">VIP ARRIVALS</div>' +
          '<div class="panel-body" id="panel-vip-arrivals-body" style="padding:0;">Loading&hellip;</div></div>';
      } else if (slug === 'indacrib') {
        panel.innerHTML =
          '<div class="panel"><div class="panel-hdr">INDACRIB &mdash; GUEST GAME</div>' +
          '<div class="panel-body" id="panel-indacrib-body" style="padding:0;">Loading&hellip;</div></div>';
      } else if (slug === 'concierge-transport') {
        panel.innerHTML =
          '<div class="panel"><div class="panel-hdr">CONCIERGE TRANSPORT</div>' +
          '<div class="panel-body" id="panel-concierge-transport-body" style="padding:0;">Loading&hellip;</div></div>';
      } else if (slug === 'housekeeping') {
        panel.innerHTML =
          '<div class="panel"><div class="panel-hdr">HOUSEKEEPING</div>' +
          '<div class="panel-body" id="panel-housekeeping-body" style="padding:0;">Loading&hellip;</div></div>';
      } else if (slug === 'staff-operations') {
        panel.innerHTML =
          '<div class="panel"><div class="panel-hdr">STAFF OPERATIONS</div>' +
          '<div class="panel-body" id="panel-staff-operations-body" style="padding:0;">Loading&hellip;</div></div>';
      } else if (slug === 'incident-center') {
        panel.innerHTML =
          '<div class="panel"><div class="panel-hdr">INCIDENT CENTER</div>' +
          '<div class="panel-body" id="panel-incident-center-body" style="padding:0;">Loading&hellip;</div></div>';
      } else if (slug === 'iot-smart-systems' || slug === 'smart-systems' || mod.textContent.trim().toLowerCase().indexOf('iot') !== -1) {
        panel.innerHTML =
          '<div class="panel"><div class="panel-hdr">IOT / SMART SYSTEMS</div>' +
          '<div class="panel-body" id="panel-iot-body" style="padding:0;">Loading&hellip;</div></div>';
      } else if (slug === 'airbnb-str-operations') {
        panel.innerHTML =
          '<div class="panel"><div class="panel-hdr">AIRBNB / STR OPERATIONS</div>' +
          '<div class="panel-body" id="panel-airbnb-str-operations-body" style="padding:0;">Loading&hellip;</div></div>';
      } else if (slug === 'ota-intelligence') {
        panel.innerHTML =
          '<div class="panel"><div class="panel-hdr">OTA INTELLIGENCE</div>' +
          '<div class="panel-body" id="panel-ota-intelligence-body" style="padding:0;">Loading&hellip;</div></div>';
      } else if (slug === 'revenue-management') {
        panel.innerHTML =
          '<div class="panel"><div class="panel-hdr">REVENUE MANAGEMENT</div>' +
          '<div class="panel-body" id="panel-revenue-management-body" style="padding:0;">Loading&hellip;</div></div>';
      } else if (slug === 'compliance') {
        panel.innerHTML =
          '<div class="panel"><div class="panel-hdr">COMPLIANCE</div>' +
          '<div class="panel-body" id="panel-compliance-body" style="padding:0;">Loading&hellip;</div></div>';
      } else {
        panel.innerHTML =
          '<div class="panel"><div class="panel-hdr">' + mod.textContent.toUpperCase() +
          '</div><div class="panel-body" style="padding:24px;color:var(--muted);">' +
          'This module isn\'t built yet — check back soon.</div></div>';
      }
      main.appendChild(panel);
    });

    modules.forEach(function (mod) {
      mod.addEventListener('click', function () {
        modules.forEach(function (m) { m.classList.remove('active'); });
        mod.classList.add('active');
        document.querySelectorAll('#main .tabpanel').forEach(function (p) { p.style.display = 'none'; });
        var slug = mod.getAttribute('data-tab');
        // Document Intake has no panel of its own — its content lives in
        // the Guest Intelligence tab (see comment above). Show that panel
        // instead, while still marking Document Intake as the active nav
        // item so the sidebar reflects what the user clicked.
        var targetSlug = slug === 'document-intake' ? firstSlug : slug;
        var target = document.getElementById('tabpanel-' + targetSlug);
        if (target) target.style.display = '';
        if (slug === 'maintenance' && typeof renderMaintenanceTab === 'function') {
          renderMaintenanceTab();
        }
        if (slug === 'reservations' && typeof renderReservationsTab === 'function') {
          renderReservationsTab();
        }
        if (slug === 'front-desk' && typeof renderFrontDeskTab === 'function') {
          renderFrontDeskTab();
        }
        if (slug === 'vip-arrivals' && typeof renderVipTab === 'function') {
          renderVipTab();
        }
        if (slug === 'indacrib' && typeof renderIndaCribTab === 'function') {
          renderIndaCribTab();
        }
        if (slug === 'concierge-transport' && typeof renderConciergeTransportTab === 'function') {
          renderConciergeTransportTab();
        }
        if (slug === 'housekeeping' && typeof renderHousekeepingTab === 'function') {
          renderHousekeepingTab();
        }
        if (slug === 'staff-operations' && typeof renderStaffOpsTab === 'function') {
          renderStaffOpsTab();
        }
        if (slug === 'incident-center' && typeof renderIncidentsTab === 'function') {
          renderIncidentsTab();
        }
        if (typeof renderIotTab === 'function' && document.getElementById('panel-iot-body') && target && target.querySelector('#panel-iot-body')) {
          renderIotTab();
        }
        if (slug === 'airbnb-str-operations' && typeof renderAirbnbTab === 'function') {
          renderAirbnbTab();
        }
        if (slug === 'ota-intelligence' && typeof renderOtaTab === 'function') {
          renderOtaTab();
        }
        if (slug === 'revenue-management' && typeof renderRevenueTab === 'function') {
          renderRevenueTab();
        }
        if (slug === 'compliance' && typeof renderComplianceTab === 'function') {
          renderComplianceTab();
        }
      });
    });
  });
})();
