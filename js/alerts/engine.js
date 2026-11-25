import { daysBetween, mark, model, units } from "../core/portfolio.js";
import { risk } from "../core/risk.js";
import { aggregate } from "../core/greeks.js";
import { insurance } from "../strategy/insurance.js";
import { levels, thresholds } from "./rules.js";
export function alerts(b) {
  const out = [],
    t = thresholds(b);
  const add = (level, title, detail) => out.push({ level, title, detail });
  const fmt = (x) => Number(x.toFixed(2));
  for (const p of b.positions.filter((p) => p.type !== "stock")) {
    const d = daysBetween(b.asOf, p.expiration),
      spot = b.quotes[p.symbol],
      price = mark(p, b);
    const delta = Math.abs(p.greeks?.delta ?? model(p, b).delta);
    const gain =
      p.entry > 0 ? (price / p.entry - 1) * 100 * Math.sign(p.quantity) : 0;
    const emit = (level, title, detail) =>
      add(level, p.symbol + " · " + title, detail);
    if (p.type === "put" && p.quantity > 0) {
      const i = b.thresholds.reduce((last, v, j) => (d < v ? j : last), -1);
      if (i >= 0)
        emit(
          levels[i],
          "保护期限",
          "DTE " +
            d +
            " < " +
            b.thresholds[i] +
            " 天。评估续期成本与延长保护后的 Vega 敞口。",
        );
      if (gain > t.putGain || gain > t.tailGain) {
        const tail = gain > t.tailGain;
        emit(
          tail ? "WARNING" : "INFO",
          "保险兑现",
          "浮盈 " +
            fmt(gain) +
            "% > " +
            (tail ? t.tailGain : t.putGain) +
            "%。部分止盈可回收保费，也会降低剩余覆盖。",
        );
      }
      if (delta < t.putDelta)
        emit(
          "INFO",
          "保护距离",
          "|Delta| " +
            fmt(delta) +
            " < " +
            t.putDelta +
            "。提高行权价可增加近端保护和保费。",
        );
      const rise = (spot / p.entrySpot - 1) * 100;
      if (p.entrySpot != null && rise > t.spotRise)
        emit(
          "INFO",
          "保险行权价复核",
          "较入场上涨 " +
            fmt(rise) +
            "% > " +
            t.spotRise +
            "%。提高行权价可提高保护底线。",
        );
      const volRise = (p.iv - p.entryIv) * 100;
      if (p.entryIv != null && volRise > t.ivRise)
        emit(
          "INFO",
          "保险波动率复核",
          "IV 上升 " +
            fmt(volRise) +
            "pp > " +
            t.ivRise +
            "pp。兑现可降低 Vega 和尾部保护。",
        );
    }
    if (p.quantity >= 0) continue;
    const put = p.type === "put",
      limit = put ? t.shortDelta : t.callDelta;
    if (gain >= t.highCapture || (put && gain >= t.capture))
      emit(
        "INFO",
        "权利金收益",
        "已获取 " +
          fmt(gain) +
          "% ≥ " +
          (gain >= t.highCapture ? t.highCapture : t.capture) +
          "%。回补可锁定已获权利金并释放义务。",
      );
    if (delta > limit)
      emit(
        "WARNING",
        "卖方方向敞口",
        "|Delta| " + fmt(delta) + " > " + limit + "。回补可降低方向敞口。",
      );
    const distance =
      ((put ? spot - p.strike : p.strike - spot) / p.strike) * 100;
    if (distance <= t.nearStrike)
      emit(
        "WARNING",
        "近期指派压力",
        "距行权价的虚值空间 " +
          fmt(distance) +
          "% ≤ " +
          t.nearStrike +
          "%。检查现金或可交割股票。",
      );
    if (d < t.shortDte)
      emit(
        "WARNING",
        "卖方临近到期",
        "DTE " + d + " < " + t.shortDte + "。回补可消除到期指派义务。",
      );
    if (!put && spot > p.strike && d > 0)
      emit(
        "INFO",
        "提前指派可能",
        "参考价 $" +
          spot +
          " > 行权价 $" +
          p.strike +
          "。美式实值 Call 可能提前指派，回补将解除交割义务。",
      );
    if (!put) {
      const shares = b.positions.filter(
        (l) => l.symbol === p.symbol && l.type === "stock" && l.quantity > 0,
      );
      const total = shares.reduce((s, l) => s + units(l), 0);
      const cost = shares.reduce((s, l) => s + units(l) * l.entry, 0) / total;
      if (p.strike < cost)
        emit(
          "WARNING",
          "行权价低于持股成本",
          "$" +
            p.strike +
            " < 均价 $" +
            fmt(cost) +
            "。提高行权价可减轻指派时的股票亏损。",
        );
    }
  }
  const r = risk(b.positions, b);
  if (r.reserve < 0)
    add(
      "CRITICAL",
      "指派现金不足",
      "现金缺口 $" + fmt(-r.reserve) + "。减少 Short Put 可降低指派义务。",
    );
  if (r.uncovered > 0)
    add(
      "CRITICAL",
      "卖出 Call 覆盖不足",
      r.uncovered + " 股缺乏覆盖。减仓可降低上行风险。",
    );
  if (r.coverage !== null && r.coverage < b.minimumCoverage)
    add(
      "WARNING",
      "股票保险覆盖不足",
      fmt(100 * r.coverage) +
        "% < " +
        fmt(100 * b.minimumCoverage) +
        "%。增购保护可提高覆盖，同时增加成本。",
    );
  const spent = insurance(b).spent;
  if (spent > b.budget)
    add(
      "WARNING",
      "年度保险预算超限",
      "$" +
        fmt(spent) +
        " > $" +
        b.budget +
        "。缩减新增保费可控制成本，同时减少新增保护。",
    );
  const gamma = aggregate(b.positions, b).gamma;
  if (gamma < -t.shortGamma)
    add(
      "WARNING",
      "组合净负 Gamma",
      fmt(gamma) +
        " < −" +
        t.shortGamma +
        "。减少卖方合约可降低剧烈波动时的再对冲需求。",
    );
  return out;
}
