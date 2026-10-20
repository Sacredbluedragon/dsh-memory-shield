/**
 * 遮蔽层（纯遮蔽版）：context 遮蔽、工具接管、诊断工具。
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

export function isMemorySection(name) {
	return ALLOWED_EXACT.has(name) || ALLOWED_PREFIXES.some((p) => name.startsWith(p));
}

/** 注册空 context，遮蔽其他记忆插件的同名 section。 */
export function shadowEmptyContext(ctx, sectionName) {
	return ctx.systemPrompt.context({
		name: sectionName,
		text: () => "",
		order: 500,
	});
}

/** 同名工具空壳：接管名字，不读写全局记忆。 */
export function shadowTool(toolName, _s) {
	return {
		name: toolName,
		description:
			"该工具在当前 preset 中已被遮蔽，不可用。如需记忆功能，请安装 companion 插件。",
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
					"如需记忆功能，请安装 companion 插件。",
			};
		},
	};
}

/** 遮蔽诊断工具：agent 调用查看当前遮蔽状态。 */
export function shadowDiagnoseTool(ctx, s) {
	return {
		name: "shadow_diagnose",
		description: "查看 preset-memory 当前遮蔽状态：遮蔽了多少工具、多少 context、哪些在白名单。",
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
