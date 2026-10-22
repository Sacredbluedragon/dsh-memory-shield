/**
 * 默认配置（纯遮蔽版，无面板）。
 */
export const DEFAULTS = {
	// 默认关闭：本包以 bundle 形态装进 profile 时不遮蔽任何会话，
	// 只有目标 preset 里显式写 config.enabled: true 才生效。
	enabled: false,
	presetName: "default",
	shadowTools: [
		"de_prompts", "dtodo",
	],
	shadowSections: [
		"memory:snapshot",
		"prompt:injections",
	],
	autoShadow: true,
	shadowWhitelist: [],
	// UI 配置（profile 层提示用）
	hintDismissed: false,
	showInSettings: true,
};
