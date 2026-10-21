// 纯遮蔽版 dryrun：验证导出契约、默认配置、遮蔽注册逻辑
import { apply, inject, name, Config } from "./index.js";
import { DEFAULTS } from "./lib/defaults.js";
import { PLUGIN_NAME } from "./lib/constants.js";

const results = [];
function check(label, ok, detail = "") {
	results.push({ label, ok, detail });
	console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
}

// 1. 导出契约
check("导出 apply/inject/name/Config",
	typeof apply === "function" && Array.isArray(inject) && typeof name === "string" && typeof Config === "function");

// 2. 常量
check("插件名 = dsh-memory-shield", PLUGIN_NAME === "dsh-memory-shield", PLUGIN_NAME);

// 3. 默认配置关键字段
check("默认 enabled=false（bundle 形态装完不遮蔽）", DEFAULTS.enabled === false);
check("默认 autoShadow=true", DEFAULTS.autoShadow === true);
check("默认 shadowSections 含 memory:snapshot", DEFAULTS.shadowSections.includes("memory:snapshot"));
check("默认 shadowSections 含 prompt:injections", DEFAULTS.shadowSections.includes("prompt:injections"));
check("默认 shadowSections 不含 tool:memory（已查实不存在）", !DEFAULTS.shadowSections.includes("tool:memory"));
check("默认 shadowSections 不含 memory:notes（已查实不存在）", !DEFAULTS.shadowSections.includes("memory:notes"));
check("默认 shadowTools 不含 skill_manage", !DEFAULTS.shadowTools.includes("skill_manage"));
check("无 memoryEnabled 字段（纯遮蔽）", DEFAULTS.memoryEnabled === undefined);
check("无 memoryTracks 字段（纯遮蔽）", DEFAULTS.memoryTracks === undefined);
check("无 settingsPanel 字段（无面板）", DEFAULTS.settingsPanel === undefined);
check("无 shadowToolPatterns 字段（死键已删）", DEFAULTS.shadowToolPatterns === undefined);

// 4. 字段集一致性：Config.dict keys == DEFAULTS keys
const configKeys = Object.keys(Config.dict || {}).sort();
const defaultKeys = Object.keys(DEFAULTS).sort();
check("Config 字段集 == defaults 键集",
	JSON.stringify(configKeys) === JSON.stringify(defaultKeys),
	`config=[${configKeys.join(",")}] defaults=[${defaultKeys.join(",")}]`);

// 5. 模拟 ctx 跑一次 apply（enabled=true）
const calls = { effects: [], tools: [], contexts: [], logs: [] };
const fakeCtx = {
	logger: { info: (...a) => calls.logs.push(a.join(" ")), warn: (...a) => calls.logs.push(a.join(" ")) },
	effect: (fn, tag) => { calls.effects.push(tag); try { fn(); } catch (e) { calls.logs.push("effect err: " + e.message); } },
	tools: { register: (t) => calls.tools.push(t.name || t) },
	systemPrompt: {
		context: (opts) => {
			calls.contexts.push(opts);
			if (typeof opts.order !== "number") throw new Error("context 缺 order: " + opts.name);
		},
	},
};
apply(fakeCtx, { enabled: true });
check("apply 跑通无异常", calls.effects.length > 0, `${calls.effects.length} 个 effect`);
check("注册了 shadowEmptyContext memory:snapshot", calls.effects.some((t) => t.includes("memory:snapshot")));
check("注册了 shadow diagnose tool", calls.tools.includes("shadow_diagnose"));
check("注册了 memory 主工具", calls.tools.includes("memory"));
check("systemPrompt.context 都带 order", calls.contexts.every((c) => typeof c.order === "number"), `${calls.contexts.length} 个 context`);

// 6. enabled=false 时不注册遮蔽 effect，但仍注册 diagnose
const calls2 = { effects: [], tools: [], logs: [] };
const fakeCtx2 = {
	logger: { info: (...a) => calls2.logs.push(a.join(" ")), warn: (...a) => calls2.logs.push(a.join(" ")) },
	effect: (fn, tag) => { calls2.effects.push(tag); try { fn(); } catch (e) {} },
	tools: { register: (t) => calls2.tools.push(t.name || t) },
	systemPrompt: { context: () => {} },
};
apply(fakeCtx2, { enabled: false });
check("enabled=false 时不注册遮蔽 effect", !calls2.effects.some((t) => t.includes("shadow section") || t.includes("shadow tool")), `${calls2.effects.length} 个 effect`);
check("enabled=false 时仍注册 diagnose", calls2.tools.includes("shadow_diagnose"));

// 7. 空 config（bundle 形态默认）不遮蔽：只注册 diagnose，不注册遮蔽 effect
const calls3 = { effects: [], tools: [] };
const fakeCtx3 = {
	logger: { info: () => {}, warn: () => {} },
	effect: (fn, tag) => { calls3.effects.push(tag); try { fn(); } catch (e) {} },
	tools: { register: (t) => calls3.tools.push(t.name || t) },
	systemPrompt: { context: () => {} },
};
apply(fakeCtx3, {});
check("空 config 默认不遮蔽（bundle 形态装完安全）", calls3.effects.length === 1 && calls3.effects[0].includes("diagnose"), `${calls3.effects.length} 个 effect`);
check("空 config 仍注册 diagnose", calls3.tools.includes("shadow_diagnose"));

// 总结
const failed = results.filter((r) => !r.ok);
console.log(`\n全部通过：${results.length - failed.length} 项`);
if (failed.length) {
	console.log(`失败：${failed.length} 项`);
	failed.forEach((f) => console.log("  - " + f.label));
	process.exit(1);
}
