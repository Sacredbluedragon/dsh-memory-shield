/**
 * dsh-memory-core —— 增强版 dryrun（T06）。
 *
 * 在原 11 项（defaults / tracks / 实例化 / render）基础上，追加 10 组端到端断言：
 * 写读闭环、替换、删除、归档、待确认队列、注入内容与预算、目录隔离、看门狗、
 * API 路由、lite/full 模式。
 *
 * 特点：
 *   - 不启 DSH 进程：用假 ctx 驱动 apply()，捕获工具 / 注入 / 路由 / 事件处理器；
 *   - 所有数据落在 os.tmpdir() 下的临时目录，跑完删除；
 *   - 每项失败打印「期望 / 实际」；
 *   - 代码能力缺失的项不打空断言，改用 note 明示（见文件末尾说明）。
 *
 * 跑法：把本文件放在 packages/dsh-memory-core/ 下，在该目录执行 `node _dryrun.mjs`。
 */

import * as nodeModule from "node:module";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";

import { DEFAULTS } from "./lib/defaults.js";
import { MemoryStore, SuggestionQueue, ArchiveStore } from "./lib/store.js";
import { renderSnapshot, renderResident, WRITE_GUARD_NOTICE } from "./lib/render.js";
import { TOTAL_BUDGET, BUDGETS } from "./lib/budgets.js";
import { tracksOf, TRACK_FILES } from "./lib/tracks.js";

// ── 依赖兜底 ────────────────────────────────────────────────────────────
// index.js 末尾 `export { Config } from "./lib/schema.js"`，schema.js 依赖
// @deepseek-ai/schemastery。dryrun 不应要求装依赖：该包缺失时注入一个最小
// stub（链式 Proxy），只为让模块能求值，Config 本身不参与任何断言。
const { createRequire } = nodeModule;
const require = createRequire(import.meta.url);
const register = nodeModule.register; // Node < 20.6 无此导出，故用命名空间取，避免具名导入直接报错
let depInstalled = true;
try {
  require.resolve("@deepseek-ai/schemastery");
} catch {
  depInstalled = false;
}
if (!depInstalled) {
  if (typeof register !== "function") {
    console.error("缺少 @deepseek-ai/schemastery，且当前 Node 不支持 module.register，无法继续。");
    process.exit(2);
  }
  const stub = "data:text/javascript," + encodeURIComponent(
    "const chain = new Proxy(function () {}, { get: () => chain, apply: () => chain })\nexport default chain\n",
  );
  register("data:text/javascript," + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier === "@deepseek-ai/schemastery") return { url: "${stub}", shortCircuit: true }
  return next(specifier, context)
}
`));
}
const { apply } = await import("./index.js");

// ── 断言框架 ────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
let noted = 0;

const show = (v) => {
  if (typeof v === "string") return JSON.stringify(v.length > 200 ? `${v.slice(0, 200)}…(${v.length}字)` : v);
  try {
    const s = JSON.stringify(v);
    return s !== undefined && s.length > 300 ? `${s.slice(0, 300)}…` : String(s);
  } catch {
    return String(v);
  }
};

function ok(name, cond, expect, actual) {
  if (cond) {
    pass += 1;
    console.log(`  ok   ${name}`);
    return true;
  }
  fail += 1;
  console.log(`  FAIL ${name}`);
  console.log(`       期望: ${show(expect)}`);
  console.log(`       实际: ${show(actual)}`);
  return false;
}

/** 代码能力缺失 / 现状偏差：不算 pass 也不算 fail，必须显式打出来。 */
function note(text) {
  noted += 1;
  console.log(`  note ${text}`);
}

const section = (title) => console.log(`\n=== ${title} ===`);

// ── 测试夹具 ────────────────────────────────────────────────────────────
let uniqSeq = 0;
const U = (tag) => `T06-${tag}-${Date.now().toString(36)}-${(uniqSeq += 1)}-${Math.random().toString(36).slice(2, 6)}`;

function makeAgent(cwd, origin = "user") {
  return {
    id: `agent-${Math.random().toString(36).slice(2, 8)}`,
    session: {
      header: { cwd, origin },
      // writeGapCounter 用 ownEvents?.() ?? events，二者取其一即可
      events: [{ type: "turn/start" }, { type: "user/message", data: { source: { kind: "user" } } }],
    },
  };
}

/** 假 ctx：把 apply() 里注册的东西全部捕获下来。 */
function makeCtx(agent) {
  const rec = { tools: [], injects: [], web: [], handlers: new Map(), effects: [], logs: [] };
  const ctx = {
    agent,
    logger: {
      info: (m) => rec.logs.push(String(m)),
      warn: (m) => rec.logs.push(String(m)),
      error: (m) => rec.logs.push(String(m)),
    },
    effect(fn, label) {
      const result = fn();
      rec.effects.push({ label, result });
      return result;
    },
    tools: {
      register(tool) {
        rec.tools.push(tool);
        return { dispose() {} };
      },
    },
    systemPrompt: {
      context(opts) {
        rec.injects.push({ name: opts.name, fn: opts.text, opts });
        return { dispose() {} };
      },
    },
    webServer: {
      register(route) {
        rec.web.push(route);
        return { dispose() {} };
      },
    },
    on(event, fn) {
      const list = rec.handlers.get(event) ?? [];
      list.push(fn);
      rec.handlers.set(event, list);
      return { dispose() {} };
    },
  };
  return { ctx, rec };
}

function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: "" };
  res.writeHead = (code, headers) => {
    res.statusCode = code;
    res.headers = headers ?? {};
  };
  res.end = (chunk) => {
    res.body = chunk === undefined || chunk === null ? "" : String(chunk);
  };
  return res;
}

/** 调一次路由 handler，返回 { status, headers, body, json }。 */
async function callApi(handler, { method = "GET", url, body, headers = {} } = {}) {
  const res = fakeRes();
  if (method === "POST") {
    const req = new EventEmitter();
    req.method = "POST";
    req.url = url;
    req.headers = headers;
    const pending = handler(req, res);
    req.emit("data", JSON.stringify(body ?? {}));
    req.emit("end");
    await pending;
  } else {
    await handler({ method, url, headers }, res);
  }
  let json = null;
  try {
    json = JSON.parse(res.body);
  } catch {
    json = null;
  }
  return { status: res.statusCode, headers: res.headers, body: res.body, json };
}

const entriesOfTool = async (tool, target, agent) => {
  const res = await tool.execute({ action: "list", target }, { agent });
  return res?.entries ?? [];
};

/** 读文件；不存在或读失败返回空串（断言失败不应让整个套件崩掉）。 */
const readSafe = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};

// ── 主流程 ──────────────────────────────────────────────────────────────
const root = mkdtempSync(join(tmpdir(), "t06-dryrun-"));
const dirLite = join(root, "lite");
const cwdA = join(root, "cwd-a");
const agentA = makeAgent(cwdA);
const { ctx, rec } = makeCtx(agentA);

try {
  console.log("=== 0. 环境 ===");
  console.log(`  node ${process.version} / schemastery ${depInstalled ? "已安装" : "未安装（已注入 stub）"}`);
  console.log(`  tmp = ${root}`);

  apply(ctx, { memoryDir: dirLite, memoryTracks: "lite" });

  const tool = rec.tools[0];
  const injectFn = rec.injects[0]?.fn;
  const routeHandler = rec.web[0]?.handler;

  ok("0a apply 注册了 memory 工具", rec.tools.length === 1 && tool?.name === "memory_core", 1, rec.tools.length);
  ok("0b apply 注册了 memory-core:snapshot 注入", rec.injects.length === 1 && rec.injects[0].name === "memory-core:snapshot", 1, rec.injects.map((i) => i.name));
  ok("0c apply 注册了 webServer 路由", rec.web.length === 1 && typeof routeHandler === "function", 1, rec.web.length);
  ok("0d 注册了 agent/turn-stopping 看门狗处理器", (rec.handlers.get("agent/turn-stopping") ?? []).length === 1, 1, (rec.handlers.get("agent/turn-stopping") ?? []).length);

  // ── R. 原有 11 项回归 ────────────────────────────────────────────────
  section("R. 原有 11 项回归（defaults / tracks / 实例化 / render）");
  ok("R1  memoryTracks 默认 = lite", DEFAULTS.memoryTracks === "lite", "lite", DEFAULTS.memoryTracks);
  ok("R2  writeGuard 默认 = true", DEFAULTS.writeGuard === true, true, DEFAULTS.writeGuard);
  ok("R3  writeGuardThreshold 默认 = 2", DEFAULTS.writeGuardThreshold === 2, 2, DEFAULTS.writeGuardThreshold);
  ok("R4  snapshotOrder 默认 = 500", DEFAULTS.snapshotOrder === 500, 500, DEFAULTS.snapshotOrder);
  ok("R5  lite tracks = memory/user/key", tracksOf("lite").join("/") === "memory/user/key", "memory/user/key", tracksOf("lite"));
  ok("R6  full tracks = 5 条", tracksOf("full").length === 5, 5, tracksOf("full"));
  ok("R7  TRACK_FILES = 5 项", Object.keys(TRACK_FILES).length === 5, 5, Object.keys(TRACK_FILES));
  const storeR = new MemoryStore(join(root, "regress"), { injectionScan: false });
  ok("R8  MemoryStore 可实例化", storeR instanceof MemoryStore, "MemoryStore 实例", typeof storeR);
  const pendingR = new SuggestionQueue(join(root, "regress", "pending.md"));
  ok("R9  SuggestionQueue 可实例化", pendingR instanceof SuggestionQueue, "SuggestionQueue 实例", typeof pendingR);
  const archiveR = new ArchiveStore(join(root, "regress"));
  ok("R10 ArchiveStore 可实例化", archiveR instanceof ArchiveStore, "ArchiveStore 实例", typeof archiveR);
  const textR = renderSnapshot(storeR, { ...DEFAULTS }, null, { agent: undefined });
  ok("R11 renderSnapshot 返回字符串", typeof textR === "string", "string", typeof textR);

  // ── 1. 写读闭环 ──────────────────────────────────────────────────────
  section("1. 写读闭环（add → list）");
  const U1 = U("add");
  const addRes = await tool.execute({ action: "add", target: "memory", content: `闭环验证 ${U1}` }, { agent: agentA });
  ok("1a add 返回 ok", addRes?.ok === true, { ok: true }, addRes);

  const list1 = await entriesOfTool(tool, "memory", agentA);
  ok("1b list 能读到刚写的条目", list1.some((e) => e.includes(U1)), `含「${U1}」的条目`, list1);

  const disk1 = readSafe(join(dirLite, "memory.md"));
  ok("1c 落盘：memory.md 里确实有这条", disk1.includes(U1), `memory.md 含「${U1}」`, disk1.length > 0 ? `文件 ${disk1.length} 字，不含该串` : "文件为空");

  // ── 2. 替换 ──────────────────────────────────────────────────────────
  section("2. 替换（replace 用唯一子串定位）");
  const U2old = U("repl-old");
  const U2new = U("repl-new");
  await tool.execute({ action: "add", target: "memory", content: `待替换 ${U2old}` }, { agent: agentA });
  const repRes = await tool.execute({ action: "replace", target: "memory", match: U2old, content: `替换后 ${U2new}` }, { agent: agentA });
  ok("2a replace 返回 ok", repRes?.ok === true, { ok: true }, repRes);
  const list2 = await entriesOfTool(tool, "memory", agentA);
  ok("2b 旧串消失", !list2.some((e) => e.includes(U2old)), `不含「${U2old}」`, list2);
  ok("2c 新串出现", list2.some((e) => e.includes(U2new)), `含「${U2new}」`, list2);

  // ── 3. 删除 ──────────────────────────────────────────────────────────
  section("3. 删除（remove）");
  const U3 = U("del");
  await tool.execute({ action: "add", target: "memory", content: `待删除 ${U3}` }, { agent: agentA });
  const before3 = await entriesOfTool(tool, "memory", agentA);
  ok("3a 删除前存在", before3.some((e) => e.includes(U3)), `含「${U3}」`, before3);
  const delRes = await tool.execute({ action: "remove", target: "memory", match: U3 }, { agent: agentA });
  ok("3b remove 返回 ok", delRes?.ok === true, { ok: true }, delRes);
  const after3 = await entriesOfTool(tool, "memory", agentA);
  ok("3c 删除后消失", !after3.some((e) => e.includes(U3)), `不含「${U3}」`, after3);

  const ghost = await tool.execute({ action: "remove", target: "memory", match: "T06-根本不存在的串" }, { agent: agentA });
  note(`删除不存在的条目时工具仍返回 ${show(ghost)}（store.remove 实际返回 ok:false，index.js:67-71 未透传结果）`);

  // ── 4. 归档 ──────────────────────────────────────────────────────────
  section("4. 归档（archive：主轨消失、归档可见）");
  const U4 = U("arch");
  await tool.execute({ action: "add", target: "memory", content: `待归档 ${U4}` }, { agent: agentA });
  const arcRes = await tool.execute({ action: "archive", target: "memory", match: U4 }, { agent: agentA });
  ok("4a archive 返回 ok", arcRes?.ok === true, { ok: true }, arcRes);

  const mainAfterArc = await entriesOfTool(tool, "memory", agentA);
  ok("4b 主轨读不到", !mainAfterArc.some((e) => e.includes(U4)), `主轨不含「${U4}」`, mainAfterArc);

  const archiveStore = new ArchiveStore(dirLite);
  const archived = archiveStore.entriesOf("memory", cwdA);
  ok("4c 归档轨读得到", archived.some((e) => e.includes(U4)), `memory-archive.md 含「${U4}」`, archived);

  // ── 5. 待确认队列 ────────────────────────────────────────────────────
  section("5. 待确认队列（key 轨 writeGuard → pending → confirm）");
  const U5 = U("pend");
  const qRes = await tool.execute({ action: "add", target: "key", content: `待确认 ${U5}` }, { agent: agentA });
  ok("5a key 轨写入被拦截进队列", qRes?.ok === true && qRes?.queued === true, { ok: true, queued: true }, qRes);

  const queue = new SuggestionQueue(join(dirLite, "pending.md"));
  const pendingItems = queue.read();
  const idx5 = pendingItems.findIndex((p) => String(p?.content ?? "").includes(U5));
  ok("5b pending 里有这条", idx5 >= 0, `含「${U5}」的待确认项`, pendingItems);

  const keyBefore = await entriesOfTool(tool, "key", agentA);
  ok("5c 确认前 key 轨没有它", !keyBefore.some((e) => e.includes(U5)), `key 轨不含「${U5}」`, keyBefore);

  const confirm = await callApi(routeHandler, {
    method: "POST",
    url: "/api/memory-core/entry",
    body: { action: "confirm", entry: pendingItems[idx5].content },
  });
  ok("5d confirm 接口 200", confirm.status === 200, 200, confirm.status);

  const keyAfter = await entriesOfTool(tool, "key", agentA);
  ok("5e 确认后进主轨", keyAfter.some((e) => e.includes(U5)), `key 轨含「${U5}」`, keyAfter);

  const pendingAfter = queue.read();
  ok("5f 队列已出队", !pendingAfter.some((p) => String(p?.content ?? "").includes(U5)), `pending 不含「${U5}」`, pendingAfter);

  // 5g 队列里同时有两条时，确认第二条必须只动第二条（防 findIndex 退化成 0）
  const U5b = U("pend2");
  const U5c = U("pend3");
  await tool.execute({ action: "add", target: "key", content: `待确认 ${U5b}` }, { agent: agentA });
  await tool.execute({ action: "add", target: "key", content: `待确认 ${U5c}` }, { agent: agentA });
  const pending2 = queue.read();
  const item5c = pending2.find((p) => String(p?.content ?? "").includes(U5c));
  const confirm2 = await callApi(routeHandler, {
    method: "POST",
    url: "/api/memory-core/entry",
    body: { action: "confirm", entry: item5c?.content ?? "" },
  });
  const keyAfter2 = await entriesOfTool(tool, "key", agentA);
  const pendingAfter2 = queue.read();
  const hasB = keyAfter2.some((e) => e.includes(U5b));
  const hasC = keyAfter2.some((e) => e.includes(U5c));
  ok(
    "5g 两条待确认时确认第二条只动第二条",
    confirm2.status === 200 && hasC && !hasB && pendingAfter2.some((p) => String(p?.content ?? "").includes(U5b)),
    "key 含 U5c、不含 U5b，且 U5b 仍在队列",
    { status: confirm2.status, hasB, hasC, left: pendingAfter2.length },
  );


  // 5h/5i 同源守卫（跨源拒绝 / 同源放行）
  const evilRes = await callApi(routeHandler, {
    url: "/api/memory-core/status",
    headers: { host: "127.0.0.1:3080", origin: "https://evil.example" },
  });
  ok("5h 跨源 Origin 被拒", evilRes.status === 403, 403, evilRes.status);
  const sameRes = await callApi(routeHandler, {
    url: "/api/memory-core/status",
    headers: { host: "127.0.0.1:3080", origin: "http://127.0.0.1:3080" },
  });
  ok("5i 同源 Origin 放行", sameRes.status === 200, 200, sameRes.status);

  // ── 6. 注入内容与预算 ────────────────────────────────────────────────
  section("6. 注入内容（renderSnapshot / apply 注册的注入函数）");
  const snap = injectFn();
  ok("6a 注入是字符串", typeof snap === "string", "string", typeof snap);
  ok("6b 注入包含刚写的条目（第 1 组）", snap.includes(U1), `含「${U1}」`, snap.slice(0, 200));
  ok("6c 注入带轨道标题", snap.includes("## 长期记忆"), "含「## 长期记忆」", snap.slice(0, 120));
  ok("6d 注入带固定写入引导", snap.includes("## 每轮收尾"), "含「## 每轮收尾」", snap.slice(-200));

  // 预算：另起一个 store，塞 3000 字，验证截断与总预算
  const dirBudget = join(root, "budget");
  const budgetStore = new MemoryStore(dirBudget, { injectionScan: false });
  budgetStore.add("memory", `超长条目 ${"B".repeat(3000)}`, agentA);
  const parts = renderResident(budgetStore, agentA, ["memory", "user", "key"]);
  const usedChars = parts.reduce((n, p) => n + p.chars, 0);
  ok("6e 常驻部分总量不超过 TOTAL_BUDGET", usedChars <= TOTAL_BUDGET, `<= ${TOTAL_BUDGET}`, usedChars);
  ok(
    "6f memory 轨被截断到 1000 字",
    BUDGETS.memory === 1000 && (parts[0]?.chars ?? 0) <= 1000,
    "BUDGETS.memory===1000 且 chars<=1000",
    { budget: BUDGETS.memory, chars: parts[0]?.chars ?? 0 },
  );
  const snapBig = renderSnapshot(budgetStore, { ...DEFAULTS }, null, { agent: agentA });
  ok("6g 超长内容下注入仍可渲染", typeof snapBig === "string" && snapBig.length > 0, "非空字符串", snapBig.length);
  note(`未发现 2800 预算常量；代码实际为 TOTAL_BUDGET=${TOTAL_BUDGET}（lib/budgets.js:5），按此断言`);

  // ── 7. 目录隔离 ──────────────────────────────────────────────────────
  section("7. 目录隔离（两个 memoryDir 互不可见）");
  const dirX = join(root, "iso-x");
  const dirY = join(root, "iso-y");
  const storeX = new MemoryStore(dirX, { injectionScan: false });
  const storeY = new MemoryStore(dirY, { injectionScan: false });
  const UX = U("iso-x");
  const UY = U("iso-y");
  storeX.add("memory", `X 独有 ${UX}`, agentA);
  storeY.add("memory", `Y 独有 ${UY}`, agentA);
  const xEntries = storeX.entriesOf("memory", agentA);
  const yEntries = storeY.entriesOf("memory", agentA);
  ok("7a X 目录看得到自己的", xEntries.some((e) => e.includes(UX)), `含「${UX}」`, xEntries);
  ok("7b X 目录看不到 Y 的", !xEntries.some((e) => e.includes(UY)), `不含「${UY}」`, xEntries);
  ok("7c Y 目录看不到 X 的", !yEntries.some((e) => e.includes(UX)), `不含「${UX}」`, yEntries);
  ok("7d 两份文件各自独立落盘", existsSync(join(dirX, "memory.md")) && existsSync(join(dirY, "memory.md")), "两文件都存在", [existsSync(join(dirX, "memory.md")), existsSync(join(dirY, "memory.md"))]);

  // ── 8. 看门狗 ────────────────────────────────────────────────────────
  section("8. 看门狗（连续未写记忆 → 注入提醒）");
  const NOTICE = "连着几个回合没写记忆";
  const onTurnStopping = (rec.handlers.get("agent/turn-stopping") ?? [])[0];
  // 干净起点：前面的 confirm 测试可能已经写过记忆，先写一条把 wroteThisTurn 消耗掉
  await tool.execute({ action: "add", target: "memory", content: `看门狗起点 ${U("wd0")}` }, { agent: agentA });
  ok("8a gap=0 时注入不含提醒", !injectFn().includes(NOTICE), "不含提醒", injectFn().includes(NOTICE));

  onTurnStopping({ agent: agentA }); // 吃掉 wroteThisTurn
  ok("8b 第 1 个空回合仍不提醒（阈值 2）", !injectFn().includes(NOTICE), "不含提醒", injectFn().includes(NOTICE));

  onTurnStopping({ agent: agentA }); // gap = 1
  ok("8c gap=1 仍不提醒", !injectFn().includes(NOTICE), "不含提醒", injectFn().includes(NOTICE));

  onTurnStopping({ agent: agentA }); // gap = 2
  ok("8d gap=2 触发提醒", injectFn().includes(NOTICE), `含「${WRITE_GUARD_NOTICE.slice(0, 12)}…」`, injectFn().slice(0, 200));

  await tool.execute({ action: "add", target: "memory", content: `看门狗清零 ${U("wd1")}` }, { agent: agentA });
  onTurnStopping({ agent: agentA }); // 写过记忆 → 下一回合 gap 清零
  ok("8e 写入后下一回合提醒消失（noteWrite 已接线）", !injectFn().includes(NOTICE), "不含提醒", injectFn().slice(0, 200));

  onTurnStopping({ agent: agentA }); // gap = 1
  ok("8f 清零后再空一回合仍不提醒（阈值 2）", !injectFn().includes(NOTICE), "不含提醒", injectFn().includes(NOTICE));

  note("看门狗计数只在内存 Map 里（按 agent.id），不落任何计数文件；无法断言「计数文件被创建/更新」——缺该能力，故改为断言注入文本");

  section("9. API 路由（/manage /status /entries /entry）");
  ok("9a 以 prefix 形式注册 1 条路由", rec.web.length === 1 && rec.web[0].kind === "prefix" && rec.web[0].path === "/api/memory-core", { kind: "prefix", path: "/api/memory-core" }, rec.web.map((r) => ({ kind: r.kind, path: r.path })));
  note("代码只注册 1 条 prefix 路由（index.js:100-104），4 个子路径由 handler 内部 if 分发；下面逐条实测，而非断言 4 次 register");

  const manage = await callApi(routeHandler, { url: "/api/memory-core/manage" });
  ok("9b GET /manage 返回 200 HTML", manage.status === 200 && String(manage.headers["content-type"] ?? "").includes("text/html"), "200 + text/html", { status: manage.status, type: manage.headers["content-type"], len: manage.body.length });

  const status = await callApi(routeHandler, { url: "/api/memory-core/status" });
  ok("9c GET /status 返回 200 且 ok", status.status === 200 && status.json?.ok === true, { status: 200, ok: true }, { status: status.status, json: status.json });

  const entriesApi = await callApi(routeHandler, { url: "/api/memory-core/entries?track=memory" });
  ok("9d GET /entries?track=memory 返回条目", entriesApi.status === 200 && (entriesApi.json?.data?.entries ?? []).some((e) => e.includes(U1)), `200 且含「${U1}」`, { status: entriesApi.status, count: entriesApi.json?.data?.entries?.length });

  const U9 = U("api-add");
  const addViaApi = await callApi(routeHandler, { method: "POST", url: "/api/memory-core/entry", body: { action: "add", track: "memory", content: `接口写入 ${U9}` } });
  const entriesAfterApi = await callApi(routeHandler, { url: "/api/memory-core/entries?track=memory" });
  ok("9e POST /entry action=add 生效", addViaApi.status === 200 && (entriesAfterApi.json?.data?.entries ?? []).some((e) => e.includes(U9)), `200 且条目含「${U9}」`, { status: addViaApi.status, json: addViaApi.json });

  const badAction = await callApi(routeHandler, { method: "POST", url: "/api/memory-core/entry", body: { action: "nope" } });
  ok("9f POST /entry 未知 action 返回 400", badAction.status === 400, 400, badAction.status);

  const notFound = await callApi(routeHandler, { url: "/api/memory-core/nope" });
  ok("9g 未知路径返回 404", notFound.status === 404, 404, notFound.status);

  // ── 10. 模式与 enabled ───────────────────────────────────────────────
  section("10. lite / full 模式与 enabled");
  ok("10a lite 模式 tracks = memory/user/key", (status.json?.data?.tracks ?? []).join("/") === "memory/user/key", "memory/user/key", status.json?.data?.tracks);

  const dirFull = join(root, "full");
  const agentF = makeAgent(join(root, "cwd-full"));
  const { ctx: ctxFull, rec: recFull } = makeCtx(agentF);
  apply(ctxFull, { memoryDir: dirFull, memoryTracks: "full" });
  const statusFull = await callApi(recFull.web[0].handler, { url: "/api/memory-core/status" });
  ok("10b full 模式 tracks = memory/user/project/key/daily", (statusFull.json?.data?.tracks ?? []).join("/") === "memory/user/project/key/daily", "memory/user/project/key/daily", statusFull.json?.data?.tracks);

  ok("10c full 模式下仍注册 1 工具 + 1 注入", recFull.tools.length === 1 && recFull.injects.length === 1, { tools: 1, injects: 1 }, { tools: recFull.tools.length, injects: recFull.injects.length });

  note("未发现 enabled / 关闭记忆的配置项：lib/schema.js 的 Config 只有 memoryTracks/presetName/memoryDir/writeGuard/writeGuardThreshold/snapshotOrder；index.js apply() 无条件注册工具与注入。因此「不启用记忆时工具/注入是否注册」无对应分支，无法断言——缺该能力");

  // ── 汇总 ────────────────────────────────────────────────────────────
  section("result");
  console.log(`  ${pass} pass, ${fail} fail, ${noted} note`);
  if (noted > 0) console.log("  （note = 代码能力缺失或现状偏差，不计入 pass/fail，详见产出说明）");
} catch (e) {
  fail += 1;
  console.log(`\n  FAIL 运行中断：${e?.message ?? e}`);
  console.log("       期望: 全部断言执行完毕");
  console.log(`       实际: 抛异常，已执行 ${pass + fail - 1} 项`);
  console.log(String(e?.stack ?? "").split("\n").slice(0, 5).join("\n"));
} finally {
  try {
    rmSync(root, { recursive: true, force: true });
    console.log(`  cleaned: ${root}`);
  } catch (e) {
    console.log(`  清理失败（可手动删）：${root} — ${e?.message ?? e}`);
  }
}

process.exit(fail > 0 ? 1 : 0);
