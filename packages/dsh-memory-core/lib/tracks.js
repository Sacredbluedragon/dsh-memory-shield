/**
 * 轨道定义。
 *
 * lite 版（默认）：三轨 memory/user/key。
 * full 版（升级）：五轨 memory/user/project/key/daily（对齐 dsh-memory-evolve 的 target 枚举）。
 * 遮蔽会话的记忆与普通会话 evolve 完全隔离（独立数据目录）。
 */
export const TRACKS_LITE = ["memory", "user", "key"];
export const TRACKS_FULL = ["memory", "user", "project", "key", "daily"];

export const TRACK_LABELS = {
	memory: "长期记忆",
	user: "用户档案",
	project: "项目记忆",
	key: "关键事实",
	daily: "每日日志",
};

/** 归档文件后缀。 */
export const ARCHIVE_SUFFIX = "-archive.md";
export const PENDING_FILE = "pending.md";

/** 按模式返回轨道列表。 */
export function tracksOf(mode) {
	return mode === "full" ? TRACKS_FULL : TRACKS_LITE;
}
