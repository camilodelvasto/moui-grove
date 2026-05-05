/**Archive view — client-side tag and section filtering.*/

export function init() {
  const params = new URLSearchParams(window.location.search);
  const tag = params.get('tag');
  const section = params.get('section');

  if (!tag && !section) return;

  const items = document.querySelectorAll('[data-layout="archive"] li');
  items.forEach(li => {
    const links = li.querySelectorAll('a');
    const text = Array.from(links).map(a => a.textContent).join(' ').toLowerCase();
    const href = Array.from(links).map(a => a.getAttribute('href')).join(' ');

    let show = true;
    if (tag) {
      show = show && text.includes(tag.toLowerCase());
    }
    if (section) {
      show = show && href.includes('/' + section + '/');
    }
    li.style.display = show ? '' : 'none';
  });

  _showActiveFilter(tag, section);
}

function _showActiveFilter(tag, section) {
  const main = document.getElementById('main');
  if (!main) return;

  const h1 = main.querySelector('h1');
  if (!h1) return;

  const parts = [];
  if (tag) parts.push('tag: ' + tag);
  if (section) parts.push('section: ' + section);

  const badge = document.createElement('span');
  badge.className = 'filter-badge';
  badge.textContent = parts.join(', ');
  h1.insertAdjacentElement('afterend', badge);
}
