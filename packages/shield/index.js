/**
 * dsh-memory-shield — 通用记忆遮蔽插件（纯遮蔽器，无面板）。
 *
 * 在指定 preset 内遮蔽其他记忆插件的注入和工具，让这个通道拥有干净的上下文。
 * 本插件不自带任何记忆存储/写入/管理能力——记忆是可选 companion 插件的事。
 * 查看遮蔽状态：让 agent 调用 shadow_diagnose 工具。
 *
 * 分层：
 *   - profile 层（无会话上下文）：只注册 GET /api/memory-shield/state 与提示，不遮蔽、不写盘。
 *   - preset 层（有会话上下文）：注册遮蔽逻辑（memory context + tools）。
 */
import { PLUGIN_NAME } from "./lib/constants.js";
import { DEFAULTS } from "./lib/defaults.js";
import { shadowEmptyContext, shadowTool, shadowDiagnoseTool, isMemorySection } from "./lib/shadow.js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// 分层判定依赖内核的 scope API；拿不到时保守判为 profile 层（不遮蔽），并把原因记下来。
let scopeApi = null;
let scopeImportError = null;
try { scopeApi = await import("@deepseek-ai/dsh-scope"); } catch (e) { scopeApi = null; scopeImportError = e?.message || String(e); }

// 分层判定的纯函数（dryrun 直接测，不依赖真实 ctx）：
// preset 插件由 preset registry 在 generation scope 里挂载，scopeOf(ctx) 有值；
// profile 层（bundle patch）跑在 root ctx 上，scopeOf(ctx) 返回 undefined。
// 注意：generation scope 没有 parent（registry 建 scope 不传 options.parent），不能用 scopeParentOf 判。
export function layerFromScope(scopeKey, hasScopeApi, forced) {
	if (forced === "preset") return "preset";
	if (forced === "profile") return "profile";
	if (!hasScopeApi) return "profile";
	return scopeKey !== undefined && scopeKey !== null ? "preset" : "profile";
}

// UI 配置写到用户数据目录（~/.dsh/plugin-data/<pkg>/），避免 npm install 覆盖
const HOME = process.env.USERPROFILE || process.env.HOME || '';
const UI_DIR = HOME ? join(HOME, '.dsh', 'plugin-data', 'dsh-memory-shield') : HERE;
const UI_CFG = join(UI_DIR, 'ui-config.json');

function readUiCfg() {
  try {
    return JSON.parse(readFileSync(UI_CFG, "utf8"));
  } catch { return {}; }
}
function writeUiCfg(patch) {
  const cur = readUiCfg();
  const next = { ...cur, ...patch };
  try { mkdirSync(UI_DIR, { recursive: true }); } catch {}
  writeFileSync(UI_CFG, JSON.stringify(next, null, 2), "utf8");
  return next;
}

const name = PLUGIN_NAME;
const inject = ["systemPrompt", "tools", "webServer"];

function apply(ctx, config) {
	const s = { ...DEFAULTS, ...(config ?? {}) };

	// 判定分层：preset 插件挂在 generation scope（scopeOf 有值、但**没有 parent**）；
	// profile 层在 root ctx（scopeOf 返回 undefined）。拿不到 dsh-scope 时保守判为 profile 层。
	// __forceLayer 仅给 dryrun 用，生产上下文不会设它。
	const forced = ctx?.__forceLayer;
	const scopeKey = scopeApi?.scopeOf?.(ctx);
	const layer = layerFromScope(scopeKey, !!scopeApi, forced);
	const isPresetLayer = layer === "preset";

	if (!isPresetLayer) {
		// ── profile 层：只注册状态查询与提示，不遮蔽、不写盘 ──
		ctx.logger.info(`${name}: profile layer — registering state endpoint only (no shadowing)`);

		try {
			ctx.effect(
				() =>
					ctx.webServer.register({
						kind: 'prefix',
						path: '/api/memory-shield',
						handler: async (req, res) => {
							const url = new URL(req.url, 'http://127.0.0.1');
							const ui = readUiCfg();
							if (req.method === 'GET' && url.pathname === '/api/memory-shield/state') {
								res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
								res.end(JSON.stringify({
									ok: true,
									data: {
										enabled: s.enabled === true,
										hintDismissed: ui.hintDismissed === true,
										showInSettings: ui.showInSettings !== false && s.showInSettings !== false,
									},
								}));
								return;
							}
							if (req.method === 'POST' && url.pathname === '/api/memory-shield/config') {
								let body = {};
								try { body = await new Promise((resolve) => {
									let raw = '';
									req.on('data', (d) => { raw += d; if (raw.length > 65536) req.destroy(); });
									req.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
									req.on('error', () => resolve({}));
								}); } catch {}
								const patch = {};
								if (typeof body?.hintDismissed === 'boolean') patch.hintDismissed = body.hintDismissed;
								if (typeof body?.showInSettings === 'boolean') patch.showInSettings = body.showInSettings;
								const next = writeUiCfg(patch);
								res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
								res.end(JSON.stringify({ ok: true, data: next }));
								return;
							}
							res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
							res.end(JSON.stringify({ ok: false, why: 'not found' }));
						},
					}),
				`${name}: /api/memory-shield/state endpoint`,
			);
		} catch (e) {
			try { ctx.logger?.warn?.(`${name}: state endpoint failed: ${e?.message ?? e}`) } catch {}
		}
		return;
	}

	// ── preset 层：现有遮蔽逻辑 ──

	// 自动从会话 preset 派生
	if (s.autoPresetFromSession === true) {
		const sessionPreset = ctx.session?.header?.agentPreset;
		if (sessionPreset) {
			s.presetName = sessionPreset;
			ctx.logger.info(`${name}: auto preset from session: ${s.presetName}`);
		}
	}

	// 遮蔽诊断工具（始终注册，包括 enabled=false——只读、只报计数）
	ctx.effect(() => ctx.tools.register(shadowDiagnoseTool(ctx, s)), `${name}: shadow diagnose tool`);

	if (s.enabled !== true) {
		ctx.logger.warn(
			`${name}: shadow DISABLED by config\n` +
			`        后果：本次会话不遮蔽任何记忆 context/tool，其他记忆插件会照常注入。`,
		);
		return;
	}

	// memory:snapshot 空遮蔽（接住任何同名注入）
	ctx.effect(() => shadowEmptyContext(ctx, "memory:snapshot"), `${name}: shadow memory:snapshot (empty)`);

	// 其他记忆插件的 context section（只放行 memory 类前缀）
	for (const sectionName of s.shadowSections) {
		if (sectionName === "memory:snapshot") continue;
		if (!isMemorySection(sectionName)) {
			ctx.logger.warn(`${name}: skip non-memory section "${sectionName}" (prefix not allowed)`);
			continue;
		}
		ctx.effect(() => shadowEmptyContext(ctx, sectionName), `${name}: shadow section ${sectionName}`);
	}

	// 自动遮蔽：常见 memory:* section 名
	if (s.autoShadow === true) {
		const AUTO_SHADOW_SECTIONS = [
			"memory:profile", "memory:recall", "memory:self",
			"memory-eternal:recall", "memory-eternal:context",
			"meow-memory:context", "meow-memory:guide",
			"memory-palace:context",
		];
		for (const sectionName of AUTO_SHADOW_SECTIONS) {
			if (s.shadowSections.includes(sectionName)) continue;
			if (!isMemorySection(sectionName)) continue;
			ctx.effect(() => shadowEmptyContext(ctx, sectionName), `${name}: auto-shadow section ${sectionName}`);
		}
	}

	// 同名工具接管（精确规则，白名单统一生效）
	for (const toolName of s.shadowTools) {
		if (s.shadowWhitelist?.includes(toolName)) continue;
		ctx.effect(() => ctx.tools.register(shadowTool(toolName, s)), `${name}: shadow tool ${toolName}`);
	}

	// 自动遮蔽：常见 memory_* 工具名
	if (s.autoShadow === true) {
		const AUTO_SHADOW_TOOLS = [
			"memory", "memory_add", "memory_search", "memory_delete", "memory_recall",
			"memory_write", "memory_read", "memory_list", "memory_prune",
			"memory_import", "memory_ruminate", "memory_conflicts",
			"memory_slot_write", "memory_slot_read", "memory_slot_list",
			"memoir_read", "memoir_write",
			"memory_suggest",
			"memory_evolve_search_local_files", "memory_review_status",
		];
		for (const toolName of AUTO_SHADOW_TOOLS) {
			if (s.shadowWhitelist?.includes(toolName)) continue;
			if (s.shadowTools.includes(toolName)) continue;
			ctx.effect(() => ctx.tools.register(shadowTool(toolName, s)), `${name}: auto-shadow ${toolName}`);
		}
	}

	// 摘要日志
	ctx.logger.info(
		`${name}: shadow active — ` +
		`${s.shadowTools.length} tool rules, ${s.shadowSections.length} context sections, ` +
		`autoShadow=${s.autoShadow}, whitelist=${s.shadowWhitelist.length}, preset=${s.presetName}`,
	);
}

export { apply, inject, name };
export { Config } from "./lib/schema.js";
