// access-gate.js — the one chromeless code-entry screen, shared by the
// site-encryption gate (gate.js) and the chat-secret gate (chat.js). UI only;
// the caller owns what submitting DOES via onSubmit(value, { showError }).
import { createButton } from '../elements/button.js';

// Render a code-entry panel into root. All display text arrives as parameters
// so this module is independent of strings.js (which reads the DOM at import time).
// Returns the panel element.
export function renderAccessGate({ root, subtitle, label, submit, onSubmit }) {
  const panel = document.createElement('div');
  panel.className = 'gate';

  const sub = document.createElement('p');
  sub.className = 'gate-subtitle';
  sub.textContent = subtitle;

  const form = document.createElement('form');
  form.className = 'gate-form';
  form.autocomplete = 'off';

  const lab = document.createElement('label');
  lab.textContent = label;

  const input = document.createElement('input');
  input.type = 'password';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', label);
  lab.appendChild(input);

  const error = document.createElement('p');
  error.className = 'gate-error';
  error.setAttribute('role', 'status');
  error.style.display = 'none';

  const btn = createButton({ label: submit, type: 'submit' });

  form.append(lab, btn, error);
  panel.append(sub, form);
  root.appendChild(panel);
  input.focus();

  const showError = (msg) => {
    error.textContent = msg;
    error.style.display = '';
    btn.disabled = false;
    input.focus();
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = input.value.trim();
    if (!value) return;
    btn.disabled = true;
    error.style.display = 'none';
    await onSubmit(value, { showError });
  });

  return panel;
}
