import { rules, thresholds } from "../alerts/rules.js";
import {
  panel,
  field,
  line,
  cash,
  number,
  percent,
  table,
  select,
} from "./components.js";
import { insurance } from "../strategy/insurance.js";
import { alerts } from "../alerts/engine.js";
import { payoff } from "../core/payoff.js";
import { units } from "../core/portfolio.js";
import { wheel } from "../strategy/wheel.js";
export function settings(b) {
  return (
    '<form id="settings">' +
    panel(
      "Account inputs",
      '<div class="fields">' +
        field("估值日", "asOf", b.asOf, "date", "required") +
        field("快照现金余额 · USD", "cash", b.cash, "number", "required") +
        field("无风险利率 · %", "rate", 100 * b.rate, "number", "required") +
        field(
          "股息率 · %",
          "dividend",
          100 * b.dividend,
          "number",
          "required",
        ) +
        "</div>",
    ) +
    panel(
      "Insurance & reminders",
      '<div class="fields">' +
        field(
          "年度保险预算 · USD",
          "budget",
          b.budget,
          "number",
          'min="0" required',
        ) +
        field(
          "最低覆盖 · %",
          "minimumCoverage",
          100 * b.minimumCoverage,
          "number",
          'min="0" max="100" required',
        ) +
        b.thresholds
          .map((t, i) =>
            field(
              ["续期评估", "重点 Roll", "即将失效"][i] + " · DTE <",
              "dte" + i,
              t,
              "number",
              'required min="1"',
            ),
          )
          .join("") +
        '</div><details><summary>更多提醒阈值</summary><div class="fields">' +
        Object.entries(rules)
          .map(([key, [, label]]) =>
            field(label, key, thresholds(b)[key], "number", 'min="0" required'),
          )
          .join("") +
        '</div></details><button class="primary">保存设置</button>',
    ) +
    "</form>" +
    panel(
      "Workspace data",
      '<div class="actions"><button data-export>导出 JSON</button><button data-import>导入 JSON</button><a href="legacy.html">打开旧版比率价差终端</a></div><p class="note">导入前校验版本、日期、数量、乘数及报价。确认后替换当前本地账户。</p>',
    )
  );
}
export function riskPage(b) {
  const messages = alerts(b);
  return (
    panel(
      "Rule monitor",
      messages.length
        ? messages
            .map(
              (a) =>
                '<div class="riskrow"><div><b>' +
                a.title +
                "</b><small>" +
                a.detail +
                '</small></div><b class="' +
                (a.level === "CRITICAL" ? "neg" : "warn") +
                '">' +
                a.level +
                "</b></div>",
            )
            .join("")
        : '<div class="empty">当前没有触发已配置的规则。</div>',
      '<button data-page="Settings">配置阈值</button>',
    ) +
    panel(
      "Long Put · 续期窗口",
      table(
        ["等级", "触发条件", "评估事项"],
        b.thresholds.map((v, i) => [
          ["INFO", "WARNING", "CRITICAL"][i],
          "DTE < " + v,
          ["保险续期", "移仓时间及成本", "保护即将失效"][i],
        ]),
      ),
    )
  );
}
export function insurancePage(c, b) {
  const ins = insurance(b),
    w = wheel(c.legs);
  const comparisons = c.put
    ? [0, 0.5, 1, 2].map((ratio, i) => {
        const qty = Math.ceil(
            (Math.max(0, w.shares) * ratio) / c.put.multiplier,
          ),
          legs = [
            ...c.legs.filter((p) => p.type !== "put" || p.quantity < 0),
            { ...c.put, quantity: qty },
          ];
        return [
          ["无保险", "部分保险", "全额保险", "超额保险"][i],
          qty,
          cash(qty * c.put.entry * c.put.multiplier),
          cash(payoff(legs, b, c.spot * 0.1, c.date)),
        ];
      })
    : [];
  return (
    panel(
      "Annual insurance budget",
      line("年度保险预算", cash(b.budget)) +
        line("累计保费支出", cash(ins.spent)) +
        line("累计保险回款", cash(ins.proceeds)) +
        line("净保险成本", cash(ins.net)) +
        line("预算剩余", cash(ins.remaining)),
      '<button data-page="Settings">修改预算</button>',
    ) +
    panel(
      "Insurance structures",
      comparisons.length
        ? table(
            ["结构", "Put 数量", "购入成本", "下跌 90% 情景 P&L"],
            comparisons,
          ) +
            '<p class="note">使用首笔 Long Put 的行权价、到期日和入场价替换现有保护腿，按整张向上取整。</p>'
        : "录入 Long Put 后可比较保险结构。",
    )
  );
}
export function journalPage(b, period) {
  const d = new Date(b.asOf),
    year = b.asOf.slice(0, 4),
    month = d.getUTCMonth();
  const since = {
    all: "0000",
    year: year + "-01-01",
    quarter:
      year +
      "-" +
      String(1 + 3 * Math.floor(month / 3)).padStart(2, "0") +
      "-01",
    month: b.asOf.slice(0, 7) + "-01",
    week: new Date(+d - 86400000 * ((d.getUTCDay() + 6) % 7))
      .toISOString()
      .slice(0, 10),
  }[period];
  const rows = b.journal.filter((e) => e.date >= since),
    closed = rows.filter((e) => e.event === "Close"),
    gains = closed.filter((e) => e.realized > 0),
    losses = closed.filter((e) => e.realized < 0),
    sum = (events, key) => events.reduce((s, e) => s + e[key], 0);
  return (
    panel(
      "Trade statistics",
      line("已实现收益", cash(sum(closed, "realized"))) +
        line(
          "期权净现金流",
          cash(
            sum(
              rows.filter((e) => e.type !== "stock"),
              "cashflow",
            ),
          ),
        ) +
        line(
          "胜率",
          closed.length ? percent(gains.length / closed.length) : "—",
        ) +
        line(
          "Profit factor",
          losses.length
            ? number(sum(gains, "realized") / -sum(losses, "realized"))
            : gains.length
              ? "∞"
              : "—",
        ),
      select(
        "统计周期",
        "period",
        [
          ["all", "全部"],
          ["week", "本周"],
          ["month", "本月"],
          ["quarter", "本季度"],
          ["year", "本年"],
        ],
        period,
      ),
    ) +
    panel(
      "Trade ledger",
      rows.length
        ? table(
            ["日期", "事件", "标的", "数量", "现金流", "已实现盈亏"],
            [...rows]
              .reverse()
              .map((e) => [
                e.date,
                e.event,
                e.symbol,
                number(e.quantity),
                cash(e.cashflow),
                cash(e.realized),
              ]),
          )
        : '<p class="empty">暂无成交。期初持仓不产生交易流水。</p>',
      "<button data-csv>导出 CSV</button>",
    )
  );
}
