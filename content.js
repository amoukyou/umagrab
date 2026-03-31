// UMAGrab - Polymarket UMA Oracle Status
// Uses Gamma API + tero.market UMA API
(function () {
  'use strict';

  const GAMMA_API = 'https://gamma-api.polymarket.com';
  const UMA_API = 'https://www.tero.market/uma/api';
  const UMA_SITE = 'https://www.tero.market/uma';

  let panel = null;
  let currentSlug = null;
  let dragState = null;

  // ── Logging ──

  const LOG_KEY = 'umagrab_logs';
  const LOG_MAX = 500;

  function log(level, event, data) {
    const entry = {
      ts: new Date().toISOString(),
      level,  // info, warn, error
      event,  // e.g. 'gamma_fetch', 'uma_query', 'not_found'
      slug: currentSlug,
      url: location.href,
      ...data
    };

    // Console
    const tag = `[UMAGrab:${level}]`;
    if (level === 'error') console.error(tag, event, data);
    else if (level === 'warn') console.warn(tag, event, data);
    else console.log(tag, event, data);

    // Persist to localStorage
    try {
      const logs = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
      logs.push(entry);
      // Keep last N entries
      if (logs.length > LOG_MAX) logs.splice(0, logs.length - LOG_MAX);
      localStorage.setItem(LOG_KEY, JSON.stringify(logs));
    } catch (e) { /* storage full or unavailable */ }
  }

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

  // ── Step 1: Gamma API ──

  async function fetchWithRetry(url, retries = 2, delay = 1000) {
    for (let i = 0; i <= retries; i++) {
      try {
        const resp = await fetch(url);
        return resp;
      } catch (e) {
        if (i === retries) throw e;
        log('warn', 'fetch_retry', { url, attempt: i + 1, error: e.message });
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  async function fetchGammaMarkets(eventSlug) {
    const url = `${GAMMA_API}/events?slug=${encodeURIComponent(eventSlug)}`;
    log('info', 'gamma_fetch', { url });

    const resp = await fetchWithRetry(url);
    if (!resp.ok) {
      log('error', 'gamma_fetch_fail', { status: resp.status });
      throw new Error(`Gamma API: ${resp.status}`);
    }
    const data = await resp.json();
    const ev = Array.isArray(data) ? data[0] : data;
    if (!ev) {
      log('error', 'gamma_event_not_found', { eventSlug });
      throw new Error('Event not found');
    }

    const markets = ev.markets || [];
    log('info', 'gamma_ok', {
      marketCount: markets.length,
      marketIds: markets.map(m => m.id)
    });
    return markets;
  }

  // ── Step 2: tero.market UMA API ──

  async function fetchUMAStatus(gammaMarkets, eventSlug) {
    const marketIds = gammaMarkets.map(m => String(m.id));
    const umaMap = new Map();
    const strategyLog = { a_event_slug: null, b_siblings: null, c_individual: null };

    // Strategy A: event_slug query
    try {
      const url = `${UMA_API}/questions?event_slug=${encodeURIComponent(eventSlug)}&per_page=200`;
      const resp = await fetch(url);
      if (resp.ok) {
        const data = await resp.json();
        const total = data.total || 0;
        for (const q of (data.questions || [])) {
          if (q.market_id && q.is_latest !== 0) {
            umaMap.set(String(q.market_id), q);
          }
        }
        strategyLog.a_event_slug = { apiTotal: total, matched: umaMap.size };
        log('info', 'strategy_a', { total, matched: umaMap.size });
      } else {
        strategyLog.a_event_slug = { error: resp.status };
        log('warn', 'strategy_a_fail', { status: resp.status });
      }
    } catch (e) {
      strategyLog.a_event_slug = { error: e.message };
      log('warn', 'strategy_a_error', { error: e.message });
    }

    if (umaMap.size >= marketIds.length * 0.5) {
      logFinalResult(marketIds, umaMap, strategyLog);
      return umaMap;
    }

    // Strategy B: siblings API
    if (umaMap.size === 0) {
      let tried = 0;
      for (const mid of marketIds.slice(0, 3)) {
        tried++;
        try {
          const resp = await fetch(`${UMA_API}/pm/siblings/${mid}`);
          if (resp.ok) {
            const data = await resp.json();
            const sibs = data.siblings || [];
            for (const s of sibs) {
              umaMap.set(String(s.market_id), {
                state: s.uma_state,
                proposed_price: s.uma_proposed,
                pm_question: s.question,
                title_zh: s.title_zh,
                market_id: s.market_id
              });
            }
            strategyLog.b_siblings = { triedMid: mid, siblingsReturned: sibs.length, matched: umaMap.size };
            log('info', 'strategy_b', { mid, siblings: sibs.length, matched: umaMap.size });
            if (umaMap.size > 0) break;
          }
        } catch (e) { /* try next */ }
      }
      if (umaMap.size === 0) {
        strategyLog.b_siblings = { tried, matched: 0 };
        log('warn', 'strategy_b_none', { tried });
      }
    }

    // Strategy C: individual search
    const missing = marketIds.filter(mid => !umaMap.has(mid));
    if (missing.length > 0 && missing.length <= 20) {
      let found = 0;
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
                  found++;
                }
              }
            })
            .catch(() => {})
        );
        await Promise.all(promises);
      }
      strategyLog.c_individual = { searched: missing.length, found };
      log('info', 'strategy_c', { searched: missing.length, found });
    }

    logFinalResult(marketIds, umaMap, strategyLog);
    return umaMap;
  }

  function logFinalResult(marketIds, umaMap, strategyLog) {
    const found = marketIds.filter(mid => umaMap.has(mid));
    const notFound = marketIds.filter(mid => !umaMap.has(mid));

    log(notFound.length > 0 ? 'warn' : 'info', 'lookup_result', {
      total: marketIds.length,
      found: found.length,
      notFound: notFound.length,
      notFoundIds: notFound,
      strategies: strategyLog
    });

    // Log each missing market individually for easy debugging
    for (const mid of notFound) {
      log('warn', 'market_not_found', {
        market_id: mid,
        strategies: strategyLog
      });
    }
  }

  // ── Panel ──

  function createPanel() {
    const el = document.createElement('div');
    el.id = 'uma-oracle-panel';
    el.innerHTML = `
      <div class="uma-header">
        <div class="uma-header-left">
          <h3>UMAGrab</h3>
          <span class="uma-slug"></span>
        </div>
        <div class="uma-header-actions">
          <button class="uma-log-btn" title="Show logs">log</button>
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
    el.querySelector('.uma-log-btn').addEventListener('click', showLogViewer);

    return el;
  }

  // ── Log viewer ──

  function showLogViewer() {
    // Toggle: if already showing, remove it
    const existing = document.getElementById('uma-log-viewer');
    if (existing) { existing.remove(); return; }

    const logs = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    const viewer = document.createElement('div');
    viewer.id = 'uma-log-viewer';

    // Filter to recent & relevant logs
    const recent = logs.slice(-100);
    const warns = recent.filter(l => l.level === 'warn' || l.level === 'error');

    let html = `
      <div class="uma-log-header">
        <span>Logs (${recent.length} recent, ${warns.length} warnings)</span>
        <span>
          <button class="uma-log-copy">Copy All</button>
          <button class="uma-log-clear">Clear</button>
          <button class="uma-log-close">&times;</button>
        </span>
      </div>
      <div class="uma-log-body">
    `;

    // Show most recent first
    for (const entry of [...recent].reverse()) {
      const levelClass = entry.level === 'error' ? 'log-error' : entry.level === 'warn' ? 'log-warn' : 'log-info';
      const time = entry.ts ? entry.ts.substring(11, 19) : '??';
      const { ts, level, event, slug, url, ...rest } = entry;
      const detail = Object.keys(rest).length > 0 ? JSON.stringify(rest) : '';
      html += `<div class="uma-log-entry ${levelClass}">
        <span class="log-time">${time}</span>
        <span class="log-level">${level}</span>
        <span class="log-event">${escapeHtml(event)}</span>
        <span class="log-slug">${escapeHtml(slug || '')}</span>
        ${detail ? `<div class="log-detail">${escapeHtml(detail)}</div>` : ''}
      </div>`;
    }

    html += '</div>';
    viewer.innerHTML = html;
    document.body.appendChild(viewer);

    // Bind buttons (no inline onclick — CSP blocks it in extensions)
    viewer.querySelector('.uma-log-copy').addEventListener('click', function () {
      navigator.clipboard.writeText(localStorage.getItem(LOG_KEY) || '[]');
      this.textContent = 'Copied!';
    });
    viewer.querySelector('.uma-log-clear').addEventListener('click', () => {
      localStorage.removeItem(LOG_KEY);
      viewer.remove();
    });
    viewer.querySelector('.uma-log-close').addEventListener('click', () => {
      viewer.remove();
    });
  }

  // ── Render ──

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

    // Keep Gamma API order (same as PM page) — do NOT re-sort

    for (const item of items) {
      const uma = item.uma;
      const title = (uma && (uma.title_zh || uma.pm_question)) || item.gamma.question || `Market ${item.mid}`;
      const stateClass = item.state.replace(/\s/g, '');
      let metaHtml = '';

      if (uma && uma.state) {
        const proposed = formatProposed(uma.proposed_price);
        const proposedSpan = proposed ? `<span class="uma-proposed-price">&rarr; ${escapeHtml(proposed)}</span>` : '';

        const teroLink = `${UMA_SITE}/?search=${item.mid}`;
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
    bindPageHoverLinks(gammaMarkets);
  }

  // ── Hover-link ──

  const PAGE_CARD_SELECTOR = 'div[data-orientation="vertical"].group.cursor-pointer';

  let hoverCleanups = [];
  let marketLinks = [];
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

      const pageCards = Array.from(document.querySelectorAll(PAGE_CARD_SELECTOR))
        .filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 200 && rect.height > 30;
        });

      // Extract visible text from each page card for smart matching
      const cardTexts = pageCards.map(el => {
        const titleEl = el.querySelector('p.font-semibold');
        return (titleEl ? titleEl.textContent : el.textContent).trim().toLowerCase();
      });

      // Always use text matching (page may hide/reorder markets vs Gamma API order)
      {
        const usedGammaIdx = new Set();
        for (let ci = 0; ci < pageCards.length; ci++) {
          const cardText = cardTexts[ci];
          let bestIdx = -1;
          let bestScore = 0;

          for (let gi = 0; gi < gammaMarkets.length; gi++) {
            if (usedGammaIdx.has(gi)) continue;
            const question = (gammaMarkets[gi].question || '').toLowerCase();
            // Score: count matching words (include short words like numbers)
            const words = cardText.split(/\s+/).filter(w => w.length >= 2);
            let score = 0;
            for (const w of words) {
              if (question.includes(w)) score++;
            }
            // Bonus if card text is a direct substring of question
            if (question.includes(cardText)) {
              score += 10;
            }
            if (score > bestScore) {
              bestScore = score;
              bestIdx = gi;
            }
          }

          if (bestIdx >= 0 && bestScore > 0) {
            usedGammaIdx.add(bestIdx);
            const mid = String(gammaMarkets[bestIdx].id);
            const panelItem = panel?.querySelector(`.uma-market[data-mid="${mid}"]`);
            if (panelItem) {
              marketLinks.push({ mid, pageEl: pageCards[ci], panelItem });
            }
          }
        }
      }

      log('info', 'hover_link', {
        pageCards: pageCards.length,
        gammaMarkets: gammaMarkets.length,
        linked: marketLinks.length,
        method: 'text_match'
      });

      const slugEl = panel?.querySelector('.uma-slug');
      if (slugEl) slugEl.textContent = `${marketLinks.length}/${gammaMarkets.length} linked`;
    }

    let lastMoveTime = 0;
    function onMouseMove(e) {
      if (!marketLinks.length) return; // Not ready yet
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

    setTimeout(scanAndBuild, 2000);
    let rescanTimer = null;
    const domObserver = new MutationObserver(() => {
      clearTimeout(rescanTimer);
      rescanTimer = setTimeout(scanAndBuild, 3000);
    });
    domObserver.observe(document.body, { childList: true, subtree: true });
    hoverCleanups.push(() => domObserver.disconnect());
  }

  // ── Main ──

  async function loadData(eventSlug) {
    const body = panel.querySelector('.uma-body');
    panel.querySelector('.uma-slug').textContent = eventSlug;
    body.innerHTML = '<div class="uma-loading">Fetching markets...</div>';

    log('info', 'load_start', { eventSlug });

    try {
      const gammaMarkets = await fetchGammaMarkets(eventSlug);
      if (!gammaMarkets.length) {
        log('warn', 'no_gamma_markets', { eventSlug });
        body.innerHTML = '<div class="uma-empty">No markets found for this event</div>';
        return;
      }

      body.innerHTML = `<div class="uma-loading">Found ${gammaMarkets.length} markets, checking UMA...</div>`;
      const umaMap = await fetchUMAStatus(gammaMarkets, eventSlug);
      renderResults(gammaMarkets, umaMap);

      log('info', 'load_complete', {
        eventSlug,
        gammaCount: gammaMarkets.length,
        umaFound: umaMap.size,
        umaMissing: gammaMarkets.length - umaMap.size
      });

    } catch (err) {
      log('error', 'load_error', { eventSlug, error: err.message });
      body.innerHTML = `<div class="uma-error">Error: ${escapeHtml(err.message)}</div>`;
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

  log('info', 'extension_loaded', { url: location.href });
  checkAndShow();
})();
