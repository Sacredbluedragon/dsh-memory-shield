/**
 * dsh-memory-core —— 遮蔽会话的隔离记忆包。
 *
 * 与 shield 包配对使用：shield 挡住其他记忆插件的注入，本包给遮蔽会话加一套
 * 隔离的记忆存储（独立数据目录，与普通会话的 dsh-memory-evolve 完全隔离）。
 *
 * 默认 full 模式（五轨 memory/user/project/key/daily）；老配置显式写 lite 的仍跑三轨。
 */
import { PLUGIN_NAME } from "./lib/constants.js";
import { DEFAULTS, resolveMemoryDir } from "./lib/defaults.js";
import { MemoryStore, SuggestionQueue, ArchiveStore } from "./lib/store.js";
import { renderSnapshot } from "./lib/render.js";
import { readLiveConfig, writeLiveConfig, liveConfigPath } from "./lib/runtime-config.js";
import { writeGapCounter } from "./lib/watchdog.js";
import { tracksOf, TRACK_FILES, PENDING_FILE } from "./lib/tracks.js";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const name = PLUGIN_NAME;
const inject = ["systemPrompt", "tools", "webServer"];

/**
 * 进程级单例：同一进程只允许一个实例注册工具 / 注入 / 路由。
 *
 * 为什么需要：profile 层（插件列表的开关）与 preset 层（preset 的 plugins 挂载）可以同时
 * 启用同一个包。两个实例注册同名工具与同一路径 `/api/memory-core` 时，后装配的会抛
 * `webserver: duplicate prefix route`，把整个 preset 拖成「加载失败」。新手很容易顺手
 * 打开列表开关，所以这里退化成「先到先得」：后到的只写一条 warn，不注册任何东西。
 */
const INSTANCE = (globalThis[Symbol.for("dsh-memory-core.instance")] ??= { owner: null });

/** 仅供自测：重置单例槽位，让同一进程可以连续验证两个 apply。 */
export function __resetInstance() {
	INSTANCE.owner = null;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** 同源守卫：挡 DNS 重绑定与跨站请求；返回空串表示放行 */
function sameOriginBlocked(req) {
	const host = String(req.headers?.host ?? "").split(":")[0];
	const origin = req.headers?.origin;
	if (origin) {
		let oh = "";
		try {
			oh = new URL(origin).hostname;
		} catch {
			return "非法 Origin 头";
		}
		if (oh !== host && !(LOOPBACK.has(host) && LOOPBACK.has(oh))) return "跨源访问被拒绝";
	}
	const site = req.headers?.["sec-fetch-site"];
	if (!origin && site && site !== "same-origin" && site !== "none") return "跨站请求被拒绝";
	return "";
}

/** 取当前会话的 agent。Cordis 的 ctx.<服务> 在未声明 inject 时会抛错，所以走 ctx.get(name, false) 探测；取不到返回 undefined。 */
function agentOf(ctx) {
	for (const name of ["agent", "agents"]) {
		try {
			const a = ctx.get?.(name, false);
			if (a?.session) return a;
		} catch {}
	}
	return undefined;
}

function apply(ctx, config) {
	const s = { ...DEFAULTS, ...(config ?? {}) };
	const memoryDir = resolveMemoryDir(s);
	if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true });

	/**
	 * 把设置页面板写入的覆盖层叠到当前运行配置上（对齐 evolve 的「修改立即生效」）。
	 * 每次工具调用、每轮注入、每次路由请求前都重读文件——面板写入后一拍即生效，
	 * 不需要重启；文件坏了就退回 patch 配置（readLiveConfig 内部吞掉解析错误）。
	 */
	const refreshLive = () => {
		try {
			Object.assign(s, readLiveConfig(memoryDir));
		} catch {}
	};

	// 先到先得：第二个实例只登记、不注册，避免同名工具与重复路由
	const primary = INSTANCE.owner === null;
	if (primary) {
		INSTANCE.owner = { memoryDir, presetName: s.presetName };
		ctx.effect(
			() => () => {
				if (INSTANCE.owner?.memoryDir === memoryDir) INSTANCE.owner = null;
			},
			`${name}: release instance slot`,
		);
	} else {
		ctx.logger.warn(
			`${name}: 已有实例在运行（${INSTANCE.owner.memoryDir}），本实例（${memoryDir}）只登记、不注册工具/注入/路由，` +
				`避免同名工具与 /api/memory-core 路由冲突。若要换实例，请关掉插件列表开关或删掉 preset 里的挂载后重启。`,
		);
	}

	const store = new MemoryStore(memoryDir, { injectionScan: true, memoryTracks: s.memoryTracks });
	const pending = new SuggestionQueue(join(memoryDir, PENDING_FILE));
	const archive = new ArchiveStore(memoryDir);

	// ── memory_core 工具 ────────────────────────────────────────
	const writeGap = writeGapCounter(ctx, () => s.perTurnWriteGuard === true);
	/**
	 * 写入成功后清 gap，否则看门狗每轮都会提醒「没写记忆」。
	 * 只看 daily/project（对齐 evolve）：写一条 memory/user/key 就清计数，
	 * 会让看门狗永远追不到真正漏写的日志。
	 */
	const markWrote = (target, agent) => {
		// full 模式对齐 evolve：只看 daily/project，写 memory/user/key 不清计数。
		// lite 模式没有这两轨可写，退回「任意轨写入即清零」，否则看门狗永远追不到终点。
		if (s.memoryTracks === "full" && target !== "daily" && target !== "project") return;
		try {
			writeGap?.noteWrite?.(agent);
		} catch {}
	};

	/** 子代理只能读，不能往常驻记忆轨写（对齐 evolve 的写入门禁）。 */
	const isSubagent = (agent) => agent?.session?.header?.origin === "subagent";
	const ARCHIVE_TRACKS = new Set(["memory", "user", "key"]);

	const memoryTool = {
		name: "memory_core",
		description:
			"读写遮蔽会话的隔离记忆（与全局 memory 工具互不影响）。target 可选：memory（长期记忆）、user（用户偏好）、key（关键事实，需确认）、project（项目记忆，需 full 模式）、daily（每日日志，需 full 模式）。",
		parameters: {
			type: "object",
			properties: {
				action: { type: "string", enum: ["add", "list", "replace", "remove", "archive"], description: "操作" },
				target: { type: "string", enum: ["memory", "user", "key", "project", "daily"], description: "记忆轨" },
				content: { type: "string", description: "新内容（add/replace 时必填）" },
				match: { type: "string", description: "匹配子串（replace/remove/archive 时必填；命中多条会报错）" },
				entries: { type: "array", items: { type: "string" }, description: "批量写入（仅 daily/project，一次调用写多条）" },
				reason: { type: "string", description: "key 建议的理由（写进待确认队列，供确认时参考）" },
				limit: { type: "integer", description: "list 返回条数（默认 50）" },
				recent: { type: "boolean", description: "list 是否按时间倒序（默认 true）" },
				filter: { type: "string", description: "list 关键词过滤" },
				since: { type: "string", description: "list 起始日期 YYYY-MM-DD" },
				until: { type: "string", description: "list 结束日期 YYYY-MM-DD" },
			},
			required: ["action", "target"],
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					message: { type: "string" },
					target: { type: "string" },
					entries: { type: "array", items: { type: "string" } },
					count: { type: "integer" },
					total: { type: "integer" },
					queued: { type: "boolean" },
				},
				required: ["ok", "message"],
			},
			render: (_args, value) => [{ type: "text", text: value.message || (value.ok ? "ok" : "failed") }],
		},
		async execute(args, exec) {
			refreshLive();
			const { action, target } = args;
			const agent = exec?.agent;
			try {
				if (!tracksOf(s.memoryTracks).includes(target)) {
					return { ok: false, message: `${target} 不在当前模式（${s.memoryTracks}）的可用轨里`, target };
				}
				if (isSubagent(agent) && (action === "add" || action === "replace") && (target === "memory" || target === "user")) {
					return { ok: false, message: "子代理不能写常驻记忆轨（memory/user），请在主会话里写", target };
				}
				if (action === "list") {
					// 项目轨必须能定位到文件：定位不到要明确报错，
					// 否则 query 会走 readRaw 的降级分支返回 0 条，被误读成「这个项目没有记忆」。
					try {
						store.pathOf(target, agent);
					} catch (e) {
						return { ok: false, message: e?.message ?? String(e), target };
					}
					const stats = {};
					const rows = store.query(target, agent, {
						filter: args.filter,
						since: args.since,
						until: args.until,
						limit: Number.isInteger(args.limit) ? args.limit : 50,
						recent: args.recent !== false,
					}, stats);
					const total = stats.total ?? rows.length;
					return {
						ok: true,
						message: rows.length < total
							? `${target} 轨共 ${total} 条，按时间倒序返回 ${rows.length} 条（可用 filter/since/until/limit 收窄）`
							: `${target} 轨 ${total} 条`,
						target, entries: rows, count: rows.length, total,
					};
				}
				if (action === "add") {
					const many = Array.isArray(args.entries) && args.entries.length > 0;
					const list = many ? args.entries : (args.content ? [args.content] : []);
					if (list.length === 0) return { ok: false, message: "add 需要 content（daily/project 可用 entries 批量）", target };
					if (many && target !== "daily" && target !== "project") {
						return { ok: false, message: "批量 entries 只支持 daily/project", target };
					}
					if (target === "key") {
						const cwd = agent?.session?.header?.cwd ?? null;
						let queuedCount = 0;
						let duplicated = 0;
						for (const text of list) {
							const dup = pending.mutate((items) => {
								const norm = String(text).trim();
								const hit = items.findIndex((p) => p.target === target && String(p.content ?? "").trim() === norm);
								if (hit >= 0) {
									items[hit].hits = (items[hit].hits ?? 1) + 1;
									items[hit].lastSeen = new Date().toISOString();
									return true;
								}
								items.push({ target, content: text, at: new Date().toISOString(), cwd, reason: args.reason ?? null, hits: 1 });
								return false;
							});
							if (dup) duplicated += 1; else queuedCount += 1;
						}
						return {
							ok: true,
							message: `已加入待确认队列 ${queuedCount} 条${duplicated ? `（去重 ${duplicated} 条）` : ""}，用户确认后生效。`,
							target, queued: true, count: queuedCount,
						};
					}
					const results = list.map((text) => store.add(target, text, agent));
					const failed = results.find((r) => r?.ok === false);
					if (failed) return { ok: false, message: failed.message || `写入 ${target} 失败`, target };
					markWrote(target, agent);
					return { ok: true, message: `已写入 ${target} ${list.length} 条`, target, count: list.length };
				}
				if (action === "replace") {
					if (!args.match || !args.content) return { ok: false, message: "replace 需要 match 和 content", target };
					const peek = store.peek(target, args.match, agent);
					if (peek?.ok === false) return { ok: false, message: peek.message || "没有找到要替换的条目", target };
					const r = store.updateEntryContent(target, peek.entry, args.content, agent);
					if (r?.ok === false) return { ok: false, message: r.message || "替换失败", target };
					markWrote(target, agent);
					return { ok: true, message: `已替换 ${target} 轨条目（保留原时间戳）`, target };
				}
				if (action === "remove") {
					if (!args.match) return { ok: false, message: "remove 需要 match", target };
					const peek = store.peek(target, args.match, agent);
					if (peek?.ok === false) return { ok: false, message: peek.message, target };
					const r = store.removeExact(target, peek.entry, agent);
					if (r?.ok === false) return { ok: false, message: r.message, target };
					return { ok: true, message: r.message || `已删除 ${target} 轨条目`, target };
				}
				if (action === "archive") {
					if (!args.match) return { ok: false, message: "archive 需要 match", target };
					if (!ARCHIVE_TRACKS.has(target)) return { ok: false, message: "archive 只支持 memory/user/key 三轨", target };
					// 两步校验：先按子串定位唯一一条（模型常用子串），再按整条精确复核，
					// 保证写进归档与从主轨删掉的是同一条原文，避免子串误伤。
					const peek = store.peek(target, args.match, agent);
					if (peek?.ok === false) return { ok: false, message: peek.message || "找不到要归档的条目", target };
					const exact = store.peekExact(target, peek.entry, agent);
					if (exact?.ok === false) return { ok: false, message: exact.message || "主轨里没有这条条目", target };
					const cwd = agent?.session?.header?.cwd;
					const a = archive.append(target, exact.entry, cwd);
					if (a?.ok === false) return { ok: false, message: a.message || "写入归档失败", target };
					const r = store.removeExact(target, exact.entry, agent);
					if (r?.ok === false) return { ok: false, message: `已写入归档但删除主轨失败：${r.message}`, target };
					return { ok: true, message: `已归档 ${target} 轨条目`, target };
				}
				return { ok: false, message: `未知 action: ${action}`, target };
			} catch (e) {
				return { ok: false, message: e?.message ?? String(e), target };
			}
		},
	};
	if (primary) ctx.effect(() => ctx.tools.register(memoryTool), `${name}: memory tool`);

	// ── memory-core:snapshot 注入 ──────────────────────────────
	if (primary)
		ctx.effect(
		() =>
			ctx.systemPrompt.context({
				name: "memory-core:snapshot",
				order: s.snapshotOrder,
				text: (context) => {
					refreshLive();
					// 优先用宿主渲染上下文里的 agent（evolve 同口径）：ctx.get("agent") 在 preset 作用域
					// 常常拿不到带 cwd 的会话，full 模式下 key 会因此整轨静默不注入。
					return renderSnapshot(store, s, writeGap, { agent: context?.agent ?? agentOf(ctx) });
				},
			}),
		`${name}: memory-core:snapshot inject`,
	);

	// ── webServer API ───────────────────────────────────────────
	if (primary)
		ctx.effect(
		() =>
			ctx.webServer.register({
				kind: "prefix",
				path: "/api/memory-core",
				handler: async (req, res) => {
					const url = new URL(req.url, "http://127.0.0.1");
					const json = (code, data) => {
						res.writeHead(code, { "content-type": "application/json" });
						res.end(JSON.stringify(data));
					};
					const denied = sameOriginBlocked(req);
					if (denied) {
						json(403, { ok: false, why: denied });
						return;
					}
										const agent = agentOf(ctx);
					const cwd = agent?.session?.header?.cwd;
					// 设置页面板改过的值每请求重读一次（与工具/注入同口径）
					refreshLive();

					// GET /config —— 当前生效配置 + 覆盖层文件位置（设置页「配置」页签）
					if (req.method === "GET" && url.pathname === "/api/memory-core/config") {
						json(200, {
							ok: true,
							data: {
								memoryTracks: s.memoryTracks,
								writeGuard: s.writeGuard === true,
								perTurnWriteGuard: s.perTurnWriteGuard === true,
								writeGuardThreshold: s.writeGuardThreshold,
								snapshotOrder: s.snapshotOrder,
								presetName: s.presetName,
								layer: s.presetName === DEFAULTS.presetName ? "profile" : "preset",
								livePath: liveConfigPath(memoryDir),
								live: readLiveConfig(memoryDir),
							},
						});
						return;
					}

					// POST /config —— 写覆盖层，下一拍生效（对齐 evolve 的「修改立即生效并持久化」）
					if (req.method === "POST" && url.pathname === "/api/memory-core/config") {
						try {
							const body = await new Promise((resolve) => {
								let raw = "";
								req.on("data", (c) => (raw += c));
								req.on("end", () => {
									try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); }
								});
							});
							const live = writeLiveConfig(memoryDir, body?.patch ?? body ?? {});
							refreshLive();
							json(200, {
								ok: true,
								data: {
									live,
									memoryTracks: s.memoryTracks,
									writeGuard: s.writeGuard === true,
									perTurnWriteGuard: s.perTurnWriteGuard === true,
									writeGuardThreshold: s.writeGuardThreshold,
									snapshotOrder: s.snapshotOrder,
								},
							});
						} catch (e) {
							json(500, { ok: false, why: e?.message ?? String(e) });
						}
						return;
					}

					// GET /manage —— 返回 manage.html 页面
					if (req.method === "GET" && url.pathname === "/api/memory-core/manage") {
						try {
							const htmlPath = join(dirname(fileURLToPath(import.meta.url)), "manage.html");
							const html = readFileSync(htmlPath, "utf8");
							res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
							res.end(html);
						} catch (e) {
							json(500, { ok: false, why: e?.message ?? String(e) });
						}
						return;
					}

					// GET /status —— 面板状态
					if (req.method === "GET" && url.pathname === "/api/memory-core/status") {
						json(200, {
							ok: true,
							data: {
								memoryEnabled: true,
								memoryTracks: s.memoryTracks,
								presetName: s.presetName,
								// layer=profile 说明它是被插件列表开关拉起来的（没在 preset 里挂）：
								// 所有会话都会多一份隔离记忆，还会和 evolve 双写，面板要黄条提示。
								layer: s.presetName === DEFAULTS.presetName ? "profile" : "preset",
								memoryDir,
								tracks: tracksOf(s.memoryTracks),
							},
						});
						return;
					}

					// GET /files —— 每轨的文件位置、条数、归档与待确认数（记忆管理页的页签用）
					if (req.method === "GET" && url.pathname === "/api/memory-core/files") {
						const qcwd = url.searchParams.get("cwd") || cwd;
						const probe = qcwd ? { session: { header: { cwd: qcwd } } } : agent;
						const labels = {
							memory: "长期记忆 MEMORY.md",
							user: "用户档案 USER.md",
							project: "项目日志",
							key: "项目关键记忆 KEY.md",
							daily: "今日日志",
						};
						const rows = tracksOf(s.memoryTracks).map((track) => {
							const row = {
								track,
								title: labels[track] ?? track,
								available: true,
								exists: false,
								path: "",
								count: 0,
								archived: 0,
								pending: 0,
							};
							try {
								row.path = store.pathOf(track, probe);
								row.exists = existsSync(row.path);
								row.count = store.entriesOf(track, probe).length;
							} catch {
								row.available = false;
							}
							try {
								row.archived = ARCHIVE_TRACKS.has(track) ? archive.entriesOf(track, qcwd).length : 0;
							} catch {
								row.archived = 0;
							}
							try {
								row.pending = pending.read().filter((p) => p.target === track).length;
							} catch {
								row.pending = 0;
							}
							return row;
						});
						json(200, {
							ok: true,
							data: {
								rows,
								cwd: qcwd ?? null,
								memoryDir,
								memoryTracks: s.memoryTracks,
								presetName: s.presetName,
							},
						});
						return;
					}

					// GET /entries?track=memory —— 列出某轨正式条目 + 待确认 + 归档
					if (req.method === "GET" && url.pathname === "/api/memory-core/entries") {
						const track = url.searchParams.get("track") || "memory";
						const qcwd = url.searchParams.get("cwd") || cwd;
						const probe = qcwd ? { session: { header: { cwd: qcwd } } } : agent;
						try {
							const entries = store.entriesOf(track, probe);
							const pendingItems = pending.read().filter((p) => p.target === track);
							// 归档只有 memory/user/key 三轨；project/daily 没有归档文件，直接给空数组
							const archived = ARCHIVE_TRACKS.has(track) ? archive.entriesOf(track, qcwd) : [];
							json(200, { ok: true, data: { track, entries, pending: pendingItems, archived, count: entries.length } });
						} catch (e) {
							json(500, { ok: false, why: e?.message ?? String(e) });
						}
						return;
					}

					// POST /reveal —— 用系统资源管理器定位记忆文件（管理页「打开文件」）
					if (req.method === "POST" && url.pathname === "/api/memory-core/reveal") {
						const body = await new Promise((done) => {
							let raw = "";
							req.on("data", (c) => (raw += c));
							req.on("end", () => {
								try { done(JSON.parse(raw || "{}")); } catch { done({}); }
							});
						});
						const target = resolve(String(body?.path ?? ""));
						const root = resolve(memoryDir);
						if (target !== root && !target.startsWith(root + sep)) {
							json(400, { ok: false, why: "路径不在记忆目录内" });
							return;
						}
						if (!existsSync(target)) {
							json(404, { ok: false, why: "文件尚不存在" });
							return;
						}
						try {
							spawn("explorer.exe", ["/select," + target], { detached: true, stdio: "ignore" }).unref();
							json(200, { ok: true });
						} catch (e) {
							json(500, { ok: false, why: e?.message ?? String(e) });
						}
						return;
					}

					// POST /entry —— 所有写操作
					if (req.method === "POST" && url.pathname === "/api/memory-core/entry") {
						try {
							const body = await new Promise((resolve) => {
								let raw = "";
								req.on("data", (c) => (raw += c));
								req.on("end", () => {
									try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); }
								});
							});
							const { action, track, target, content, entry, match } = body;
							const t = track || target || "memory";
							if (!tracksOf(s.memoryTracks).includes(t)) {
								return json(400, { ok: false, why: `${t} 不在当前模式（${s.memoryTracks}）的可用轨里` });
							}
							const ARCHIVE_ACTIONS = new Set(["archive", "promote", "removeArchive"]);
							if (ARCHIVE_ACTIONS.has(action) && !ARCHIVE_TRACKS.has(t)) {
								return json(400, { ok: false, why: "归档只支持 memory/user/key 三轨" });
							}
							// 管理页在别的会话里打开时，项目记忆与关键事实需要显式 cwd；
							// 会话内调用不传 cwd，退回当前 agent。
							const bcwd = typeof body.cwd === "string" && body.cwd.trim() ? body.cwd.trim() : cwd;
							const actx = bcwd && bcwd !== cwd ? { session: { header: { cwd: bcwd } } } : agent;
							const fail = (r, fallback) => json(400, { ok: false, why: r?.message || fallback });
							// 面板传整条（精确命中优先）；工具/脚本常传子串，退回唯一子串定位。
							const resolveEntry = (t, raw, actx) => {
								const key = String(raw ?? "").trim();
								if (!key) return { ok: false, message: "条目内容为空" };
								const exact = store.peekExact(t, key, actx);
								if (exact?.ok !== false) return exact;
								return store.peek(t, key, actx);
							};
							const resolveArchived = (t, raw, cwd) => {
								const key = String(raw ?? "").trim();
								if (!key) return { ok: false, message: "条目内容为空" };
								const all = archive.entriesOf(t, cwd) ?? [];
								const exact = all.find((e) => e.trim() === key);
								if (exact) return { ok: true, entry: exact };
								const hits = all.filter((e) => e.includes(key));
								if (hits.length === 1) return { ok: true, entry: hits[0] };
								if (hits.length === 0) return { ok: false, message: `归档中没有包含「${key}」的条目` };
								return { ok: false, message: `「${key}」在归档里命中 ${hits.length} 条，无法确定是哪一条` };
							};
							// 面板会带 target（当前页签）；不带的调用（工具/脚本）退回只按内容匹配。
							const explicitTarget = track || target || null;

							if (action === "add") {
								if (t === "key") {
									const dup = pending.mutate((items) => {
										const norm = String(content ?? "").trim();
										const hit = items.findIndex((p) => p.target === t && String(p.content ?? "").trim() === norm);
										if (hit >= 0) {
											items[hit].hits = (items[hit].hits ?? 1) + 1;
											items[hit].lastSeen = new Date().toISOString();
											return true;
										}
										items.push({ target: t, content, at: new Date().toISOString(), cwd: bcwd ?? null, reason: body.reason ?? null, hits: 1 });
										return false;
									});
									return json(200, { ok: true, data: { action, target: t, queued: true, duplicated: !!dup } });
								}
								const r = store.add(t, content, actx);
								if (r?.ok === false) return fail(r, `写入 ${t} 失败`);
								markWrote(t, agent);
								return json(200, { ok: true, data: { action, target: t } });
							}
							if (action === "replace" || action === "edit" || action === "saveEdit") {
								const src = String(match || entry || "").trim();
								const peek = resolveEntry(t, src, actx);
								if (peek?.ok === false) return fail(peek, "找不到要编辑的条目");
								const r = store.updateEntryContent(t, peek.entry, content, actx);
								if (r?.ok === false) return fail(r, "编辑失败");
								markWrote(t, agent);
								return json(200, { ok: true, data: { action, target: t } });
							}
							if (action === "delete" || action === "remove") {
								const src = String(match || entry || "").trim();
								const peek = resolveEntry(t, src, actx);
								if (peek?.ok === false) return fail(peek, "找不到要删除的条目");
								const r = store.removeExact(t, peek.entry, actx);
								if (r?.ok === false) return fail(r, "删除失败");
								return json(200, { ok: true, data: { action, target: t } });
							}
							if (action === "archive") {
								const src = String(entry || match || "").trim();
								const peek = resolveEntry(t, src, actx);
								if (peek?.ok === false) return fail(peek, "找不到要归档的条目");
								const a = archive.append(t, peek.entry, bcwd);
								if (a?.ok === false) return fail(a, "写入归档失败");
								const r = store.removeExact(t, peek.entry, actx);
								if (r?.ok === false) return json(500, { ok: false, why: `已写入归档但删除主轨失败：${r.message}` });
								return json(200, { ok: true, data: { action, target: t } });
							}
							if (action === "confirm") {
								const want = String(entry ?? "").trim();
								const items = pending.read();
								const idx = items.findIndex(
									(p) => (!explicitTarget || p.target === t) && String(p.content ?? "").trim() === want,
								);
								if (idx < 0) return json(404, { ok: false, why: "待确认队列里没有这条" });
								const item = items[idx];
								const itemCtx = item.cwd ? { session: { header: { cwd: item.cwd } } } : actx;
								const r = store.add(item.target, item.content, itemCtx);
								if (r?.ok === false) return fail(r, "写入失败，建议条目保留在队列里");
								pending.write(items.filter((_, i) => i !== idx));
								markWrote(item.target, agent);
								return json(200, { ok: true, data: { action, target: t } });
							}
							if (action === "reject") {
								const want = String(entry ?? "").trim();
								const before = pending.read();
								const after = before.filter(
									(p) => !((!explicitTarget || p.target === t) && String(p.content ?? "").trim() === want),
								);
								if (after.length === before.length) return json(404, { ok: false, why: "待确认队列里没有这条" });
								pending.write(after);
								return json(200, { ok: true, data: { action, target: t } });
							}
							if (action === "promote") {
								const pick = resolveArchived(t, entry, bcwd);
								if (pick?.ok === false) return fail(pick, "归档里没有这条");
								const src = pick.entry;
								// 转正前剥掉归档时附带的理由行与原轨行，否则主轨会被污染
								const clean = src
									.replace(/\n?（归档理由：[^）]*）/g, "")
									.replace(/\n?（原轨：[^）]*）/g, "")
									.trim();
								const r = store.add(t, clean, actx);
								if (r?.ok === false) return fail(r, "写回主轨失败");
								const rm = archive.removeExact(t, src, bcwd);
								markWrote(t, agent);
								return json(200, { ok: true, data: { action, target: t, archiveRemoved: rm?.ok === true } });
							}
							if (action === "removeArchive") {
								const pick = resolveArchived(t, entry, bcwd);
								if (pick?.ok === false) return fail(pick, "归档里没有这条");
								const r = archive.removeExact(t, pick.entry, bcwd);
								if (r?.ok === false) return fail(r, "归档里没有这条");
								return json(200, { ok: true, data: { action, target: t } });
							}
							return json(400, { ok: false, why: "unknown action: " + action });
						} catch (e) {
							json(500, { ok: false, why: e?.message ?? String(e) });
						}
						return;
					}

					json(404, { ok: false, why: "not found" });
				},
			}),
		`${name}: webServer API`,
	);

	ctx.logger.info(
		`${name}: memory-core active — mode=${s.memoryTracks}, dir=${memoryDir}, tracks=${tracksOf(s.memoryTracks).join("/")}`,
	);
}

export { apply, inject, name };
export { Config } from "./lib/schema.js";
