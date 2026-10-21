// companion 包最小 dryrun：只验证导入和基本实例化，不启 DSH 运行时。
import { DEFAULTS, resolveMemoryDir } from "./lib/defaults.js";
import { MemoryStore, SuggestionQueue, ArchiveStore } from "./lib/store.js";
import { tracksOf, TRACK_FILES } from "./lib/tracks.js";
import { renderSnapshot } from "./lib/render.js";

let pass = 0;
let fail = 0;
const ok = (name, cond) => {
  if (cond) { pass++; console.log(`  ok: ${name}`); }
  else { fail++; console.log(`  FAIL: ${name}`); }
};

console.log("=== defaults ===");
ok("memoryTracks default = lite", DEFAULTS.memoryTracks === "lite");
ok("writeGuard default = true", DEFAULTS.writeGuard === true);
ok("writeGuardThreshold default = 2", DEFAULTS.writeGuardThreshold === 2);
ok("snapshotOrder default = 500", DEFAULTS.snapshotOrder === 500);

console.log("=== tracks ===");
ok("lite tracks = memory/user/key", tracksOf("lite").join("/") === "memory/user/key");
ok("full tracks = memory/user/project/key/daily", tracksOf("full").length === 5);
ok("TRACK_FILES has 5 entries", Object.keys(TRACK_FILES).length === 5);

console.log("=== store instantiation ===");
const tmpDir = "./_dryrun-tmp";
const store = new MemoryStore(tmpDir, { injectionScan: false });
ok("MemoryStore created", store instanceof MemoryStore);
const pending = new SuggestionQueue(tmpDir + "/pending.md");
ok("SuggestionQueue created", pending instanceof SuggestionQueue);
const archive = new ArchiveStore(tmpDir);
ok("ArchiveStore created", archive instanceof ArchiveStore);

console.log("=== render ===");
const s = { ...DEFAULTS };
const text = renderSnapshot(store, s, null, { agent: undefined });
ok("renderSnapshot returns string", typeof text === "string");

console.log(`\n=== result: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
