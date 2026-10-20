/**
 * dsh-preset-memory — 通用记忆遮蔽插件（纯遮蔽器，无面板）。
 *
 * 在指定 preset 内遮蔽其他记忆插件的注入和工具，让这个通道拥有干净的上下文。
 * 本插件不自带任何记忆存储/写入/管理能力——记忆是可选 companion 插件的事。
 * 查看遮蔽状态：让 agent 调用 shadow_diagnose 工具。
 */
import { PLUGIN_NAME } from "./lib/constants.js";
import { DEFAULTS } from "./lib/defaults.js";
import { shadowEmptyContext, shadowTool, shadowDiagnoseTool, isMemorySection } from "./lib/shadow.js";

const name = PLUGIN_NAME;
const inject = ["systemPrompt", "tools"];

function apply(ctx, config) {
	const s = { ...DEFAULTS, ...(config ?? {}) };

	// 自动从会话 preset 派生（注：ctx.session 内核是 sessions，此功能暂名存实亡）
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
