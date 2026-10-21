/**
 * 注入层：记忆注入渲染、预算分配、看门狗提醒拼接。
 */
import { ENTRY_DELIMITER } from "./store.js";
import { TRACK_LABELS } from "./tracks.js";
import { BUDGETS, TOTAL_BUDGET, KEY_TOP_N, KEY_SCAN_N, KEY_EXTRA_CAP, KEY_HOT_WORDS } from "./budgets.js";

export const WRITE_GUIDE =
	"## 每轮收尾\n用 memory 工具写一条：重要事实写 `key`，用户偏好写 `user`，长期记忆写 `memory`。";

export const WRITE_GUARD_NOTICE =
	"## 提醒\n你连着几个回合没写记忆了。收尾时记得用 memory 工具写一条：重要事实写 `key`，" +
	"用户偏好写 `user`，长期记忆写 `memory`。";

/** 截断后清理开头的孤立分隔符残留。 */
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

/** 渲染常驻记忆注入：按 memory > user > key 优先级分配预算。 */
export function renderResident(store, agent, tracks) {
	const order = tracks ?? ["memory", "user", "key"];
	const parts = [];
	let used = 0;
	for (const track of order) {
		if (used >= TOTAL_BUDGET) break;
		const budget = Math.min(BUDGETS[track], TOTAL_BUDGET - used);
		if (budget <= 0) break;
		const entries = store.entriesOf(track, agent);
		if (entries.length === 0) continue;
		let text = entries.join(ENTRY_DELIMITER);
		if (text.length > budget) {
			text = text.slice(text.length - budget);
			const nl = text.indexOf("\n");
			if (nl >= 0) text = text.slice(nl + 1);
			text = trimCutHead(text);
		}
		parts.push({ track, text, chars: text.length });
		used += text.length;
	}
	const keyBudget = Math.min(KEY_EXTRA_CAP, TOTAL_BUDGET - used);
	if (keyBudget > 0) {
		const keyEntries = pickKeyEntries(store, agent);
		let keyText = keyEntries.join(ENTRY_DELIMITER);
		if (keyText.length > keyBudget) {
			keyText = keyText.slice(keyText.length - keyBudget);
			const nl = keyText.indexOf("\n");
			if (nl >= 0) keyText = keyText.slice(nl + 1);
			keyText = trimCutHead(keyText);
		}
		if (keyText.length > 0) {
			parts.push({ track: "key", text: keyText, chars: keyText.length });
		}
	}
	return parts;
}

/** 渲染 memory:snapshot 注入文本：常驻记忆 + 恒引导 + 条件看门狗提醒。 */
export function renderSnapshot(store, s, writeGap, context) {
	const agent = context?.agent;
	const parts = renderResident(store, agent, s.memoryTracks === "full"
		? ["memory", "user", "project", "key", "daily"]
		: ["memory", "user", "key"]);
	const body = parts.length === 0
		? ""
		: `${parts.map((p) => `## ${TRACK_LABELS[p.track]}`).join("\n")}\n\n${parts.map((p) => p.text).join("\n\n")}`;
	const due =
		s.writeGuard === true &&
		writeGap !== null &&
		agent !== undefined &&
		agent.session?.header?.origin !== "subagent" &&
		writeGap.gapOf(agent) >= s.writeGuardThreshold;
	const notice = due ? WRITE_GUARD_NOTICE : "";
	return [body, WRITE_GUIDE, notice].filter(Boolean).join("\n\n");
}
