/**
 * dsh-memory-core —— 遮蔽会话的 companion 记忆包。
 *
 * 与 shield 包配对使用：shield 挡住其他记忆插件的注入，本包给遮蔽会话加一套
 * 隔离的记忆存储（独立数据目录，与普通会话的 dsh-memory-evolve 完全隔离）。
 *
 * 默认 lite 模式（三轨 memory/user/key）；切 full 模式（五轨）由用户在设置里改。
 */
import { PLUGIN_NAME } from "./lib/constants.js";
import { DEFAULTS, resolveMemoryDir } from "./lib/defaults.js";
import { MemoryStore, SuggestionQueue, ArchiveStore } from "./lib/store.js";
import { renderSnapshot } from "./lib/render.js";
import { writeGapCounter } from "./lib/watchdog.js";
import { tracksOf, TRACK_FILES, PENDING_FILE } from "./lib/tracks.js";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const name = PLUGIN_NAME;
const inject = ["systemPrompt", "tools", "webServer"];

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

function apply(ctx, config) {
	const s = { ...DEFAULTS, ...(config ?? {}) };
	const memoryDir = resolveMemoryDir(s);
	if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true });

	const store = new MemoryStore(memoryDir, { injectionScan: true, memoryTracks: s.memoryTracks });
	const pending = new SuggestionQueue(join(memoryDir, PENDING_FILE));
	const archive = new ArchiveStore(memoryDir);

	// ── memory_core 工具 ────────────────────────────────────────
	const writeGap = writeGapCounter(ctx, () => s.writeGuard === true);
	/** 写入成功后清 gap，否则看门狗每轮都会提醒「没写记忆」 */
	const markWrote = (agent) => {
		try {
			writeGap?.noteWrite?.(agent);
		} catch {}
	};

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
				match: { type: "string", description: "匹配子串（replace/remove/archive 时必填）" },
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
					queued: { type: "boolean" },
				},
				required: ["ok", "message"],
			},
			render: (_args, value) => [{ type: "text", text: value.message || (value.ok ? "ok" : "failed") }],
		},
		async execute({ action, target, content, match }, exec) {
			try {
				if (action === "list") {
					const entries = store.entriesOf(target, exec?.agent);
					return { ok: true, message: `${target} 轨 ${entries.length} 条`, target, entries, count: entries.length };
				}
				if (action === "add") {
					if (!content) return { ok: false, message: "add 需要 content", target };
					// key 轨走待确认队列
					if (target === "key" && s.writeGuard) {
						pending.append({ target, content, at: new Date().toISOString() });
						return { ok: true, message: "已加入待确认队列，用户确认后生效。", target, queued: true };
					}
					const r = store.add(target, content, exec?.agent);
					if (r?.ok !== false) markWrote(exec?.agent);
					return { ok: r?.ok !== false, message: r?.message || `已写入 ${target}`, target };
				}
				if (action === "replace") {
					if (!match || !content) return { ok: false, message: "replace 需要 match 和 content", target };
					const r = store.replace(target, match, content, exec?.agent);
					if (r?.ok !== false) markWrote(exec?.agent);
					return { ok: r?.ok !== false, message: r?.message || `已替换 ${target}`, target };
				}
				if (action === "remove") {
					if (!match) return { ok: false, message: "remove 需要 match", target };
					const r = store.remove(target, match, exec?.agent);
					return { ok: r?.ok !== false, message: r?.message || `已删除 ${target}`, target };
				}
				if (action === "archive") {
					if (!match) return { ok: false, message: "archive 需要 match", target };
					// 先写归档、再删主轨：两步之间断掉也不会丢内容
					const peek = store.peek(target, match, exec?.agent);
					if (peek?.ok === false) return { ok: false, message: peek.message || "找不到要归档的条目", target };
					archive.append(target, peek.entry, exec?.agent?.session?.header?.cwd);
					const r = store.remove(target, match, exec?.agent);
					return { ok: r?.ok !== false, message: r?.message || `已归档 ${target}`, target };
				}
				return { ok: false, message: `未知 action: ${action}`, target };
			} catch (e) {
				return { ok: false, message: e?.message ?? String(e), target };
			}
		},
	};
	ctx.effect(() => ctx.tools.register(memoryTool), `${name}: memory tool`);

	// ── memory-core:snapshot 注入 ──────────────────────────────
	ctx.effect(
		() =>
			ctx.systemPrompt.context({
				name: "memory-core:snapshot",
				order: s.snapshotOrder,
				text: () => renderSnapshot(store, s, writeGap, { agent: ctx.agent }),
			}),
		`${name}: memory-core:snapshot inject`,
	);

	// ── webServer API ───────────────────────────────────────────
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
					const cwd = ctx.agent?.session?.header?.cwd;

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
								memoryDir,
								tracks: tracksOf(s.memoryTracks),
							},
						});
						return;
					}

					// GET /entries?track=memory —— 列出某轨正式条目 + 待确认 + 归档
					if (req.method === "GET" && url.pathname === "/api/memory-core/entries") {
						const track = url.searchParams.get("track") || "memory";
						try {
							const entries = store.entriesOf(track, ctx.agent);
							const pendingItems = pending.read().filter((p) => p.target === track);
							const archived = archive.entriesOf(track, cwd);
							json(200, { ok: true, data: { track, entries, pending: pendingItems, archived, count: entries.length } });
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
							const { action, track, target, content, entry, match, index } = body;
							const t = track || target || "memory";

							if (action === "add") {
								if (t === "key" && s.writeGuard) {
									pending.append({ target: t, content, at: new Date().toISOString() });
								} else {
									const r = store.add(t, content, ctx.agent);
									if (r?.ok !== false) markWrote(ctx.agent);
								}
							} else if (action === "replace" || action === "edit" || action === "saveEdit") {
								const r = store.replace(t, match || entry, content, ctx.agent);
								if (r?.ok !== false) markWrote(ctx.agent);
							} else if (action === "delete" || action === "remove") {
								store.remove(t, match || entry, ctx.agent);
							} else if (action === "archive") {
								// 先写归档、再删主轨（两步之间断掉也不丢内容）
								archive.append(t, entry || match, cwd);
								store.remove(t, match || entry, ctx.agent);
							} else if (action === "confirm") {
								// 待确认 → 正式写入；按内容匹配，不用前端索引（前端列表是过滤后的）
								const items = pending.read();
								const want = String(entry ?? "").trim();
								const idx = items.findIndex((p) => String(p.content ?? "").trim() === want);
								if (idx >= 0) {
									const r = store.add(items[idx].target, items[idx].content, ctx.agent);
									if (r?.ok !== false) {
										items.splice(idx, 1);
										pending.write(items);
										markWrote(ctx.agent);
									}
								}
							} else if (action === "reject") {
								// 待确认 → 删除；同样按内容匹配
								const items = pending.read();
								const want = String(entry ?? "").trim();
								const idx = items.findIndex(
									(p) => p.target === t && String(p.content ?? "").trim() === want,
								);
								if (idx >= 0) {
									items.splice(idx, 1);
									pending.write(items);
								}
							} else if (action === "promote") {
								// 归档 → 移回主轨：先写主轨，写成功才删归档
								const r = store.add(t, entry, ctx.agent);
								if (r?.ok !== false) {
									archive.removeExact(t, entry, cwd);
									markWrote(ctx.agent);
								}
							} else if (action === "removeArchive") {
								archive.removeExact(t, entry, cwd);
							} else {
								return json(400, { ok: false, why: "unknown action: " + action });
							}
							json(200, { ok: true, data: { action, target: t } });
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
		`${name}: companion active — mode=${s.memoryTracks}, dir=${memoryDir}, tracks=${tracksOf(s.memoryTracks).join("/")}`,
	);
}

export { apply, inject, name };
export { Config } from "./lib/schema.js";
