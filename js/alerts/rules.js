export const levels = ["INFO", "WARNING", "CRITICAL"];
// All percentages here are in percentage points, including premium capture.
export const rules = {
  putGain: [100, "Long Put 止盈评估 · %"],
  tailGain: [300, "Long Put 尾部兑现 · %"],
  putDelta: [0.1, "保护 Put 最低 |Delta|"],
  spotRise: [20, "较开仓标的上涨 · %"],
  ivRise: [20, "较入场 IV 上升 · 百分点"],
  capture: [50, "Short Put 权利金收益 · %"],
  highCapture: [80, "卖方高收益提醒 · %"],
  shortDelta: [0.35, "Short Put 最大 |Delta|"],
  callDelta: [0.7, "Short Call 最大 Delta"],
  nearStrike: [3, "接近行权价 · %"],
  shortDte: [3, "卖方近到期 · 天"],
  shortGamma: [20, "净负 Gamma 警戒 · 股/$1"],
};
export const thresholds = (b) =>
  Object.fromEntries(
    Object.entries(rules).map(([k, [v]]) => [k, b.rules?.[k] ?? v]),
  );
