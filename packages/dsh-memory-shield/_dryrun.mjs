// 纯遮蔽版 dryrun：验证导出契约、默认配置、遮蔽注册逻辑
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { apply, inject, name, Config, layerFromScope } from "./index.js";
import { DEFAULTS } from "./lib/defaults.js";
import { isMemorySection } from "./lib/shadow.js";
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

// 4b. 分层判定回归（T12 P0-1：preset 的 generation scope 没有 parent）
check("root ctx（scopeKey=undefined）判 profile", layerFromScope(undefined, true) === "profile");
check("generation scope（有 scopeKey、无 parent）判 preset", layerFromScope("generation:abc", true) === "preset");
check("拿不到 dsh-scope 时保守判 profile", layerFromScope(undefined, false) === "profile");
check("__forceLayer=preset 优先", layerFromScope(undefined, true, "preset") === "preset");
check("__forceLayer=profile 优先", layerFromScope("generation:abc", true, "profile") === "profile");

// 4c. T16 P2 回归（0.1.10）
const HERE = dirname(fileURLToPath(import.meta.url));
const clientSrc = readFileSync(join(HERE, "client.js"), "utf8");
const readmeSrc = readFileSync(join(HERE, "README.md"), "utf8");
check("P2-1 提示词不再写死 3080 的 API 地址", !clientSrc.includes("127.0.0.1:3080/api/memory-shield"), clientSrc.includes("ORIGIN") ? "用 ORIGIN 拼接" : "未找到 ORIGIN");
check("P2-2 autoPresetFromSession 已从 defaults 删除", DEFAULTS.autoPresetFromSession === undefined);
check("P2-2 autoPresetFromSession 已从 schema 删除", !Object.keys(Config.dict || {}).includes("autoPresetFromSession"));
check("P2-2 老配置带已删键不报错", (() => { try { Config({ autoPresetFromSession: true, enabled: true }); return true; } catch { return false; } })());
check("P2-3 面板区分「已挂载未启用」", clientSrc.includes("已挂载，尚未启用"));
check("P2-5 README 列出 dsh-memories 前缀", readmeSrc.includes("dsh-memories"));
check("P2-5 README 单独列出 dsh-memo 前缀", readmeSrc.includes("、dsh-memo "));
check("P2-5 前缀白名单含 dsh-memories/dsh-memo", isMemorySection("dsh-memories:context") && isMemorySection("dsh-memo:context"));

// 5. 模拟 ctx 跑一次 apply（enabled=true）
const calls = { effects: [], tools: [], contexts: [], logs: [] };
const fakeCtx = {
	__forceLayer: "preset",
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
	__forceLayer: "preset",
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
	__forceLayer: "preset",
	logger: { info: () => {}, warn: () => {} },
	effect: (fn, tag) => { calls3.effects.push(tag); try { fn(); } catch (e) {} },
	tools: { register: (t) => calls3.tools.push(t.name || t) },
	systemPrompt: { context: () => {} },
};
apply(fakeCtx3, {});
check("空 config 默认不遮蔽（bundle 形态装完安全）", calls3.effects.length === 1 && calls3.effects[0].includes("diagnose"), `${calls3.effects.length} 个 effect`);
check("空 config 仍注册 diagnose", calls3.tools.includes("shadow_diagnose"));

// 8. profile 层：只注册状态路由，不遮蔽、不注册 diagnose
const calls4 = { effects: [], tools: [], routes: [] };
const fakeCtx4 = {
	__forceLayer: "profile",
	logger: { info: () => {}, warn: () => {} },
	effect: (fn, tag) => { calls4.effects.push(tag); try { fn(); } catch (e) {} },
	tools: { register: (t) => calls4.tools.push(t.name || t) },
	systemPrompt: { context: () => {} },
	webServer: { register: (r) => { calls4.routes.push(r.path); return () => {}; } },
};
apply(fakeCtx4, { enabled: true });
check("profile 层注册状态路由", calls4.routes.includes("/api/memory-shield"), `${calls4.routes.length} 条`);
check("profile 层不注册 diagnostic tool", !calls4.tools.includes("shadow_diagnose"));
check("profile 层不遮蔽（即使 enabled=true）", !calls4.effects.some((t) => t.includes("shadow section") || t.includes("shadow tool")), `${calls4.effects.length} 个 effect`);

// 总结
const failed = results.filter((r) => !r.ok);
console.log(`\n全部通过：${results.length - failed.length} 项`);
if (failed.length) {
	console.log(`失败：${failed.length} 项`);
	failed.forEach((f) => console.log("  - " + f.label));
	process.exit(1);
}
