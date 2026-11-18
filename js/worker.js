/* 문제 생성을 화면과 분리된 스레드에서 실행한다 (큰 격자에서 화면이 멈추지 않게). */
importScripts('engine.js');
self.onmessage = function (e) {
  self.postMessage(self.SudokuEngine.generate(e.data.size, e.data.diff));
};
