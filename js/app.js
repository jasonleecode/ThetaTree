import { rules } from "./alerts/rules.js";
import { load, save, validate } from "./core/storage.js";
import {
  addDays,
  closePosition,
  daysBetween,
  mark,
  units,
  pnl,
} from "./core/portfolio.js";
import { expiryStats } from "./core/payoff.js";
import {
  cash,
  number,
  percent,
  icon,
  pages,
  panel,
  table,
  field,
  esc,
  legName,
} from "./ui/components.js";
import { draw, chartBox, clearChart } from "./ui/charts.js";
import { dashboard, holdings, greekPanel } from "./ui/dashboard.js";
import {
  scenario,
  samples,
  payoffPage,
  labPage,
  rollPage,
} from "./ui/analyzers.js";
import {
  settings,
  riskPage,
  insurancePage,
  journalPage,
} from "./ui/account.js";
import { editor, readPosition, updateEstimate } from "./ui/editor.js";

const app = document.querySelector("#app"),
  dialog = document.querySelector("#dialog");
let b,
  revision = 0,
  symbol = "TQQQ",
  scenarioInputs = {},
  rollInputs = {},
  period = "all",
  dashboardMode = "expiry",
  busy = false;
const titles = [
  "Portfolio overview",
  "Portfolio",
  "Payoff analyzer",
  "Roll analyzer",
  "Antifragility lab",
  "Insurance manager",
  "Risk monitor",
  "Trade journal",
  "Workspace settings",
];
const descriptions = [
  "Harvest Theta. Own Convexity. Survive Uncertainty.",
  "管理股票、期权及组合持仓。",
  "比较标的价格、时间与波动率对损益的影响。",
  "比较平旧开新的现金流、损益与 Greeks。",
  "观察下跌尾部的收益斜率与压力情景。",
  "跟踪保险预算、保费支出和保护结构。",
  "检查指派现金、覆盖水平与保险期限。",
  "按成交区分现金流和已实现收益。",
  "设置账户、模型参数与本地数据。",
];
function page() {
  try {
    const name = decodeURIComponent(location.hash.slice(1));
    return pages.includes(name) ? name : pages[0];
  } catch {
    return pages[0];
  }
}
function notify(message) {
  const el = document.querySelector("#toast");
  el.textContent = message;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => (el.textContent = ""), 4800);
}
function render() {
  clearChart();
  const active = page(),
    idx = pages.indexOf(active);
  document.querySelector("#nav").innerHTML = pages
    .map(
      (n) =>
        '<button data-page="' +
        n +
        '" class="' +
        (n === active ? "active" : "") +
        '" ' +
        (n === active ? 'aria-current="page"' : "") +
        ">" +
        icon(n) +
        n +
        "</button>",
    )
    .join("");
  document.querySelector("#crumb").textContent = active;
  if (!Object.hasOwn(b.quotes, symbol)) symbol = Object.keys(b.quotes)[0];
  const c = scenario(
    b,
    symbol,
    active === "Dashboard"
      ? dashboardMode === "today"
        ? { days: 0 }
        : {}
      : scenarioInputs,
  );
  let content,
    series,
    legs = c.legs,
    spot = c.spot;
  switch (active) {
    case "Dashboard": {
      const subset = c.series.slice(0, 2);
      series = subset;
      const control =
        '<div class="switch"><button data-mode="expiry" class="' +
        (dashboardMode === "expiry" ? "selected" : "") +
        '">到期</button><button data-mode="today" class="' +
        (dashboardMode === "today" ? "selected" : "") +
        '">理论</button></div>';
      content = dashboard(
        b,
        chartBox(series) +
          "<small>" +
          symbol +
          " · " +
          c.date +
          " · 原始成本基准</small>",
        control,
      );
      break;
    }
    case "Portfolio":
      content =
        panel("Open positions", holdings(b.positions, b)) +
        greekPanel(b) +
        panel(
          "Position analytics",
          table(
            [
              "Instrument",
              "Moneyness",
              "Intrinsic",
              "Extrinsic",
              "Break-even",
              "Max profit",
              "Max loss",
              "Notional",
              "Cash secured",
              "ROC¹",
              "年化¹",
            ],
            b.positions.map((p) => {
              const s = b.quotes[p.symbol],
                intrinsic =
                  p.type === "stock"
                    ? 0
                    : Math.max(
                        0,
                        p.type === "put" ? p.strike - s : s - p.strike,
                      ),
                stats = expiryStats([p], b);
              const capital = stats.maxLoss,
                roc =
                  Number.isFinite(capital) && capital > 0
                    ? pnl(p, b) / capital
                    : null,
                days = daysBetween(p.open, b.asOf);
              return [
                p.symbol + " " + legName(p),
                p.type === "stock"
                  ? "—"
                  : s === p.strike
                    ? "ATM"
                    : intrinsic
                      ? "ITM"
                      : "OTM",
                p.type === "stock" ? "—" : cash(intrinsic),
                p.type === "stock" ? "—" : cash(mark(p, b) - intrinsic),
                stats.roots.map(cash).join(" / ") || "—",
                cash(stats.maxProfit),
                cash(stats.maxLoss),
                cash(Math.abs(s * units(p))),
                cash(
                  p.type === "put" && p.quantity < 0 ? -units(p) * p.strike : 0,
                ),
                percent(roc),
                roc !== null && days > 0 ? percent((roc * 365) / days) : "—",
              ];
            }),
          ) +
            '<p class="note">¹ 按单腿最大风险资本计算，年化使用简单折算。跨腿抵消效果见 Payoff Analyzer。</p>',
        );
      break;
    case "Payoff Analyzer":
      content = payoffPage(c, scenarioInputs);
      series = c.series;
      break;
    case "Antifragility Lab":
      content = labPage(c, scenarioInputs, symbol);
      series = c.series;
      break;
    case "Roll Analyzer": {
      const result = rollPage(b, symbol, rollInputs);
      content = result.html;
      series = result.series;
      legs = result.legs;
      spot = b.quotes[symbol];
      break;
    }
    case "Insurance Manager":
      content = insurancePage(scenario(b, symbol, {}), b);
      break;
    case "Risk Monitor":
      content = riskPage(b);
      break;
    case "Trade Journal":
      content = journalPage(b, period);
      break;
    case "Settings":
      content = settings(b);
      break;
  }
  const selector =
    '<select aria-label="分析标的" id="symbol">' +
    Object.keys(b.quotes)
      .map(
        (k) =>
          "<option " + (k === symbol ? "selected" : "") + ">" + k + "</option>",
      )
      .join("") +
    "</select>";
  app.innerHTML =
    '<div class="pagehead"><div><div class="eyebrow">THETATREE / ' +
    (idx === 0 ? "TERMINAL" : active.toUpperCase()) +
    "</div><h1>" +
    titles[idx] +
    '</h1><p class="subtitle">' +
    descriptions[idx] +
    '</p></div><div class="actions">' +
    (idx < 6 ? selector : "") +
    (idx < 2
      ? '<button class="primary" data-add>＋ Add position</button>'
      : "") +
    "</div></div>" +
    content +
    '<div class="foot">USD · 本地估值快照 ' +
    b.asOf +
    " · 初始数据为模拟持仓 · 手动报价 / 欧式 BSM</div>";
  if (series) draw(series, samples(spot, legs), spot);
}
function modal(html) {
  document.querySelector("#modal").innerHTML = html;
  if (!dialog.open) dialog.showModal();
}
async function commit(next) {
  if (busy) throw Error("正在保存，请稍后重试");
  busy = true;
  try {
    revision = await save(next, revision);
    b = next;
    dialog.close();
    scenarioInputs = {};
    rollInputs = {};
    render();
    notify("已保存至本地工作区");
  } finally {
    busy = false;
  }
}
function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
let pendingImport;
function importBook() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.onchange = async () => {
    try {
      pendingImport = validate(JSON.parse(await input.files[0].text()));
      modal(
        "<h2>替换当前账户？</h2><p>导入 " +
          pendingImport.positions.length +
          " 笔持仓、" +
          pendingImport.journal.length +
          ' 笔流水。可先导出当前账户作为备份。</p><div class="actions"><button data-dismiss>取消</button><button data-export>备份当前账户</button><button class="primary" data-confirm-import>确认替换</button></div>',
      );
    } catch (e) {
      notify(e.message);
    }
  };
  input.click();
}
document.addEventListener("click", async (event) => {
  const btn = event.target.closest("button");
  if (!btn || !b) return;
  const d = btn.dataset;
  try {
    if (d.page) {
      location.hash = encodeURIComponent(d.page);
      document.body.classList.remove("open");
      return;
    }
    if (btn.id === "menu") {
      document.body.classList.toggle("open");
      return;
    }
    if (btn.id === "theme") {
      const next =
        document.documentElement.dataset.theme === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      localStorage.setItem("tt-theme", next);
      render();
      return;
    }
    if ("add" in d || d.edit) {
      const p = b.positions.find((p) => p.id === d.edit);
      modal(editor(b, p?.symbol ?? symbol, p));
      updateEstimate(document.querySelector("#positionForm"), b);
    }
    if ("dismiss" in d) dialog.close();
    if (d.close) {
      modal(
        '<h2>确认平仓？</h2><p>按快照估值结清整笔持仓，回款或支出计入现金，已实现盈亏计入交易日志。</p><div class="actions"><button data-dismiss>取消</button><button class="primary" data-confirm-close="' +
          d.close +
          '">确认平仓</button></div>',
      );
    }
    if (d.confirmClose) await commit(closePosition(b, d.confirmClose));
    if ("export" in d)
      download(
        "ThetaTree-" + b.asOf + ".json",
        JSON.stringify(b, null, 2),
        "application/json",
      );
    if ("import" in d) importBook();
    if ("confirmImport" in d && pendingImport) {
      await commit(pendingImport);
      pendingImport = null;
    }
    if ("csv" in d) {
      const keys = [
        "date",
        "event",
        "symbol",
        "type",
        "quantity",
        "cashflow",
        "realized",
      ];
      download(
        "ThetaTree-journal.csv",
        [
          keys.join(","),
          ...b.journal.map((e) => keys.map((k) => e[k]).join(",")),
        ].join("\r\n"),
        "text/csv",
      );
    }
    if (d.mode) {
      dashboardMode = d.mode;
      render();
    }
    if ("qty" in d || "days" in d) {
      const key = "qty" in d ? "qty" : "days";
      scenarioInputs[key] = Number(d[key]);
      render();
    }
    if ("path" in d) {
      scenarioInputs.path = d.path;
      render();
    }
    if ("reset" in d) {
      scenarioInputs = {};
      render();
    }
  } catch (e) {
    notify(e.message);
  }
});
document.addEventListener("change", (event) => {
  const el = event.target;
  if (el.id === "symbol") {
    symbol = el.value;
    scenarioInputs = {};
    rollInputs = {};
    render();
    return;
  }
  if (!el.checkValidity?.() || el.value === "") return;
  const value = el.type === "number" ? el.valueAsNumber : el.value;
  if (el.closest("#scenario,#path")) {
    if (["qty", "days"].includes(el.name) && !Number.isInteger(value)) {
      notify("请输入整数");
      render();
      return;
    }
    scenarioInputs[el.name] = value;
    render();
  }
  if (el.closest("#roll")) {
    if (el.name === "old") rollInputs = { old: value };
    else rollInputs[el.name] = value;
    render();
  }
  if (el.name === "period") {
    period = value;
    render();
  }
});
document.addEventListener("input", (e) => {
  if (e.target.closest("#positionForm")) updateEstimate(e.target.form, b);
});
document.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  try {
    if (form.id === "settings") {
      const f = new FormData(form),
        n = (k) => Number(f.get(k));
      await commit({
        ...b,
        asOf: f.get("asOf"),
        cash: n("cash"),
        rate: n("rate") / 100,
        dividend: n("dividend") / 100,
        budget: n("budget"),
        minimumCoverage: n("minimumCoverage") / 100,
        rules: Object.fromEntries(Object.keys(rules).map((k) => [k, n(k)])),
        thresholds: [0, 1, 2].map((i) => n("dte" + i)),
      });
    }
    if (form.id === "positionForm") {
      const { p, spot, trade } = readPosition(form, b),
        next = structuredClone(b);
      next.quotes[p.symbol] = spot;
      const index = next.positions.findIndex((x) => x.id === p.id);
      const flow = -p.entry * units(p) - p.commission;
      if (index >= 0) {
        next.positions[index] = p;
        const event = next.journal.find(
          (e) => e.event === "Open" && e.positionId === p.id,
        );
        if (event) {
          if (p.open !== event.date) throw Error("已记账交易须保留开仓日期");
          next.cash += flow - event.cashflow;
          Object.assign(event, {
            symbol: p.symbol,
            type: p.type,
            quantity: p.quantity,
            cashflow: flow,
          });
        }
      } else {
        next.positions.push(p);
        if (trade) {
          if (p.open !== b.asOf) throw Error("开仓交易日期须等于估值日");
          next.cash += flow;
          next.journal.push({
            date: b.asOf,
            event: "Open",
            positionId: p.id,
            symbol: p.symbol,
            type: p.type,
            quantity: p.quantity,
            cashflow: flow,
            realized: 0,
          });
        }
      }
      await commit(next);
    }
  } catch (err) {
    if (dialog.open) {
      let msg = form.querySelector("[role=alert]");
      if (!msg) {
        msg = document.createElement("p");
        msg.setAttribute("role", "alert");
        msg.className = "warn";
        form.prepend(msg);
      }
      msg.textContent = err.message;
    } else notify(err.message);
  }
});
window.addEventListener("hashchange", () => {
  if (b) {
    render();
    scrollTo(0, 0);
  }
});
try {
  document.documentElement.dataset.theme =
    localStorage.getItem("tt-theme") ?? "dark";
  const stored = await load();
  if (stored) {
    b = validate(stored.book);
    revision = stored.revision;
  } else {
    const response = await fetch("data/demo.json");
    if (!response.ok) throw Error("演示账户读取失败");
    b = validate(await response.json());
    revision = await save(b, 0);
  }
  render();
} catch (e) {
  app.textContent =
    "无法加载本地工作区：" +
    e.message +
    "。请使用本地 HTTP Server 打开并允许 IndexedDB。";
}
