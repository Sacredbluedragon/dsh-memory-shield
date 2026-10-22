/**
 * 遮蔽层（纯遮蔽版）：context 遮蔽、工具接管、诊断工具。
 *
 * T02 改动：shadowEmptyContext 由「固定返回空串」改为「可挂一句说明」。
 * 说明只在调用方显式传入时才出现（默认空串），因此 profile 层 / enabled=false
 * 的路径行为与改动前完全一致。
 */
import { PLUGIN_NAME } from "./constants.js";

/** 只放行 memory 类前缀 + 精确名白名单，防止误抹内核段（harness:identity 等）。 */
const ALLOWED_PREFIXES = [
	"memory:", "memory-eternal:", "meow-memory:", "memory-palace:",
	"memento:", "auto-memory:", "prime-memory:", "memoir:",
	"dsh-memories:", "dsh-memo:",
];
/** 精确名白名单（不带前缀，只放指定名，防误伤）。 */
const ALLOWED_EXACT = new Set([
	"prompt:injections",
]);

/**
 * 遮蔽生效时注入给 agent 的那一句说明。
 * 约束：≤80 汉字（含标点与 ASCII 标识符），一次性常量，不含时间戳/计数等易变内容，
 * 保证同一会话内每次渲染字节完全一致（不打散 prompt 缓存）。
 */
export const SHADOW_HINT =
	"本会话已启用记忆遮蔽：其他记忆插件注入的记忆已被拦截（数据未删除）。" +
	"配套的 dsh-memory-core 尚未发布，当前无法安装。";

export function isMemorySection(name) {
	return ALLOWED_EXACT.has(name) || ALLOWED_PREFIXES.some((p) => name.startsWith(p));
}

/**
 * 注册 context 遮蔽段，遮蔽其他记忆插件的同名 section。
 *
 * @param {object} ctx  插件上下文
 * @param {string} sectionName 被遮蔽的 section 名
 * @param {string} [hint] 遮蔽生效时返回的说明文本；缺省/非字符串 → 返回空串（原行为）
 *
 * 说明：`text` 是纯函数，不做日志、不做计数、不读写磁盘——每次渲染只求值一次字符串，
 * 因此不会因为重复渲染而刷屏。
 */
export function shadowEmptyContext(ctx, sectionName, hint = "") {
	const text = typeof hint === "string" ? hint : "";
	return ctx.systemPrompt.context({
		name: sectionName,
		text: () => text,
		order: 500,
	});
}

/** 同名工具空壳：接管名字，不读写全局记忆。 */
export function shadowTool(toolName, _s) {
	return {
		name: toolName,
		description:
			"该工具在当前 preset 中已被遮蔽，不可用。配套的 dsh-memory-core 尚未发布，当前无法安装。",
		parameters: {
			type: "object",
			properties: {},
			additionalProperties: true,
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {
					ok: { type: "boolean" },
					message: { type: "string" },
				},
				required: ["ok", "message"],
			},
			render: (_args, value) => [{ type: "text", text: String(value?.message ?? "") }],
		},
		async execute() {
			return {
				ok: false,
				message:
					`工具 ${toolName} 在当前 preset 中不可用（已被记忆遮蔽插件接管）。` +
					"配套的 dsh-memory-core 尚未发布，当前无法安装。",
			};
		},
	};
}

/** 遮蔽诊断工具：agent 调用查看当前遮蔽状态。 */
export function shadowDiagnoseTool(ctx, s) {
	return {
		name: "shadow_diagnose",
		description: "查看 memory-shield 当前遮蔽状态：遮蔽了多少工具、多少 context、哪些在白名单。",
		parameters: { type: "object", properties: {} },
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {
					ok: { type: "boolean" },
					message: { type: "string" },
				},
				required: ["ok", "message"],
			},
			render: (_args, value) => [{ type: "text", text: String(value?.message ?? "") }],
		},
		async execute() {
			return {
				ok: true,
				message:
					`遮蔽状态：enabled=${s.enabled}, preset=${s.presetName}, ` +
					`shadowTools=${s.shadowTools.length}, shadowSections=${s.shadowSections.length}, ` +
					`autoShadow=${s.autoShadow}, whitelist=${s.shadowWhitelist?.length ?? 0}`,
			};
		},
	};
}
