(() => {
  'use strict';

  // Empty when Flask serves this page. Set <meta name="api-base"> if the UI lives elsewhere.
  const API = (document.querySelector('meta[name="api-base"]')?.content || '').replace(/\/+$/, '');
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const form = $('#churnForm');
  const result = $('#result');
  const arc = $('#arc');
  const pctNum = $('#pctNum');
  const riskText = $('#riskText');
  const verdictLine = $('#verdictLine');
  const leversBox = $('#levers');
  const leverList = $('#leverList');
  const predictBtn = $('#predictBtn');
  const predictLabel = $('#predictLabel');
  const noteEl = $('#note');
  const statusEl = $('#status');
  const statusText = $('#statusText');

  /* ---------- pointer light and 3D keys ---------- */

  if (finePointer) {
    const glows = $$('.glow');

    addEventListener('pointermove', (e) => {
      for (const el of glows) {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', `${e.clientX - r.left}px`);
        el.style.setProperty('--my', `${e.clientY - r.top}px`);
      }
    }, { passive: true });

    if (!calm) {
      // a large, slow light that trails the cursor
      const ambient = $('.ambient');
      const light = { x: innerWidth / 2, y: innerHeight * 0.3, tx: innerWidth / 2, ty: innerHeight * 0.3 };
      let frame = 0;

      const glide = () => {
        light.x += (light.tx - light.x) * 0.09;
        light.y += (light.ty - light.y) * 0.09;
        ambient.style.setProperty('--cx', `${light.x.toFixed(1)}px`);
        ambient.style.setProperty('--cy', `${light.y.toFixed(1)}px`);
        const gap = Math.abs(light.tx - light.x) + Math.abs(light.ty - light.y);
        frame = gap > 0.5 ? requestAnimationFrame(glide) : 0;
      };

      addEventListener('pointermove', (e) => {
        light.tx = e.clientX;
        light.ty = e.clientY;
        ambient.style.setProperty('--lit', '1');
        if (!frame) frame = requestAnimationFrame(glide);
      }, { passive: true });

      // keys lean toward the cursor; the wrapper is measured because it never rotates
      $$('[data-tilt]').forEach((wrap) => {
        const max = Number(wrap.dataset.tilt) || 10;

        wrap.addEventListener('pointermove', (e) => {
          const r = wrap.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width;
          const y = (e.clientY - r.top) / r.height;
          wrap.style.setProperty('--ry', `${((x - 0.5) * 2 * max).toFixed(2)}deg`);
          wrap.style.setProperty('--rx', `${((0.5 - y) * 2 * max).toFixed(2)}deg`);
          wrap.style.setProperty('--gx', `${(x * 100).toFixed(1)}%`);
          wrap.style.setProperty('--gy', `${(y * 100).toFixed(1)}%`);
        });

        wrap.addEventListener('pointerleave', () => {
          wrap.style.setProperty('--rx', '0deg');
          wrap.style.setProperty('--ry', '0deg');
        });
      });
    }
  }

  /* ---------- form behaviour ---------- */

  const tenure = form.elements.tenure;
  const monthly = form.elements.MonthlyCharges;
  const total = form.elements.TotalCharges;
  const autoBtn = $('#autoTotal');
  let autoTotal = true;

  function setAuto(on) {
    autoTotal = on;
    autoBtn.setAttribute('aria-pressed', String(on));
  }

  function syncTotal() {
    if (!autoTotal) return;
    if (tenure.value === '' || monthly.value === '') {
      total.value = '';
      return;
    }
    total.value = (Number(tenure.value) * Number(monthly.value)).toFixed(2);
  }

  // No phone or no internet means the related questions do not apply.
  function syncDependencies() {
    const noPhone = form.elements.PhoneService.value === 'No';
    const noNet = form.elements.InternetService.value === 'No';
    $$('.field[data-needs]').forEach((field) => {
      const off = field.dataset.needs === 'phone' ? noPhone : noNet;
      field.classList.toggle('is-na', off);
      $$('input', field).forEach((input) => { input.disabled = off; });
    });
  }

  function collect() {
    const data = Object.fromEntries(new FormData(form));
    $$('.field.is-na').forEach((field) => {
      data[$('input', field).name] = field.dataset.na;
    });
    for (const key of ['tenure', 'MonthlyCharges', 'TotalCharges']) data[key] = Number(data[key]);
    return data;
  }

  const PRESETS = {
    loyal: {
      gender: 'Male', Partner: 'Yes', Dependents: 'Yes', tenure: 58,
      PhoneService: 'Yes', MultipleLines: 'Yes', InternetService: 'DSL',
      OnlineSecurity: 'Yes', OnlineBackup: 'Yes', DeviceProtection: 'Yes', TechSupport: 'Yes',
      StreamingTV: 'No', StreamingMovies: 'No', Contract: 'Two year', PaperlessBilling: 'No',
      PaymentMethod: 'Credit card (automatic)', MonthlyCharges: 64.75,
    },
    risky: {
      gender: 'Female', Partner: 'No', Dependents: 'No', tenure: 2,
      PhoneService: 'Yes', MultipleLines: 'No', InternetService: 'Fiber optic',
      OnlineSecurity: 'No', OnlineBackup: 'No', DeviceProtection: 'No', TechSupport: 'No',
      StreamingTV: 'Yes', StreamingMovies: 'Yes', Contract: 'Month-to-month', PaperlessBilling: 'Yes',
      PaymentMethod: 'Electronic check', MonthlyCharges: 89.9,
    },
  };

  function applyPreset(name) {
    form.reset();
    for (const [field, value] of Object.entries(PRESETS[name])) {
      form.elements[field].value = String(value);
    }
    setAuto(true);
    syncTotal();
    syncDependencies();
    predict();
  }

  function resetAll() {
    form.reset();
    setAuto(true);
    syncTotal();
    syncDependencies();
    idle();
  }

  // Once a score is on screen, dim it as soon as the inputs stop matching it.
  function markStale() {
    if (result.dataset.state === 'done') result.dataset.stale = 'true';
  }

  tenure.addEventListener('input', syncTotal);
  monthly.addEventListener('input', syncTotal);
  total.addEventListener('input', () => setAuto(false));
  autoBtn.addEventListener('click', () => { setAuto(!autoTotal); syncTotal(); markStale(); });
  form.addEventListener('change', syncDependencies);
  form.addEventListener('input', markStale);
  form.addEventListener('change', markStale);
  form.addEventListener('submit', (e) => { e.preventDefault(); predict(); });
  $$('[data-preset]').forEach((btn) => btn.addEventListener('click', () => applyPreset(btn.dataset.preset)));
  $('#resetBtn').addEventListener('click', resetAll);

  /* ---------- prediction ---------- */

  const RISK = {
    low: { tag: 'Low risk', line: 'Likely to stay' },
    medium: { tag: 'Medium risk', line: 'Leans toward staying' },
    high: { tag: 'High risk', line: 'Likely to leave' },
  };

  const LEVER_COPY = {
    Contract: {
      'One year': 'Move to a one-year contract',
      'Two year': 'Move to a two-year contract',
      'Month-to-month': 'Move to a monthly contract',
    },
    PaymentMethod: {
      'Bank transfer (automatic)': 'Pay by bank transfer (auto)',
      'Credit card (automatic)': 'Pay by credit card (auto)',
      'Electronic check': 'Pay by electronic check',
      'Mailed check': 'Pay by mailed check',
    },
    PaperlessBilling: { No: 'Switch to paper billing', Yes: 'Switch to paperless billing' },
    OnlineSecurity: { Yes: 'Add online security' },
    OnlineBackup: { Yes: 'Add online backup' },
    DeviceProtection: { Yes: 'Add device protection' },
    TechSupport: { Yes: 'Add tech support' },
  };

  const FIELD_LABEL = { tenure: 'Tenure', MonthlyCharges: 'Monthly charges', TotalCharges: 'Total charges' };

  let busy = false;

  function note(text = '', isError = false) {
    noteEl.textContent = text;
    noteEl.classList.toggle('is-error', isError);
  }

  function setBusy(on) {
    busy = on;
    predictBtn.setAttribute('aria-busy', String(on));
    predictLabel.textContent = on ? 'Predicting\u2026' : 'Predict churn risk';
  }

  function problemText(body) {
    if (body && body.fields) {
      const [field, message] = Object.entries(body.fields)[0];
      return `${FIELD_LABEL[field] || field}: ${message}`;
    }
    return body && body.error;
  }

  async function predict() {
    if (busy || !form.reportValidity()) return;
    setBusy(true);
    note('');
    const wake = setTimeout(
      () => note('The server was asleep and is starting up. This can take up to a minute.'),
      4000,
    );

    try {
      const res = await fetch(`${API}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collect()),
        signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(90000) : undefined,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(problemText(body) || `The server returned ${res.status}.`);
      render(body);
      note('');
    } catch (err) {
      const offline = err.name === 'TypeError' || err.name === 'TimeoutError' || err.name === 'AbortError';
      note(offline ? "Can't reach the server. Check your connection and try again." : err.message, true);
    } finally {
      clearTimeout(wake);
      setBusy(false);
    }
  }

  /* ---------- result ---------- */

  const CIRC = 2 * Math.PI * 96;
  arc.style.strokeDasharray = CIRC.toFixed(2);
  arc.style.strokeDashoffset = CIRC.toFixed(2);

  let shown = 0;
  let countFrame = 0;

  function countTo(target) {
    cancelAnimationFrame(countFrame);
    if (calm) {
      shown = target;
      pctNum.textContent = target;
      return;
    }
    const from = shown;
    const start = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - start) / 1000);
      shown = Math.round(from + (target - from) * (1 - Math.pow(1 - k, 3)));
      pctNum.textContent = shown;
      if (k < 1) countFrame = requestAnimationFrame(step);
    };
    countFrame = requestAnimationFrame(step);
  }

  function renderLevers(levers) {
    leverList.replaceChildren();
    leversBox.hidden = levers.length === 0;
    if (!levers.length) return;

    const biggest = Math.max(...levers.map((l) => -l.delta));
    const fills = [];

    for (const lever of levers) {
      const item = document.createElement('li');
      item.className = 'lever';

      const label = document.createElement('span');
      label.textContent = LEVER_COPY[lever.field]?.[lever.value] ?? `${lever.field}: ${lever.value}`;

      const gain = document.createElement('b');
      gain.textContent = `\u2212${Math.round(-lever.delta * 100)} pts`;

      const track = document.createElement('div');
      track.className = 'lever-bar';
      const fill = document.createElement('span');
      track.append(fill);

      item.append(label, gain, track);
      leverList.append(item);
      fills.push([fill, (-lever.delta / biggest) * 100]);
    }

    void leverList.offsetWidth; // let the bars start from zero
    for (const [fill, width] of fills) fill.style.width = `${width}%`;
  }

  function render(r) {
    const prob = Math.min(1, Math.max(0, Number(r.churn_probability) || 0));
    const copy = RISK[r.risk_level] || RISK.low;

    document.body.dataset.risk = r.risk_level;
    result.dataset.state = 'done';
    delete result.dataset.stale;

    arc.style.strokeDashoffset = (CIRC * (1 - prob)).toFixed(2);
    countTo(Math.round(prob * 100));
    riskText.textContent = copy.tag;
    verdictLine.textContent = copy.line;
    renderLevers(r.levers || []);

    // on a single-column layout the score can be well below the button that was pressed
    const box = result.getBoundingClientRect();
    if (innerWidth <= 980 && (box.top > innerHeight * 0.75 || box.bottom < 0)) {
      result.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' });
    }
  }

  function idle() {
    cancelAnimationFrame(countFrame);
    shown = 0;
    delete document.body.dataset.risk;
    delete result.dataset.stale;
    result.dataset.state = 'idle';
    arc.style.strokeDashoffset = CIRC.toFixed(2);
    pctNum.textContent = '\u2014';
    riskText.textContent = 'Not scored';
    verdictLine.textContent = '\u00a0';
    leversBox.hidden = true;
    note('');
  }

  /* ---------- server status ---------- */

  function setStatus(state, text) {
    statusEl.dataset.state = state;
    statusText.textContent = text;
  }

  async function watchHealth() {
    setStatus('checking', 'Connecting');
    const slow = setTimeout(() => setStatus('waking', 'Waking up'), 2500);
    try {
      const res = await fetch(`${API}/health`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      setStatus('online', 'Online');
    } catch {
      setStatus('offline', 'Offline');
      setTimeout(watchHealth, 8000);
    } finally {
      clearTimeout(slow);
    }
  }

  /* ---------- start ---------- */

  $('#year').textContent = new Date().getFullYear();
  syncTotal();
  syncDependencies();
  watchHealth();
})();
