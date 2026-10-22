/**
 * 注入预算与检索参数。
 */
export const BUDGETS = { memory: 1000, user: 600, key: 400 };
export const TOTAL_BUDGET = 2000;
export const KEY_TOP_N = 5;
export const SEARCH_TOP_N = 5;
export const KEY_SCAN_N = 8;
export const KEY_EXTRA_CAP = 600;
// key 轨加权挑条目时用的「重要词」：命中越多排越前；留空数组 = 不加权（原样按最近排序）
export const KEY_HOT_WORDS = ['不要', '必须', '注意', '重要', '偏好', '禁止', '始终', '永远'];
