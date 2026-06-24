/**Drawer element — slide-in panel with focus trap.*/
import { trapFocus } from '../a11y.js';

export function createDrawer({ edge = 'right', label } = {}) {
  if (!label) throw new Error('Drawer requires a label');

  const overlay = document.createElement('div');
  overlay.className = 'el-drawer-overlay';
  overlay.hidden = true;

  const panel = document.createElement('div');
  panel.className = `el-drawer el-drawer--${edge}`;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', label);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'el-drawer-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '\u00d7';

  panel.appendChild(closeBtn);
  overlay.appendChild(panel);

  let releaseTrap = null;

  function open() {
    overlay.hidden = false;
    releaseTrap = trapFocus(panel);
  }

  function close() {
    overlay.hidden = true;
    if (releaseTrap) releaseTrap();
    releaseTrap = null;
  }

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  overlay.open = open;
  overlay.close = close;
  overlay.panel = panel;

  return overlay;
}
