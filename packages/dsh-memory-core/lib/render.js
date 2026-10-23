/**
 * 注入层：记忆注入渲染、预算分配、看门狗提醒拼接。
 *
 * 形制对齐 dsh-memory-evolve：
 * - 每轨一个 `## 标签`，其下逐条 `- ` 开头，标题与正文一一对应（不再把所有正文拼在末尾）；
 * - key 只注入一次（不再「循环注一份 + 额外补一段」）；
 * - 写引导与看门狗文案按当前启用的轨生成，full 模式必须指向 daily/project，否则那两轨永远是死档。
 */
import { ENTRY_DELIMITER } from "./store.js";
import { TRACK_LABELS, tracksOf } from "./tracks.js";
import { BUDGETS, TOTAL_BUDGET, KEY_TOP_N, KEY_SCAN_N, KEY_HOT_WORDS } from "./budgets.js";

/** 写引导：按启用轨给出收尾动作，full 模式强调 daily 与 project 各写一次（target 是单值）。 */
export function writeGuideFor(memoryTracks) {
	const tracks = tracksOf(memoryTracks);
	const hasProject = tracks.includes("project");
	const hasDaily = tracks.includes("daily");
	if (hasProject && hasDaily) {
		// target 只能取一个轨，entries 也只写同一个轨：这条引导如果写「一次调用写两个轨」，
		// 模型要么撞枚举/轨校验错误，要么把 project 的内容塞进 daily 静默写错轨。
		return (
			"## 每轮收尾\n" +
			"用 memory_core 工具写记忆。每次调用只能写一个轨，所以收尾分两次：" +
			"先 `target: \"daily\"` 写今天做了什么，再 `target: \"project\"` 写本项目的进展、决策与坑。" +
			"重要事实写 `key`，用户偏好写 `user`，长期记忆写 `memory`。"
		);
	}
	return "## 每轮收尾\n用 memory_core 按内容分别写入：重要事实写 `key`，用户偏好写 `user`，长期记忆写 `memory`。";
}

/** 看门狗提醒：说明盯的是哪几轨、阈值是多少，并指向补写。 */
export function writeGuardNoticeFor(memoryTracks, threshold) {
	const tracks = tracksOf(memoryTracks);
	const duty = tracks.includes("daily") ? "daily / project" : "memory / user / key";
	return (
		`## 提醒\n连续 ${threshold} 轮没有写入 ${duty}。收尾时用 memory_core 补上这几轮的进展。`
	);
}

/** 截断后清理开头的孤立分隔符与残行。 */
function trimCutHead(text) {
	let out = text.replace(/^[ \t]*\n+/, "");
	while (/^§[ \t]*(\n|$)/.test(out)) out = out.replace(/^§[ \t]*\n?/, "").replace(/^[ \t]*\n+/, "");
	return out;
}

/** 挑 key 轨注入条目：先取最近 KEY_SCAN_N 条，再按关键词加权取前 KEY_TOP_N。 */
function pickKeyEntries(store, agent) {
	const all = store.entriesOf("key", agent);
	const window = all.slice(-KEY_SCAN_N);
	if (window.length <= KEY_TOP_N) return window;
	const weighted = window
		.map((entry, index) => {
			let hits = 0;
			for (const word of KEY_HOT_WORDS) hits += entry.split(word).length - 1;
			return { entry, index, hits };
		})
		.sort((a, b) => b.hits - a.hits || b.index - a.index)
		.slice(0, KEY_TOP_N)
		.sort((a, b) => a.index - b.index);
	return weighted.map((row) => row.entry);
}

/** 把条目渲染成 `- 首行` + 续行缩进两格，避免多行条目在列表里断掉层级。 */
function asBullet(entry) {
	const lines = String(entry).split("\n");
	return "- " + lines[0] + lines.slice(1).map((l) => "\n  " + l).join("");
}

/**
 * 渲染常驻记忆注入：按 memory > user > key 顺序分配预算，每轨一个块。
 * 只注入 memory/user/key 三轨；project/daily 是「按需读取」的轨，不进上下文。
 */
export function renderResident(store, agent, tracks) {
	const order = tracks ?? ["memory", "user", "key"];
	const parts = [];
	let used = 0;
	for (const track of order) {
		if (used >= TOTAL_BUDGET) break;
		const budget = Math.min(BUDGETS[track] ?? 0, TOTAL_BUDGET - used);
		if (!(budget > 0)) continue;
		const entries = track === "key" ? pickKeyEntries(store, agent) : store.entriesOf(track, agent);
		if (entries.length === 0) continue;
		let text = entries.map(asBullet).join("\n");
		if (text.length > budget) {
			text = text.slice(text.length - budget);
			const nl = text.indexOf("\n");
			if (nl >= 0) text = text.slice(nl + 1);
			text = trimCutHead(text);
		}
		if (text.length === 0) continue;
		parts.push({ track, text, chars: text.length });
		used += text.length;
	}
	return parts;
}

/**
 * 快照净化（对齐 evolve issue #53）：宿主把段正文当模板解析，正文里出现未注册的 `{{name}}`
 * 会让整段渲染抛错，该会话每一步都起不来且无法用工具自救。记忆正文由模型/用户写入，
 * 天然可能出现 `{{...}}`，所以出口必须只降级、不展开：`{{session}}` → `{session}`。
 */
export function sanitizeSnapshot(content) {
	return String(content ?? "")
		.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, "{$1}")
		.replace(/\{\{/g, "{");
}

/** 渲染 memory-core:snapshot 注入文本：常驻记忆 + 恒引导 + 条件看门狗提醒。 */
export function renderSnapshot(store, s, writeGap, context) {
	const agent = context?.agent;
	const parts = renderResident(store, agent, ["memory", "user", "key"]);
	const body = parts.length === 0
		? ""
		: parts.map((p) => `## ${TRACK_LABELS[p.track]}\n${p.text}`).join("\n\n");
	const due =
		s.perTurnWriteGuard === true &&
		writeGap !== null &&
		agent !== undefined &&
		agent.session?.header?.origin !== "subagent" &&
		writeGap.gapOf(agent) >= s.writeGuardThreshold;
	const notice = due ? writeGuardNoticeFor(s.memoryTracks, s.writeGuardThreshold) : "";
	return sanitizeSnapshot([body, writeGuideFor(s.memoryTracks), notice].filter(Boolean).join("\n\n"));
}
