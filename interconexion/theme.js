// theme.js — palette/theme resolution and CSS variable injection

export function resolveColor(value, palette, assignments) {
  if (!value) return undefined;
  const str = String(value);
  if (palette[str]) return palette[str];
  if (assignments[str] && palette[assignments[str]]) return palette[assignments[str]];
  if (assignments[str]) return assignments[str];
  return str;
}

export function resolveBackground(value, palette, assignments) {
  if (!value) return undefined;
  if (typeof value === 'object' && value.from) {
    const from = resolveColor(value.from, palette, assignments);
    const to = resolveColor(value.to, palette, assignments);
    const direction = value.direction || '180deg';
    return `linear-gradient(${direction}, ${from}, ${to})`;
  }
  return resolveColor(value, palette, assignments);
}

/**
 * Universal token resolution. Looks up value across gradients → palette → borders.
 * Returns { type: 'gradient'|'color'|'border'|'raw', css: string } or null.
 */
export function resolveToken(value, themeData) {
  if (value == null) return null;
  const str = String(value);
  const gradients = themeData.gradients || {};
  const palette = themeData.palette || {};
  const borders = themeData.borders || {};
  if (gradients[str]) return { type: 'gradient', css: gradients[str] };
  if (palette[str]) return { type: 'color', css: palette[str] };
  if (borders[str]) return { type: 'border', css: borders[str] };
  return { type: 'raw', css: str };
}

/**
 * Check for token name collisions across namespaces.
 * Returns array of collision descriptions. Empty = no collisions.
 */
export function checkTokenCollisions(themeData) {
  const gradients = Object.keys(themeData.gradients || {});
  const palette = Object.keys(themeData.palette || {});
  const borders = Object.keys(themeData.borders || {});
  const collisions = [];
  for (const name of gradients) {
    if (palette.includes(name)) collisions.push(`"${name}" exists in both gradients and palette`);
    if (borders.includes(name)) collisions.push(`"${name}" exists in both gradients and borders`);
  }
  for (const name of palette) {
    if (borders.includes(name)) collisions.push(`"${name}" exists in both palette and borders`);
  }
  return collisions;
}

/**
 * Convert a resolved token into inline styles for a .divider element.
 * orientation: 'v' (vertical) or 'h' (horizontal).
 */
export function resolveDividerCSS(resolved, orientation) {
  if (!resolved) return null;
  const styles = {};
  if (resolved.type === 'gradient') {
    const deg = orientation === 'v' ? '180deg' : '90deg';
    let css = resolved.css;
    css = css.replace(/linear-gradient\(\s*\d+deg/, `linear-gradient(${deg}`);
    styles.backgroundImage = css;
    styles.width = orientation === 'v' ? '2px' : '100%';
    if (orientation === 'h') styles.height = '2px';
  } else if (resolved.type === 'color') {
    styles.backgroundColor = resolved.css;
    styles.width = orientation === 'v' ? '1px' : '100%';
    if (orientation === 'h') styles.height = '1px';
  } else if (resolved.type === 'border') {
    const side = orientation === 'v' ? 'borderLeft' : 'borderTop';
    styles[side] = resolved.css;
    if (orientation === 'h') styles.height = '0';
  } else {
    const side = orientation === 'v' ? 'borderLeft' : 'borderTop';
    styles[side] = resolved.css;
    if (orientation === 'h') styles.height = '0';
  }
  return styles;
}

export function resolvePadding(value, themeData) {
  if (!value) return undefined;
  const named = { sm: 'space-sm', md: 'space-md', lg: 'space-lg', xl: 'space-xl' };
  if (named[value] && themeData[named[value]]) return themeData[named[value]];
  return value;
}

export function extractThemeParts(themeData) {
  const palette = themeData.palette || {};
  const assignments = {};
  for (const [key, value] of Object.entries(themeData)) {
    if (key.startsWith('color-')) assignments[key] = value;
  }
  return { palette, assignments };
}

export function resolveReveal(themeData, deckReveal, slideReveal) {
  if (!themeData.reveal) throw new Error('resolveReveal: theme must declare a reveal block');
  const themeReveal = themeData.reveal;
  if (themeReveal.type == null) throw new Error('resolveReveal: theme.reveal.type is required');
  if (themeReveal.stagger == null) throw new Error('resolveReveal: theme.reveal.stagger is required');
  if (themeReveal.speed == null) throw new Error('resolveReveal: theme.reveal.speed is required');
  const base = {
    type: themeReveal.type,
    stagger: themeReveal.stagger,
    speed: themeReveal.speed
  };
  // Deck-level override — only applied if the deck YAML declares a reveal block
  if (deckReveal !== undefined) {
    if (deckReveal.type !== undefined) base.type = deckReveal.type;
    if (deckReveal.stagger !== undefined) base.stagger = deckReveal.stagger;
    if (deckReveal.speed !== undefined) base.speed = deckReveal.speed;
  }
  // Slide-level override — only applied if the slide declares style.reveal
  if (slideReveal !== undefined) {
    if (slideReveal.type !== undefined) base.type = slideReveal.type;
    if (slideReveal.stagger !== undefined) base.stagger = slideReveal.stagger;
    if (slideReveal.speed !== undefined) base.speed = slideReveal.speed;
  }
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    base.type = 'none';
  }
  return base;
}

function collectThemeVars(themeData) {
  const pairs = [];
  const palette = themeData.palette || {};
  for (const [name, value] of Object.entries(palette)) {
    pairs.push([`--palette-${name}`, value]);
  }
  for (const [key, value] of Object.entries(themeData)) {
    if (key === 'palette') continue;
    if (typeof value === 'object') continue;
    pairs.push([`--${key}`, String(value)]);
  }
  for (const [key, value] of Object.entries(themeData)) {
    if (key.startsWith('color-') && typeof value === 'string') {
      pairs.push([`--${key}-resolved`, palette[value] || value]);
    }
  }
  // Resolve bar-gradient-* tokens through palette
  for (const key of ['bar-gradient-from', 'bar-gradient-to']) {
    const value = themeData[key];
    if (typeof value === 'string') {
      pairs.push([`--${key}-resolved`, palette[value] || value]);
    }
  }
  const effects = themeData.effects || {};
  for (const [name, config] of Object.entries(effects)) {
    if (!config || typeof config !== 'object') continue;
    for (const [key, value] of Object.entries(config)) {
      if (key === 'colors' && Array.isArray(value)) {
        value.forEach((c, i) => {
          pairs.push([`--effect-${name}-color-${i}`, palette[c] || c]);
        });
      } else if (typeof value === 'string') {
        pairs.push([`--effect-${name}-${key}`, palette[value] || value]);
      } else {
        pairs.push([`--effect-${name}-${key}`, String(value)]);
      }
    }
  }
  return pairs;
}

export function serializeThemeVars(themeData) {
  return collectThemeVars(themeData)
    .map(([k, v]) => `${k}: ${v};`)
    .join(' ');
}

export function applyCSSVariables(themeData, root) {
  for (const [k, v] of collectThemeVars(themeData)) {
    root.style.setProperty(k, v);
  }
}

// ---------------------------------------------------------------------------
// Effect config resolution — merges theme defaults with slide overrides.
// Returns [{name, config}] — a pure function with no DOM writes.
// ---------------------------------------------------------------------------

function mergeEffectConfig(themeConfig, slideConfig, palette, assignments) {
  const base = themeConfig && typeof themeConfig === 'object' ? { ...themeConfig } : {};
  const slide = slideConfig && typeof slideConfig === 'object' ? slideConfig : {};
  const merged = { ...base, ...slide };
  const resolved = {};
  for (const [key, value] of Object.entries(merged)) {
    if (key === 'color' || key === 'stripe') {
      resolved[key] = resolveColor(value, palette, assignments);
    } else if (key === 'colors' && Array.isArray(value)) {
      resolved[key] = value.map(c => resolveColor(c, palette, assignments));
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

export function resolveEffects(effectRef, themeData) {
  if (effectRef == null) return [];
  if (!themeData) throw new Error('resolveEffects: themeData is required');
  const themeEffects = themeData.effects || {};
  const { palette, assignments } = extractThemeParts(themeData);

  if (typeof effectRef === 'string') {
    return [{
      name: effectRef,
      config: mergeEffectConfig(themeEffects[effectRef], null, palette, assignments),
    }];
  }

  if (Array.isArray(effectRef)) {
    return effectRef.map(name => ({
      name,
      config: mergeEffectConfig(themeEffects[name], null, palette, assignments),
    }));
  }

  if (typeof effectRef === 'object') {
    return Object.entries(effectRef).map(([name, slideConfig]) => ({
      name,
      config: mergeEffectConfig(themeEffects[name], slideConfig, palette, assignments),
    }));
  }

  throw new Error(`resolveEffects: unexpected effectRef type: ${typeof effectRef}`);
}

/**
 * Compute relative luminance of a hex color string.
 * Returns a value between 0 (black) and 1 (white).
 */
export function relativeLuminance(hex) {
  if (!hex || typeof hex !== 'string') return 0;
  const clean = hex.replace('#', '');
  if (clean.length < 6) return 0;
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const toLinear = (c) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}
