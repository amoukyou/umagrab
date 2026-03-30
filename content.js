// Polymarket UMA Oracle Status - Content Script
// Uses Gamma API + tero.market UMA API
(function () {
  'use strict';

  const GAMMA_API = 'https://gamma-api.polymarket.com';
  const UMA_API = 'https://www.tero.market/uma/api';
  const UMA_SITE = 'https://www.tero.market/uma';

  let panel = null;
  let currentSlug = null;
  let dragState = null;

  function getEventSlug() {
    const m = location.pathname.match(/^\/event\/([^/?#]+)/);
    return m ? m[1] : null;
  }

  function formatProposed(price) {
    if (!price) return '';
    if (price === '1000000000000000000') return 'p1 (Yes)';
    if (price === '0') return 'p2 (No)';
    if (price === '500000000000000000') return 'p3 (Unknown)';
    return price;
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // Step 1: Get all markets for event from Gamma API
  async function fetchGammaMarkets(eventSlug) {
    const resp = await fetch(`${GAMMA_API}/events?slug=${encodeURIComponent(eventSlug)}`);
    if (!resp.ok) throw new Error(`Gamma API: ${resp.status}`);
    const data = await resp.json();
    const ev = Array.isArray(data) ? data[0] : data;
    if (!ev) throw new Error('Event not found');
    return ev.markets || [];
  }

  // Step 2: Query tero.market for UMA status
  // Strategy: try siblings API first (fast, one call), then fallback to event_slug, then individual search
  async function fetchUMAStatus(gammaMarkets, eventSlug) {
    const marketIds = gammaMarkets.map(m => String(m.id));
    const umaMap = new Map(); // market_id -> {state, proposed, question, title_zh}

    // Strategy A: Try event_slug query (works if enrich has run)
    try {
      const resp = await fetch(`${UMA_API}/questions?event_slug=${encodeURIComponent(eventSlug)}&per_page=200`);
      if (resp.ok) {
        const data = await resp.json();
        for (const q of (data.questions || [])) {
          if (q.market_id && q.is_latest !== 0) {
            umaMap.set(String(q.market_id), q);
          }
        }
      }
    } catch (e) { console.log('[UMA] event_slug query failed:', e); }

    // If we found enough, return
    if (umaMap.size >= marketIds.length * 0.5) return umaMap;

    // Strategy B: Try siblings API with first market_id
    if (umaMap.size === 0) {
      for (const mid of marketIds) {
        try {
          const resp = await fetch(`${UMA_API}/pm/siblings/${mid}`);
          if (resp.ok) {
            const data = await resp.json();
            for (const s of (data.siblings || [])) {
              umaMap.set(String(s.market_id), {
                state: s.uma_state,
                proposed_price: s.uma_proposed,
                pm_question: s.question,
                title_zh: s.title_zh,
                market_id: s.market_id
              });
            }
            if (umaMap.size > 0) break;
          }
        } catch (e) { /* try next */ }
      }
    }

    // Strategy C: Individual search for missing market_ids
    const missing = marketIds.filter(mid => !umaMap.has(mid));
    if (missing.length > 0 && missing.length <= 20) {
      const batchSize = 5;
      for (let i = 0; i < missing.length; i += batchSize) {
        const batch = missing.slice(i, i + batchSize);
        const promises = batch.map(mid =>
          fetch(`${UMA_API}/questions?search=${mid}&per_page=5`)
            .then(r => r.ok ? r.json() : { questions: [] })
            .then(data => {
              for (const q of (data.questions || [])) {
                if (String(q.market_id) === mid && q.is_latest !== 0) {
                  umaMap.set(mid, q);
                }
              }
            })
            .catch(() => {})
        );
        await Promise.all(promises);
      }
    }

    return umaMap;
  }

  function createPanel() {
    const el = document.createElement('div');
    el.id = 'uma-oracle-panel';
    el.innerHTML = `
      <div class="uma-header">
        <div class="uma-header-left">
          <h3>UMA Oracle</h3>
          <span class="uma-slug"></span>
        </div>
        <div class="uma-header-actions">
          <button class="uma-refresh-btn" title="Refresh">&#x21bb;</button>
          <button class="uma-collapse-btn" title="Collapse">&#x2212;</button>
          <button class="uma-close-btn" title="Close">&#x2715;</button>
        </div>
      </div>
      <div class="uma-body">
        <div class="uma-loading">Loading...</div>
      </div>
    `;
    document.body.appendChild(el);

    // Drag
    const header = el.querySelector('.uma-header');
    header.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      dragState = { startX: e.clientX, startY: e.clientY, origLeft: el.offsetLeft, origTop: el.offsetTop };
      el.style.right = 'auto';
      el.style.left = el.offsetLeft + 'px';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragState) return;
      el.style.left = (dragState.origLeft + e.clientX - dragState.startX) + 'px';
      el.style.top = (dragState.origTop + e.clientY - dragState.startY) + 'px';
    });
    document.addEventListener('mouseup', () => { dragState = null; });

    el.querySelector('.uma-close-btn').addEventListener('click', () => { el.remove(); panel = null; });
    el.querySelector('.uma-collapse-btn').addEventListener('click', () => {
      el.classList.toggle('collapsed');
      el.querySelector('.uma-collapse-btn').innerHTML = el.classList.contains('collapsed') ? '&#x002B;' : '&#x2212;';
    });
    el.querySelector('.uma-refresh-btn').addEventListener('click', () => { if (currentSlug) loadData(currentSlug); });

    return el;
  }

  function renderResults(gammaMarkets, umaMap) {
    const body = panel.querySelector('.uma-body');

    const states = {};
    const items = gammaMarkets.map(gm => {
      const mid = String(gm.id);
      const uma = umaMap.get(mid);
      const state = uma ? (uma.state || 'Unknown') : 'Not in UMA';
      states[state] = (states[state] || 0) + 1;
      return { gamma: gm, uma, state, mid };
    });

    const stateColors = {
      Requested: '#fef3e2', Proposed: '#e8f4fd', Disputed: '#fde8e8',
      Settled: '#e8f8ef', 'Not in UMA': '#f5f5f5', Unknown: '#f5f5f5'
    };

    let html = '<div class="uma-summary">';
    for (const [s, c] of Object.entries(states)) {
      if (c > 0) html += `<span class="uma-summary-item" style="background:${stateColors[s] || '#f0f0f0'}">${s}: ${c}</span>`;
    }
    html += `<span class="uma-summary-item" style="background:#f0f0f0">Total: ${items.length}</span>`;
    html += '</div>';

    const order = { Disputed: 0, Proposed: 1, Requested: 2, Settled: 3, 'Not in UMA': 4, Unknown: 5 };
    items.sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9));

    for (const item of items) {
      const uma = item.uma;
      const title = (uma && (uma.title_zh || uma.pm_question)) || item.gamma.question || `Market ${item.mid}`;
      const stateClass = item.state.replace(/\s/g, '');
      let metaHtml = '';

      if (uma && uma.state) {
        const proposed = formatProposed(uma.proposed_price);
        const proposedSpan = proposed ? `<span class="uma-proposed-price">&rarr; ${escapeHtml(proposed)}</span>` : '';

        // tero link: search by market_id to expand that question
        const teroLink = `${UMA_SITE}/?search=${item.mid}`;

        // uma link: prefer transactionHash, fallback to search by market_id
        const txHash = uma.settlement_hash || uma.dispute_hash || uma.proposal_hash || uma.request_hash;
        const umaOracleLink = txHash
          ? `https://oracle.uma.xyz/?transactionHash=${txHash}&chainId=137`
          : `https://oracle.uma.xyz/?search=${item.mid}&chainId=137`;

        metaHtml = `
          <span class="uma-state ${uma.state}">${uma.state}</span>
          ${proposedSpan}
          <span class="uma-links">
            <a class="uma-link" href="${teroLink}" target="_blank">tero</a>
            <a class="uma-link" href="${umaOracleLink}" target="_blank">uma</a>
          </span>
        `;
      } else {
        metaHtml = '<span class="uma-state NotFound">Not in UMA</span>';
      }

      html += `
        <div class="uma-market state-${stateClass}" data-mid="${item.mid}" data-question="${escapeHtml(item.gamma.question || '')}">
          <div class="uma-market-title"><span class="uma-market-id">#${item.mid}</span> ${escapeHtml(title)}</div>
          <div class="uma-market-meta">${metaHtml}</div>
        </div>
      `;
    }

    body.innerHTML = html;

    // After render, bind hover-linking between page markets and panel items
    bindPageHoverLinks(gammaMarkets);
  }

  // ── Hover-link: PM page ↔ panel (bidirectional) ──
  // PM cards use abbreviated text (e.g. "↑ $150") not the full question,
  // and an absolute overlay intercepts mouse events.
  // Solution: match by ORDER (Gamma API order = page card order),
  // use mousemove + bounding rect hit-testing.

  const PAGE_CARD_SELECTOR = 'div[data-orientation="vertical"].group.cursor-pointer';

  let hoverCleanups = [];
  let marketLinks = []; // [{mid, pageEl, panelItem}]
  let currentHoverMid = null;

  function bindPageHoverLinks(gammaMarkets) {
    hoverCleanups.forEach(fn => fn());
    hoverCleanups = [];
    marketLinks = [];

    function clearAllHighlights() {
      panel?.querySelectorAll('.uma-highlight').forEach(el => el.classList.remove('uma-highlight'));
      document.querySelectorAll('.uma-page-highlight').forEach(el => el.classList.remove('uma-page-highlight'));
      currentHoverMid = null;
    }

    function scanAndBuild() {
      clearAllHighlights();
      marketLinks = [];

      // Get page cards by selector, in DOM order (= display order)
      const pageCards = Array.from(document.querySelectorAll(PAGE_CARD_SELECTOR))
        .filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 200 && rect.height > 30; // skip non-market "group" elements
        });

      // Match by index: Gamma markets[i] ↔ pageCards[i]
      const count = Math.min(gammaMarkets.length, pageCards.length);
      for (let i = 0; i < count; i++) {
        const mid = String(gammaMarkets[i].id);
        const panelItem = panel?.querySelector(`.uma-market[data-mid="${mid}"]`);
        if (!panelItem) continue;
        marketLinks.push({ mid, pageEl: pageCards[i], panelItem });
      }

      console.log(`[UMA Extension] Linked ${marketLinks.length}/${gammaMarkets.length} markets (${pageCards.length} page cards found)`);
      const slugEl = panel?.querySelector('.uma-slug');
      if (slugEl) slugEl.textContent = `${marketLinks.length}/${gammaMarkets.length} linked`;
    }

    // Throttled mousemove: check cursor position against page card bounding rects
    let lastMoveTime = 0;
    function onMouseMove(e) {
      const now = Date.now();
      if (now - lastMoveTime < 60) return;
      lastMoveTime = now;

      if (e.target.closest?.('#uma-oracle-panel')) return;

      const x = e.clientX, y = e.clientY;
      let hitMid = null;

      for (const link of marketLinks) {
        const rect = link.pageEl.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          hitMid = link.mid;
          break;
        }
      }

      if (hitMid === currentHoverMid) return;
      clearAllHighlights();

      if (hitMid) {
        currentHoverMid = hitMid;
        const link = marketLinks.find(m => m.mid === hitMid);
        if (link) {
          link.panelItem.classList.add('uma-highlight');
          link.pageEl.classList.add('uma-page-highlight');
          link.panelItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    }

    // Panel hover → page highlight
    function onPanelOver(e) {
      const marketEl = e.target.closest('.uma-market');
      if (!marketEl) return;
      const mid = marketEl.dataset.mid;
      if (mid === currentHoverMid) return;

      clearAllHighlights();
      currentHoverMid = mid;
      marketEl.classList.add('uma-highlight');

      const link = marketLinks.find(m => m.mid === mid);
      if (link) {
        link.pageEl.classList.add('uma-page-highlight');
        link.pageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    function onPanelOut(e) {
      if (e.relatedTarget?.closest?.('.uma-market')) return;
      clearAllHighlights();
    }

    // Bind events
    document.addEventListener('mousemove', onMouseMove, true);
    const panelBody = panel?.querySelector('.uma-body');
    if (panelBody) {
      panelBody.addEventListener('mouseover', onPanelOver);
      panelBody.addEventListener('mouseleave', onPanelOut);
    }

    hoverCleanups.push(() => {
      document.removeEventListener('mousemove', onMouseMove, true);
      if (panelBody) {
        panelBody.removeEventListener('mouseover', onPanelOver);
        panelBody.removeEventListener('mouseleave', onPanelOut);
      }
      clearAllHighlights();
    });

    // Scan after PM renders, re-scan on DOM changes
    setTimeout(scanAndBuild, 2000);
    let rescanTimer = null;
    const domObserver = new MutationObserver(() => {
      clearTimeout(rescanTimer);
      rescanTimer = setTimeout(scanAndBuild, 3000);
    });
    domObserver.observe(document.body, { childList: true, subtree: true });
    hoverCleanups.push(() => domObserver.disconnect());
  }

  async function loadData(eventSlug) {
    const body = panel.querySelector('.uma-body');
    panel.querySelector('.uma-slug').textContent = eventSlug;
    body.innerHTML = '<div class="uma-loading">Fetching markets...</div>';

    try {
      const gammaMarkets = await fetchGammaMarkets(eventSlug);
      if (!gammaMarkets.length) {
        body.innerHTML = '<div class="uma-empty">No markets found for this event</div>';
        return;
      }

      body.innerHTML = `<div class="uma-loading">Found ${gammaMarkets.length} markets, checking UMA...</div>`;
      const umaMap = await fetchUMAStatus(gammaMarkets, eventSlug);
      renderResults(gammaMarkets, umaMap);

    } catch (err) {
      body.innerHTML = `<div class="uma-error">Error: ${escapeHtml(err.message)}</div>`;
      console.error('[UMA Extension]', err);
    }
  }

  function checkAndShow() {
    const slug = getEventSlug();
    if (!slug) {
      if (panel) { panel.remove(); panel = null; currentSlug = null; }
      return;
    }
    if (slug === currentSlug && panel) return;
    currentSlug = slug;
    if (!panel) panel = createPanel();
    loadData(slug);
  }

  // SPA navigation watcher
  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(checkAndShow, 500);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('popstate', () => setTimeout(checkAndShow, 500));

  console.log('[UMA Extension] Loaded on:', location.href);
  checkAndShow();
})();
