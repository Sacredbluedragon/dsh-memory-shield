/**
 * schemastery schema（纯遮蔽版，无面板）。
 */
import z from "@deepseek-ai/schemastery";
import { DEFAULTS } from "./defaults.js";

export const Config = z.object({
	enabled: z.boolean().default(DEFAULTS.enabled),
	presetName: z.string().default(DEFAULTS.presetName),
	shadowTools: z.array(z.string()).default(DEFAULTS.shadowTools),
	shadowSections: z.array(z.string()).default(DEFAULTS.shadowSections),
	autoShadow: z.boolean().default(DEFAULTS.autoShadow),
	shadowWhitelist: z.array(z.string()).default(DEFAULTS.shadowWhitelist),
	autoPresetFromSession: z.boolean().default(DEFAULTS.autoPresetFromSession),
});
