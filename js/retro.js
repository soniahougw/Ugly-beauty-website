// 90s mode: on/off switch, visitor counter, webring, "click HERE" links, sparkle cursor trail.
(() => {
  const KEY = 'tri-retro';
  const body = document.body;
  const toggle = document.getElementById('retro-toggle');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function setRetro(on) {
    body.classList.toggle('retro', on);
    toggle.textContent = on ? '90s mode: ON' : '90s mode: OFF';
    toggle.setAttribute('aria-pressed', String(on));
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch {}
  }
  setRetro(body.classList.contains('retro'));
  toggle.addEventListener('click', () => setRetro(!body.classList.contains('retro')));

  // Visitor counter: counts this browser's visits (there is no server to count everyone).
  let visits = 1;
  try {
    visits = (parseInt(localStorage.getItem('tri-visits'), 10) || 0) + 1;
    localStorage.setItem('tri-visits', String(visits));
  } catch {}
  document.getElementById('odo').innerHTML = String(visits).padStart(6, '0').split('').map((d) => `<span>${d}</span>`).join('');

  // "Click HERE" links and webring buttons fly the 3D camera by clicking the matching place card.
  const go = (id) => document.querySelector(`.place[data-id="${id}"]`)?.click();
  document.querySelectorAll('[data-go]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      go(a.dataset.go);
    })
  );
  let ring = -1;
  const ids = () => [...document.querySelectorAll('.place[data-id]')].map((c) => c.dataset.id);
  document.querySelectorAll('[data-ring]').forEach((b) =>
    b.addEventListener('click', () => {
      const list = ids();
      if (!list.length) return;
      const step = b.dataset.ring;
      ring = step === 'random' ? Math.floor(Math.random() * list.length) : (ring + (step === 'next' ? 1 : -1) + list.length) % list.length;
      go(list[ring]);
    })
  );

  // Sparkle trail that follows the mouse.
  if (reduceMotion) return;
  const glyphs = ['✨', '⭐', '🌟', '✦'];
  let last = 0;
  addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'mouse' || !body.classList.contains('retro')) return;
      const now = performance.now();
      if (now - last < 45) return;
      last = now;
      const s = document.createElement('span');
      s.className = 'sparkle';
      s.setAttribute('aria-hidden', 'true');
      s.textContent = glyphs[Math.floor(Math.random() * glyphs.length)];
      s.style.left = `${e.clientX}px`;
      s.style.top = `${e.clientY}px`;
      body.appendChild(s);
      setTimeout(() => s.remove(), 800);
    },
    { passive: true }
  );
})();
