// Build a muscle-map SVG for an exercise at runtime. This is a JS port of
// tools/generate_svgs.py so that CUSTOM exercises (which have no pre-generated
// file) still get an on-theme illustration highlighting their target muscles.
// Output matches the built-in art: a faint body silhouette (currentColor) with
// the targeted muscles painted via the `.muscle-fill` class (themed accent).

const W = 200, H = 300;

const BODY = `
  <g fill="currentColor" fill-opacity="0.16" stroke="currentColor" stroke-opacity="0.16">
    <circle cx="100" cy="42" r="20"/>
    <rect x="92" y="60" width="16" height="12" rx="4"/>
    <path d="M66,76 Q64,72 74,72 L126,72 Q136,72 134,76 L128,120 Q124,150 120,152 L122,172 L78,172 L80,152 Q76,150 72,120 Z"/>
  </g>
  <g fill="none" stroke="currentColor" stroke-opacity="0.16" stroke-width="17" stroke-linecap="round" stroke-linejoin="round">
    <path d="M72,80 L54,120 L48,162"/>
    <path d="M128,80 L146,120 L152,162"/>
  </g>
  <g fill="none" stroke="currentColor" stroke-opacity="0.16" stroke-width="21" stroke-linecap="round" stroke-linejoin="round">
    <path d="M90,168 L88,228 L90,286"/>
    <path d="M110,168 L112,228 L110,286"/>
  </g>`;

function m(active) {
  return active ? 'class="muscle-fill"' : 'fill="currentColor" fill-opacity="0.30"';
}

function frontOverlays(t) {
  return [
    `<ellipse cx="72" cy="80" rx="12" ry="10" ${m(t.has('delts'))}/>`,
    `<ellipse cx="128" cy="80" rx="12" ry="10" ${m(t.has('delts'))}/>`,
    `<path d="M86,86 Q100,82 100,86 L100,104 Q90,108 82,102 Q80,90 86,86 Z" ${m(t.has('chest'))}/>`,
    `<path d="M114,86 Q100,82 100,86 L100,104 Q110,108 118,102 Q120,90 114,86 Z" ${m(t.has('chest'))}/>`,
    `<ellipse cx="61" cy="99" rx="8" ry="15" transform="rotate(20 61 99)" ${m(t.has('biceps'))}/>`,
    `<ellipse cx="139" cy="99" rx="8" ry="15" transform="rotate(-20 139 99)" ${m(t.has('biceps'))}/>`,
    `<ellipse cx="51" cy="143" rx="7" ry="15" transform="rotate(12 51 143)" ${m(t.has('forearms'))}/>`,
    `<ellipse cx="149" cy="143" rx="7" ry="15" transform="rotate(-12 149 143)" ${m(t.has('forearms'))}/>`,
    `<rect x="90" y="108" width="20" height="40" rx="6" ${m(t.has('abs'))}/>`,
    `<ellipse cx="82" cy="126" rx="6" ry="16" ${m(t.has('obliques'))}/>`,
    `<ellipse cx="118" cy="126" rx="6" ry="16" ${m(t.has('obliques'))}/>`,
    `<ellipse cx="89" cy="206" rx="11" ry="30" ${m(t.has('quads'))}/>`,
    `<ellipse cx="111" cy="206" rx="11" ry="30" ${m(t.has('quads'))}/>`,
    `<ellipse cx="89" cy="262" rx="8" ry="20" ${m(t.has('calves'))}/>`,
    `<ellipse cx="111" cy="262" rx="8" ry="20" ${m(t.has('calves'))}/>`
  ].join('\n    ');
}

function backOverlays(t) {
  return [
    `<ellipse cx="72" cy="80" rx="12" ry="10" ${m(t.has('reardelt'))}/>`,
    `<ellipse cx="128" cy="80" rx="12" ry="10" ${m(t.has('reardelt'))}/>`,
    `<path d="M86,74 L114,74 L104,100 L96,100 Z" ${m(t.has('traps'))}/>`,
    `<path d="M82,96 L96,100 L98,142 L84,132 Z" ${m(t.has('lats'))}/>`,
    `<path d="M118,96 L104,100 L102,142 L116,132 Z" ${m(t.has('lats'))}/>`,
    `<ellipse cx="61" cy="99" rx="8" ry="15" transform="rotate(20 61 99)" ${m(t.has('triceps'))}/>`,
    `<ellipse cx="139" cy="99" rx="8" ry="15" transform="rotate(-20 139 99)" ${m(t.has('triceps'))}/>`,
    `<rect x="90" y="134" width="20" height="22" rx="5" ${m(t.has('lowerback'))}/>`,
    `<ellipse cx="91" cy="172" rx="12" ry="12" ${m(t.has('glutes'))}/>`,
    `<ellipse cx="109" cy="172" rx="12" ry="12" ${m(t.has('glutes'))}/>`,
    `<ellipse cx="89" cy="212" rx="11" ry="26" ${m(t.has('hamstrings'))}/>`,
    `<ellipse cx="111" cy="212" rx="11" ry="26" ${m(t.has('hamstrings'))}/>`,
    `<ellipse cx="89" cy="264" rx="8" ry="20" ${m(t.has('calves'))}/>`,
    `<ellipse cx="111" cy="264" rx="8" ry="20" ${m(t.has('calves'))}/>`
  ].join('\n    ');
}

const GLYPHS = {
  barbell: '<line x1="6" y1="20" x2="34" y2="20"/><rect x="4" y="13" width="6" height="14" rx="2"/><rect x="30" y="13" width="6" height="14" rx="2"/><rect x="10" y="16" width="4" height="8" rx="1"/><rect x="26" y="16" width="4" height="8" rx="1"/>',
  dumbbell: '<line x1="12" y1="20" x2="28" y2="20"/><rect x="6" y="12" width="8" height="16" rx="2"/><rect x="26" y="12" width="8" height="16" rx="2"/>',
  cable: '<circle cx="20" cy="10" r="5"/><line x1="20" y1="15" x2="20" y2="28"/><path d="M14,28 h12"/><path d="M17,28 v4 M23,28 v4"/>',
  machine: '<rect x="7" y="7" width="26" height="26" rx="3"/><line x1="14" y1="7" x2="14" y2="33"/><circle cx="24" cy="16" r="3"/>',
  bodyweight: '<circle cx="20" cy="11" r="4"/><path d="M20,15 v10 M20,18 l-7,-3 M20,18 l7,-3 M20,25 l-6,8 M20,25 l6,8"/>',
  cardio: '<path d="M20,31 C6,22 8,10 15,10 C19,10 20,13 20,13 C20,13 21,10 25,10 C32,10 34,22 20,31 Z"/>',
  band: '<ellipse cx="20" cy="20" rx="13" ry="8"/><ellipse cx="20" cy="20" rx="6" ry="3.5"/>'
};

function equipmentBadge(equip) {
  const g = GLYPHS[equip] || GLYPHS.machine;
  return `
  <g transform="translate(150,8)">
    <rect x="0" y="0" width="40" height="40" rx="11" fill="currentColor" fill-opacity="0.10"/>
    <g fill="none" stroke="currentColor" stroke-opacity="0.55" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      ${g}
    </g>
  </g>`;
}

/** Return SVG markup (string) illustrating an exercise's target muscles. */
export function buildExerciseSVG(ex) {
  const view = ex && ex.view === 'back' ? 'back' : 'front';
  const targets = new Set([...(ex.primary || []), ...(ex.secondary || [])]);
  const overlays = view === 'front' ? frontOverlays(targets) : backOverlays(targets);
  const badge = equipmentBadge((ex && ex.equipment) || 'machine');
  const name = (ex && ex.names && (ex.names.en || Object.values(ex.names)[0])) || (ex && ex.id) || '';
  const safe = String(name).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${safe}">
  <title>${safe}</title>
${BODY}
  <g>
    ${overlays}
  </g>${badge}
</svg>`;
}

// Map a muscle group to a default view + a representative primary muscle,
// so a freshly created custom exercise lights up a sensible region.
export const GROUP_VIEW = {
  chest: 'front', back: 'back', legs: 'front', shoulders: 'front',
  biceps: 'front', triceps: 'back', core: 'front', cardio: 'front', warmup: 'front'
};
export const GROUP_MUSCLE = {
  chest: 'chest', back: 'lats', legs: 'quads', shoulders: 'delts',
  biceps: 'biceps', triceps: 'triceps', core: 'abs', cardio: 'calves', warmup: 'delts'
};
