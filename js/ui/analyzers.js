import {
  field,
  select,
  panel,
  cash,
  line,
  number,
  percent,
  table,
  legName,
  tone,
} from "./components.js";
import { addDays, daysBetween, model, mark, units } from "../core/portfolio.js";
import { payoff, expiryStats } from "../core/payoff.js";
import { aggregate } from "../core/greeks.js";
import { roll } from "../strategy/roll.js";
import { stress, tail, leveragedPath } from "../strategy/antifragility.js";
import { wheel } from "../strategy/wheel.js";
import { chartBox } from "./charts.js";
export const assumption =
  "逐腿按分析日估值。较早到期的腿假设按横轴价格现金结算，所得现金持有至分析日，不计利息。未到期合约采用欧式 BSM 近似。";
export function scenario(b, symbol, s) {
  const legs = b.positions
    .filter((p) => p.symbol === symbol)
    .map((p) => ({ ...p }));
  const put = legs.find((p) => p.type === "put" && p.quantity > 0),
    call = legs.find((p) => p.type === "call");
  if (put) {
    put.quantity = s.qty ?? put.quantity;
    put.strike = s.strike ?? put.strike;
    put.entry = s.entry ?? put.entry;
  }
  if (call) call.strike = s.callStrike ?? call.strike;
  const horizon = legs.reduce(
    (d, p) => Math.max(d, p.expiration ? daysBetween(b.asOf, p.expiration) : 0),
    0,
  );
  const days = s.days ?? horizon,
    date = addDays(b.asOf, days);
  const spot = s.spot ?? b.quotes[symbol],
    book = b;
  const value = (subset, x, day = date) =>
    payoff(subset, book, x, day, s.base ?? "cost", (s.iv ?? 0) / 100);
  const stock = legs.filter((p) => p.type === "stock"),
    series = [
      ["Portfolio", (x) => value(legs, x)],
      ["Stock only", (x) => value(stock, x)],
    ];
  const subtypes = [
    ["Long Put", (p) => p.type === "put" && p.quantity > 0],
    ["Short Put", (p) => p.type === "put" && p.quantity < 0],
    ["Covered Call", (p) => p.type === "call" && p.quantity < 0],
  ];
  for (const [label, test] of subtypes) {
    const group = legs.filter(test);
    if (group.length)
      series.push([
        label,
        (x) =>
          value(label === "Covered Call" ? [...stock, ...group] : group, x),
      ]);
  }
  return { legs, put, call, days, horizon, date, book, spot, series, value };
}
export function samples(spot, legs) {
  const end = Math.max(spot * 2, ...legs.map((p) => (p.strike ?? 0) * 1.15));
  return [
    ...new Set([
      spot,
      ...legs.filter((p) => p.strike).map((p) => p.strike),
      ...Array.from({ length: 121 }, (_, i) => (end * i) / 120),
    ]),
  ].sort((a, b) => a - b);
}
export function controls(c, s) {
  return (
    '<div class="fields" id="scenario">' +
    field("标的参考价 · USD", "spot", c.spot, "number", 'min=".01"') +
    field(
      "分析日距估值日 · 天",
      "days",
      c.days,
      "number",
      'min="0" max="36500"',
    ) +
    field(
      "IV 平移 · 百分点",
      "iv",
      s.iv ?? 0,
      "number",
      'min="-100" max="500"',
    ) +
    select(
      "盈亏基准",
      "base",
      [
        ["cost", "原始成本"],
        ["mark", "当前市值"],
      ],
      s.base ?? "cost",
    ) +
    (c.put
      ? field(
          "首笔 Long Put · 张",
          "qty",
          c.put.quantity,
          "number",
          'min="0"',
        ) +
        field("Put 行权价", "strike", c.put.strike, "number", 'min=".01"') +
        field("Put 入场权利金", "entry", c.put.entry, "number", 'min="0"')
      : "") +
    (c.call
      ? field("Call 行权价", "callStrike", c.call.strike, "number", 'min=".01"')
      : "") +
    '</div><div class="actions"><button data-days="0">估值日</button><button data-days="' +
    c.horizon +
    '">最终到期日</button>' +
    (c.put
      ? [3, 6, 12]
          .map((q) => '<button data-qty="' + q + '">' + q + " 张 Put</button>")
          .join("")
      : "") +
    [7, 30, 90, 180]
      .map((d) => '<button data-days="' + d + '">+' + d + " 天</button>")
      .join("") +
    "<button data-reset>还原情景</button></div>"
  );
}
export function payoffPage(c, s) {
  const stats = expiryStats(c.legs, c.book),
    moves = [0.3, 0.5, 0.75, 1, 1.25, 1.5];
  return (
    panel("Scenario parameters", controls(c, s)) +
    panel(
      "Payoff profile",
      chartBox(c.series) + '<p class="note">' + assumption + "</p>",
      '<span class="pill">' + c.date + "</span>",
    ) +
    panel(
      "到期结构 · 原始成本",
      stats
        ? line("Maximum profit", cash(stats.maxProfit)) +
            line("Maximum loss", cash(stats.maxLoss)) +
            line("Break-even", stats.roots.map(cash).join(" / ") || "—")
        : "不同期限的组合依赖结算路径，见分析日情景曲线。",
    ) +
    panel(
      "P&L heatmap · IV × spot",
      table(
        ["Δ IV", ...moves.map((m) => cash(m * c.spot))],
        [-20, 0, 10, 20, 40].map((v) => [
          v + " pp",
          ...moves.map((m) => {
            const y = payoff(
              c.legs,
              c.book,
              c.spot * m,
              c.date,
              s.base ?? "cost",
              v / 100,
            );
            return (
              '<span class="' +
              tone(y) +
              '" title="IV ' +
              v +
              " pp · S " +
              cash(c.spot * m) +
              '">' +
              cash(y) +
              "</span>"
            );
          }),
        ]),
      )
        .replaceAll(
          '<td><span class="pos"',
          '<td style="background:#32a57720"><span class="pos"',
        )
        .replaceAll(
          '<td><span class="neg"',
          '<td style="background:#d3606820"><span class="neg"',
        ),
    )
  );
}
export function labPage(c, s, symbol) {
  const result = tail(
      c.legs,
      c.book,
      symbol,
      c.date,
      (s.iv ?? 0) / 100,
      c.spot,
    ),
    rows = stress(
      c.legs,
      c.book,
      symbol,
      c.date,
      s.base ?? "cost",
      (s.iv ?? 0) / 100,
      c.spot,
    );
  const w = wheel(c.legs),
    g = aggregate(c.legs, c.book);
  const protective = c.legs.filter((p) => p.type === "put" && p.quantity > 0);
  const putDelta = aggregate(protective, c.book).delta;
  const tailValue = rows[0].pnl;
  const stockLoss = 0.9 * c.spot * Math.max(w.shares, 0);
  const tailFromMark = payoff(
    c.legs,
    c.book,
    c.spot * 0.1,
    c.date,
    "mark",
    (s.iv ?? 0) / 100,
  );
  const path = s.path ?? "-10, -8, 12, 8",
    returns = path.split(",").map((x) => Number(x.trim()) / 100);
  return (
    panel("Stress parameters", controls(c, s)) +
    panel(
      "Tail response",
      chartBox(c.series) +
        line("尾部斜率 · 1%–10% 参考价", number(result.slope) + " 股") +
        line(
          "Long Put 名义覆盖",
          w.shares > 0 ? percent(w.putShares / w.shares) : "—",
        ) +
        line(
          "Delta 调整后保护 · 估值日",
          w.shares > 0 ? percent(-putDelta / w.shares) : "—",
        ) +
        line("下跌 90% · 尾部收益", cash(tailValue)) +
        line(
          "下跌 90% · 相对正股损失减免",
          stockLoss > 0 ? percent(1 + tailFromMark / stockLoss) : "—",
        ) +
        line(
          "组合 Net Gamma / Net Vega",
          number(g.gamma) + " / " + number(g.vega),
        ) +
        line(
          "最大样本压力损失",
          cash(Math.max(0, ...rows.map((r) => -r.pnl))),
        ) +
        '<p class="note">' +
        assumption +
        " 分类比较尾部与参考价附近的斜率，区分尾部凸性与线性空头。</p>",
      '<span class="pill">' + result.label + "</span>",
    ) +
    panel(
      "Price shocks",
      table(
        ["标的变动", "情景价格", "组合 P&L"],
        rows.map((r) => [
          percent(r.move),
          cash(c.spot * (1 + r.move)),
          '<span class="' + tone(r.pnl) + '">' + cash(r.pnl) + "</span>",
        ]),
      ),
    ) +
    (symbol === "TQQQ"
      ? panel(
          "TQQQ · 每日三倍重置",
          '<div id="path" class="fields">' +
            field("指数每日收益率 · %，逗号分隔", "path", path, "text") +
            field(
              "年费率 · %",
              "fee",
              s.fee ?? 0,
              "number",
              'min="0" max="100"',
            ) +
            "</div>" +
            line(
              "模拟 TQQQ 累计收益",
              path.trim() && returns.every((r) => Number.isFinite(r) && r >= -1)
                ? percent(leveragedPath(returns, (s.fee ?? 0) / 100).at(-1) - 1)
                : "请输入有效序列",
            ) +
            '<div class="actions">' +
            Object.entries({
              暴跌反弹: "-12,-8,15,10",
              长期震荡: "3,-3,3,-3,3,-3,3,-3",
              缓慢下跌: "-1,-1,-1,-1,-1,-1,-1",
              连续暴跌: "-8,-10,-12,-8",
            })
              .map(
                ([label, v]) =>
                  '<button data-path="' + v + '">' + label + "</button>",
              )
              .join("") +
            '</div><p class="note">逐日复利，每日费用按 252 个交易日摊销。</p>',
        )
      : "")
  );
}
export function rollPage(b, symbol, s) {
  const legs = b.positions.filter((p) => p.symbol === symbol),
    opts = legs.filter((p) => p.type !== "stock" && p.expiration > b.asOf);
  if (!opts.length)
    return { html: panel("Roll comparison", "需要至少一笔未到期的期权持仓。") };
  const old = opts.find((p) => p.id === s.old) ?? opts[0];
  const candidate = {
    ...old,
    strike: s.newStrike ?? old.strike,
    expiration: s.newDate ?? addDays(old.expiration, 90),
    market: null,
    greeks: null,
    commission: 0,
  };
  candidate.entry = s.newEntry ?? model(candidate, b).price;
  const comparison = roll(old, candidate, b),
    after = legs.map((p) => (p === old ? candidate : p));
  const date = old.expiration;
  const series = [
    ["After roll", (x) => payoff(after, b, x, date) + comparison.realized],
    ["Before roll", (x) => payoff(legs, b, x, date)],
  ];
  const html =
    panel(
      "Candidate contract",
      '<div class="fields" id="roll">' +
        select(
          "当前合约",
          "old",
          opts.map((p) => [p.id, legName(p) + " · " + p.expiration]),
          old.id,
        ) +
        field(
          "新行权价",
          "newStrike",
          candidate.strike,
          "number",
          'min=".01"',
        ) +
        field(
          "新到期日",
          "newDate",
          candidate.expiration,
          "date",
          'min="' + addDays(b.asOf, 1) + '"',
        ) +
        field(
          "新权利金 · 默认理论价",
          "newEntry",
          candidate.entry,
          "number",
          'min="0"',
        ) +
        "</div>" +
        line("旧腿平仓现金流", cash(comparison.close)) +
        line("新腿开仓现金流", cash(comparison.open)) +
        line(
          comparison.net >= 0 ? "Net credit" : "Net debit",
          cash(Math.abs(comparison.net)),
        ) +
        line("旧腿已实现盈亏（假设平仓）", cash(comparison.realized)) +
        line(
          "期限 / 行权价变化",
          daysBetween(old.expiration, candidate.expiration) +
            " 天 / " +
            cash(candidate.strike - old.strike),
        ) +
        line(
          "Greeks 变化 · Δ / Γ / Θ / ν / ρ",
          Object.values(comparison.changes).map(number).join(" / "),
        ),
    ) +
    panel(
      "Before & after",
      chartBox(series) +
        '<p class="note">分析日 ' +
        date +
        "。" +
        assumption +
        " 移仓后曲线计入旧腿已实现盈亏。</p>",
    );
  return { html, series, legs: after };
}
