/**Banner element — dismissible notification strip.*/

export function createBanner({ message, type = 'info', dismissible = true, urgent = false } = {}) {
  if (!message) throw new Error('Banner requires a message');

  const banner = document.createElement('div');
  banner.className = `el-banner el-banner--${type}`;
  banner.setAttribute('role', urgent ? 'alert' : 'status');

  const text = document.createElement('span');
  text.textContent = message;
  banner.appendChild(text);

  if (dismissible) {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'el-banner-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '\u00d7';
    close.addEventListener('click', () => banner.remove());
    banner.appendChild(close);
  }

  return banner;
}
