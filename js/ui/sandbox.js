import { openSandbox } from "../core/sandbox-storage.js";
import {
  panel,
  card,
  table,
  select,
  field,
  line,
  cash,
  number,
  tone,
  esc,
} from "./components.js";
import { chartBox, draw } from "./charts.js";
const E = globalThis.ThetaEngine;
const button = (key, text, disabled = false) =>
  '<button type="button" data-sb="' +
  key +
  '" ' +
  (disabled ? "disabled" : "") +
  ">" +
  text +
  "</button>";
const actions = (...parts) =>
  '<div class="actions">' + parts.join("") + "</div>";
const format = (n) => (Number.isFinite(n) ? cash(n) : n < 0 ? "−∞" : "+∞");
function slider(key, label, value, min, max, step) {
  return (
    "<label>" +
    label +
    '<output data-output="' +
    key +
    '">' +
    value +
    '</output><input aria-label="' +
    label +
    '" type="range" name="' +
    key +
    '" min="' +
    min +
    '" max="' +
    max +
    '" step="' +
    step +
    '" value="' +
    value +
    '"></label>'
  );
}
function legInput(leg, key, min, max, step) {
  return (
    '<input type="number" aria-label="' +
    key +
    " 模拟腿 " +
    leg.id +
    '" data-leg="' +
    leg.id +
    '" name="' +
    key +
    '" min="' +
    min +
    '" max="' +
    max +
    '" step="' +
    step +
    '" value="' +
    Number(leg[key].toFixed(6)) +
    '">'
  );
}
export function mountSandbox(root) {
  let state,
    off,
    asset,
    w,
    quote,
    quoteError = "",
    live = false,
    abort,
    timer,
    disposed = false;
  const $ = (s) => root.querySelector(s);
  const scenario = () =>
    quote ? { ...w.scenario, s: quote.price } : w.scenario;
  const message = (text) => {
    $("[data-message]").textContent = text;
  };
  function status() {
    if (!state || !$("[data-save]")) return;
    $("[data-save]").textContent = state.error
      ? "未保存：" + state.error
      : state.saving
        ? "正在保存…"
        : state.local
          ? "浏览器本地保存"
          : "已保存至 SQLite";
    $("[data-retry]").hidden = !state.error;
  }
  function targets() {
    const short = w.book.legs
      .filter((l) => l.type === "put" && l.qty < 0)
      .sort((a, b) => b.strike - a.strike)[0];
    const protection = w.book.legs.find((l) => l.tag === "protection");
    const strikes = E.assetStrikes(asset);
    return {
      short,
      protection,
      strikes,
      put: Math.max(
        0.01,
        E.roundPrice((short?.strike ?? strikes.short) - asset.gap),
      ),
      roll: short
        ? Math.max(
            0.01,
            E.roundPrice(
              short.strike - Math.max(0.01, E.roundPrice(asset.gap / 2)),
            ),
          )
        : null,
    };
  }
  function legsTable() {
    return table(
      [
        "类型",
        "数量",
        "行权价",
        "每股入场价",
        "理论价",
        "Delta · 股",
        "浮动盈亏",
        "",
      ],
      w.book.legs.map((l) => [
        '<select aria-label="模拟腿类型" data-leg="' +
          l.id +
          '" name="type">' +
          ["put", "call", "stock"]
            .map(
              (t) =>
                "<option " +
                (l.type === t ? "selected" : "") +
                ">" +
                t +
                "</option>",
            )
            .join("") +
          "</select>",
        legInput(
          l,
          "qty",
          l.type === "stock" ? -Number.MAX_SAFE_INTEGER : -10000,
          l.type === "stock" ? Number.MAX_SAFE_INTEGER : 10000,
          1,
        ),
        l.type === "stock" ? "—" : legInput(l, "strike", 0.01, 10000, "any"),
        legInput(l, "entry", 0, 100000, "any"),
        '<span data-leg-price="' + l.id + '"></span>',
        '<span data-leg-delta="' + l.id + '"></span>',
        '<span data-leg-pnl="' + l.id + '"></span>',
        button("close-" + l.id, "平仓"),
      ]),
    );
  }
  function build() {
    const item = state.store.assets.find(
      (i) => i.config.symbol === state.store.active,
    );
    asset = item.config;
    w = item.workspace;
    root.innerHTML =
      panel(
        "模拟工作区",
        actions(
          select(
            "当前标的",
            "sbAsset",
            state.store.assets.map((i) => [
              i.config.symbol,
              i.config.symbol + " · " + i.config.name,
            ]),
            asset.symbol,
          ),
          button("new", "新增标的"),
          '<button type="button" data-sb="live" ' +
            (asset.symbol === "SPCX" ? "disabled" : "") +
            ">" +
            (live ? "断开行情" : "接入市场行情") +
            "</button>",
          "<small data-feed></small>",
        ) +
          '<form class="fields" id="sb-new" hidden>' +
          field("标的代码", "code", "", "text", 'required maxlength="20"') +
          field("名称", "title", "", "text", 'maxlength="60"') +
          field(
            "初始价格",
            "spot",
            100,
            "number",
            'min="1" max="10000" required',
          ) +
          field(
            "初始 IV %",
            "vol",
            65,
            "number",
            'min="15" max="100" required',
          ) +
          field("行权价间距", "gap", 5, "number", 'min=".01" required') +
          '<button class="primary">创建并切换</button></form><p class="note" data-message role="status"></p>',
        "<small data-save></small><span data-retry hidden>" +
          button("retry", "重试保存") +
          " " +
          button("reload", "重读工作区") +
          "</span>",
      ) +
      '<div class="cards" data-metrics></div>' +
      panel(
        "收益结构",
        chartBox([["到期损益"], ["当日理论损益"]]) +
          "<div data-bounds></div><div data-zones></div>",
      ) +
      panel(
        "情景参数",
        '<div class="fields">' +
          slider("s", "标的现价", w.scenario.s, asset.min, asset.max, 0.01) +
          slider("iv", "隐含波动率 %", w.scenario.iv, 15, 100, 1) +
          slider("days", "剩余天数", w.scenario.days, 1, 60, 1) +
          "</div>",
        button("reset", "重置参数"),
      ) +
      panel(
        "持仓构建器",
        legsTable() +
          '<div data-basis></div><p class="note">期权数量按张，正股按股。修改类型、数量或行权价会按当前理论价平旧开新。修改入场价用于修正成本。</p>',
        actions(
          button("add", "添加腿"),
          button("undo", "撤销", !w.history.length),
        ),
      ) +
      panel(
        "动态移仓与对冲",
        '<p data-trigger></p><div class="actions" data-strategies></div>',
      ) +
      panel(
        "策略预设",
        actions(
          button("ratio", "默认 1:−2 比率价差"),
          button("w", "W 型示例"),
          button("wings", "叠加 W 左右翼"),
        ) +
          '<p class="note">前两项重建当前标的模拟仓位和盈亏，可撤销。叠加双翼会保留已有持仓。</p>',
      ) +
      panel(
        "单腿 Black–Scholes 计算器",
        '<div class="fields">' +
          select(
            "类型",
            "sbCalcType",
            [
              ["put", "Put"],
              ["call", "Call"],
            ],
            w.calc.type,
          ) +
          field(
            "行权价",
            "sbCalcStrike",
            w.calc.strike,
            "number",
            'required min=".01" max="10000"',
          ) +
          field(
            "年化利率 %",
            "sbRate",
            w.scenario.r,
            "number",
            'required min="-5" max="30"',
          ) +
          "</div><div data-calc></div>",
      ) +
      panel(
        "模拟交易记录",
        w.book.log.length
          ? table(
              ["模拟操作", "标的价格", "IV", "天数"],
              w.book.log.map((l) => [
                esc(l.message),
                cash(l.s),
                number(l.iv) + "%",
                l.days,
              ]),
            )
          : '<p class="empty">暂无模拟成交。</p>',
      );
    status();
    valueView();
  }
  function valueView() {
    const s = scenario(),
      book = w.book,
      analysis = E.expiryAnalysis(book, s),
      g = E.portfolioGreeks(book, s),
      today = E.pnl(book, s),
      { short, protection, put, roll } = targets();
    const f = (x) => E.pnl(book, s, x, true),
      series = [
        ["到期损益", f],
        ["当日理论损益", (x) => E.pnl(book, s, x)],
      ];
    const strikes = book.legs
      .filter((l) => l.type !== "stock")
      .map((l) => l.strike);
    const min = Math.max(
        0,
        Math.min(asset.min, s.s, ...strikes.map((x) => x - asset.gap)),
      ),
      max = Math.max(asset.max, s.s, ...strikes.map((x) => x + asset.gap));
    const xs = [
      ...new Set([
        s.s,
        ...strikes,
        ...analysis.roots.filter((x) => x >= min && x <= max),
        ...Array.from({ length: 201 }, (_, i) => min + ((max - min) * i) / 200),
      ]),
    ].sort((a, b) => a - b);
    draw(series, xs, s.s);
    $("[data-metrics]").innerHTML =
      card(
        "当日模拟盈亏",
        cash(today),
        "同价到期 " + cash(f(s.s)),
        "Portfolio",
        tone(today),
      ) +
      card("Net Delta", number(g.delta), "等效股数", "Payoff Analyzer") +
      card("Net Gamma", number(g.gamma), "股 / $1", "Risk Monitor") +
      card(
        "Net Theta",
        number(g.theta),
        "USD / 天 · Vega " + number(g.vega) + " / 1pp",
        "Antifragility Lab",
      );
    const roots = [
      ...analysis.roots.map(cash),
      ...analysis.intervals.map(([a, b]) => format(a) + " – " + format(b)),
    ];
    $("[data-bounds]").innerHTML =
      line("到期盈亏平衡点", roots.join(" / ") || "无") +
      line(
        "到期损益范围",
        format(analysis.min) + " 至 " + format(analysis.max),
      );
    const { strikes: ks } = targets();
    const isW =
      book.legs.some((l) => l.tag === "protection") &&
      book.legs.some((l) => l.tag === "wing");
    $("[data-zones]").innerHTML = isW
      ? table(
          ["W 参考行权价", "标的价格", "到期盈亏"],
          [
            ["保护腿", ks.protection],
            ["卖方 Put", ks.short],
            ["右翼 Call", ks.long],
          ].map(([label, x]) => [label, cash(x), cash(f(x))]),
        )
      : "";
    $("[data-feed]").textContent = [
      quote ? "报价 " + new Date(quote.time * 1000).toLocaleString() : "",
      quoteError,
      live && !quote ? "暂用手动现价" : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const spot = $("[name=s]");
    spot.disabled = !!quote;
    spot.min = Math.min(asset.min, s.s);
    spot.max = Math.max(asset.max, s.s);
    spot.value = s.s;
    for (const key of ["s", "iv", "days"])
      $('[data-output="' + key + '"]').textContent = s[key];
    let basis = 0;
    for (const l of book.legs) {
      const m = E.mark(l, s),
        units = l.qty * E.multiplier(l);
      basis += l.entry * units;
      $('[data-leg-price="' + l.id + '"]').textContent = cash(m.price);
      $('[data-leg-delta="' + l.id + '"]').textContent = number(
        m.delta * units,
      );
      $('[data-leg-pnl="' + l.id + '"]').textContent = cash(
        (m.price - l.entry) * units,
      );
    }
    $("[data-basis]").innerHTML = line(
      "持仓净成本 / 已实现盈亏",
      cash(basis) + " / " + cash(book.realized),
    );
    const hedge = -Math.round(g.delta);
    $("[data-trigger]").textContent = short
      ? "卖方 Put 行权价 " +
        cash(short.strike) +
        (s.s < short.strike ? " · 现价已跌破" : " · 当前未跌破")
      : "当前无卖方 Put。";
    $("[data-strategies]").innerHTML = actions(
      button(
        "protection",
        protection ? "平仓保护腿" : "买入 2 张 $" + put + " 保护 Put",
      ),
      button(
        "roll",
        short ? "Roll Down 至 $" + roll : "Roll Down",
        !short || roll === short.strike,
      ),
      button("hedge", "正股 Delta 对冲 · " + hedge + " 股", !hedge),
    );
    const m = E.mark(w.calc, s);
    $("[data-calc]").innerHTML =
      line("每股理论价格", cash(m.price)) +
      line(
        "Δ / Γ / Θ（每日） / Vega（每百分点）",
        [m.delta, m.gamma, m.theta, m.vega]
          .map((v) => v.toFixed(4))
          .join(" / "),
      );
  }
  function transact(book, text, next = w.scenario) {
    const s = scenario();
    w.history = [
      ...w.history.slice(-39),
      { book: w.book, scenario: { ...w.scenario } },
    ];
    w.book = {
      ...book,
      log: [
        {
          id: Date.now() + Math.random(),
          message: text,
          s: s.s,
          iv: s.iv,
          days: s.days,
        },
        ...book.log,
      ].slice(0, 60),
    };
    w.scenario = { ...next };
    build();
    state.save();
    message(text);
  }
  function stopQuote() {
    clearTimeout(timer);
    abort?.abort();
    quote = null;
    quoteError = "";
  }
  function startQuote() {
    stopQuote();
    if (!live || asset.symbol === "SPCX") return;
    abort = new AbortController();
    const { signal } = abort;
    async function poll() {
      let delay = 15000;
      try {
        const r = await fetch("/api/spot/" + asset.symbol, {
          signal,
          cache: "no-store",
        });
        if (!r.ok) throw Error("行情服务不可用");
        const q = await r.json();
        if (signal.aborted) return;
        if (Number.isFinite(q.price) && q.price > 0) quote = q;
        quoteError = q.error || "";
        if (q.status === "loading") delay = 1000;
      } catch {
        if (signal.aborted) return;
        quoteError = "行情服务不可用，稍后重试";
      }
      if (!signal.aborted) {
        valueView();
        timer = setTimeout(poll, delay);
      }
    }
    poll();
  }
  function changeAsset(code) {
    stopQuote();
    live = live && code !== "SPCX";
    state.store.active = code;
    build();
    state.save();
    startQuote();
  }
  root.onclick = (e) => {
    const key = e.target.closest("[data-sb]")?.dataset.sb;
    if (!key) return;
    if (key === "load") {
      init();
      return;
    }
    if (!state) return;
    const s = scenario(),
      book = w.book,
      { short, protection, strikes, put, roll } = targets();
    switch (key) {
      case "retry":
        state.save();
        return;
      case "reload":
        if (confirm("重新载入服务器工作区并放弃本页未保存的模拟更改？"))
          location.reload();
        return;
      case "new":
        $("#sb-new").hidden = !$("#sb-new").hidden;
        if (!$("#sb-new").hidden) $("#sb-new input").focus();
        return;
      case "live":
        live = !live;
        startQuote();
        build();
        return;
      case "reset":
        w.scenario = E.assetScenario(asset);
        build();
        state.save();
        return;
      case "undo": {
        const prev = w.history.pop();
        if (prev) {
          w.book = prev.book;
          w.scenario = prev.scenario;
          build();
          state.save();
        }
        return;
      }
      case "w":
      case "ratio": {
        const next = E.assetScenario(asset);
        if (key === "w") {
          next.iv = 25;
          next.days = 1;
        }
        transact(
          E.createBook({ ...next, s: quote?.price ?? next.s }, key, strikes),
          "载入" + (key === "w" ? " W 型示例" : "默认比率价差"),
          next,
        );
        return;
      }
      case "add":
        transact(
          {
            ...book,
            legs: [
              ...book.legs,
              E.makeLeg(
                "put",
                Math.min(10000, Math.max(0.01, E.roundPrice(s.s))),
                1,
                s,
              ),
            ],
            mode: "custom",
          },
          "新增 1 张 Put",
        );
        return;
      case "protection":
        if (protection)
          transact(E.replaceLeg(book, protection.id, null, s), "平仓保护腿");
        else
          transact(
            {
              ...book,
              legs: [...book.legs, E.makeLeg("put", put, 2, s, "protection")],
              mode: "custom",
            },
            "买入 2 张 $" + put + " 保护 Put",
          );
        return;
      case "wings": {
        const added = [];
        if (!protection) added.push(E.makeLeg("put", put, 2, s, "protection"));
        if (!book.legs.some((l) => l.tag === "wing"))
          added.push(E.makeLeg("call", strikes.long, 1, s, "wing"));
        if (added.length)
          transact(
            { ...book, legs: [...book.legs, ...added], mode: "custom" },
            "叠加 W 左右翼",
          );
        else message("左右翼已持有");
        return;
      }
      case "roll":
        if (short && short.strike !== roll) {
          const next = E.makeLeg("put", roll, short.qty, s, "short");
          const flow = short.qty * 100 * (E.mark(short, s).price - next.entry);
          transact(
            E.replaceLeg(book, short.id, next, s),
            "同到期日 Roll Down：$" +
              short.strike +
              " → $" +
              roll +
              "，净现金流 " +
              cash(flow),
          );
        }
        return;
      case "hedge": {
        const qty = -Math.round(E.portfolioGreeks(book, s).delta);
        if (qty)
          transact(
            {
              ...book,
              legs: [...book.legs, E.makeLeg("stock", 0, qty, s, "hedge")],
              mode: "custom",
            },
            "正股 Delta 对冲 " + qty + " 股",
          );
        return;
      }
    }
    if (key.startsWith("close-"))
      transact(E.replaceLeg(book, Number(key.slice(6)), null, s), "模拟平仓");
  };
  root.oninput = (e) => {
    const el = e.target;
    if (el.type !== "range") return;
    w.scenario[el.name] = el.valueAsNumber;
    valueView();
  };
  root.onchange = (e) => {
    const el = e.target;
    if (el.closest("#sb-new")) return;
    if (el.name === "sbAsset") {
      changeAsset(el.value);
      return;
    }
    if (el.type === "range") {
      state.save();
      return;
    }
    if (!el.checkValidity() || el.value === "") {
      build();
      message("请输入有效数值");
      return;
    }
    if (el.dataset.leg) {
      const old = w.book.legs.find((l) => l.id === Number(el.dataset.leg)),
        key = el.name,
        value = key === "type" ? el.value : el.valueAsNumber;
      if (key === "qty" && (!Number.isSafeInteger(value) || value === 0)) {
        build();
        message("数量须为非零整数");
        return;
      }
      const leg = { ...old, [key]: value };
      if (key === "entry")
        transact(
          { ...w.book, legs: w.book.legs.map((l) => (l === old ? leg : l)) },
          "修正入场成本",
        );
      else {
        if (!leg.strike && leg.type !== "stock") leg.strike = asset.s;
        leg.tag = "custom";
        leg.entry = E.mark(leg, scenario()).price;
        transact(
          E.replaceLeg(w.book, old.id, leg, scenario()),
          "按理论价平旧开新",
        );
      }
      return;
    }
    if (el.name === "sbCalcType") w.calc.type = el.value;
    else if (el.name === "sbCalcStrike") w.calc.strike = el.valueAsNumber;
    else if (el.name === "sbRate") w.scenario.r = el.valueAsNumber;
    else return;
    valueView();
    state.save();
  };
  root.onsubmit = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const f = new FormData(e.target),
      code = f.get("code").trim().toUpperCase(),
      s = Number(f.get("spot")),
      gap = Number(f.get("gap"));
    const config = {
      symbol: code,
      name: f.get("title").trim() || code,
      s,
      gap,
      iv: Number(f.get("vol")),
      min: E.roundPrice(s * 0.65),
      max: E.roundPrice(s * 1.35),
    };
    if (
      !E.validateAsset(config) ||
      [s, gap, config.iv].some((n) => E.roundPrice(n) !== n) ||
      state.store.assets.length >= 50 ||
      state.store.assets.some((i) => i.config.symbol === code)
    ) {
      message(
        "检查代码、重复标的及数值范围；间距必须小于初始价格的一半，最多支持 50 个标的。",
      );
      return;
    }
    state.store.assets.push({ config, workspace: E.createWorkspace(config) });
    changeAsset(code);
  };
  async function init() {
    root.textContent = "正在读取模拟工作区…";
    try {
      state = await openSandbox();
      if (disposed) return;
      off = state.subscribe(status);
      build();
    } catch (e) {
      if (!disposed)
        root.innerHTML =
          '<p role="alert">' +
          esc(e.message) +
          "</p>" +
          button("load", "重新读取");
    }
  }
  init();
  return () => {
    disposed = true;
    stopQuote();
    off?.();
  };
}
