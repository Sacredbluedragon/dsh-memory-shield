/**
 * 默认配置（纯遮蔽版，无面板）。
 */
export const DEFAULTS = {
	enabled: true,
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
	autoPresetFromSession: false,
};
