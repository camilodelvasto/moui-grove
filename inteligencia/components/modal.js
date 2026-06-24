/** modal.js — a behavior-free modal shell.
 *
 * ONE responsibility: dialog chrome. It mounts a caller-built node inside a
 * native `<dialog>` opened with `showModal()`, so the platform provides the
 * focus trap, Escape-to-cancel, the `inert` backdrop, the top layer, and
 * focus-restore-to-trigger on close — all for free. The shell wires the two
 * close paths (Escape/cancel and backdrop click) to the caller's `onClose`
 * and returns a close handle.
 *
 * It holds ZERO policy: no titles, no buttons, no sizes, no variants. The
 * caller builds its own body and owns its own behavior; the shell knows
 * nothing about search, delete, or anything else. Styling is tokened via the
 * `.modal-overlay` / `.modal-panel` classes in core/style.css.
 *
 * The close handle (and `.close()`) fire the `close` event on a LATER task,
 * not synchronously — so after calling the handle, `onClose` has not run yet
 * and the dialog is still in the DOM until that task. Treat the handle as
 * fire-and-forget: capture anything you need into locals BEFORE closing, and
 * don't read state in the window between calling the handle and `onClose`.
 *
 * @param {Node} contentNode  the caller's body, mounted inside the panel.
 * @param {{ onClose: () => void }} opts  called once when the dialog closes
 *        (Escape, backdrop click, or the returned handle), on a later task.
 *        The shell removes the dialog from the DOM before invoking it.
 * @returns {() => void} a close handle the caller can call to close.
 */
export function open(contentNode, { onClose }) {
  const overlay = document.createElement('dialog');
  overlay.className = 'modal-overlay';

  const panel = document.createElement('div');
  panel.className = 'modal-panel';
  panel.appendChild(contentNode);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  // Backdrop click → close. A native dialog fires `click` with
  // target === dialog when the click lands on the backdrop outside the panel.
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.close();
  });

  // Native Escape (dialog `cancel`) and any `.close()` both fire `close`. One
  // cleanup path: remove the dialog from the DOM, then hand control back. The
  // browser restores focus to the element that was focused before showModal()
  // — i.e. the trigger — automatically.
  overlay.addEventListener('close', () => {
    overlay.remove();
    onClose();
  });

  // showModal() moves focus into the dialog and installs the focus trap.
  overlay.showModal();

  return () => overlay.close();
}
