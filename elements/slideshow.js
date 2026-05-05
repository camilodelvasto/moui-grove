/**Slideshow element — sequential content carousel.*/

export function createSlideshow({ slides, label, autoAdvance = 5000 } = {}) {
  if (!slides || !slides.length) throw new Error('Slideshow requires slides');
  if (!label) throw new Error('Slideshow requires a label');

  const region = document.createElement('div');
  region.className = 'el-slideshow';
  region.setAttribute('role', 'region');
  region.setAttribute('aria-label', label);
  region.setAttribute('aria-roledescription', 'carousel');

  const viewport = document.createElement('div');
  viewport.className = 'el-slideshow-viewport';

  slides.forEach((content, i) => {
    const slide = document.createElement('div');
    slide.className = 'el-slide';
    slide.setAttribute('role', 'group');
    slide.setAttribute('aria-roledescription', 'slide');
    slide.setAttribute('aria-label', `Slide ${i + 1} of ${slides.length}`);
    slide.hidden = i !== 0;
    if (typeof content === 'string') {
      slide.innerHTML = content;
    } else {
      slide.appendChild(content);
    }
    viewport.appendChild(slide);
  });

  region.appendChild(viewport);

  const controls = document.createElement('div');
  controls.className = 'el-slideshow-controls';

  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'el-slideshow-prev';
  prev.setAttribute('aria-label', 'Previous slide');
  prev.textContent = '\u2190';

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'el-slideshow-next';
  next.setAttribute('aria-label', 'Next slide');
  next.textContent = '\u2192';

  controls.appendChild(prev);
  controls.appendChild(next);
  region.appendChild(controls);

  let current = 0;
  const allSlides = viewport.children;

  function show(index) {
    allSlides[current].hidden = true;
    current = (index + slides.length) % slides.length;
    allSlides[current].hidden = false;
  }

  prev.addEventListener('click', () => show(current - 1));
  next.addEventListener('click', () => show(current + 1));

  region.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { show(current - 1); e.preventDefault(); }
    if (e.key === 'ArrowRight') { show(current + 1); e.preventDefault(); }
  });
  region.tabIndex = 0;

  let timer = null;
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function startTimer() {
    if (prefersReduced || !autoAdvance) return;
    timer = setInterval(() => show(current + 1), autoAdvance);
  }

  function stopTimer() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  region.addEventListener('mouseenter', stopTimer);
  region.addEventListener('mouseleave', startTimer);
  region.addEventListener('focusin', stopTimer);
  region.addEventListener('focusout', startTimer);

  startTimer();

  return region;
}
