/**Single post view — TOC scroll tracking and reading progress.*/

export function init() {
  const tocData = document.getElementById('toc-data');
  if (!tocData) return;

  const entries = JSON.parse(tocData.textContent);
  if (!entries.length) return;

  const nav = _buildTocNav(entries);
  const main = document.getElementById('main');
  if (main) main.insertAdjacentElement('afterend', nav);

  _trackScroll(entries);
  _readingProgress();
}

function _buildTocNav(entries) {
  const nav = document.createElement('nav');
  nav.className = 'toc-sidebar';
  nav.setAttribute('aria-label', 'Table of contents');
  const ol = document.createElement('ol');
  entries.forEach(entry => {
    const li = document.createElement('li');
    li.dataset.level = entry.level;
    const a = document.createElement('a');
    a.href = '#' + entry.id;
    a.textContent = entry.text;
    li.appendChild(a);
    ol.appendChild(li);
  });
  nav.appendChild(ol);
  return nav;
}

function _trackScroll(entries) {
  const ids = entries.map(e => e.id);
  const observer = new IntersectionObserver(observed => {
    for (const entry of observed) {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        document.querySelectorAll('.toc-sidebar a').forEach(a => {
          a.classList.toggle('active', a.getAttribute('href') === '#' + id);
        });
        break;
      }
    }
  }, { rootMargin: '-20% 0px -80% 0px' });

  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
  });
}

function _readingProgress() {
  const bar = document.createElement('div');
  bar.className = 'reading-progress';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', 'Reading progress');
  document.body.prepend(bar);

  window.addEventListener('scroll', () => {
    const h = document.documentElement.scrollHeight - window.innerHeight;
    const pct = h > 0 ? (window.scrollY / h) * 100 : 0;
    bar.style.width = pct + '%';
  }, { passive: true });
}
