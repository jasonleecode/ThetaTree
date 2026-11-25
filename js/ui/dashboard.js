import {
  card,
  panel,
  line,
  table,
  cash,
  number,
  percent,
  tone,
  legName,
} from "./components.js";
import { names, aggregate } from "../core/greeks.js";
import {
  mark,
  pnl,
  totals,
  yearProfit,
  daysBetween,
  addDays,
} from "../core/portfolio.js";
import { risk, shockedExposure } from "../core/risk.js";
import { insurance } from "../strategy/insurance.js";
import { alerts } from "../alerts/engine.js";
export function holdings(positions, b) {
  if (!positions.length)
    return '<p class="empty">暂无持仓。通过 Add position 录入第一笔持仓。</p>';
  return table(
    ["Instrument", "Quantity", "Entry", "Mark", "DTE", "Unrealized P&L", ""],
    positions.map((p) => [
      "<b>" + p.symbol + "</b><small>" + legName(p) + "</small>",
      number(p.quantity),
      cash(p.entry),
      cash(mark(p, b)) +
        "<small>" +
        (p.type === "stock"
          ? "Reference"
          : p.market != null && p.expiration > b.asOf
            ? "Market input"
            : "BSM / intrinsic") +
        "</small>",
      p.expiration ? daysBetween(b.asOf, p.expiration) : "—",
      '<span class="' + tone(pnl(p, b)) + '">' + cash(pnl(p, b)) + "</span>",
      '<button data-edit="' + p.id + '">编辑</button>',
    ]),
  );
}
export function greekPanel(b) {
  const g = aggregate(b.positions, b);
  return panel(
    "Portfolio Greeks",
    '<div class="greekgrid">' +
      names
        .map(
          (k, i) =>
            "<div><span><em>" +
            ["Δ", "Γ", "Θ", "ν", "ρ"][i] +
            "</em>Net " +
            k[0].toUpperCase() +
            k.slice(1) +
            "</span><strong>" +
            number(g[k]) +
            "</strong><small>" +
            [
              "等效股数",
              "股 / $1",
              "USD / 天",
              "USD / 1pp IV",
              "USD / 1pp 利率",
            ][i] +
            "</small></div>",
        )
        .join("") +
      "</div>",
    '<span class="pill">Position-weighted</span>',
  );
}
export function dashboard(b, chart, control) {
  const t = totals(b),
    r = risk(b.positions, b),
    ins = insurance(b);
  const rows = b.journal.filter((e) => e.type !== "stock");
  const premium = (since) =>
    rows.filter((e) => e.date >= since).reduce((s, e) => s + e.cashflow, 0);
  const monday = addDays(b.asOf, -((new Date(b.asOf).getUTCDay() + 6) % 7));
  const coverage = percent(r.coverage),
    ytd = yearProfit(b);
  return (
    '<div class="cards">' +
    card("Net asset value", cash(t.nav), "净资产 · USD", "Portfolio") +
    card(
      "Unrealized P&L",
      cash(t.unrealized),
      "持仓成本基准",
      "Payoff Analyzer",
      tone(t.unrealized),
    ) +
    card("Cash balance", cash(b.cash), "当前现金余额", "cash") +
    card(
      "Hedge coverage",
      coverage,
      "按标的匹配正股",
      "Insurance Manager",
      "pos",
    ) +
    '</div><div class="maincols">' +
    panel("Payoff profile", chart, control) +
    panel(
      "Risk overview",
      '<div class="ringarea"><div class="ring" style="--coverage:' +
        (r.coverage ?? 0) * 100 +
        '%"><b>' +
        coverage +
        "</b></div><div><b>Put protection</b><small>正股名义保护比例</small></div></div>" +
        line("Cash reserve", cash(r.reserve)) +
        line("Assignment exposure", cash(r.assignment)) +
        line("Uncovered calls", number(r.uncovered) + " 股") +
        line(
          "Liquidity risk",
          r.reserve < 0 ? "指派资金不足" : "指派现金充足",
        ) +
        line("Active alerts", String(alerts(b).length)),
    ) +
    "</div>" +
    greekPanel(b) +
    panel(
      "Open positions",
      holdings(b.positions, b),
      '<span class="pill">' + b.positions.length + " legs</span>",
    ) +
    panel(
      "Account activity",
      '<div class="grid2"><div>' +
        line("股票市值", cash(t.stock)) +
        line("期权市值", cash(t.options)) +
        line("已实现收益", cash(t.realized)) +
        line("年度累计交易盈亏", ytd === null ? "缺年初估值" : cash(ytd)) +
        line("全标的 −10% 敞口¹", cash(shockedExposure(b, -0.1))) +
        "</div><div>" +
        line("本周权利金净现金流", cash(premium(monday))) +
        line("本月权利金净现金流", cash(premium(b.asOf.slice(0, 7) + "-01"))) +
        line("年度保险支出", cash(ins.spent)) +
        line("全标的 +10% 敞口¹", cash(shockedExposure(b, 0.1))) +
        "</div></div><small>¹ 同日同 IV 的模型价值变化。流动性指标仅衡量指派资金。</small>",
    )
  );
}
