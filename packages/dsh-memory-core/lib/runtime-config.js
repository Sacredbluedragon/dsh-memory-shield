/**
 * 运行期配置：设置页面板改的值单独存一份覆盖层。
 *
 * 为什么不直接改 preset：preset 的 config 是启动装配时的输入，改了要重启才生效；
 * 而设置页的语义是「修改立即生效并持久化」（对齐 dsh-memory-evolve 的设置页）。
 * 所以落一份 `<memoryDir>/../memory-core.config.json`，apply 时以 patch 配置为底，
 * 每轮/每次调用前再叠一层这里（见 index.js 的 refresh）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

/** 允许从文件覆盖的键。其余键（presetName / memoryDir）只认 patch，避免面板改坏落点。 */
export const LIVE_KEYS = ["memoryTracks", "writeGuard", "perTurnWriteGuard", "writeGuardThreshold", "snapshotOrder"];

export function liveConfigPath(memoryDir) {
	return join(dirname(memoryDir), "memory-core.config.json");
}

/** 只留下合法值：类型不对的键直接丢弃，不写坏当前运行态。 */
function pick(raw) {
	const out = {};
	const src = raw && typeof raw === "object" ? raw : {};
	if (src.memoryTracks === "lite" || src.memoryTracks === "full") out.memoryTracks = src.memoryTracks;
	if (typeof src.writeGuard === "boolean") out.writeGuard = src.writeGuard;
	if (typeof src.perTurnWriteGuard === "boolean") out.perTurnWriteGuard = src.perTurnWriteGuard;
	if (Number.isInteger(src.writeGuardThreshold) && src.writeGuardThreshold >= 1) {
		out.writeGuardThreshold = src.writeGuardThreshold;
	}
	if (Number.isInteger(src.snapshotOrder)) out.snapshotOrder = src.snapshotOrder;
	return out;
}

export function readLiveConfig(memoryDir) {
	try {
		return pick(JSON.parse(readFileSync(liveConfigPath(memoryDir), "utf8")));
	} catch {
		return {};
	}
}

export function writeLiveConfig(memoryDir, patch) {
	const next = { ...readLiveConfig(memoryDir), ...pick(patch) };
	writeFileSync(liveConfigPath(memoryDir), JSON.stringify(next, null, 2) + "\n", "utf8");
	return next;
}
