/* 스도쿠 엔진: 문제 생성(난수 섞기 + 유일해 검증), 풀이, 힌트.
 * 화면 코드와 분리되어 있어 Web Worker(importScripts)와 브라우저/Node 어디서나 쓸 수 있다.
 *
 * 격자 크기 N = 2..12. 상자(box)는 가로x세로가 N을 나누는 모양을 쓴다.
 * 소수(2,3,5,7,11)는 직사각형 상자를 만들 수 없어 "행/열만 겹치지 않는" 라틴 방진 스도쿠가 된다.
 */
(function (root) {
  'use strict';

  // [상자 세로 칸 수, 상자 가로 칸 수]
  const BOX = { 2: [1, 2], 3: [1, 3], 4: [2, 2], 5: [1, 5], 6: [2, 3], 7: [1, 7],
                8: [2, 4], 9: [3, 3], 10: [2, 5], 11: [1, 11], 12: [3, 4] };

  const sym = (v) => (v <= 9 ? String(v) : 'ABC'[v - 10]);
  const range = (n) => Array.from({ length: n }, (_, i) => i);
  const pc = (x) => { let c = 0; while (x) { x &= x - 1; c++; } return c; };

  // ---------- 난수 ----------
  function randInt(n) {
    const c = root.crypto;
    if (c && c.getRandomValues) {
      const a = new Uint32Array(1);
      const lim = Math.floor(0x100000000 / n) * n;
      let x;
      do { c.getRandomValues(a); x = a[0]; } while (x >= lim);
      return x % n;
    }
    return Math.floor(Math.random() * n);
  }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // ---------- 격자 구조 ----------
  const GEO = {};
  function geometry(N) {
    if (GEO[N]) return GEO[N];
    const [br, bc] = BOX[N];
    const hasBox = br > 1 && bc > 1;
    const units = [];
    for (let r = 0; r < N; r++) units.push({ kind: 'row', idx: r, cells: range(N).map((c) => r * N + c) });
    for (let c = 0; c < N; c++) units.push({ kind: 'col', idx: c, cells: range(N).map((r) => r * N + c) });
    if (hasBox) {
      for (let b = 0; b < N / br; b++) for (let s = 0; s < N / bc; s++) {
        const cells = [];
        for (let i = 0; i < br; i++) for (let j = 0; j < bc; j++) cells.push((b * br + i) * N + s * bc + j);
        units.push({ kind: 'box', idx: b * (N / bc) + s, cells });
      }
    }
    const sets = range(N * N).map(() => new Set());
    for (const u of units) for (const a of u.cells) for (const b of u.cells) if (a !== b) sets[a].add(b);
    const peers = sets.map((s) => Int16Array.from(s));
    const unitsOf = range(N * N).map(() => []);
    units.forEach((u, ui) => u.cells.forEach((c) => unitsOf[c].push(ui)));
    return (GEO[N] = { N, br, bc, hasBox, units, peers, unitsOf });
  }

  function candMask(a, g, i) {
    let m = (1 << g.N) - 1;
    const p = g.peers[i];
    for (let k = 0; k < p.length; k++) { const v = a[p[k]]; if (v) m &= ~(1 << (v - 1)); }
    return m;
  }

  // ---------- 해답 판 만들기 (패턴 + 행/열/숫자 섞기) ----------
  function makeSolution(N) {
    const [br, bc] = BOX[N];
    const rowOrder = [], colOrder = [];
    for (const b of shuffle(range(N / br))) for (const i of shuffle(range(br))) rowOrder.push(b * br + i);
    for (const s of shuffle(range(N / bc))) for (const j of shuffle(range(bc))) colOrder.push(s * bc + j);
    const digits = shuffle(range(N)).map((x) => x + 1);
    const sol = new Int8Array(N * N);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const pr = rowOrder[r], pcol = colOrder[c];
      sol[r * N + c] = digits[(bc * (pr % br) + Math.floor(pr / br) + pcol) % N];
    }
    return sol;
  }

  // ---------- 해의 개수 세기 (MRV 백트래킹) ----------
  function countSolutions(grid, N, limit, maxNodes) {
    const g = geometry(N);
    const a = Int8Array.from(grid);
    const cells = N * N;
    let count = 0, nodes = 0, aborted = false;
    function rec() {
      if (aborted) return;
      if (++nodes > maxNodes) { aborted = true; return; }
      let best = -1, bm = 0, bcnt = 99;
      for (let i = 0; i < cells; i++) {
        if (a[i]) continue;
        const m = candMask(a, g, i);
        const c = pc(m);
        if (c === 0) return;
        if (c < bcnt) { bcnt = c; best = i; bm = m; if (c === 1) break; }
      }
      if (best < 0) { count++; return; }
      for (let v = 1; v <= N && count < limit; v++) {
        if (bm & (1 << (v - 1))) { a[best] = v; rec(); a[best] = 0; if (aborted) return; }
      }
    }
    rec();
    return { count, aborted };
  }

  // ---------- 사람 방식 풀이 (하나만 남은 칸 / 유일한 자리) ----------
  function logicSolve(grid, N, allowHidden) {
    const g = geometry(N);
    const a = Int8Array.from(grid);
    const cells = N * N;
    for (;;) {
      let placed = false;
      for (let i = 0; i < cells; i++) {
        if (a[i]) continue;
        const m = candMask(a, g, i);
        if (m && (m & (m - 1)) === 0) { a[i] = Math.log2(m) + 1; placed = true; }
      }
      if (placed) continue;
      if (allowHidden) {
        for (const u of g.units) {
          for (let v = 1; v <= N; v++) {
            if (u.cells.some((c) => a[c] === v)) continue;
            let only = -1, n = 0;
            for (const c of u.cells) {
              if (!a[c] && (candMask(a, g, c) & (1 << (v - 1)))) { only = c; n++; if (n > 1) break; }
            }
            if (n === 1) { a[only] = v; placed = true; }
          }
        }
      }
      if (!placed) break;
    }
    return { solved: a.every((v) => v !== 0), grid: a };
  }

  // ---------- 문제 만들기 ----------
  const BLANK_FRACTION = { easy: 0.4, medium: 0.52, hard: 0.62 };

  /* easy  : "하나만 남은 칸"만으로 풀림
   * medium: 위 + "유일한 자리"로 풀림
   * hard  : 유일해만 보장(더 깊은 추론이나 가정이 필요할 수 있음) */
  function generate(N, diff) {
    const sol = makeSolution(N);
    const cells = N * N;
    const target = Math.max(1, Math.round(cells * BLANK_FRACTION[diff]));
    const grid = Int8Array.from(sol);
    const order = shuffle(range(cells));
    const nodeLimit = N >= 10 ? 30000 : 8000;
    let removed = 0;
    for (const i of order) {
      if (removed >= target) break;
      const keep = grid[i];
      grid[i] = 0;
      let ok;
      if (diff === 'easy') ok = logicSolve(grid, N, false).solved;
      else if (diff === 'medium') ok = logicSolve(grid, N, true).solved;
      else { const r = countSolutions(grid, N, 2, nodeLimit); ok = !r.aborted && r.count === 1; }
      if (ok) removed++; else grid[i] = keep;
    }
    return { size: N, diff, givens: Array.from(grid), solution: Array.from(sol) };
  }

  // ---------- 힌트 ----------
  const UNIT_KO = { row: '가로줄', col: '세로줄', box: '상자' };

  /* values: 학생이 현재 채운 판(0=빈칸). 반환: {type, cells, cell, value, region, text1, text2, text3}
   * type: error(틀린 칸) | naked(하나만 남은 칸) | hidden(유일한 자리) | reveal(쉬운 규칙 없음) | null(완성) */
  function findHint(values, solution, N) {
    const g = geometry(N);
    const a = Int8Array.from(values);
    const wrong = [];
    for (let i = 0; i < a.length; i++) if (a[i] && a[i] !== solution[i]) wrong.push(i);
    if (wrong.length) {
      return { type: 'error', cells: wrong, region: wrong, cell: wrong[0], value: 0,
        text1: '판에 정답과 다른 숫자가 있어요. 지금까지 쓴 숫자를 다시 살펴보세요.',
        text2: '틀린 숫자가 있으면 그 뒤로 풀어도 막혀요. 먼저 틀린 칸을 찾아 고쳐요.',
        text3: `표시된 칸 ${wrong.length}개의 숫자가 틀렸어요. 지우고 다시 생각해 보세요.` };
    }
    const empties = [];
    for (let i = 0; i < a.length; i++) if (!a[i]) empties.push(i);
    if (!empties.length) return null;

    const regionOf = (i) => {
      const s = new Set([i]);
      for (const ui of g.unitsOf[i]) for (const c of g.units[ui].cells) s.add(c);
      return [...s];
    };
    const masks = new Map(empties.map((i) => [i, candMask(a, g, i)]));

    // 1) 하나만 남은 칸
    for (const i of empties) {
      const m = masks.get(i);
      if (m && (m & (m - 1)) === 0) {
        const v = Math.log2(m) + 1;
        const seen = new Set();
        for (const p of g.peers[i]) if (a[p]) seen.add(a[p]);
        const list = [...seen].sort((x, y) => x - y).map(sym).join(', ');
        return { type: 'naked', cell: i, value: v, region: regionOf(i),
          text1: `초록색으로 표시된 가로줄·세로줄${g.hasBox ? '·상자' : ''}에서 이미 쓰인 숫자를 모아 보세요.`,
          text2: '기법 "하나만 남은 칸": 어떤 칸에 들어갈 수 있는 숫자가 하나만 남는 곳을 찾으세요.',
          text3: `표시된 칸의 가로줄·세로줄${g.hasBox ? '·상자' : ''}에 ${list}이(가) 이미 있어서 ${sym(v)}만 들어갈 수 있어요.` };
      }
    }
    // 2) 유일한 자리
    for (const u of g.units) {
      for (let v = 1; v <= N; v++) {
        if (u.cells.some((c) => a[c] === v)) continue;
        const spots = u.cells.filter((c) => !a[c] && (masks.get(c) & (1 << (v - 1))));
        if (spots.length === 1) {
          return { type: 'hidden', cell: spots[0], value: v, region: u.cells.slice(),
            text1: `초록색 ${UNIT_KO[u.kind]}을(를) 살펴보세요.`,
            text2: `기법 "유일한 자리": 이 ${UNIT_KO[u.kind]}에서 숫자 ${sym(v)}이(가) 들어갈 수 있는 칸이 하나뿐이에요. ${sym(v)}의 자리를 찾아보세요.`,
            text3: `이 ${UNIT_KO[u.kind]}에서 ${sym(v)}이(가) 들어갈 수 있는 칸은 표시된 칸뿐이에요.` };
        }
      }
    }
    // 3) 쉬운 규칙이 없을 때: 후보가 가장 적은 칸을 알려 준다
    let best = empties[0];
    for (const i of empties) if (pc(masks.get(i)) < pc(masks.get(best))) best = i;
    return { type: 'reveal', cell: best, value: solution[best], region: regionOf(best),
      text1: '"하나만 남은 칸", "유일한 자리"만으로는 찾을 수 없는 단계예요. 후보 메모를 적어 비교해 보세요.',
      text2: '표시된 칸의 후보를 메모로 적고, 같은 줄에서 겹치는 후보를 지워 보세요.',
      text3: `후보가 가장 적은 칸이에요. 정답은 ${sym(solution[best])}입니다.` };
  }

  root.SudokuEngine = { BOX, geometry, makeSolution, countSolutions, logicSolve, generate, findHint, sym, randInt, shuffle };
})(typeof globalThis !== 'undefined' ? globalThis : this);
