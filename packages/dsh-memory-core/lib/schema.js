/**
 * schemastery schema（dsh-memory-core 记忆版）。
 */
import z from "@deepseek-ai/schemastery";
import { DEFAULTS } from "./defaults.js";

export const Config = z.object({
	memoryTracks: z.union([z.const("lite"), z.const("full")]).default(DEFAULTS.memoryTracks),
	presetName: z.string().default(DEFAULTS.presetName),
	memoryDir: z.string().default(DEFAULTS.memoryDir),
	directMemory: z.boolean().default(DEFAULTS.directMemory),
	directUser: z.boolean().default(DEFAULTS.directUser),
	directKey: z.boolean().default(DEFAULTS.directKey),
	perTurnWriteGuard: z.boolean().default(DEFAULTS.perTurnWriteGuard),
	writeGuardThreshold: z.number().default(DEFAULTS.writeGuardThreshold),
	snapshotOrder: z.number().default(DEFAULTS.snapshotOrder),
	bannerEnabled: z.boolean().default(DEFAULTS.bannerEnabled),
	loadedHintShown: z.boolean().default(DEFAULTS.loadedHintShown),
});
