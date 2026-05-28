// whiteboard.js — standalone drawing overlay. No deck imports.

/** @type {HTMLCanvasElement|null} */
let canvas = null;
/** @type {CanvasRenderingContext2D|null} */
let ctx = null;
/** @type {HTMLElement|null} */
let containerRef = null;
/** @type {HTMLElement|null} */
let toolbar = null;
/** @type {string} */
let currentSlideId = '';
/** @type {Map<string, Array<{points: Array<{x: number, y: number}>, color: string, width: number}>>} */
const strokeMap = new Map();

let options = {
  colors: ['#000000', '#ffffff', '#ef4444', '#3b82f6', '#eab308', '#22c55e'],
  brushSizes: { thin: 1.5, thick: 4 },
  storageKey: 'whiteboard:default',
};

let activeColor = '#000000';
let activeBrush = 'thin';

// ── Tap detection ────────────────────────────────────────────────────────────
// Duplicated in app.js — whiteboard.js must stay standalone for extraction.
// Keep in sync manually or extract to a shared platform constants module when
// a third consumer appears (rule of three).

const TAP_MAX_DURATION_MS = 300;
const TAP_MAX_MOVEMENT_PX = 10;
const EDGE_ZONE_PX = 48;

let pointerStartX = 0;
let pointerStartY = 0;
let pointerStartTime = 0;

// ── Storage ──────────────────────────────────────────────────────────────────

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(options.storageKey);
    if (!raw) return;
    const data = JSON.parse(raw);
    for (const [id, strokes] of Object.entries(data)) {
      strokeMap.set(id, strokes);
    }
  } catch (_) { /* corrupt data — start fresh */ }
}

function saveToStorage() {
  const obj = {};
  for (const [id, strokes] of strokeMap) {
    obj[id] = strokes;
  }
  try {
    localStorage.setItem(options.storageKey, JSON.stringify(obj));
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      console.warn('Whiteboard: localStorage quota exceeded. Strokes will not persist.');
    }
  }
}

// ── Redraw ───────────────────────────────────────────────────────────────────

function redraw() {
  if (!canvas || !ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const strokes = strokeMap.get(currentSlideId) || [];
  for (const stroke of strokes) {
    if (stroke.points.length < 2) continue;
    ctx.beginPath();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const first = stroke.points[0];
    ctx.moveTo(first.x * canvas.width, first.y * canvas.height);
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x * canvas.width, stroke.points[i].y * canvas.height);
    }
    ctx.stroke();
  }
}

// ── Canvas sizing ────────────────────────────────────────────────────────────

function sizeCanvas() {
  if (!canvas || !canvas.parentElement) return;
  canvas.width = canvas.parentElement.clientWidth;
  canvas.height = canvas.parentElement.clientHeight;
  redraw();
}

let resizeObserver = null;

// ── Drawing ──────────────────────────────────────────────────────────────────

let drawing = false;
let currentStroke = null;

function onPointerDown(e) {
  pointerStartX = e.offsetX;
  pointerStartY = e.offsetY;
  pointerStartTime = performance.now();
  drawing = true;
  currentStroke = {
    points: [{ x: e.offsetX / canvas.width, y: e.offsetY / canvas.height }],
    color: activeColor,
    width: options.brushSizes[activeBrush],
  };
  canvas.setPointerCapture(e.pointerId);
}

function onPointerMove(e) {
  if (!drawing || !currentStroke) return;
  const point = { x: e.offsetX / canvas.width, y: e.offsetY / canvas.height };
  currentStroke.points.push(point);
  // Incremental draw — draw just the latest segment
  ctx.beginPath();
  ctx.strokeStyle = currentStroke.color;
  ctx.lineWidth = currentStroke.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const pts = currentStroke.points;
  if (pts.length >= 2) {
    const prev = pts[pts.length - 2];
    ctx.moveTo(prev.x * canvas.width, prev.y * canvas.height);
    ctx.lineTo(point.x * canvas.width, point.y * canvas.height);
    ctx.stroke();
  }
}

function onPointerUp(e) {
  if (!drawing || !currentStroke) return;
  drawing = false;

  const elapsed = performance.now() - pointerStartTime;
  const dx = Math.abs((e.offsetX || pointerStartX) - pointerStartX);
  const dy = Math.abs((e.offsetY || pointerStartY) - pointerStartY);
  const isTap = elapsed < TAP_MAX_DURATION_MS && dx < TAP_MAX_MOVEMENT_PX && dy < TAP_MAX_MOVEMENT_PX;

  if (isTap) {
    // Check edge zones for navigation (use viewport coordinates)
    const viewX = canvas.getBoundingClientRect().left + pointerStartX;
    if (viewX <= EDGE_ZONE_PX) {
      e.stopPropagation();
      window.dispatchEvent(new CustomEvent('moui:navigate', { detail: { direction: 'prev' } }));
      currentStroke = null;
      return;
    }
    if (viewX >= window.innerWidth - EDGE_ZONE_PX) {
      e.stopPropagation();
      window.dispatchEvent(new CustomEvent('moui:navigate', { detail: { direction: 'next' } }));
      currentStroke = null;
      return;
    }
    // Tap in center — not a stroke, not navigation, discard
    currentStroke = null;
    return;
  }

  // Drag — save as stroke
  if (currentStroke.points.length >= 2) {
    if (!strokeMap.has(currentSlideId)) strokeMap.set(currentSlideId, []);
    strokeMap.get(currentSlideId).push(currentStroke);
    saveToStorage();
  }
  currentStroke = null;
}

// ── Toolbar ──────────────────────────────────────────────────────────────────

function buildToolbar(container) {
  toolbar = document.createElement('div');
  toolbar.className = 'wb-toolbar';

  const style = document.createElement('style');
  style.textContent = `
    .wb-toolbar {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 0 6px;
      opacity: 0;
      transition: opacity 0.2s ease;
    }
    .wb-toolbar.visible {
      opacity: 1;
    }
    .wb-toolbar .wb-divider {
      width: 1px;
      height: 14px;
      background: rgba(255, 255, 255, 0.2);
      margin: 0 1px;
    }
    .wb-toolbar .wb-color {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      padding: 0;
      background: none;
      box-shadow: 0 0 0 2px transparent;
      transition: box-shadow 0.15s ease;
    }
    .wb-toolbar .wb-color.active {
      box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.9);
    }
    .wb-toolbar .wb-brush {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: 3px;
      border: none;
      background: transparent;
      cursor: pointer;
      padding: 0;
      transition: background 0.15s ease;
    }
    .wb-toolbar .wb-brush:hover {
      background: rgba(255, 255, 255, 0.1);
    }
    .wb-toolbar .wb-brush.active {
      background: rgba(255, 255, 255, 0.2);
    }
    .wb-toolbar .wb-eraser {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: 3px;
      border: none;
      background: transparent;
      cursor: pointer;
      padding: 0;
      color: rgba(255, 255, 255, 0.7);
      transition: background 0.15s ease, color 0.15s ease;
    }
    .wb-toolbar .wb-eraser:hover {
      background: rgba(239, 68, 68, 0.3);
      color: #ef4444;
    }
  `;
  toolbar.appendChild(style);

  // Colors
  for (const color of options.colors) {
    const btn = document.createElement('button');
    btn.className = 'wb-color' + (color === activeColor ? ' active' : '');
    btn.style.background = color;
    if (color === '#ffffff' || color === '#FFFFFF') {
      btn.style.boxShadow = 'inset 0 0 0 1px rgba(255,255,255,0.3)';
    }
    btn.setAttribute('aria-label', `Color ${color}`);
    btn.addEventListener('click', () => {
      activeColor = color;
      toolbar.querySelectorAll('.wb-color').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
    });
    toolbar.appendChild(btn);
  }

  // Divider
  const div1 = document.createElement('span');
  div1.className = 'wb-divider';
  toolbar.appendChild(div1);

  // Thick brush
  const thickBtn = document.createElement('button');
  thickBtn.className = 'wb-brush' + (activeBrush === 'thick' ? ' active' : '');
  thickBtn.setAttribute('aria-label', 'Thick brush');
  thickBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="4" fill="rgba(255,255,255,0.85)"/></svg>';
  thickBtn.addEventListener('click', () => {
    activeBrush = 'thick';
    thickBtn.classList.add('active');
    thinBtn.classList.remove('active');
  });
  toolbar.appendChild(thickBtn);

  // Thin brush
  const thinBtn = document.createElement('button');
  thinBtn.className = 'wb-brush' + (activeBrush === 'thin' ? ' active' : '');
  thinBtn.setAttribute('aria-label', 'Thin brush');
  thinBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="1.5" fill="rgba(255,255,255,0.85)"/></svg>';
  thinBtn.addEventListener('click', () => {
    activeBrush = 'thin';
    thinBtn.classList.add('active');
    thickBtn.classList.remove('active');
  });
  toolbar.appendChild(thinBtn);

  // Divider
  const div2 = document.createElement('span');
  div2.className = 'wb-divider';
  toolbar.appendChild(div2);

  // Eraser (per-slide clear)
  const eraser = document.createElement('button');
  eraser.className = 'wb-eraser';
  eraser.setAttribute('aria-label', 'Clear this slide');
  eraser.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>';
  eraser.addEventListener('click', () => {
    strokeMap.set(currentSlideId, []);
    saveToStorage();
    redraw();
  });
  toolbar.appendChild(eraser);

  const target = options.toolbarContainer || document.body;
  target.appendChild(toolbar);
  // Trigger enter animation
  requestAnimationFrame(() => toolbar.classList.add('visible'));
}

function removeToolbar() {
  if (!toolbar) return;
  toolbar.classList.remove('visible');
  setTimeout(() => { toolbar?.remove(); toolbar = null; }, 200);
}

// ── Public API ───────────────────────────────────────────────────────────────

export function mountWhiteboard(container, slideId, opts = {}) {
  if (canvas) unmountWhiteboard();

  strokeMap.clear();
  Object.assign(options, opts);
  currentSlideId = slideId;
  loadFromStorage();

  containerRef = container;
  canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:50;cursor:crosshair;touch-action:none;';
  container.style.position = 'relative';
  container.appendChild(canvas);
  ctx = canvas.getContext('2d');

  sizeCanvas();
  resizeObserver = new ResizeObserver(() => sizeCanvas());
  resizeObserver.observe(container);

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  buildToolbar(container);
}

export function unmountWhiteboard() {
  if (canvas) {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    canvas.remove();
    canvas = null;
    ctx = null;
  }
  containerRef = null;
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  removeToolbar();
}

export function setWhiteboardSlide(slideId) {
  currentSlideId = slideId;
  // Re-attach canvas if the host's render cycle replaced container children
  if (canvas && containerRef && !canvas.parentElement) {
    containerRef.appendChild(canvas);
    sizeCanvas();
    return; // sizeCanvas calls redraw
  }
  redraw();
}
