/**
 * 默认配置（dsh-memory-core 版）。
 */
import path from "node:path";
import os from "node:os";

export const DEFAULTS = {
	memoryTracks: "full", // "full" = 五轨 memory/user/project/key/daily（默认）；"lite" = 三轨 memory/user/key
	presetName: "default",
	memoryDir: "",
	writeGuard: true, // key 轨写入后进待确认队列（语义闸门，不控制看门狗）
	perTurnWriteGuard: false, // 看门狗：连续 N 轮没写记忆时在快照末尾提醒（独立开关，对齐 evolve）
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
