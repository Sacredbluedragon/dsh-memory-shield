/**
 * 写入看门狗：连续 N 个真人回合没写记忆就提醒。
 */
import { PLUGIN_NAME } from "./constants.js";

/**
 * @param {object} ctx 插件 ctx
 * @param {() => boolean} isEnabled 每轮重读开关
 * @returns {{gapOf: (agent?: object) => number, noteWrite: (agent?: object) => void}|null}
 */
export function writeGapCounter(ctx, isEnabled) {
	const gaps = new Map();
	const lastTurnWasMessage = (agent) => {
		const events = agent.session.ownEvents?.() ?? agent.session.events ?? [];
		let startIndex = -1;
		for (let i = events.length - 1; i >= 0; i -= 1) {
			if (events[i]?.type === "turn/start") { startIndex = i; break; }
		}
		if (startIndex < 0) return false;
		for (let i = startIndex; i < events.length; i += 1) {
			if (events[i]?.type !== "user/message") continue;
			const kind = events[i]?.data?.source?.kind;
			return kind === undefined || kind === "user";
		}
		return false;
	};
	const onTurnStopping = (payload) => {
		const agent = payload?.agent ?? payload;
		if (!agent?.session) return;
		if (agent.session.header?.origin === "subagent") return;
		if (!isEnabled()) return;
		if (!lastTurnWasMessage(agent)) return;
		const state = gaps.get(agent.id) ?? { gap: 0, wroteThisTurn: false };
		if (state.wroteThisTurn) {
			state.gap = 0;
			state.wroteThisTurn = false;
		} else {
			state.gap += 1;
		}
		gaps.set(agent.id, state);
	};
	ctx.effect(() => ctx.on("agent/turn-stopping", onTurnStopping, { label: `${PLUGIN_NAME}: write guard` }));
	ctx.effect(() =>
		ctx.on("agent/disposed", ({ agent: disposed }) => {
			if (disposed?.id !== undefined) gaps.delete(disposed.id);
		}, { label: `${PLUGIN_NAME}: write guard gc` }),
	);
	return {
		gapOf: (agent) => gaps.get(agent?.id)?.gap ?? 0,
		noteWrite: (agent) => {
			if (!agent?.id) return;
			const state = gaps.get(agent.id) ?? { gap: 0, wroteThisTurn: false };
			state.wroteThisTurn = true;
			gaps.set(agent.id, state);
		},
	};
}
