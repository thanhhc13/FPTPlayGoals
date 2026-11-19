// =====================================================================
// Công thức MSC – port nguyên logic từ Code.gs (MSC_V2)
// =====================================================================
import { bad } from './http.js';

export const MSC_VERSION = 'MSC_V2';
export const MSC_BUDGET = Object.freeze({ Must: 8, Should: 1.5, Could: 0.5 });
export const GROUPS = ['Must', 'Should', 'Could'];
const ID_RE = /^[a-zA-Z0-9_-]{10,100}$/;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

export function mscCounts(tasks) {
  const counts = { Must: 0, Should: 0, Could: 0 };
  for (const task of tasks) {
    if (!task || !has(counts, task.msc)) throw bad('INVALID_MSC', 'Nhóm MSC không hợp lệ.');
    counts[task.msc]++;
  }
  return counts;
}

/** Thang điểm chung của mọi báo cáo. */
export const mscMaxScore = () => 10;

/** Số điểm có thể đạt từ các nhóm thực sự đã đăng ký. */
export const mscAvailableScore = (c) => 8 + (c.Should > 0 ? 1.5 : 0) + (c.Could > 0 ? 0.5 : 0);

export const mscTaskMax = (task, counts) => MSC_BUDGET[task.msc] / counts[task.msc];

export function validateSubmittedMscPlan(tasks) {
  if (!Array.isArray(tasks) || tasks.length < 2 || tasks.length > 20) {
    throw bad('PLAN_SIZE', 'Kế hoạch phải có từ 2 đến 20 mục tiêu.');
  }
  const ids = new Set();
  for (const task of tasks) {
    const id = String((task && task.id) || '').trim();
    if (!task || task.formulaVersion !== MSC_VERSION || !ID_RE.test(id) || ids.has(id)
      || !String(task.title || '').trim() || !String(task.target || '').trim()) {
      throw bad('PLAN_INVALID', 'Kế hoạch MSC có mục tiêu không hợp lệ.');
    }
    ids.add(id);
  }
  const counts = mscCounts(tasks);
  if (counts.Must < 2) throw bad('MUST_MIN', 'Kế hoạch cần ít nhất 2 mục tiêu Must.');
  return counts;
}

export function normalizeMscPlan(items, status) {
  if (!Array.isArray(items) || items.length < 2 || items.length > 20) {
    throw bad('PLAN_SIZE', 'Kế hoạch phải có từ 2 đến 20 mục tiêu.');
  }
  const ids = new Set();
  const tasks = items.map((item, index) => {
    const id = String((item && item.id) || '').trim();
    const title = String((item && item.title) || '').trim();
    const target = String((item && item.target) || '').trim();
    const msc = String((item && item.msc) || '').trim();
    if (!ID_RE.test(id) || ids.has(id)) throw bad('TASK_ID', `Mã mục tiêu ${index + 1} thiếu hoặc bị trùng.`);
    ids.add(id);
    if (title.length > 200 || target.length > 2000 || !has(MSC_BUDGET, msc)) {
      throw bad('TASK_INVALID', `Mục tiêu ${index + 1} có nội dung hoặc nhóm MSC không hợp lệ.`);
    }
    if (status === 'SUBMITTED' && (!title || !target)) {
      throw bad('TASK_REQUIRED', `Mục tiêu ${index + 1} cần có tên và kết quả cam kết.`);
    }
    return { formulaVersion: MSC_VERSION, id, title, target, msc };
  });
  const counts = mscCounts(tasks);
  if (counts.Must < 2) throw bad('MUST_MIN', 'Kế hoạch cần ít nhất 2 mục tiêu Must.');
  if (status === 'SUBMITTED') validateSubmittedMscPlan(tasks);
  return tasks;
}

export function normalizeMscResults(items, planTasks, status) {
  const counts = validateSubmittedMscPlan(planTasks);
  if (!Array.isArray(items) || items.length !== planTasks.length) {
    throw bad('RESULT_MISMATCH', 'Kết quả không khớp kế hoạch đã nộp.');
  }
  const byId = new Map();
  for (const item of items) {
    const id = String((item && item.taskId) || '').trim();
    if (!id || byId.has(id)) throw bad('RESULT_TASK_ID', 'TaskID báo cáo thiếu hoặc bị trùng.');
    byId.set(id, item);
  }
  let total = 0;
  const results = planTasks.map((task, index) => {
    const item = byId.get(String(task.id));
    if (!item) throw bad('RESULT_MISSING', `Thiếu kết quả mục tiêu ${index + 1}.`);
    const actual = String(item.actual || '').trim();
    const evidence = String(item.evidence || '').trim();
    const completion = String(item.completion || '').trim();
    const rawReason = String(item.reason || '').trim();
    if (actual.length > 4000 || evidence.length > 2000 || rawReason.length > 2000
      || (completion && !['COMPLETED', 'NOT_COMPLETED'].includes(completion))) {
      throw bad('RESULT_INVALID', `Dữ liệu mục tiêu ${index + 1} không hợp lệ.`);
    }
    if (status === 'SUBMITTED' && (!actual || !completion)) {
      throw bad('RESULT_REQUIRED', `Mục tiêu ${index + 1} cần kết quả thực tế và trạng thái hoàn thành.`);
    }
    if (status === 'SUBMITTED' && completion === 'NOT_COMPLETED' && !rawReason) {
      throw bad('REASON_REQUIRED', `Mục tiêu ${index + 1} không hoàn thành cần nêu rõ nguyên nhân.`);
    }
    const reason = completion === 'NOT_COMPLETED' ? rawReason : '';
    const maxPoints = mscTaskMax(task, counts);
    const earnedPoints = completion === 'COMPLETED' ? maxPoints : 0;
    total += earnedPoints;
    return { taskId: String(task.id), actual, evidence, completion, reason, maxPoints, earnedPoints };
  });
  return { results, totalScore: Number(total.toFixed(6)), maxScore: mscMaxScore(counts) };
}

/** Điểm BĐH: cùng công thức, theo quyết định Hoàn thành/Không của BĐH. */
export function normalizeBdhDecisions(items, planTasks, requireAll) {
  const counts = validateSubmittedMscPlan(planTasks);
  const byId = new Map((Array.isArray(items) ? items : []).map((d) => [String(d && d.taskId), d]));
  let total = 0, decided = 0;
  const decisions = planTasks.map((task, index) => {
    const d = byId.get(String(task.id)) || {};
    const completion = String(d.completion || '').trim();
    const note = String(d.note || '').trim();
    if ((completion && !['COMPLETED', 'NOT_COMPLETED'].includes(completion)) || note.length > 2000) {
      throw bad('BDH_INVALID', `Quyết định BĐH cho mục tiêu ${index + 1} không hợp lệ.`);
    }
    if (requireAll && !completion) throw bad('BDH_REQUIRED', `Chưa chọn kết quả BĐH duyệt cho mục tiêu ${index + 1}: ${task.title}.`);
    const maxPoints = mscTaskMax(task, counts);
    const earnedPoints = completion === 'COMPLETED' ? maxPoints : 0;
    if (completion) decided++;
    total += earnedPoints;
    return { taskId: String(task.id), completion, note, maxPoints, earnedPoints };
  });
  return { decisions, score: decided === planTasks.length ? Number(total.toFixed(6)) : null };
}

/** Quy đổi điểm sang xếp hạng và hệ số KPI. */
export function mscRankFromScore(scoreInput) {
  const score = Number(Number(scoreInput).toFixed(4));
  if (scoreInput === null || scoreInput === undefined || scoreInput === '' || !Number.isFinite(score) || score < 0 || score > 10) {
    return { rank: 'Chưa xác định', coefficient: 'Chưa xác định' };
  }
  let rank, coefficient;
  if (score >= 10) { rank = 'A+'; coefficient = 1.4; }
  else if (score >= 9.7) { rank = 'A'; coefficient = 1.3; }
  else if (score >= 9.4) { rank = 'B+'; coefficient = 1.2; }
  else if (score >= 9.0) { rank = 'B'; coefficient = 1.1; }
  else if (score >= 8.0) { rank = 'C'; coefficient = 1.0; }
  else if (score >= 7.5) { rank = 'D'; coefficient = 0.8; }
  else { rank = 'E'; coefficient = 0.6; }
  return { rank, coefficient: coefficient.toFixed(1) };
}

/** Gắn maxPoints vào từng mục tiêu của kế hoạch đã hợp lệ. */
export function withMaxPoints(tasks) {
  const counts = mscCounts(tasks);
  return tasks.map((t) => ({ ...t, maxPoints: mscTaskMax(t, counts) }));
}
