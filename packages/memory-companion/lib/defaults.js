/**
 * 默认配置（companion 版）。
 */
import path from "node:path";
import os from "node:os";

export const DEFAULTS = {
	memoryTracks: "lite", // "lite" = 三轨 memory/user/key；"full" = 五轨 memory/user/project/key/daily
	presetName: "default",
	memoryDir: "",
	writeGuard: true,
	writeGuardThreshold: 2,
	snapshotOrder: 500,
};

/** 解析 memoryDir 落点。 */
export function resolveMemoryDir(s) {
	if (s.memoryDir) return s.memoryDir;
	return process.env.DSH_MEMORY_CORE_DIR || path.join(
		process.env.DSH_HOME || path.join(os.homedir(), ".dsh"),
		"..", ".dsh-plugin-data", s.presetName, "memory",
	);
}
