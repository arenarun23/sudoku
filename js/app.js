/* 스도쿠 화면 · 저장 · 진행도 */
(function () {
  'use strict';
  const E = window.SudokuEngine;
  const $ = (s) => document.querySelector(s);
  const sym = E.sym;
  const SIZES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const DIFFS = ['easy', 'medium', 'hard'];
  const DIFF_KO = { easy: '쉬움', medium: '보통', hard: '어려움' };
  const tier = (n) => (n <= 4 ? '초급' : n <= 8 ? '중급' : '고급');
  const keyOf = (size, diff) => size + '-' + diff;
  const fmtTime = (s) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
  };
  const boxLabel = (n) => {
    const [br, bc] = E.BOX[n];
    return br > 1 && bc > 1 ? `상자 ${bc}×${br}` : '상자 없음 (가로·세로만)';
  };

  // ================= 저장소 =================
  const NS = 'aiedu.sudoku.v1';
  const mem = {};
  let storageOK = true;
  function load(k, def) {
    try {
      const v = localStorage.getItem(k);
      if (v != null) return JSON.parse(v);
    } catch (e) { storageOK = false; }
    return k in mem ? JSON.parse(mem[k]) : def;
  }
  function store(k, v) {
    const s = JSON.stringify(v);
    mem[k] = s;
    try { localStorage.setItem(k, s); } catch (e) { storageOK = false; }
  }
  function remove(k) {
    delete mem[k];
    try { localStorage.removeItem(k); } catch (e) { /* 무시 */ }
  }
  const blankData = () => ({
    saves: {}, progress: {},
    settings: { unlockAll: false, showMistakes: true, autoCands: false, seenGuide: false },
  });

  const S = {
    profiles: [], profile: '', data: null,
    game: null, cells: [], sel: -1, notesMode: false,
    undo: [], hint: null, flash: null, timer: null, busy: false,
    screen: 'home', guideFrom: 'home', guidePending: null,
  };

  function loadProfiles() {
    S.profiles = load(NS + '.profiles', null) || ['학생 1'];
    S.profile = load(NS + '.current', null) || S.profiles[0];
    if (!S.profiles.includes(S.profile)) S.profile = S.profiles[0];
    selectProfile(S.profile);
  }
  function selectProfile(name) {
    S.profile = name;
    store(NS + '.current', name);
    let d = load(NS + '.p.' + name, null);
    if (!d || typeof d !== 'object') d = blankData();
    if (!d.saves || typeof d.saves !== 'object') d.saves = {};
    if (!d.progress || typeof d.progress !== 'object') d.progress = {};
    d.settings = Object.assign(blankData().settings, d.settings || {});
    S.data = d;
  }
  const persist = () => store(NS + '.p.' + S.profile, S.data);

  // ================= 공통 UI =================
  function show(id) {
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
    S.screen = id;
    document.body.dataset.screen = id;
    if (id === 'home') renderHome();
    if (id === 'levels') renderLevels();
    window.scrollTo(0, 0);
  }
  let toastT;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('on'), 1800);
  }
  /* buttons: [{label, value, cls}] → 누른 버튼의 value (ESC는 null) */
  function ask(title, body, buttons) {
    return new Promise((res) => {
      const d = $('#dlg');
      d.innerHTML = '';
      const h = document.createElement('h2'); h.textContent = title; d.appendChild(h);
      if (body) { const p = document.createElement('div'); p.className = 'dlg-body'; p.innerHTML = body; d.appendChild(p); }
      const box = document.createElement('div'); box.className = 'dlg-btns'; d.appendChild(box);
      let done = false;
      const finish = (v) => { if (done) return; done = true; if (d.open) d.close(); res(v); };
      for (const b of buttons) {
        const el = document.createElement('button');
        el.type = 'button'; el.textContent = b.label; el.className = b.cls || '';
        el.onclick = () => finish(b.value);
        box.appendChild(el);
      }
      d.onclose = () => finish(null);
      d.showModal();
      const first = box.querySelector('.primary') || box.firstChild;
      if (first) first.focus();
    });
  }

  function renderProfiles() {
    const sel = $('#profileSel');
    sel.innerHTML = '';
    for (const p of S.profiles) {
      const o = document.createElement('option');
      o.value = p; o.textContent = p; o.selected = p === S.profile;
      sel.appendChild(o);
    }
  }

  // ================= 진행도 / 해금 =================
  const prog = (size, diff) => S.data.progress[keyOf(size, diff)];
  const cleared = (size, diff) => !!(prog(size, diff) && prog(size, diff).cleared);
  function unlocked(size, diff) {
    if (S.data.settings.unlockAll) return true;
    const di = DIFFS.indexOf(diff);
    if (di > 0) return unlocked(size, DIFFS[di - 1]) && cleared(size, DIFFS[di - 1]);
    if (size === SIZES[0]) return true;
    return DIFFS.some((d) => cleared(size - 1, d));
  }
  function nextLevel(size, diff) {
    const di = DIFFS.indexOf(diff);
    if (di < 2) return { size, diff: DIFFS[di + 1] };
    if (size < 12) return { size: size + 1, diff: 'easy' };
    return null;
  }
  /* 아직 안 푼 단계 중 열려 있는 가장 앞 단계 */
  function suggestedLevel() {
    for (const size of SIZES) for (const diff of DIFFS) {
      if (!cleared(size, diff) && unlocked(size, diff)) return { size, diff };
    }
    return null;
  }
  const starsText = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

  // ================= 처음 화면 =================
  function progressPct(g) {
    let blanks = 0, ok = 0;
    for (let i = 0; i < g.givens.length; i++) {
      if (g.givens[i]) continue;
      blanks++;
      if (g.values[i] === g.solution[i]) ok++;
    }
    return blanks ? Math.round((ok / blanks) * 100) : 100;
  }
  function renderHome() {
    const box = $('#resumeBox');
    const saves = Object.values(S.data.saves).sort((a, b) => b.updatedAt - a.updatedAt);
    box.innerHTML = '';
    if (saves.length) {
      const h = document.createElement('h2'); h.className = 'sec-title'; h.textContent = '이어하기'; box.appendChild(h);
      const list = document.createElement('div'); list.className = 'resume-list';
      for (const g of saves) {
        const pct = progressPct(g);
        const when = new Date(g.updatedAt);
        const card = document.createElement('div');
        card.className = 'resume-card';
        card.innerHTML = `
          <div class="rc-main">
            <strong>${g.size}×${g.size} · ${DIFF_KO[g.diff]}</strong>
            <span class="muted">${tier(g.size)} · ${fmtTime(g.elapsed)} · 힌트 ${g.hints} · ${when.toLocaleDateString('ko-KR')} ${when.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span>
            <div class="bar"><i style="width:${pct}%"></i></div>
          </div>
          <div class="rc-btns">
            <button type="button" class="primary" data-act="resume">이어하기 ${pct}%</button>
            <button type="button" class="ghost small" data-act="restart">처음부터</button>
            <button type="button" class="ghost small" data-act="new">새 문제</button>
            <button type="button" class="ghost small danger" data-act="del" aria-label="저장 삭제">삭제</button>
          </div>`;
        card.addEventListener('click', async (e) => {
          const act = e.target.dataset && e.target.dataset.act;
          if (act === 'resume') startGame(g);
          else if (act === 'restart') startGame(resetGame(g));
          else if (act === 'new') launch(g.size, g.diff, true);
          else if (act === 'del') {
            const ok = await ask('저장 삭제', `${g.size}×${g.size} ${DIFF_KO[g.diff]} 문제의 저장을 지울까요?`,
              [{ label: '취소', value: false, cls: 'ghost' }, { label: '삭제', value: true, cls: 'danger' }]);
            if (ok) { delete S.data.saves[g.key]; persist(); renderHome(); }
          }
        });
        list.appendChild(card);
      }
      box.appendChild(list);
    }
    const sg = suggestedLevel();
    $('#nextLabel').textContent = sg ? `${sg.size}×${sg.size} ${DIFF_KO[sg.diff]} (${tier(sg.size)})` : '모든 단계를 풀었어요!';
    $('#startNext').disabled = !sg;
    $('#guideBadge').hidden = !!S.data.settings.seenGuide;
    const st = S.data.settings;
    $('#optUnlock').checked = st.unlockAll;
    $('#optMistakes').checked = st.showMistakes;
    $('#optCands').checked = st.autoCands;
  }

  // ================= 단계 선택 =================
  function renderLevels() {
    const list = $('#levelList');
    list.innerHTML = '';
    let lastTier = '';
    for (const size of SIZES) {
      if (tier(size) !== lastTier) {
        lastTier = tier(size);
        const h = document.createElement('h3'); h.className = 'tier'; h.textContent = lastTier; list.appendChild(h);
      }
      const row = document.createElement('div');
      row.className = 'level-row';
      const name = document.createElement('div');
      name.className = 'lv-name';
      name.innerHTML = `<strong>${size}×${size}</strong><span class="muted">${boxLabel(size)}</span>`;
      row.appendChild(name);
      for (const diff of DIFFS) {
        const b = document.createElement('button');
        b.type = 'button';
        const open = unlocked(size, diff);
        const p = prog(size, diff);
        const saved = S.data.saves[keyOf(size, diff)];
        b.className = 'lv-btn' + (p && p.cleared ? ' done' : '') + (saved ? ' saved' : '');
        b.disabled = !open;
        b.innerHTML = `<span>${open ? '' : '🔒 '}${DIFF_KO[diff]}</span>` +
          `<small>${p && p.cleared ? starsText(p.stars) + ' · ' + fmtTime(p.bestTime) : saved ? '풀던 중 ' + progressPct(saved) + '%' : open ? '도전!' : '잠김'}</small>`;
        b.onclick = () => launch(size, diff);
        row.appendChild(b);
      }
      list.appendChild(row);
    }
  }

  // ================= 문제 만들기 / 시작 =================
  function makePuzzle(size, diff) {
    const fallback = (res) => setTimeout(() => res(E.generate(size, diff)), 20);
    return new Promise((res) => {
      let w;
      try { w = new Worker('js/worker.js'); } catch (e) { return fallback(res); }
      const t = setTimeout(() => { w.terminate(); fallback(res); }, 8000);
      w.onmessage = (e) => { clearTimeout(t); w.terminate(); res(e.data); };
      w.onerror = (e) => { e.preventDefault(); clearTimeout(t); w.terminate(); fallback(res); };
      w.postMessage({ size, diff });
    });
  }
  function freshGame(p) {
    const n = p.size * p.size;
    return {
      key: keyOf(p.size, p.diff), size: p.size, diff: p.diff,
      givens: p.givens, solution: p.solution, values: p.givens.slice(),
      notes: new Array(n).fill(0), elapsed: 0, hints: 0, checks: 0,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
  }
  function resetGame(g) {
    return Object.assign({}, g, { values: g.givens.slice(), notes: new Array(g.givens.length).fill(0),
      elapsed: 0, hints: 0, checks: 0, updatedAt: Date.now() });
  }

  /* 단계 시작: 저장된 문제가 있으면 이어하기 / 처음부터 / 새 문제 중 고르게 한다 */
  async function launch(size, diff, forceNew) {
    if (S.busy) return;
    if (!S.data.settings.seenGuide) {
      const c = await ask('스도쿠가 처음이에요?', '게임 방법을 먼저 보면 훨씬 쉬워요. 직접 해 보는 연습 문제도 있어요!',
        [{ label: '📖 게임 방법 먼저 보기', value: 'guide', cls: 'primary' },
         { label: '바로 시작할래요', value: 'go' }]);
      if (c === null) return;
      S.data.settings.seenGuide = true;
      persist();
      if (c === 'guide') { openGuide({ size, diff, forceNew }); return; }
    }
    const saved = S.data.saves[keyOf(size, diff)];
    if (saved && !forceNew) {
      const pct = progressPct(saved);
      const choice = await ask(`${size}×${size} ${DIFF_KO[diff]}`,
        `풀던 문제가 저장되어 있어요. (${pct}% · ${fmtTime(saved.elapsed)})<br>어떻게 할까요?`,
        [{ label: '멈춘 곳부터 이어하기', value: 'resume', cls: 'primary' },
         { label: '같은 문제 처음부터', value: 'restart' },
         { label: '새 문제 섞기', value: 'new' },
         { label: '취소', value: null, cls: 'ghost' }]);
      if (choice === 'resume') return startGame(saved);
      if (choice === 'restart') return startGame(resetGame(saved));
      if (choice !== 'new') return;
    }
    S.busy = true;
    $('#loading').hidden = false;
    try {
      const p = await makePuzzle(size, diff);
      startGame(freshGame(p));
    } finally {
      $('#loading').hidden = true;
      S.busy = false;
    }
  }

  function startGame(g) {
    stopTimer();
    S.game = g;
    S.sel = -1; S.undo = []; S.hint = null; S.flash = null; S.notesMode = false;
    saveGame();
    logEvent('start', g);
    buildBoard();
    show('game');
    render();
    startTimer();
  }

  // ================= 저장 =================
  function saveGame() {
    const g = S.game;
    if (!g) return;
    g.updatedAt = Date.now();
    S.data.saves[g.key] = g;
    persist();
  }
  function startTimer() {
    let tick = 0;
    S.timer = setInterval(() => {
      if (document.hidden || !S.game || $('#game').hidden) return;
      S.game.elapsed++;
      $('#timer').textContent = fmtTime(S.game.elapsed);
      if (++tick % 10 === 0) saveGame();
    }, 1000);
  }
  function stopTimer() { clearInterval(S.timer); S.timer = null; }

  // ================= 판 그리기 =================
  function buildBoard() {
    const g = S.game, N = g.size, geo = E.geometry(N);
    const board = $('#board');
    board.style.setProperty('--n', N);
    board.style.setProperty('--nc', N <= 4 ? 2 : N <= 9 ? 3 : 4);
    board.innerHTML = '';
    S.cells = [];
    for (let i = 0; i < N * N; i++) {
      const r = Math.floor(i / N), c = i % N;
      const el = document.createElement('div');
      el.className = 'cell';
      el.setAttribute('role', 'gridcell');
      el.dataset.i = i;
      if (geo.hasBox && (c + 1) % geo.bc === 0 && c < N - 1) el.classList.add('bR');
      if (geo.hasBox && (r + 1) % geo.br === 0 && r < N - 1) el.classList.add('bB');
      board.appendChild(el);
      S.cells.push(el);
    }
    $('#gameTitle').textContent = `${N}×${N} · ${DIFF_KO[g.diff]}`;
    $('#gameSub').textContent = `${tier(N)} · ${boxLabel(N)}`;
    const pad = $('#pad');
    pad.innerHTML = '';
    pad.style.setProperty('--cols', N <= 6 ? N : Math.ceil(N / 2));
    for (let v = 1; v <= N; v++) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'num'; b.dataset.v = v;
      b.innerHTML = `${sym(v)}<small></small>`;
      pad.appendChild(b);
    }
  }

  function candidates(i) {
    const g = S.game, N = g.size, geo = E.geometry(N);
    let m = (1 << N) - 1;
    for (const p of geo.peers[i]) { const v = g.values[p]; if (v) m &= ~(1 << (v - 1)); }
    return m;
  }

  function render() {
    const g = S.game, N = g.size, geo = E.geometry(N), st = S.data.settings;
    const sel = S.sel;
    const selVal = sel >= 0 ? g.values[sel] : 0;
    const peerSet = sel >= 0 ? new Set(geo.peers[sel]) : new Set();
    const h = S.hint;
    const region = h && h.level < 3 ? new Set(h.region) : new Set(h && h.type === 'error' ? h.cells : []);
    const flash = S.flash ? new Set(S.flash) : null;
    for (let i = 0; i < N * N; i++) {
      const el = S.cells[i];
      const v = g.values[i], given = !!g.givens[i];
      const wrong = v && v !== g.solution[i];
      el.classList.toggle('given', given);
      el.classList.toggle('sel', i === sel);
      el.classList.toggle('peer', peerSet.has(i));
      el.classList.toggle('same', !!selVal && v === selVal && i !== sel);
      el.classList.toggle('wrong', !!wrong && (st.showMistakes || (flash && flash.has(i))));
      el.classList.toggle('hint-region', region.has(i));
      el.classList.toggle('hint-target', !!h && h.level >= 3 && h.type !== 'error' && i === h.cell);
      let html;
      if (v) html = `<span class="v">${sym(v)}</span>`;
      else {
        const m = g.notes[i] || (st.autoCands ? candidates(i) : 0);
        if (m) {
          const auto = !g.notes[i];
          html = `<span class="notes${auto ? ' auto' : ''}">`;
          for (let k = 1; k <= N; k++) html += `<i>${m & (1 << (k - 1)) ? sym(k) : ''}</i>`;
          html += '</span>';
        } else html = '';
      }
      if (el._html !== html) { el.innerHTML = html; el._html = html; }
      el.setAttribute('aria-label', `${Math.floor(i / N) + 1}행 ${i % N + 1}열 ${v ? sym(v) : '빈칸'}${given ? ' (고정)' : ''}`);
    }
    // 숫자판: 남은 개수
    const counts = new Array(N + 1).fill(0);
    for (const v of g.values) if (v) counts[v]++;
    for (const b of document.querySelectorAll('#pad .num')) {
      const v = +b.dataset.v, left = N - counts[v];
      b.querySelector('small').textContent = left > 0 ? left : '';
      b.classList.toggle('used', left <= 0);
    }
    $('#btnNotes').setAttribute('aria-pressed', String(S.notesMode));
    $('#btnNotes').classList.toggle('on', S.notesMode);
    $('#timer').textContent = fmtTime(g.elapsed);
    $('#hintCount').textContent = '힌트 ' + g.hints;
    $('#btnUndo').disabled = !S.undo.length;
    // 힌트 패널
    const panel = $('#hintPanel');
    if (h) {
      panel.hidden = false;
      $('#hintText').textContent = h['text' + h.level];
      for (const s of panel.querySelectorAll('[data-l]')) s.classList.toggle('on', +s.dataset.l <= h.level);
      if (h.level < 3) setTool('#btnHint', '💡', `더 보기 ${h.level + 1}/3`);
      else if (h.type === 'error') setTool('#btnHint', '🧹', '틀린 것 지우기');
      else setTool('#btnHint', '✔️', '정답 넣기');
    } else {
      panel.hidden = true;
      setTool('#btnHint', '💡', '힌트');
    }
  }

  function setTool(sel, icon, label) {
    const b = $(sel);
    b.querySelector('.ti').textContent = icon;
    b.querySelector('.tl').textContent = label;
  }

  // ================= 게임 방법 =================
  // 4×4 예시 판(상자 2×2). 0 = 연습판의 빈칸
  const G_SOL = [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1];
  const G_BLANK = [1, 6, 8, 11, 15];
  const G_RULE = { row: [4, 5, 6, 7], col: [2, 6, 10, 14], box: [10, 11, 14, 15] };
  const P = { values: [], sel: -1, cells: [], done: false };

  function miniBoard(el, values, cls) {
    el.style.setProperty('--n', 4);
    el.innerHTML = '';
    const cells = [];
    for (let i = 0; i < 16; i++) {
      const c = document.createElement('div');
      const r = Math.floor(i / 4), col = i % 4;
      c.className = 'cell' + (col === 1 ? ' bR' : '') + (r === 1 ? ' bB' : '') + (values[i] ? ' given' : '');
      if (cls && cls[i]) c.classList.add(cls[i]);
      c.textContent = values[i] ? String(values[i]) : '';
      el.appendChild(c);
      cells.push(c);
    }
    return cells;
  }
  function buildGuide() {
    const q = G_SOL.map((v, i) => (G_BLANK.includes(i) ? 0 : v));
    miniBoard($('#gDemoQ'), q);
    miniBoard($('#gDemoA'), G_SOL);
    for (const [id, key] of [['#gRuleRow', 'row'], ['#gRuleCol', 'col'], ['#gRuleBox', 'box']]) {
      const cls = {};
      G_RULE[key].forEach((i) => (cls[i] = 'rule-hl'));
      miniBoard($(id), G_SOL, cls);
    }
    const pad = $('#pPad');
    pad.innerHTML = '';
    for (let v = 1; v <= 4; v++) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'num'; b.dataset.v = v; b.textContent = v;
      pad.appendChild(b);
    }
    resetPractice();
  }
  function resetPractice() {
    P.values = G_SOL.map((v, i) => (G_BLANK.includes(i) ? 0 : v));
    P.sel = -1; P.done = false;
    P.cells = miniBoard($('#pBoard'), P.values);
    P.cells.forEach((c, i) => { c.dataset.i = i; if (!P.values[i]) c.classList.add('blank'); });
    practiceMsg('빈칸을 하나 골라 보세요.', '');
    renderPractice();
  }
  function renderPractice(bad) {
    const geo = E.geometry(4);
    const peers = P.sel >= 0 ? new Set(geo.peers[P.sel]) : new Set();
    P.cells.forEach((c, i) => {
      c.classList.toggle('sel', i === P.sel);
      c.classList.toggle('peer', peers.has(i));
      c.classList.toggle('wrong', !!bad && bad.includes(i));
      if (!c.classList.contains('given')) c.textContent = P.values[i] ? String(P.values[i]) : '';
    });
  }
  function practiceMsg(text, kind) {
    const m = $('#pMsg');
    m.textContent = text;
    m.className = 'p-msg' + (kind ? ' ' + kind : '');
  }
  function practiceInput(v) {
    if (P.done) return;
    const i = P.sel;
    if (i < 0 || !G_BLANK.includes(i)) { practiceMsg('먼저 빈칸을 눌러 주세요.', 'warn'); return; }
    if (P.values[i] === G_SOL[i]) { practiceMsg('이 칸은 벌써 맞혔어요! 다른 빈칸을 골라요.', ''); return; }
    if (v === G_SOL[i]) {
      P.values[i] = v;
      P.cells[i].classList.add('ok');
      const left = G_BLANK.filter((k) => P.values[k] !== G_SOL[k]).length;
      if (!left) {
        P.done = true; P.sel = -1;
        renderPractice();
        practiceMsg('🎉 다 채웠어요! 약속 3가지를 모두 지켰어요. 이제 진짜 문제를 풀어 볼까요?', 'good');
        return;
      }
      renderPractice();
      practiceMsg(`딩동댕! ${E.iga(v)} 맞았어요 👏 빈칸이 ${left}개 남았어요.`, 'good');
      return;
    }
    // 어느 약속을 어겼는지 알려 준다
    const geo = E.geometry(4);
    const r = Math.floor(i / 4), c = i % 4;
    const row = [0, 1, 2, 3].map((k) => r * 4 + k), col = [0, 1, 2, 3].map((k) => k * 4 + c);
    const box = geo.units.find((u) => u.kind === 'box' && u.cells.includes(i)).cells;
    const hit = (cells) => cells.filter((k) => k !== i && P.values[k] === v);
    let msg, bad;
    if ((bad = hit(row)).length) msg = `앗! 이 가로줄에 ${E.iga(v)} 벌써 있어요.`;
    else if ((bad = hit(col)).length) msg = `앗! 이 세로줄에 ${E.iga(v)} 벌써 있어요.`;
    else if ((bad = hit(box)).length) msg = `앗! 이 굵은 선 상자에 ${E.iga(v)} 벌써 있어요.`;
    else { bad = []; msg = `${v}도 들어갈 것 같지만 정답이 아니에요. 다른 빈칸부터 채우고 다시 생각해 봐요.`; }
    renderPractice(bad);
    practiceMsg(msg, 'warn');
  }
  function openGuide(pending) {
    if (S.screen !== 'guide') S.guideFrom = S.screen;
    S.guidePending = pending || null;
    if (!S.data.settings.seenGuide) { S.data.settings.seenGuide = true; persist(); }
    if (S.game && S.screen === 'game') saveGame();
    show('guide');
    $('#guideStart').textContent = S.guideFrom === 'game' && S.game ? '🎮 풀던 문제로 돌아가기' : '🎮 이제 문제 풀러 가기';
  }
  function closeGuide(start) {
    const pending = S.guidePending;
    S.guidePending = null;
    if (pending) { if (start) launch(pending.size, pending.diff, pending.forceNew); else show('home'); return; }
    if (S.guideFrom === 'game' && S.game) { show('game'); render(); return; }
    if (start) { const sg = suggestedLevel() || { size: 2, diff: 'easy' }; launch(sg.size, sg.diff); return; }
    show(S.guideFrom === 'levels' ? 'levels' : 'home');
  }

  // ================= 입력 =================
  function change(list) {
    // list: [{i, v, n}] 바꿀 값. 되돌리기를 위해 이전 값을 함께 기록한다.
    const g = S.game;
    const rec = list.map((c) => ({ i: c.i, v: g.values[c.i], n: g.notes[c.i] }));
    let changed = false;
    for (const c of list) {
      if (g.values[c.i] !== c.v || g.notes[c.i] !== c.n) changed = true;
      g.values[c.i] = c.v; g.notes[c.i] = c.n;
    }
    if (!changed) return;
    S.undo.push(rec);
    if (S.undo.length > 300) S.undo.shift();
    S.hint = null; S.flash = null;
    saveGame();
    render();
    checkWin();
  }

  function input(v) {
    const g = S.game, i = S.sel;
    if (i < 0 || g.givens[i]) return;
    if (S.notesMode && !g.values[i]) {
      change([{ i, v: 0, n: g.notes[i] ^ (1 << (v - 1)) }]);
      return;
    }
    if (g.values[i] === v) { change([{ i, v: 0, n: g.notes[i] }]); return; }
    const list = [{ i, v, n: 0 }];
    // 같은 줄·상자 메모에서 이 숫자를 지워 준다
    const bit = 1 << (v - 1);
    for (const p of E.geometry(g.size).peers[i]) if (g.notes[p] & bit) list.push({ i: p, v: g.values[p], n: g.notes[p] & ~bit });
    change(list);
  }
  function erase() {
    const g = S.game, i = S.sel;
    if (i < 0 || g.givens[i]) return;
    change([{ i, v: 0, n: 0 }]);
  }
  function undo() {
    const rec = S.undo.pop();
    if (!rec) return;
    const g = S.game;
    for (let k = rec.length - 1; k >= 0; k--) { g.values[rec[k].i] = rec[k].v; g.notes[rec[k].i] = rec[k].n; }
    S.hint = null;
    saveGame();
    render();
  }
  function moveSel(dr, dc) {
    const N = S.game.size;
    if (S.sel < 0) S.sel = 0;
    else {
      const r = (Math.floor(S.sel / N) + dr + N) % N, c = (S.sel % N + dc + N) % N;
      S.sel = r * N + c;
    }
    render();
  }

  // ================= 힌트 / 검사 =================
  function hint() {
    const g = S.game;
    const h = S.hint;
    if (h && h.level < 3) { h.level++; if (h.type !== 'error') S.sel = h.level >= 3 ? h.cell : S.sel; render(); return; }
    if (h && h.level >= 3) {
      if (h.type === 'error') change(h.cells.map((i) => ({ i, v: 0, n: 0 })));
      else {
        S.sel = h.cell;
        const bit = 1 << (h.value - 1);
        const list = [{ i: h.cell, v: h.value, n: 0 }];
        for (const p of E.geometry(g.size).peers[h.cell]) if (g.notes[p] & bit) list.push({ i: p, v: g.values[p], n: g.notes[p] & ~bit });
        change(list);
      }
      return;
    }
    const found = E.findHint(g.values, g.solution, g.size);
    if (!found) return;
    found.level = 1;
    S.hint = found;
    g.hints++;
    saveGame();
    render();
  }
  function check() {
    const g = S.game;
    const wrong = [];
    g.values.forEach((v, i) => { if (v && v !== g.solution[i]) wrong.push(i); });
    g.checks++;
    if (!wrong.length) { toast('지금까지 틀린 숫자가 없어요! 👍'); saveGame(); return; }
    S.flash = wrong;
    render();
    toast(`틀린 칸이 ${wrong.length}개 있어요`);
    setTimeout(() => { S.flash = null; render(); }, 2500);
    saveGame();
  }

  // ================= 완료 =================
  async function checkWin() {
    const g = S.game;
    for (let i = 0; i < g.values.length; i++) if (g.values[i] !== g.solution[i]) return;
    stopTimer();
    const stars = g.hints === 0 ? 3 : g.hints <= 2 ? 2 : 1;
    const p = S.data.progress[g.key] || { cleared: 0, bestTime: null, stars: 0 };
    const newBest = p.bestTime == null || g.elapsed < p.bestTime;
    p.cleared++;
    if (newBest) p.bestTime = g.elapsed;
    p.stars = Math.max(p.stars, stars);
    p.lastAt = Date.now();
    S.data.progress[g.key] = p;
    delete S.data.saves[g.key];
    persist();
    logEvent('finish', g);
    S.cells.forEach((el) => el.classList.add('win'));
    const nx = nextLevel(g.size, g.diff);
    const canNext = nx && unlocked(nx.size, nx.diff);
    const btns = [];
    if (canNext) btns.push({ label: `다음 단계 (${nx.size}×${nx.size} ${DIFF_KO[nx.diff]})`, value: 'next', cls: 'primary' });
    btns.push({ label: '같은 단계 새 문제', value: 'again', cls: canNext ? '' : 'primary' });
    btns.push({ label: '단계 선택', value: 'levels', cls: 'ghost' });
    const choice = await ask('완성했어요! 🎉',
      `<p class="stars">${starsText(stars)}</p><p>${g.size}×${g.size} ${DIFF_KO[g.diff]} · 걸린 시간 ${fmtTime(g.elapsed)}${newBest ? ' (최고 기록!)' : ''} · 힌트 ${g.hints}번</p>` +
      '<p class="muted">힌트 없이 풀면 별 3개, 힌트 2번 이하면 별 2개예요.</p>', btns);
    S.game = null;
    if (choice === 'next') launch(nx.size, nx.diff);
    else if (choice === 'again') launch(g.size, g.diff, true);
    else show(choice === 'levels' ? 'levels' : 'home');
  }

  // ================= 이벤트 연결 =================
  function exitGame() {
    if (S.game) { saveGame(); toast('저장했어요. 다음에 이어서 풀 수 있어요.'); }
    stopTimer();
    S.game = null;
    show('home');
  }

  function bind() {
    $('#homeBtn').onclick = () => (S.game ? exitGame() : show('home'));
    document.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => show(b.dataset.go)));
    $('#startPick').onclick = () => show('levels');
    $('#openGuide').onclick = () => openGuide();
    $('#gameGuide').onclick = () => openGuide();
    $('#guideBack').onclick = () => closeGuide(false);
    $('#guideStart').onclick = () => closeGuide(true);
    $('#pReset').onclick = resetPractice;
    $('#pBoard').addEventListener('click', (e) => {
      const c = e.target.closest('.cell');
      if (!c || P.done) return;
      const i = +c.dataset.i;
      P.sel = i;
      renderPractice();
      if (!G_BLANK.includes(i)) practiceMsg('이 칸은 처음부터 있던 숫자예요. 빈칸을 골라 주세요.', '');
      else if (P.values[i]) practiceMsg('이 칸은 벌써 맞혔어요!', 'good');
      else practiceMsg('좋아요! 이제 아래에서 숫자를 골라요. 가로줄·세로줄·상자에 없는 숫자는 뭘까요?', '');
    });
    $('#pPad').addEventListener('click', (e) => {
      const b = e.target.closest('.num');
      if (b) practiceInput(+b.dataset.v);
    });
    $('#startFirst').onclick = () => launch(2, 'easy');
    $('#startNext').onclick = () => { const s = suggestedLevel(); if (s) launch(s.size, s.diff); };
    $('#optUnlock').onchange = (e) => { S.data.settings.unlockAll = e.target.checked; persist(); renderHome(); };
    $('#optMistakes').onchange = (e) => { S.data.settings.showMistakes = e.target.checked; persist(); };
    $('#optCands').onchange = (e) => { S.data.settings.autoCands = e.target.checked; persist(); };
    $('#resetProfile').onclick = async () => {
      const ok = await ask('기록 지우기', `<b>${escapeHtml(S.profile)}</b> 학생의 진행 기록과 저장된 문제를 모두 지울까요? 되돌릴 수 없어요.`,
        [{ label: '취소', value: false, cls: 'ghost' }, { label: '모두 지우기', value: true, cls: 'danger' }]);
      if (ok) { S.data = blankData(); persist(); renderHome(); toast('기록을 지웠어요'); }
    };
    $('#profileSel').onchange = (e) => { if (S.game) exitGame(); selectProfile(e.target.value); renderProfiles(); show('home'); };
    $('#addProfile').onclick = () => {
      const name = (window.prompt('학생 이름(또는 번호)을 입력하세요') || '').trim().slice(0, 20);
      if (!name) return;
      if (!S.profiles.includes(name)) { S.profiles.push(name); store(NS + '.profiles', S.profiles); }
      if (S.game) exitGame();
      selectProfile(name); renderProfiles(); show('home');
    };

    $('#board').addEventListener('click', (e) => {
      const c = e.target.closest('.cell');
      if (!c) return;
      S.sel = +c.dataset.i;
      render();
    });
    $('#pad').addEventListener('click', (e) => {
      const b = e.target.closest('.num');
      if (b) input(+b.dataset.v);
    });
    $('#btnNotes').onclick = () => { S.notesMode = !S.notesMode; render(); };
    $('#btnErase').onclick = erase;
    $('#btnUndo').onclick = undo;
    $('#btnHint').onclick = hint;
    $('#btnCheck').onclick = check;
    $('#btnSave').onclick = () => { saveGame(); toast(storageOK ? '저장했어요' : '이 브라우저는 저장할 수 없어요'); };
    $('#exitGame').onclick = exitGame;
    $('#btnRestart').onclick = async () => {
      const ok = await ask('이 문제 처음부터', '지금까지 쓴 숫자와 메모, 시간이 지워지고 같은 문제를 처음부터 풀어요.',
        [{ label: '취소', value: false, cls: 'ghost' }, { label: '처음부터', value: true, cls: 'primary' }]);
      if (ok) startGame(resetGame(S.game));
    };
    $('#btnNew').onclick = async () => {
      const g = S.game;
      const ok = await ask('새 문제', '지금 문제는 버리고 같은 단계의 새 문제를 섞어요.',
        [{ label: '취소', value: false, cls: 'ghost' }, { label: '새 문제', value: true, cls: 'primary' }]);
      if (ok) launch(g.size, g.diff, true);
    };

    document.addEventListener('keydown', (e) => {
      if (!S.game || $('#game').hidden || $('#dlg').open) return;
      const k = e.key;
      const N = S.game.size;
      if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      let v = 0;
      if (/^[1-9]$/.test(k)) v = +k;
      else if (/^[abcABC]$/.test(k)) v = 10 + 'abc'.indexOf(k.toLowerCase());
      if (v) { if (v <= N) { input(v); e.preventDefault(); } return; }
      const mv = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k];
      if (mv) { e.preventDefault(); moveSel(mv[0], mv[1]); return; }
      if (k === 'Backspace' || k === 'Delete' || k === '0') { e.preventDefault(); erase(); return; }
      if (k === 'n' || k === 'N') { S.notesMode = !S.notesMode; render(); }
    });
    // 탭을 닫거나 숨길 때 저장
    const flush = () => { if (S.game) saveGame(); };
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
    window.addEventListener('pagehide', flush);
  }
  /* AIEDU 익명 이용 기록: 이벤트 종류와 "크기-난이도" 태그만 보낸다(학생 이름·입력 숫자는 보내지 않음) */
  function logEvent(type, g) {
    try { if (window.aieduLog) window.aieduLog(type, g.size + '-' + g.diff); } catch (e) { /* 기록 실패는 무시 */ }
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ================= 시작 =================
  loadProfiles();
  renderProfiles();
  bind();
  buildGuide();
  if (location.hash === '#guide') { S.data.settings.seenGuide = true; persist(); show('guide'); } else show('home');
  if (!storageOK) $('#storageWarn').hidden = false;
})();
