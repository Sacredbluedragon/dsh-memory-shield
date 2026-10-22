/**
 * schemastery schema（dsh-memory-core 记忆版）。
 */
import z from "@deepseek-ai/schemastery";
import { DEFAULTS } from "./defaults.js";

export const Config = z.object({
	memoryTracks: z.enum(["lite", "full"]).default(DEFAULTS.memoryTracks),
	presetName: z.string().default(DEFAULTS.presetName),
	memoryDir: z.string().default(DEFAULTS.memoryDir),
	writeGuard: z.boolean().default(DEFAULTS.writeGuard),
	writeGuardThreshold: z.number().default(DEFAULTS.writeGuardThreshold),
	snapshotOrder: z.number().default(DEFAULTS.snapshotOrder),
});
