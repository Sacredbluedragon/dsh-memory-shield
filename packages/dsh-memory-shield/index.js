/**
 * dsh-memory-shield — 通用记忆遮蔽插件（纯遮蔽器，无面板）。
 *
 * 在指定 preset 内遮蔽其他记忆插件的注入和工具，让这个通道拥有干净的上下文。
 * 本插件不自带任何记忆存储/写入/管理能力——记忆是可选 dsh-memory-core 包的事。
 * 查看遮蔽状态：让 agent 调用 shadow_diagnose 工具，或 GET /api/memory-shield/health。
 *
 * 分层：
 *   - profile 层（无会话上下文）：只注册 /api/memory-shield/* 状态端点，不遮蔽、不写盘。
 *   - preset 层（有会话上下文）：注册遮蔽逻辑（memory context + tools）+ 同一组端点。
 *
 * T02 改动（相对 0.1.4）：
 *   1. 遮蔽生效时，被遮蔽的第一个 context 段（memory:snapshot）返回一句说明，让 agent 知道
 *      「本会话被遮蔽」而不是「记忆插件坏了」；未启用时仍返回空串。
 *   2. 新增 GET /api/memory-shield/health。
 *   3. POST /api/memory-shield/config 加字段白名单（hintDismissed / showInSettings），
 *      其他键返回 400（原实现是静默忽略）。
 */
import { PLUGIN_NAME } from "./lib/constants.js";
import { DEFAULTS } from "./lib/defaults.js";
import { shadowEmptyContext, shadowTool, shadowDiagnoseTool, isMemorySection, SHADOW_HINT } from "./lib/shadow.js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// 分层判定依赖内核的 scope API；拿不到时保守判为 profile 层（不遮蔽）。
let scopeApi = null;
try { scopeApi = await import("@deepseek-ai/dsh-scope"); } catch { scopeApi = null; }

// 包版本：health 端点用。读自身 package.json，读不到回退 "unknown"（不抛错、不影响加载）。
const VERSION = (() => {
	try {
		const pkg = JSON.parse(readFileSync(join(HERE, "package.json"), "utf8"));
		return typeof pkg?.version === "string" ? pkg.version : "unknown";
	} catch { return "unknown"; }
})();

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

// ── HTTP 端点：单一路由 + 进程内实例登记 ─────────────────────────────
//
// 为什么不在两个分支里各注册一次 prefix：同一进程里 profile 层实例与 preset 层实例
// 可能同时存在（bundle 装进 profile，同时又被某个 preset 引用），同一 path 注册两次
// 会互相冲突。这里改成「谁先加载谁注册路由，两端共享同一个 handler，handler 每次
// 请求时再决定回答哪个实例」，并且 preset 优先（preset 才是真正在遮蔽的那一层）。
const API_PREFIX = "/api/memory-shield";
const MAX_BODY = 65536;
/** POST /config 的字段白名单：只有这两个键允许改，其余一律 400。 */
const CONFIG_KEYS = Object.freeze(["hintDismissed", "showInSettings"]);
const API = {
	routeBound: false,
	instances: { profile: null, preset: null },
};

/** 当前应答实例：preset 优先，其次 profile；都没有时返回 null。 */
function activeInstance() {
	return API.instances.preset ?? API.instances.profile ?? null;
}

/** 读请求体。返回 { value } 或 { bad: <原因> }。空体按 {} 处理。 */
function readJsonBody(req) {
	return new Promise((resolve) => {
		let raw = "";
		let settled = false;
		const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
		req.on("data", (d) => {
			raw += d;
			if (raw.length > MAX_BODY) {
				finish({ bad: "body too large" });
				try { req.destroy(); } catch {}
			}
		});
		req.on("end", () => {
			const text = raw.trim();
			if (!text) return finish({ value: {} });
			try { finish({ value: JSON.parse(text) }); } catch { finish({ bad: "invalid JSON body" }); }
		});
		req.on("error", () => finish({ bad: "request stream error" }));
	});
}

function makeApiHandler() {
	return async (req, res) => {
		const url = new URL(req.url, 'http://127.0.0.1');
		const json = (code, body) => {
			res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
			res.end(JSON.stringify(body));
		};

		// GET /health —— 只读健康信息，不依赖 ui-config，不写盘
		if (req.method === 'GET' && url.pathname === `${API_PREFIX}/health`) {
			const inst = activeInstance();
			const cfg = inst?.s ?? { ...DEFAULTS };
			json(200, {
				ok: true,
				version: VERSION,
				layer: inst?.layer ?? 'profile',
				enabled: cfg.enabled === true,
				presetName: inst?.layer === 'preset' ? (cfg.presetName || 'default') : '',
				// 实际生效数（已去重、已剔除白名单），不是配置数组长度
				shadowTools: inst?.effective?.tools?.size ?? 0,
				shadowSections: inst?.effective?.sections?.size ?? 0,
			});
			return;
		}

		if (req.method === 'GET' && url.pathname === `${API_PREFIX}/state`) {
			const inst = activeInstance();
			const cfg = inst?.s ?? { ...DEFAULTS };
			const ui = readUiCfg();
			json(200, {
				ok: true,
				data: {
					layer: inst?.layer ?? 'profile',
					presetName: inst?.layer === 'preset' ? (cfg.presetName || 'default') : '',
					enabled: cfg.enabled === true,
					hintDismissed: ui.hintDismissed === true,
					showInSettings: ui.showInSettings !== false && cfg.showInSettings !== false,
				},
			});
			return;
		}

		if (req.method === 'POST' && url.pathname === `${API_PREFIX}/config`) {
			const parsed = await readJsonBody(req);
			if (parsed.bad) return json(400, { ok: false, why: parsed.bad });
			const body = parsed.value;
			if (body === null || typeof body !== 'object' || Array.isArray(body)) {
				return json(400, { ok: false, why: 'body must be a JSON object' });
			}
			const keys = Object.keys(body);
			const denied = keys.filter((k) => !CONFIG_KEYS.includes(k));
			if (denied.length) {
				return json(400, {
					ok: false,
					why: `key not allowed: ${denied.join(', ')}`,
					allowed: [...CONFIG_KEYS],
				});
			}
			const badType = keys.filter((k) => typeof body[k] !== 'boolean');
			if (badType.length) {
				return json(400, { ok: false, why: `value must be boolean: ${badType.join(', ')}` });
			}
			const patch = {};
			for (const k of keys) patch[k] = body[k];
			json(200, { ok: true, data: writeUiCfg(patch) });
			return;
		}

		json(404, { ok: false, why: 'not found' });
	};
}

/**
 * 把本实例登记进进程内注册表，并在需要时绑一次路由。
 * 路由只绑一次；实例销毁时解绑并清空登记，允许后续实例重新绑定。
 */
function registerApi(ctx, layer, s, effective) {
	API.instances[layer] = { layer, s, effective };
	if (API.routeBound) return;
	if (typeof ctx.webServer?.register !== 'function') {
		// 无 webServer 能力（例如 dryrun / 精简宿主）：保留登记，端点交给已绑定的实例
		try { ctx.logger?.info?.(`${name}: webServer unavailable — health endpoint not bound (${layer})`); } catch {}
		return;
	}
	try {
		ctx.effect(() => {
			const dispose = ctx.webServer.register({
				kind: 'prefix',
				path: API_PREFIX,
				handler: makeApiHandler(),
			});
			API.routeBound = true;
			return () => {
				try { dispose?.(); } catch {}
				API.routeBound = false;
				// 只清自己那份登记（同层可能有更新的实例已覆盖）
				if (API.instances[layer]?.s === s) API.instances[layer] = null;
			};
		}, `${name}: ${API_PREFIX} api (${layer})`);
	} catch (e) {
		API.routeBound = false;
		API.instances[layer] = null;
		try { ctx.logger?.warn?.(`${name}: api route failed: ${e?.message ?? e}`) } catch {}
	}
}

export function layerFromScope(scopeKey, hasScopeApi, forced) {
	if (forced === "preset") return "preset";
	if (forced === "profile") return "profile";
	if (!hasScopeApi) return "profile";
	return scopeKey !== undefined && scopeKey !== null ? "preset" : "profile";
}

/**
 * 分层判定：preset 插件挂在 preset 的 standing scope 里（scope 有 parent）；
 * profile 层在 root scope（无 parent）。拿不到 dsh-scope 时保守判为 profile 层（不遮蔽）。
 * __forceLayer 仅给 dryrun 用，生产上下文不会设它。
 * 判定结果同时供 health 端点的 layer 字段使用——只有这一处判定，不另写一套。
 */
function detectLayer(ctx) {
	const forced = ctx?.__forceLayer;
	let scopeKey
	try {
		scopeKey = scopeApi?.scopeOf?.(ctx)
	} catch (e) {
		ctx.logger?.warn?.(`${name}: dsh-scope 导入或调用失败，按 profile 层处理（不遮蔽）：${e?.message || e}`)
		scopeKey = undefined
	}
	return layerFromScope(scopeKey, !!scopeApi, forced)
}

/** 遮蔽段里哪一段承载给 agent 的说明（只挂一段，避免同一句话被复制 N 份）。 */
const HINT_SECTION = 'memory:snapshot';

function apply(ctx, config) {
	const s = { ...DEFAULTS, ...(config ?? {}) };
	const layer = detectLayer(ctx);
	const isPresetLayer = layer === 'preset';

	// 实际生效计数（去重、剔除白名单后），供 health 端点使用
	const effective = { tools: new Set(), sections: new Set() };

	if (!isPresetLayer) {
		// ── profile 层：只注册状态查询与提示，不遮蔽、不写盘 ──
		ctx.logger.info(`${name}: profile layer — registering state endpoint only (no shadowing)`);
		registerApi(ctx, 'profile', s, effective);
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

	// 端点先绑：enabled=false 时也要能查 health（报 enabled:false）
	registerApi(ctx, 'preset', s, effective);

	// 遮蔽诊断工具（始终注册，包括 enabled=false——只读、只报计数）
	ctx.effect(() => ctx.tools.register(shadowDiagnoseTool(ctx, s)), `${name}: shadow diagnose tool`);

	if (s.enabled !== true) {
		ctx.logger.warn(
			`${name}: shadow DISABLED by config\n` +
			`        后果：本次会话不遮蔽任何记忆 context/tool，其他记忆插件会照常注入。`,
		);
		return;
	}

	// 说明只在「确实在遮蔽」时挂：enabled 已在上面校验为 true
	const hintFor = (sectionName) => (sectionName === HINT_SECTION ? SHADOW_HINT : "");

	// memory:snapshot 空遮蔽（接住任何同名注入）—— 承载给 agent 的说明
	ctx.effect(
		() => shadowEmptyContext(ctx, "memory:snapshot", hintFor("memory:snapshot")),
		`${name}: shadow memory:snapshot (empty)`,
	);
	effective.sections.add("memory:snapshot");

	// 其他记忆插件的 context section（只放行 memory 类前缀）
	for (const sectionName of s.shadowSections) {
		if (sectionName === "memory:snapshot") continue;
		if (!isMemorySection(sectionName)) {
			ctx.logger.warn(`${name}: skip non-memory section "${sectionName}" (prefix not allowed)`);
			continue;
		}
		ctx.effect(
			() => shadowEmptyContext(ctx, sectionName, hintFor(sectionName)),
			`${name}: shadow section ${sectionName}`,
		);
		effective.sections.add(sectionName);
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
			ctx.effect(
				() => shadowEmptyContext(ctx, sectionName, hintFor(sectionName)),
				`${name}: auto-shadow section ${sectionName}`,
			);
			effective.sections.add(sectionName);
		}
	}

	// 同名工具接管（精确规则，白名单统一生效）
	for (const toolName of s.shadowTools) {
		if (s.shadowWhitelist?.includes(toolName)) continue;
		ctx.effect(() => ctx.tools.register(shadowTool(toolName, s)), `${name}: shadow tool ${toolName}`);
		effective.tools.add(toolName);
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
			effective.tools.add(toolName);
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
