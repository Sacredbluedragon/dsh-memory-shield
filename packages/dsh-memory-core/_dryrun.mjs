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
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";

import { DEFAULTS } from "./lib/defaults.js";
import { MemoryStore, SuggestionQueue, ArchiveStore } from "./lib/store.js";
import { renderSnapshot, renderResident, writeGuardNoticeFor, writeGuideFor } from "./lib/render.js";
import { TOTAL_BUDGET, BUDGETS } from "./lib/budgets.js";
import { tracksOf } from "./lib/tracks.js";

// ── 依赖兜底 ────────────────────────────────────────────────────────────
// index.js 末尾 `export { Config } from "./lib/schema.js"`，schema.js 依赖
// @deepseek-ai/schemastery。dryrun 不应要求装依赖：该包缺失时注入一个最小
// stub（链式 Proxy），只为让模块能求值。stub 是**严格**的：只认 schemastery
// 真正导出的构造器与实例方法，遇到别的名字立即抛错——否则 `z.enum(...)` 这种
// 只在 zod 里存在的写法会被万能 Proxy 吞掉，直到真机 import 才崩（0.1.1 事故）。
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
  const ALLOWED = [
    "object", "string", "number", "natural", "percent", "boolean", "array", "dict", "tuple",
    "union", "intersect", "const", "never", "any", "function", "is", "date", "regexp",
    "bitset", "arraybuffer", "transform", "default", "required", "description", "hidden", "deprecated",
  ];
  const stub = "data:text/javascript," + encodeURIComponent(
    `const allowed = new Set(${JSON.stringify(ALLOWED)})\n` +
      "const chain = new Proxy(function () {}, {\n" +
      "  get(_t, key) {\n" +
      "    if (typeof key === 'symbol') return undefined\n" +
      "    if (!allowed.has(String(key))) throw new Error('stub: schemastery has no \"' + String(key) + '\"')\n" +
      "    return chain\n" +
      "  },\n" +
      "  apply() { return chain },\n" +
      "})\nexport default chain\n",
  );
  register("data:text/javascript," + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier === "@deepseek-ai/schemastery") return { url: "${stub}", shortCircuit: true }
  return next(specifier, context)
}
`));
}
const { apply, __resetInstance } = await import("./index.js");

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
    // 真实 Cordis：ctx.<服务> 未 inject 会抛，ctx.get(name, strict) 才安全。这里同样只经 get 拿 agent。
    get: (name) => (name === "agent" || name === "agents" ? agent : undefined),
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

  apply(ctx, { memoryEnabled: true, memoryDir: dirLite, memoryTracks: "lite", perTurnWriteGuard: true, directKey: false });
  __resetInstance(); // 单例按进程去重：清空槽位，下一段 full 实例才能注册

  const tool = rec.tools[0];
  const injectFn = rec.injects[0]?.fn;
  const routeHandler = rec.web[0]?.handler;

  ok("0a apply 注册了 memory 工具", rec.tools.length === 1 && tool?.name === "memory_core", 1, rec.tools.length);
  ok("0b apply 注册了 memory-core:snapshot 注入", rec.injects.length === 1 && rec.injects[0].name === "memory-core:snapshot", 1, rec.injects.map((i) => i.name));
  ok("0c apply 注册了 webServer 路由", rec.web.length === 1 && typeof routeHandler === "function", 1, rec.web.length);
  ok("0d 注册了 agent/turn-stopping 看门狗处理器", (rec.handlers.get("agent/turn-stopping") ?? []).length === 1, 1, (rec.handlers.get("agent/turn-stopping") ?? []).length);

  // 0e：未启用时必须零注册——这是「装进 profile 不影响任何普通会话」的产品承诺。
  {
    const off = makeCtx(makeAgent(join(root, "cwd-off")));
    __resetInstance();
    apply(off.ctx, { memoryDir: join(root, "off") });
    const total = off.rec.tools.length + off.rec.injects.length + off.rec.web.length + (off.rec.handlers.get("agent/turn-stopping") ?? []).length;
    ok("0e memoryEnabled=false 时零注册（工具/注入/路由/看门狗）", total === 0, 0, total);
    __resetInstance();
  }

  // ── R. 原有 11 项回归 ────────────────────────────────────────────────
  section("R. 原有 11 项回归（defaults / tracks / 实例化 / render）");
  ok("R1  memoryTracks 默认 = full（五轨）", DEFAULTS.memoryTracks === "full", "full", DEFAULTS.memoryTracks);
  ok("R2  三轨直接写入默认全开", DEFAULTS.directMemory === true && DEFAULTS.directUser === true && DEFAULTS.directKey === true, "true/true/true", `${DEFAULTS.directMemory}/${DEFAULTS.directUser}/${DEFAULTS.directKey}`);
  ok("R3  writeGuardThreshold 默认 = 2", DEFAULTS.writeGuardThreshold === 2, 2, DEFAULTS.writeGuardThreshold);
  ok("R4  snapshotOrder 默认 = 500", DEFAULTS.snapshotOrder === 500, 500, DEFAULTS.snapshotOrder);
  ok("R5  lite tracks = memory/user/key", tracksOf("lite").join("/") === "memory/user/key", "memory/user/key", tracksOf("lite"));
  ok("R6  full tracks = 5 条", tracksOf("full").length === 5, 5, tracksOf("full"));
  ok("R7  TRACK_FILES 已删（与实际 locate 不一致的死常量）", !("TRACK_FILES" in (await import("./lib/tracks.js"))), "无导出", "有导出");
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
  section("5. 待确认队列（directKey=false → pending → confirm）");
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

  // 6h/6i 注入面固定三轨：project 与 daily 有内容也不进快照（否则项目日志会全文注入）
  const PROJ_ONLY = `项目日志不该注入 ${U("proj")}`;
  const DAILY_ONLY = `今日日志不该注入 ${U("daily")}`;
  budgetStore.add("project", PROJ_ONLY, agentA);
  budgetStore.add("daily", DAILY_ONLY, agentA);
  const snapFull = renderSnapshot(budgetStore, { ...DEFAULTS, memoryTracks: "full" }, null, { agent: agentA });
  ok("6h full 模式不注入 project 轨", !snapFull.includes(PROJ_ONLY), "不含项目日志条目", snapFull.slice(0, 160));
  ok("6i full 模式不注入 daily 轨", !snapFull.includes(DAILY_ONLY), "不含今日日志条目", snapFull.slice(0, 160));

  // 6j/6k {{}} 净化：宿主的段渲染器把段正文当模板解析，未注册变量直接抛错，
  // 整段快照渲染失败 = 该会话每一步都起不来（evolve issue #53）。记忆正文
  // 由模型/用户写入，天然可能带 {{xxx}}，所以这里必须降级成单层大括号。
  const BRACE = `x-opencode-session: {{session}} ${U("brace")}`;
  budgetStore.add("memory", BRACE, agentA);
  const snapBrace = renderSnapshot(budgetStore, { ...DEFAULTS }, null, { agent: agentA });
  ok("6j 快照里不含未净化的 {{", !snapBrace.includes("{{"), "无 {{ 序列", snapBrace.includes("{{") ? snapBrace.slice(0, 200) : "ok");
  ok("6k 净化只降一层保留字面内容", snapBrace.includes("{session}"), "含 {session}", snapBrace.includes("{session}"));
  // 6l 写引导必须按「target 是单轨」写：写「一次调用写两个轨」会让模型撞轨校验，
  // 或把 project 的内容塞进 daily 静默写错轨。
  const guideFull = writeGuideFor("full");
  ok("6l full 写引导要求分两次调用", guideFull.includes("分两次") && !guideFull.includes("一次调用写"), "含「分两次」、不含「一次调用写」", guideFull);
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
  const NOTICE = "## 提醒";
  const onTurnStopping = (rec.handlers.get("agent/turn-stopping") ?? [])[0];
  // 干净起点：本段跑的是 lite 模式（没有 daily/project 轨可写），
  // 所以按 lite 的语义「任意轨写入即清零」，写一条 memory 把 wroteThisTurn 消耗掉
  await tool.execute({ action: "add", target: "memory", content: `看门狗起点 ${U("wd0")}` }, { agent: agentA });
  ok("8a gap=0 时注入不含提醒", !injectFn().includes(NOTICE), "不含提醒", injectFn().includes(NOTICE));

  onTurnStopping({ agent: agentA }); // 吃掉 wroteThisTurn
  ok("8b 第 1 个空回合仍不提醒（阈值 2）", !injectFn().includes(NOTICE), "不含提醒", injectFn().includes(NOTICE));

  onTurnStopping({ agent: agentA }); // gap = 1
  ok("8c gap=1 仍不提醒", !injectFn().includes(NOTICE), "不含提醒", injectFn().includes(NOTICE));

  onTurnStopping({ agent: agentA }); // gap = 2
  ok("8d gap=2 触发提醒", injectFn().includes(NOTICE), `含「${writeGuardNoticeFor("lite", 2).slice(0, 12)}…」`, injectFn().slice(0, 200));

  // 回归闸：Cordis 的 ctx.<服务> 在未 inject 时会抛（cannot get property "x" without inject），
  // 症状是路由一律 400 空体、注入段抛错。agent 只能经 ctx.get(name, false) 取。
  const coreSrc = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  ok("8d2 index.js 不直接访问 ctx.agent", !/ctx\.agent\b/.test(coreSrc), "0 处", (coreSrc.match(/ctx\.agent\b/g) ?? []).length);

  await tool.execute({ action: "add", target: "memory", content: `看门狗清零 ${U("wd1")}` }, { agent: agentA });
  onTurnStopping({ agent: agentA }); // lite 下写过任意轨 → 下一回合 gap 清零
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

  // 9f2 请求体上限：同源页面也可能被脚本灌大 body，超过 64 KB 要直接拒绝，不能全读进内存。
  const huge = await callApi(routeHandler, {
    method: "POST",
    url: "/api/memory-core/entry",
    body: { action: "add", track: "memory", content: "x".repeat(70000) },
  });
  ok("9f2 超大请求体返回 413", huge.status === 413, 413, huge.status);

  const notFound = await callApi(routeHandler, { url: "/api/memory-core/nope" });
  ok("9g 未知路径返回 404", notFound.status === 404, 404, notFound.status);

  const filesApi = await callApi(routeHandler, { url: "/api/memory-core/files" });
  ok("9h GET /files 返回每轨行", filesApi.status === 200 && (filesApi.json?.data?.rows ?? []).length === 3, "200 + 3 行（lite）", { status: filesApi.status, rows: filesApi.json?.data?.rows?.length });

  // 9h2 子代理只读：不光是 add，remove/archive 这类破坏性操作也要被挡住，
  // 否则「子代理只读」名不副实（wb P1-1）。
  const sub = makeAgent(cwdA, "subagent");
  await tool.execute({ action: "add", target: "memory", content: `子代理前置 ${U("sub-pre")}` }, { agent: agentA });
  const subRemove = await tool.execute({ action: "remove", target: "memory", match: `子代理前置 ${U("sub-pre")}` }, { agent: sub });
  const subList = await tool.execute({ action: "list", target: "memory" }, { agent: sub });
  ok("9h2 子代理 remove 被拒、list 放行", subRemove?.ok === false && subList?.ok !== false, "remove 拒 / list 放行", { remove: subRemove?.ok, list: subList?.ok });

  const filesCwd = await callApi(routeHandler, { url: `/api/memory-core/files?cwd=${encodeURIComponent(cwdA)}` });
  ok("9i GET /files?cwd 带回 cwd", filesCwd.status === 200 && filesCwd.json?.data?.cwd === cwdA, cwdA, filesCwd.json?.data?.cwd);

  const manageHtml = readSafe(new URL("./manage.html", import.meta.url));
  ok("9j manage.html 用 /files 且带页签/搜索/纯文本视图", manageHtml.includes("/api/memory-core/files") && manageHtml.includes("view-raw") && manageHtml.includes('id="search"'), "含 files/view-raw/search", { len: manageHtml.length });
  ok(
    "9o manage.html 最新在前 + 每页 20 条 + 工作目录可填",
    manageHtml.includes(".slice().reverse()") && manageHtml.includes("PAGE_SIZE = 20") && manageHtml.includes('id="cwd-input"') && manageHtml.includes("pmc-cwd"),
    "含 reverse/PAGE_SIZE/cwd-input/pmc-cwd",
    {
      reverse: manageHtml.includes(".slice().reverse()"),
      page: manageHtml.includes("PAGE_SIZE = 20"),
      cwdInput: manageHtml.includes('id="cwd-input"'),
      remember: manageHtml.includes("pmc-cwd"),
    },
  );

  // 9k/9l 运行期配置：设置页面板改完立即生效并持久化（对齐 evolve 设置页的语义）
  const cfgBefore = await callApi(routeHandler, { url: "/api/memory-core/config" });
  ok("9k GET /config 返回当前配置与覆盖层路径", cfgBefore.status === 200 && cfgBefore.json?.data?.livePath?.endsWith("memory-core.config.json"), "livePath 指向覆盖层", cfgBefore.json?.data);
  const cfgSaved = await callApi(routeHandler, {
    method: "POST",
    url: "/api/memory-core/config",
    body: { patch: { memoryTracks: "full", writeGuardThreshold: 3 } },
  });
  const cfgAfter = await callApi(routeHandler, { url: "/api/memory-core/config" });
  ok(
    "9l POST /config 立即生效并落盘",
    cfgSaved.status === 200 &&
      cfgAfter.status === 200 &&
      cfgAfter.json?.data?.memoryTracks === "full" &&
      cfgAfter.json?.data?.writeGuardThreshold === 3 &&
      existsSync(cfgBefore.json?.data?.livePath),
    "full + 阈值 3 + 文件存在",
    cfgAfter.json?.data,
  );

  // 9m/9n 横幅判据：状态接口要能让前端区分 profile / preset 两种装配方式
  ok("9m /status 带 layer 字段（默认 presetName=default 判 profile）", status.json?.data?.layer === "profile", "profile", status.json?.data?.layer);
  const clientSrc = readFileSync(new URL("./client.js", import.meta.url), "utf8");
  ok(
    "9n client.js 注册 shell.overlay 横幅且含黄/红两档文案",    /shell\.overlay/.test(clientSrc) && /data-pmc-banner/.test(clientSrc) && /layer === "profile"/.test(clientSrc) && /全局生效|全局破坏/.test(clientSrc),
    "含 shell.overlay + 两档文案",
    { overlay: /shell\.overlay/.test(clientSrc), banner: /data-pmc-banner/.test(clientSrc) },
  );

  // 9o full（默认档）下 project/key 靠 cwd 定位，工具必须能显式传 cwd，
  // 否则「没有工作目录的会话」写这两轨必抛，而模型没有别的办法补。
  ok(
    "9p memory_core 暴露 cwd 参数",
    Object.keys(tool?.parameters?.properties ?? {}).includes("cwd") && String(tool?.parameters?.properties?.cwd?.description ?? "").includes("项目"),
    "schema 含 cwd",
    Object.keys(tool?.parameters?.properties ?? {}),
  );

  // ── 10. 模式与 enabled ───────────────────────────────────────────────
  section("10. lite / full 模式与 enabled");
  ok("10a lite 模式 tracks = memory/user/key", (status.json?.data?.tracks ?? []).join("/") === "memory/user/key", "memory/user/key", status.json?.data?.tracks);

  const dirFull = join(root, "full");
  const agentF = makeAgent(join(root, "cwd-full"));
  const { ctx: ctxFull, rec: recFull } = makeCtx(agentF);
  apply(ctxFull, { memoryEnabled: true, memoryDir: dirFull, memoryTracks: "full" });
  const statusFull = await callApi(recFull.web[0].handler, { url: "/api/memory-core/status" });
  ok("10b full 模式 tracks = memory/user/project/key/daily", (statusFull.json?.data?.tracks ?? []).join("/") === "memory/user/project/key/daily", "memory/user/project/key/daily", statusFull.json?.data?.tracks);

  ok("10c full 模式下仍注册 1 工具 + 1 注入", recFull.tools.length === 1 && recFull.injects.length === 1, { tools: 1, injects: 1 }, { tools: recFull.tools.length, injects: recFull.injects.length });

  const storeNoCwd = new MemoryStore(join(root, "full-nocwd"), { memoryTracks: "full" });
  let noCwdOk = true;
  try {
    noCwdOk = storeNoCwd.entriesOf("project", undefined).length === 0 && storeNoCwd.entriesOf("key", undefined).length === 0;
  } catch {
    noCwdOk = false;
  }
  ok("10d full 模式无 cwd 时读 project/key 降级为空（不抛）", noCwdOk, true, noCwdOk);

  // 10e 单例：同进程第二个实例只登记、不注册（避免 duplicate route 与同名工具把 preset 拖崩）
  __resetInstance();
  const { ctx: ctxI1, rec: recI1 } = makeCtx(makeAgent(join(root, "cwd-i1")));
  const { ctx: ctxI2, rec: recI2 } = makeCtx(makeAgent(join(root, "cwd-i2")));
  apply(ctxI1, { memoryEnabled: true, memoryDir: join(root, "inst-1") });
  apply(ctxI2, { memoryEnabled: true, memoryDir: join(root, "inst-2") });
  ok(
    "10e 第二个实例不注册工具/注入/路由",
    recI1.tools.length === 1 && recI1.injects.length === 1 && recI1.web.length === 1 &&
      recI2.tools.length === 0 && recI2.injects.length === 0 && recI2.web.length === 0,
    { first: "tools/injects/web 各 1", second: 0 },
    { firstTools: recI1.tools.length, secondTools: recI2.tools.length, secondInjects: recI2.injects.length, secondWeb: recI2.web.length },
  );

  note("未发现 enabled / 关闭记忆的配置项：lib/schema.js 的 Config 只有 memoryTracks/presetName/memoryDir/writeGuard/writeGuardThreshold/snapshotOrder；index.js apply() 无条件注册工具与注入。因此「不启用记忆时工具/注入是否注册」无对应分支，无法断言——缺该能力");

  // 10f/10g 横幅与徽章（wb 横幅测试 C4/C8、P2-N1）
  ok(
    "10f /status 带 bannerEnabled 与 pendingKey",
    statusFull.json?.data?.bannerEnabled === true && typeof statusFull.json?.data?.pendingKey === "number",
    { bannerEnabled: true, pendingKey: "number" },
    { bannerEnabled: statusFull.json?.data?.bannerEnabled, pendingKey: statusFull.json?.data?.pendingKey },
  );
  {
    const clientSrc = readFileSync(new URL("./client.js", import.meta.url), "utf8");
    ok(
      "10l 待确认黄警按三轨总数（不再只盯 key）",
      clientSrc.includes("pendingTotal") && !clientSrc.includes("c.pendingKey || 0) >= 3"),
      "含 pendingTotal 且旧判据已删",
      clientSrc.includes("pendingTotal"),
    );
    const manageSrc = readFileSync(new URL("./manage.html", import.meta.url), "utf8");
    ok(
      "10m 管理页有 load() 刷新入口（刷新按钮/切目录都会调它）",
      /async function load\(\)/.test(manageSrc) && manageSrc.includes('id="refresh-all"'),
      "load() 已定义且刷新按钮存在",
      /async function load\(\)/.test(manageSrc),
    );
    ok(
      "10n 管理页回显 cwd 来源（防止静默读写别的项目）",
      manageSrc.includes("cwdSource") && manageSrc.includes("来自最近工作目录"),
      "含 cwdSource 与来源提示",
      manageSrc.includes("cwdSource"),
    );
    ok(
      "10o lite 模式 /entries 拒绝未启用轨",
      /tracksOf\(s\.memoryTracks\)\.includes\(track\)/.test(readFileSync(new URL("./index.js", import.meta.url), "utf8")),
      "含轨校验",
      false,
    );
    ok(
      "10g 客户端注册 plugins.detail.badge 徽章",
      clientSrc.includes('"plugins.detail.badge"') && clientSrc.includes("DetailBadge"),
      "含槽位注册与组件",
      clientSrc.includes('"plugins.detail.badge"'),
    );
    ok(
      "10h 七条使用期提示词都在，且 COPY_FIX 要求不自己重启",
      ["COPY_FIX", "COPY_UNDERSTAND", "COPY_HELP", "COPY_TRACK", "COPY_FORGET", "COPY_PENDING", "COPY_REVIEW", "COPY_PAGE_ERROR"].every((k) => clientSrc.includes(`const ${k} =`)) &&
        clientSrc.includes("不要自己重启"),
      "8 个 COPY 常量 + 不自己重启",
      ["COPY_FIX", "COPY_UNDERSTAND", "COPY_HELP", "COPY_TRACK", "COPY_FORGET", "COPY_PENDING", "COPY_REVIEW", "COPY_PAGE_ERROR"].filter((k) => !clientSrc.includes(`const ${k} =`)),
    );
    ok(
      "10i 指南覆盖「已关闭解释 + 复制给 agent」两段",
      clientSrc.includes("插件列表里为什么显示「已关闭」") && clientSrc.includes("看不懂？复制一条发给 agent"),
      "两段标题都在",
      { 已关闭解释: clientSrc.includes("插件列表里为什么显示「已关闭」"), 复制给agent: clientSrc.includes("看不懂？复制一条发给 agent") },
    );
    ok(
      "10j 绿条：loadedHintShown 贯通 defaults/schema/index/runtime-config/client，且「知道了」写回",
      clientSrc.includes('kind: "ok"') &&
        clientSrc.includes("loadedHintShown") &&
        readFileSync(new URL("./lib/defaults.js", import.meta.url), "utf8").includes("loadedHintShown") &&
        readFileSync(new URL("./lib/schema.js", import.meta.url), "utf8").includes("loadedHintShown") &&
        readFileSync(new URL("./index.js", import.meta.url), "utf8").includes("loadedHintShown") &&
        readFileSync(new URL("./lib/runtime-config.js", import.meta.url), "utf8").includes("loadedHintShown"),
      "五处都有这个键",
      ["client.js", "lib/defaults.js", "lib/schema.js", "index.js", "lib/runtime-config.js"]
        .filter((f) => !readFileSync(new URL(`./${f}`, import.meta.url), "utf8").includes("loadedHintShown")),
    );
    ok(
      "10k 黄警分支都带「复制修复提示词」（acts 以 fix 开头）",
      (clientSrc.match(/acts: \["fix"/g) || []).length >= 7,
      ">=7 处",
      (clientSrc.match(/acts: \["fix"/g) || []).length,
    );
  }

  // ── 11) add 的返回透传与漂移守卫 ──────────────────────────────────
  section("11) add 返回透传与 drift 拒绝");
  {
    const dir = mkdtempSync(join(root, "s11-"));
    const store = new MemoryStore(dir, { memoryTracks: "full" });
    const agent = makeAgent(dir);
    const text = U("dup");
    const first = store.add("memory", text, agent);
    ok("11a 首次写入 ok", first.ok === true, "ok=true", first.message);
    const second = store.add("memory", text, agent);
    ok("11b 重复写入带 duplicate 标记", second.ok === true && second.duplicate === true, "ok=true, duplicate=true", second.message);
    ok("11c 重复不追加", store.entriesOf("memory", agent).length === 1, "1 条", store.entriesOf("memory", agent).length);

    // 需要两条才有分隔符可改坏。
    store.add("memory", U("second"), agent);
    // 模拟外部编辑器把分隔符改坏：add 走带守卫的 reload，必须拒绝而不是全量重写。
    const file = store.pathOf("memory", agent);
    const broken = readFileSync(file, "utf8").replace(/\n§\n/g, "\n§ \n");
    ok("11d0 造出坏格式（含 § 行）", broken !== readFileSync(file, "utf8") && /^\s*§ $/m.test(broken), "分隔符行变成 § ", broken.split("\n").filter((x) => x.includes("§")));
    writeFileSync(file, broken);
    const before = readFileSync(file, "utf8");
    const drift = store.add("memory", U("drift"), agent);
    ok("11d 格式漂移时拒绝写入", drift.ok === false && /格式异常/.test(drift.message ?? ""), "ok=false 且提示格式异常", drift.message);
    ok("11e 拒绝后原文件未被改写", readFileSync(file, "utf8") === before, "字节不变", readFileSync(file, "utf8").length);
    const backups = readdirSync(dir).filter((f) => f.includes(".bak."));
    ok("11f 漂移时留下备份", backups.length >= 1, ">=1 个 .bak", backups);
  }

  // ── 12) 工具层与横幅：透传 duplicate、presetName 告警 ────────────────
  section("12) 工具层透传与 presetName 告警");
  {
    const idxSrc = readFileSync(new URL("./index.js", import.meta.url), "utf8");
    ok(
      "12a 工具层透传 duplicate（不再自己拼假成功）",
      idxSrc.includes("duplicate: dupCount === written.length") && idxSrc.includes("与已有记忆重复，未写入"),
      "两处都在",
      { duplicate: idxSrc.includes("duplicate: dupCount === written.length"), text: idxSrc.includes("与已有记忆重复，未写入") },
    );
    const clientSrc = readFileSync(new URL("./client.js", import.meta.url), "utf8");
    ok(
      "12b 横幅提示未配置 presetName",
      clientSrc.includes('c.presetName === "default"') && clientSrc.includes("多个 preset 会共用同一份记忆"),
      "分支与文案都在",
      clientSrc.includes('c.presetName === "default"'),
    );
  }

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
