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
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const name = PLUGIN_NAME;
const inject = ["systemPrompt", "tools", "webServer"];

function apply(ctx, config) {
	const s = { ...DEFAULTS, ...(config ?? {}) };
	const memoryDir = resolveMemoryDir(s);
	if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true });

	const store = new MemoryStore(memoryDir, { injectionScan: true });
	const pending = new SuggestionQueue(join(memoryDir, PENDING_FILE));
	const archive = new ArchiveStore(memoryDir);

	// ── memory 工具 ──────────────────────────────────────────────
	const memoryTool = {
		name: "memory",
		description:
			"读写遮蔽会话的隔离记忆。target 可选：memory（长期记忆）、user（用户偏好）、key（关键事实）、project（项目记忆，需 full 模式）、daily（每日日志，需 full 模式）。",
		parameters: {
			type: "object",
			properties: {
				action: { type: "string", enum: ["add", "list", "replace", "remove", "archive"], description: "操作" },
				target: { type: "string", enum: ["memory", "user", "key", "project", "daily"], description: "记忆轨" },
				content: { type: "string", description: "新内容（add/replace 时必填）" },
				match: { type: "string", description: "匹配子串（replace/remove 时必填）" },
			},
			required: ["action", "target"],
		},
		async call({ action, target, content, match }, ctx2) {
			try {
				if (action === "list") {
					const entries = store.entriesOf(target, ctx2.agent);
					return { ok: true, data: { target, entries, count: entries.length } };
				}
				if (action === "add") {
					if (!content) return { ok: false, why: "add 需要 content" };
					// key 轨走待确认队列
					if (target === "key" && s.writeGuard) {
						pending.append({ target, content, at: new Date().toISOString() });
						return { ok: true, data: { queued: true, note: "已加入待确认队列，用户确认后生效。" } };
					}
					store.add(target, content, ctx2.agent);
					return { ok: true, data: { added: true } };
				}
				if (action === "replace") {
					if (!match || !content) return { ok: false, why: "replace 需要 match 和 content" };
					store.replace(target, match, content, ctx2.agent);
					return { ok: true, data: { replaced: true } };
				}
				if (action === "remove") {
					if (!match) return { ok: false, why: "remove 需要 match" };
					store.remove(target, match, ctx2.agent);
					return { ok: true, data: { removed: true } };
				}
				if (action === "archive") {
					if (!match) return { ok: false, why: "archive 需要 match" };
					// 先从主轨移除，再追加到归档
					const removed = store.remove(target, match, ctx2.agent);
					if (removed?.ok !== false) {
						archive.append(target, removed?.removed || match, ctx2.agent?.session?.header?.cwd);
					}
					return { ok: true, data: { archived: true } };
				}
				return { ok: false, why: `未知 action: ${action}` };
			} catch (e) {
				return { ok: false, why: e?.message ?? String(e) };
			}
		},
	};
	ctx.effect(() => ctx.tools.register(memoryTool), `${name}: memory tool`);

	// ── memory:snapshot 注入 ────────────────────────────────────
	const writeGap = writeGapCounter(ctx, () => s.writeGuard === true);
	ctx.effect(
		() =>
			ctx.systemPrompt.inject("memory:snapshot", () => renderSnapshot(store, s, writeGap, { agent: ctx.agent }), {
				order: s.snapshotOrder,
			}),
		`${name}: memory:snapshot inject`,
	);

	// ── webServer entries API ────────────────────────────────────
	ctx.effect(
		() =>
			ctx.webServer.register({
				kind: "prefix",
				path: "/api/memory-shield",
				handler: async (req, res) => {
					const url = new URL(req.url, "http://127.0.0.1");
					const json = (code, data) => {
						res.writeHead(code, { "content-type": "application/json" });
						res.end(JSON.stringify(data));
					};

					// GET /entries?track=memory —— 列出某轨条目
					if (req.method === "GET" && url.pathname === "/api/memory-shield/entries") {
						const track = url.searchParams.get("track") || "memory";
						try {
							const entries = store.entriesOf(track, ctx.agent);
							json(200, { ok: true, data: { track, entries, count: entries.length } });
						} catch (e) {
							json(500, { ok: false, why: e?.message ?? String(e) });
						}
						return;
					}

					// GET /pending —— 待确认队列
					if (req.method === "GET" && url.pathname === "/api/memory-shield/pending") {
						try {
							const items = pending.read();
							json(200, { ok: true, data: { items, count: items.length } });
						} catch (e) {
							json(500, { ok: false, why: e?.message ?? String(e) });
						}
						return;
					}

					// POST /entry —— 新增/替换/删除
					if (req.method === "POST" && url.pathname === "/api/memory-shield/entry") {
						try {
							const body = await new Promise((resolve) => {
								let raw = "";
								req.on("data", (c) => (raw += c));
								req.on("end", () => {
									try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); }
								});
							});
							const { action, target, content, match } = body;
							if (action === "add") store.add(target, content, ctx.agent);
							else if (action === "replace") store.replace(target, match, content, ctx.agent);
							else if (action === "remove") store.remove(target, match, ctx.agent);
							else if (action === "archive") {
								const removed = store.remove(target, match, ctx.agent);
								if (removed?.ok !== false) {
									archive.append(target, removed?.removed || match, ctx.agent?.session?.header?.cwd);
								}
							}
							else return json(400, { ok: false, why: "unknown action" });
							json(200, { ok: true, data: { action, target } });
						} catch (e) {
							json(500, { ok: false, why: e?.message ?? String(e) });
						}
						return;
					}

					json(404, { ok: false, why: "not found" });
				},
			}),
		`${name}: webServer entries API`,
	);

	ctx.logger.info(
		`${name}: companion active — mode=${s.memoryTracks}, dir=${memoryDir}, tracks=${tracksOf(s.memoryTracks).join("/")}`,
	);
}

export { apply, inject, name };
export { Config } from "./lib/schema.js";
