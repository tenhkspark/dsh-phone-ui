/* DSH phone skin JS — active only below the narrow-screen breakpoint.
 *
 * The file is injected on every page load, but it does nothing on a wide window:
 * above MAX_W it neither adds html.dshm nor builds the floating controls.
 *
 * 1) adds html.dshm (the gate the stylesheet reads)
 * 2) builds a floating hamburger + scrim and drives DSH's own sidebar toggle,
 *    so no app state is reimplemented here
 * 3) mirrors visualViewport height into --dshm-vh, which keeps the composer
 *    above the on-screen keyboard
 *
 * Nothing is written to the DSH install; removing the script restores the stock UI.
 */
(() => {
  'use strict';
  const MAX_W = 520; // keep in sync with the media query in mobile.css
  if (window.__dshmInit) return;
  window.__dshmInit = true;

  const html = document.documentElement;
  const frame = () => document.querySelector('[data-slot="root"] > div[data-sidebar-collapsed]');

  const isMobile = () => window.innerWidth <= MAX_W;
  const appToggle = (open) => {
    const label = open ? 'Open sidebar' : 'Collapse sidebar';
    const btn = document.querySelector(`button[aria-label="${label}"]`);
    if (btn) btn.click();
  };

  function buildUi() {
    if (!document.getElementById('dshm-scrim')) {
      const scrim = document.createElement('div');
      scrim.id = 'dshm-scrim';
      scrim.addEventListener('click', () => {
        html.classList.remove('dshm-sb-open');
        appToggle(false);
      });
      document.body.appendChild(scrim);
    }
    if (!document.getElementById('dshm-burger')) {
      const b = document.createElement('button');
      b.id = 'dshm-burger';
      b.type = 'button';
      b.setAttribute('aria-label', 'Menu');
      b.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
      b.addEventListener('click', () => {
        const f = frame();
        const open = f && f.dataset.sidebarCollapsed === 'false';
        if (open) {
          html.classList.remove('dshm-sb-open');
          appToggle(false);
        } else {
          appToggle(true);
          html.classList.add('dshm-sb-open');
        }
      });
      document.body.appendChild(b);
    }
  }

  /* follow the app's own sidebar state */
  function syncSidebar() {
    const f = frame();
    if (!f) return;
    const open = f.dataset.sidebarCollapsed === 'false';
    html.classList.toggle('dshm-sb-open', open && isMobile());
  }

  /* keyboard: write the visible viewport height so CSS can size the app to it */
  function syncViewport() {
    const vv = window.visualViewport;
    const h = vv ? Math.round(vv.height) : window.innerHeight;
    if (!isMobile()) {
      html.style.removeProperty('--dshm-vh');
      return;
    }
    html.style.setProperty('--dshm-vh', h + 'px');
  }

  function apply() {
    const m = isMobile();
    if (m) buildUi();
    html.classList.toggle('dshm', m);
    if (!m) html.classList.remove('dshm-sb-open');
    syncViewport();
    syncSidebar();
  }

  function boot() {
    if (isMobile()) buildUi();
    apply();
    const obs = new MutationObserver(() => syncSidebar());
    const attach = () => {
      const f = frame();
      if (f) {
        obs.observe(f, { attributes: true, attributeFilter: ['data-sidebar-collapsed'] });
        syncSidebar();
        return true;
      }
      return false;
    };
    if (!attach()) {
      const t = setInterval(() => {
        if (attach()) clearInterval(t);
      }, 300);
    }
    window.addEventListener('resize', apply, { passive: true });
    window.addEventListener('orientationchange', () => setTimeout(apply, 200));
    try {
      window.matchMedia(`(max-width: ${MAX_W}px)`).addEventListener('change', apply);
    } catch (_) {}
    /* the first paint can happen before the width is final: re-check once more */
    setTimeout(apply, 300);
    setTimeout(apply, 1200);
    if (window.visualViewport) {
      visualViewport.addEventListener('resize', syncViewport);
      visualViewport.addEventListener('scroll', syncViewport);
    }
    /* keep the focused field above the keyboard */
    document.addEventListener(
      'focusin',
      (e) => {
        const t = e.target;
        if (!isMobile() || !t || !t.closest) return;
        if (!t.closest('[contenteditable="true"], input, textarea')) return;
        setTimeout(() => {
          try {
            t.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          } catch (_) {}
        }, 320);
      },
      true,
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
