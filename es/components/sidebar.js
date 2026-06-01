/**Sidebar component — TOC for single views, filters for index views.*/

export function init() {
  const layout = document.body.getAttribute('data-layout');
  if (!layout) return;

  if (layout === 'article') {
    _initTocSidebar();
  } else if (layout === 'index' || layout === 'archive') {
    _initFilterSidebar();
  }
}

function _initTocSidebar() {
  const tocData = document.getElementById('toc-data');
  if (!tocData) return;

  // TOC sidebar is built by single.js view module.
  // This component handles responsive behavior.
  const sidebar = document.querySelector('.toc-sidebar');
  if (!sidebar) return;

  // On narrow screens, convert to collapsible
  if (window.innerWidth <= 640) {
    sidebar.hidden = true;
    const toggle = document.createElement('button');
    toggle.className = 'toc-toggle';
    toggle.textContent = 'Table of Contents';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.type = 'button';
    toggle.addEventListener('click', () => {
      const expanded = sidebar.hidden;
      sidebar.hidden = !expanded;
      toggle.setAttribute('aria-expanded', String(expanded));
    });
    sidebar.insertAdjacentElement('beforebegin', toggle);
  }
}

function _initFilterSidebar() {
  // Future: render tag cloud / section list as sidebar
  // For now, filtering is handled by archive.js via URL params
}
