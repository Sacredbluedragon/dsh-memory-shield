/**
 * 默认配置（dsh-memory-core 版）。
 */
import path from "node:path";
import os from "node:os";

export const DEFAULTS = {
	memoryTracks: "full", // "full" = 五轨 memory/user/project/key/daily（默认）；"lite" = 三轨 memory/user/key
	presetName: "default",
	memoryDir: "",
	// 三轨各自的「直接写入」开关：默认全开（写进去就生效，错了用 replace/remove 改）；关掉的那一轨改为进待确认队列。
	directMemory: true,
	directUser: true,
	directKey: true,
	perTurnWriteGuard: false, // 看门狗：连续 N 轮没写记忆时在快照末尾提醒（独立开关，对齐 evolve）
	writeGuardThreshold: 2,
	snapshotOrder: 500,
	// 顶部告警横幅的总开关：关掉后任何黄色告警都不渲染（红警只属于 shield 侧）。
	bannerEnabled: true,
	// 「记忆已就绪」绿条只弹一次：用户点「知道了」后置 true，之后不再出现。
	loadedHintShown: false,
};

/** 解析 memoryDir 落点。 */
export function resolveMemoryDir(s) {
	if (s.memoryDir) return s.memoryDir;
	return process.env.DSH_MEMORY_CORE_DIR || path.join(
		process.env.DSH_HOME || path.join(os.homedir(), ".dsh"),
		"..", ".dsh-plugin-data", s.presetName, "memory",
	);
}
