/**Button element — styled variants (primary, secondary, ghost).*/

export function createButton({ label, href, variant = 'primary', disabled = false, type = 'button' } = {}) {
  if (!label) throw new Error('Button requires a label');

  if (href && !disabled) {
    const a = document.createElement('a');
    a.href = href;
    a.className = `btn btn-${variant}`;
    a.textContent = label;
    a.setAttribute('role', 'button');
    return a;
  }

  const btn = document.createElement('button');
  btn.type = type;
  btn.className = `btn btn-${variant}`;
  btn.textContent = label;
  if (disabled) {
    btn.setAttribute('aria-disabled', 'true');
    btn.disabled = true;
  }
  return btn;
}
