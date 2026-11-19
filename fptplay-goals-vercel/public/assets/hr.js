// Trang HR – FPT Play Goals: tổng hợp, BĐH duyệt, yêu cầu sửa KH, Users, Kỳ KPI
import {
  api as baseApi, $, $$, esc, linkify, fmtPts, fmtDT, toLocalInput, GROUPS, GROUP_POINTS, GROUP_INFO, rankFromScore,
  bindClamp, clampHtml, toast, busy, modal, confirmBox, promptBox, renderLogin, logout, topbar,
} from './common.js';

const api = (action, opts = {}) => baseApi(action, { base: '/api/hr', ...opts });
const root = $('#app');
const S = { me: null, tab: 'overview', periodId: '', ov: null, q: '', dept: '', st: '', users: null, uq: '', editStatus: 'PENDING' };

async function boot() {
  try { S.me = await baseApi('me', { base: '/api/auth' }); }
  catch (e) {
    if (e.status === 401) return renderLogin(root, { subtitle: 'Trang HR · Tổng hợp KPI Manager', onDone: boot });
    root.innerHTML = `<div class="wrap"><div class="alert err">${esc(e.message)}</div></div>`; return;
  }
  if (!S.me.isHR) {
    root.innerHTML = `<div class="login"><div class="box"><div class="alert err">Tài khoản <b>${esc(S.me.email)}</b> không có quyền xem tổng hợp.</div>
      <a class="btn primary" href="/">Về cổng Manager</a> <button class="btn" id="lo">Đổi tài khoản</button></div></div>`;
    $('#lo').onclick = logout; return;
  }
  root.innerHTML = topbar(S.me, `Trang HR · Tổng hợp KPI Manager${S.me.isAdmin ? ' · Admin' : ''}`, S.me.isManager ? '<a class="btn sm" href="/">Cổng Manager</a>' : '') + `
    <main class="wrap"><nav class="tabs" id="tabs">
      <button data-tab="overview">Tổng quan & BĐH duyệt</button>
      <button data-tab="edits">Yêu cầu sửa kế hoạch <span id="cnt-edits"></span></button>
      <button data-tab="users">Người dùng</button><button data-tab="periods">Kỳ KPI</button>
    </nav><section id="tab"></section></main>`;
  $('#btn-logout').onclick = logout;
  $$('#tabs button').forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; showTab(); }));
  showTab(); refreshEditCount();
}
function showTab() {
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
  $('#tab').innerHTML = '<div class="loading">Đang tải…</div>';
  ({ overview: tabOverview, edits: tabEdits, users: tabUsers, periods: tabPeriods })[S.tab]()
    .catch((e) => { $('#tab').innerHTML = `<div class="alert err">${esc(e.message)}</div>`; });
}
async function refreshEditCount() {
  try { const r = await api('edit-requests', { query: { status: 'PENDING' } }); $('#cnt-edits').innerHTML = r.length ? `<span class="count">${r.length}</span>` : ''; } catch { /* ignore */ }
}
const pill = (v) => {
  const cls = { 'Đã nộp': 'ok', 'Bản nháp': 'info', 'Đã duyệt': 'ok', 'Chờ duyệt': 'warn', 'Đang duyệt (nháp)': 'info' }[v];
  return cls ? `<span class="badge ${cls}">${esc(v)}</span>` : v === 'Chưa đến bước' ? `<span class="muted small">${esc(v)}</span>` : `<span class="badge err">${esc(v)}</span>`;
};
const PHASE = { PLAN: 'PLAN – Đăng ký', RESULT: 'RESULT – Báo cáo' };

// ====================================================================== TỔNG QUAN
async function tabOverview() {
  S.ov = await api('overview', { query: S.periodId ? { period: S.periodId } : {} });
  const { periods, period, summary, managers } = S.ov;
  if (!period) { $('#tab').innerHTML = '<div class="card empty">Chưa có kỳ KPI. Tạo kỳ ở tab "Kỳ KPI".</div>'; return; }
  S.periodId = S.ov.selectedPeriodId;
  const depts = [...new Set(managers.map((m) => m.department).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));
  const canExport = period.phase === 'RESULT' || period.status === 'CLOSED';
  $('#tab').innerHTML = `
    <div class="card row" style="align-items:flex-end">
      <div style="width:270px"><label class="f">Kỳ KPI</label><select id="o-period">${periods.slice().reverse().map((p) =>
        `<option value="${esc(p.id)}" ${p.id === period.id ? 'selected' : ''}>${esc(p.name)} · ${p.status} / ${p.phase}</option>`).join('')}</select></div>
      <div style="width:230px"><label class="f">Tìm Manager</label><input id="o-q" type="search" placeholder="Tên, email hoặc phòng" value="${esc(S.q)}"></div>
      <div style="width:180px"><label class="f">Phòng</label><select id="o-dept"><option value="">Tất cả phòng</option>${depts.map((d) => `<option ${d === S.dept ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select></div>
      <div style="width:200px"><label class="f">Trạng thái</label><select id="o-st">
        ${[['', 'Tất cả trạng thái'], ['noplan', 'Chưa nộp kế hoạch'], ['nores', 'Chưa nộp báo cáo'], ['toreview', 'Chờ BĐH duyệt'], ['approved', 'BĐH đã duyệt'], ['warn', 'Có cảnh báo'], ['edit', 'Đang xin sửa KH']]
    .map(([v, l]) => `<option value="${v}" ${v === S.st ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="grow"></div>
      <button class="btn" id="o-reload">Tải lại</button>
      <button class="btn primary" id="o-export" ${canExport ? '' : 'disabled title="Chỉ tải khi kỳ ở giai đoạn RESULT hoặc đã CLOSED"'}>⬇ Tải báo cáo Excel</button>
    </div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:16px">
      <div class="stat"><span>Tổng Manager</span><b>${summary.total}</b></div><div class="stat"><span>Đã nộp kế hoạch</span><b>${summary.plansSubmitted}</b></div>
      <div class="stat"><span>Đã nộp báo cáo</span><b>${summary.resultsSubmitted}</b></div><div class="stat"><span>BĐH đã duyệt</span><b style="color:var(--ok)">${summary.bdhApproved}</b></div>
      <div class="stat"><span>Cần theo dõi</span><b style="color:var(--must)">${summary.needsAttention}</b></div></div>
    <div class="tbl-wrap"><table class="t stack"><thead><tr><th>Manager</th><th>Phòng</th><th>Kế hoạch</th><th>Báo cáo</th><th class="right">Tự đánh giá</th><th>BĐH</th><th>Cảnh báo</th><th></th></tr></thead>
      <tbody id="o-rows"></tbody></table></div>
    <p class="muted small" id="o-count"></p>
    <div class="alert warn small">Must có tổng 8 điểm; Should tối đa 1,5 điểm và Could tối đa 0,5 điểm nếu được đăng ký. Mục tiêu hoàn thành nhận phần điểm được phân bổ; không hoàn thành nhận 0.</div>`;
  $('#o-period').onchange = (e) => { S.periodId = e.target.value; showTab(); };
  $('#o-reload').onclick = () => showTab();
  $('#o-export').onclick = (e) => busy(e.currentTarget, exportExcel);
  const draw = () => {
    const q = S.q.trim().toLocaleLowerCase('vi');
    const list = managers.filter((m) => (!q || [m.name, m.email, m.department].some((v) => String(v || '').toLocaleLowerCase('vi').includes(q)))
      && (!S.dept || m.department === S.dept)
      && ({ '': true, noplan: m.planStatus !== 'Đã nộp', nores: m.resultStatus !== 'Đã nộp', toreview: m.resultStatus === 'Đã nộp' && m.bdhStatus !== 'Đã duyệt',
        approved: m.bdhStatus === 'Đã duyệt', warn: !!m.warning, edit: m.pendingEdit })[S.st]);
    $('#o-rows').innerHTML = list.length ? list.map((m) => `<tr class="click" data-u="${m.userId}">
      <td data-label="Manager"><b>${esc(m.name)}</b><div class="muted small">${esc(m.email)}</div></td>
      <td data-label="Phòng">${esc(m.department || '—')}</td>
      <td data-label="Kế hoạch">${pill(m.planStatus)}${m.planRevision > 1 ? ` <span class="badge">Lần ${m.planRevision}</span>` : ''}${m.planReopened ? ' <span class="badge info">Đang sửa</span>' : ''}</td>
      <td data-label="Báo cáo">${pill(m.resultStatus)}${m.resultReopened ? ' <span class="badge info">Đang sửa</span>' : ''}</td>
      <td class="right" data-label="Tự đánh giá">${m.selfScore !== null ? `<b>${fmtPts(m.selfScore)}</b><div class="muted small">${m.selfRank} · ${String(m.selfCoefficient).replace('.', ',')}</div>` : '—'}</td>
      <td data-label="BĐH">${pill(m.bdhStatus)}${m.bdhScore !== null ? `<div><b>${fmtPts(m.bdhScore)}</b> <span class="muted small">${m.bdhRank} · ${String(m.bdhCoefficient).replace('.', ',')}</span></div>` : ''}</td>
      <td data-label="Cảnh báo">${m.warning ? `<span class="badge err" style="white-space:normal">${esc(m.warning)}</span>` : ''}${m.pendingEdit ? ' <span class="badge warn">Đang xin sửa KH</span>' : ''}</td>
      <td><button class="btn sm">${m.resultStatus === 'Đã nộp' && m.bdhStatus !== 'Đã duyệt' ? 'Duyệt' : 'Xem'}</button></td></tr>`).join('')
      : '<tr><td colspan="8" class="empty">Không có Manager phù hợp</td></tr>';
    $('#o-count').textContent = `Đang hiển thị ${list.length}/${managers.length} Manager · bấm một dòng để xem chi tiết và duyệt`;
  };
  $('#o-q').oninput = (e) => { S.q = e.target.value; draw(); };
  $('#o-dept').onchange = (e) => { S.dept = e.target.value; draw(); };
  $('#o-st').onchange = (e) => { S.st = e.target.value; draw(); };
  $('#o-rows').onclick = (e) => { const tr = e.target.closest('tr[data-u]'); if (tr) openDetail(Number(tr.dataset.u)); };
  draw();
}

async function exportExcel() {
  if (!(await confirmBox('Tải báo cáo Excel của kỳ đang chọn? File phản ánh dữ liệu tại thời điểm xuất.', { ok: 'Tải về' }))) return;
  const r = await fetch(`/api/hr?action=export&period=${encodeURIComponent(S.periodId)}`, { credentials: 'same-origin' });
  if (!r.ok) { let m = 'Không tạo được báo cáo Excel.'; try { m = (await r.json()).message || m; } catch { /* */ } return toast(m, 'err', 7000); }
  const blob = await r.blob();
  const name = (r.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'KPI_Manager.xlsx';
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  toast('Đã tạo báo cáo Excel cho kỳ được chọn.');
}

// ---------------------------------------------------------------- CHI TIẾT + BĐH DUYỆT
async function openDetail(userId) {
  const m = modal({ title: 'Đang tải…', body: '<div class="loading" style="min-height:200px">Đang tải…</div>', size: 'lg' });
  let data;
  try { data = await api('detail', { query: { period: S.periodId, user_id: userId } }); }
  catch (e) { $('.mb', m.el).innerHTML = `<div class="alert err">${esc(e.message)}</div>`; return; }
  const { period, manager: mg, edits } = data;
  const canReview = mg.resultStatus === 'Đã nộp' && !mg.resultReopened && (period.phase === 'RESULT' || period.status === 'CLOSED');
  const approved = mg.review?.status === 'APPROVED';
  // Quyết định BĐH: lấy từ bản đã lưu, nếu chưa có thì mặc định theo tự đánh giá
  const dec = Object.fromEntries(mg.tasks.map((t) => [t.id, { completion: t.bdhCompletion || (canReview ? t.completion : ''), note: t.bdhNote || '' }]));
  $('.mh h3', m.el).textContent = `${mg.name} — ${period.name}`;

  const groupHtml = (g) => {
    const items = mg.tasks.filter((t) => t.msc === g); if (!items.length) return '';
    const hasRes = mg.resultStatus === 'Đã nộp';
    const cg = hasRes ? '<colgroup><col style="width:24%"><col style="width:22%"><col style="width:13%"><col style="width:11%"><col style="width:20%"><col style="width:10%"></colgroup>'
      : '<colgroup><col style="width:34%"><col><col style="width:120px"></colgroup>';
    return `<div class="grp ${g.toLowerCase()}" style="margin-top:12px;padding:10px 0 4px 14px"><h3><span class="chip ${g.toLowerCase()}">${GROUP_INFO[g].label}</span> ${items.length} mục tiêu · ${fmtPts(GROUP_POINTS[g])} điểm</h3>
      <div class="tbl-wrap"><table class="t fixed stack">${cg}<thead><tr>${hasRes ? '<th>Mục tiêu</th><th>Kết quả thực hiện</th><th>Minh chứng</th><th>Tự ĐG</th><th>BĐH duyệt</th><th class="right">Điểm BĐH</th>'
      : '<th>Mục tiêu</th><th>Kết quả cam kết</th><th class="right">Điểm khi HT</th>'}</tr></thead><tbody>
      ${items.map((t) => hasRes ? `<tr data-t="${esc(t.id)}">
        <td data-label="Mục tiêu"><b>${esc(t.title)}</b>${clampHtml(t.target)}<div class="muted small">Điểm khi HT: <b>${fmtPts(t.maxPoints)}</b></div></td>
        <td data-label="Kết quả thực hiện"><div class="pre">${esc(t.actual)}</div>${t.completion === 'NOT_COMPLETED' && t.reason ? `<div class="small pre" style="color:#991b1b;margin-top:4px"><b>Nguyên nhân:</b> ${esc(t.reason)}</div>` : ''}</td>
        <td data-label="Minh chứng">${t.evidence ? linkify(t.evidence) : '—'}</td>
        <td data-label="Tự ĐG">${t.completion === 'COMPLETED' ? '<span class="badge ok">Hoàn thành</span>' : '<span class="badge err">Không HT</span>'}</td>
        <td data-label="BĐH duyệt"><span class="seg" data-seg>
          <button type="button" data-v="COMPLETED" ${canReview ? '' : 'disabled'}>✓ HT</button><button type="button" data-v="NOT_COMPLETED" ${canReview ? '' : 'disabled'}>✕ Không HT</button></span>
          <div class="small" data-diff style="color:#b45309;margin-top:4px"></div>${canReview ? '<button type="button" class="more" data-note-btn>+ Ghi chú BĐH</button>' : ''}</td>
        <td class="pts" data-label="Điểm BĐH" data-pts>—</td></tr>
        <tr class="reason hidden" data-note="${esc(t.id)}"><td colspan="6"><label class="f" style="color:#991b1b">Ghi chú BĐH cho mục tiêu này (gửi kèm email)</label>
          <input maxlength="2000" value="${esc(dec[t.id].note)}" ${canReview ? '' : 'disabled'}></td></tr>`
    : `<tr><td data-label="Mục tiêu"><b>${esc(t.title)}</b></td><td data-label="Kết quả cam kết">${clampHtml(t.target).replace('muted small ', '')}</td><td class="pts" data-label="Điểm khi HT">${fmtPts(t.maxPoints)}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  };

  const mailTxt = (s) => ({ SENT: 'đã gửi', FAILED: '<b style="color:var(--err)">lỗi</b>', PENDING: 'chờ gửi', PROCESSING: 'đang gửi' }[s] || '—');
  $('.mb', m.el).innerHTML = `
    <div class="row" style="align-items:flex-start">
      <div class="grow muted small">${esc(mg.email)} · ${esc(mg.department || 'Chưa có phòng')}${mg.team ? ` · ${esc(mg.team)}` : ''}${mg.ccEmails?.length ? ` · CC: ${esc(mg.ccEmails.join(', '))}` : ''}<br>
        Kế hoạch: ${pill(mg.planStatus)} ${mg.planSubmittedAt ? `nộp ${fmtDT(mg.planSubmittedAt)} (lần ${mg.planRevision}, email ${mailTxt(mg.planMailStatus)})` : ''}${mg.planReopened ? ' <span class="badge info">Đang được sửa</span>' : ''}<br>
        Báo cáo: ${pill(mg.resultStatus)} ${mg.resultSubmittedAt ? `nộp ${fmtDT(mg.resultSubmittedAt)} (email ${mailTxt(mg.resultMailStatus)})` : ''}${mg.resultReopened ? ' <span class="badge info">Đang được sửa</span>' : ''}</div>
      <div class="scorebox">
        <div><div class="muted small">Tự đánh giá</div><div class="rank">${mg.selfScore !== null ? `${fmtPts(mg.selfScore)} <span class="muted" style="font-size:13px">${mg.selfRank} · ${String(mg.selfCoefficient).replace('.', ',')}</span>` : '—'}</div></div>
        <div style="border-left:1px solid var(--line);padding-left:20px"><div class="muted small">BĐH duyệt</div><div class="big" id="d-score">—</div></div>
        <div><div class="muted small">Xếp hạng</div><div class="rank" id="d-rank">—</div></div><div><div class="muted small">Hệ số</div><div class="rank" id="d-coef">—</div></div>
      </div></div>
    ${mg.warning ? `<div class="alert err" style="margin-top:12px">${esc(mg.warning)}</div>` : ''}
    <div class="alert warn hidden" id="d-diff" style="margin-top:12px"></div>
    ${mg.tasks.length ? GROUPS.map(groupHtml).join('') : '<div class="empty">Chưa có kế hoạch đã nộp để xem chi tiết.</div>'}
    ${mg.resultStatus === 'Đã nộp' ? `<div class="grid g2" style="margin-top:14px">
      <div><label class="f">Nhận xét của BĐH (gửi kèm email cho Manager)</label><textarea id="d-comment" rows="3" maxlength="4000" ${canReview ? '' : 'disabled'}>${esc(mg.review?.comment || '')}</textarea></div>
      <div><label class="f">Thông tin duyệt</label><div class="alert ${approved ? 'ok' : 'info'} small" style="margin:0">
        Trạng thái: <b>${esc(mg.bdhStatus)}</b>${approved ? ` · ${fmtDT(mg.approvedAt)} · Người duyệt: ${esc(mg.reviewerEmail)} · Email kết quả: ${mailTxt(mg.bdhMailStatus)}` : ''}
        ${!canReview && mg.resultReopened ? '<br>Báo cáo đang được Manager sửa lại – chờ nộp lại mới duyệt được.' : ''}
        ${!canReview && period.phase === 'PLAN' && period.status !== 'CLOSED' ? '<br>Chỉ duyệt khi kỳ ở giai đoạn RESULT hoặc đã CLOSED.' : ''}</div></div></div>` : ''}
    ${edits.length ? `<h3 style="margin-top:18px">Lịch sử xin sửa kế hoạch</h3><ul class="small">${edits.map((e) => `<li>${fmtDT(e.created_at)} – ${esc({ PENDING: 'Chờ duyệt', APPROVED: 'Đã duyệt', REJECTED: 'Từ chối' }[e.status])} – ${esc(e.reason)}${e.decision_note ? ` <i>(HR: ${esc(e.decision_note)})</i>` : ''}</li>`).join('')}</ul>` : ''}`;

  const open = period.status === 'OPEN';
  const foot = document.createElement('div');
  foot.className = 'mf';
  foot.innerHTML = `
    ${open && period.phase === 'PLAN' && mg.planStatus === 'Đã nộp' && !mg.planReopened ? '<button class="btn sm" id="d-reopen-plan">Mở lại kế hoạch</button>' : ''}
    ${open && period.phase === 'RESULT' && mg.resultStatus === 'Đã nộp' && !mg.resultReopened ? '<button class="btn sm" id="d-reopen-res">Mở lại báo cáo</button>' : ''}
    ${mg.planStatus === 'Đã nộp' ? '<button class="btn sm" data-resend="PLAN">Gửi lại email KH</button>' : ''}
    ${mg.resultStatus === 'Đã nộp' ? '<button class="btn sm" data-resend="RESULT">Gửi lại email BC</button>' : ''}
    ${approved ? '<button class="btn sm" data-resend="BDH">Gửi lại email BĐH</button>' : ''}
    <div class="grow"></div><button class="btn" data-close>Đóng</button>
    ${canReview ? `<button class="btn" id="d-draft">${approved ? 'Lưu & chuyển về nháp' : 'Lưu nháp duyệt'}</button><button class="btn primary" id="d-approve">Duyệt & gửi Manager</button>` : ''}`;
  $('.modal', m.el).appendChild(foot);
  bindClamp(m.el);

  const self = Object.fromEntries(mg.tasks.map((t) => [t.id, t]));
  const refresh = () => {
    let total = 0, chosen = 0;
    const diffs = [];
    $$('tr[data-t]', m.el).forEach((tr) => {
      const id = tr.dataset.t, d = dec[id], t = self[id];
      $$('[data-seg] button', tr).forEach((b) => { b.className = b.dataset.v === d.completion ? `on ${d.completion === 'COMPLETED' ? 'ok' : 'no'}` : ''; });
      const diff = d.completion && d.completion !== t.completion;
      tr.classList.toggle('diff', !!diff);
      $('[data-diff]', tr).textContent = diff ? '⚠ Khác tự đánh giá' : '';
      if (diff) diffs.push(`${t.msc}: ${t.title}`);
      $('[data-pts]', tr).textContent = d.completion ? fmtPts(d.completion === 'COMPLETED' ? t.maxPoints : 0) : '—';
      const noteRow = $(`tr[data-note="${CSS.escape(id)}"]`, m.el);
      if (diff || d.note) noteRow.classList.remove('hidden');
      if (d.completion) chosen++;
      if (d.completion === 'COMPLETED') total += t.maxPoints;
    });
    const all = chosen === mg.tasks.length && chosen > 0;
    const rk = all ? rankFromScore(total) : null;
    $('#d-score', m.el).innerHTML = all ? `${fmtPts(total)}<span class="muted" style="font-size:14px">/10</span>` : '—';
    $('#d-rank', m.el).textContent = rk ? rk.rank : '—';
    $('#d-coef', m.el).textContent = rk ? rk.coefficient : '—';
    const box = $('#d-diff', m.el);
    box.classList.toggle('hidden', !diffs.length);
    box.innerHTML = diffs.length ? `BĐH điều chỉnh <b>${diffs.length}</b> mục tiêu so với tự đánh giá: ${diffs.map(esc).join('; ')}.` : '';
  };
  if (mg.resultStatus === 'Đã nộp') refresh();
  m.el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-seg] button');
    if (b && !b.disabled) { dec[b.closest('tr').dataset.t].completion = b.dataset.v; refresh(); return; }
    const nb = e.target.closest('[data-note-btn]');
    if (nb) { const row = $(`tr[data-note="${CSS.escape(nb.closest('tr').dataset.t)}"]`, m.el); row.classList.remove('hidden'); $('input', row).focus(); }
  });
  m.el.addEventListener('input', (e) => { const row = e.target.closest('tr[data-note]'); if (row) dec[row.dataset.note].note = e.target.value; });

  const act = (sel, fn) => $$(sel, m.el).forEach((b) => { b.onclick = () => busy(b, fn.bind(null, b)); });
  const submitReview = async (approve) => {
    if (approve) {
      const missing = mg.tasks.filter((t) => !dec[t.id].completion);
      if (missing.length) return toast(`Chưa chọn kết quả BĐH cho ${missing.length} mục tiêu.`, 'err');
      if (!(await confirmBox(`Duyệt điểm <b>${$('#d-score', m.el).textContent}</b> (xếp hạng ${$('#d-rank', m.el).textContent}) và gửi email kết quả cho Manager?`, { ok: 'Duyệt & gửi' }))) return;
    } else if (approved && !(await confirmBox('Kết quả đang ở trạng thái <b>Đã duyệt</b>. Lưu nháp sẽ hủy duyệt (Manager không còn thấy điểm BĐH). Tiếp tục?', { danger: true, ok: 'Chuyển về nháp' }))) return;
    try {
      const r = await api('review-save', { method: 'POST', body: {
        periodId: period.id, userId: mg.userId, resultVersionId: mg.resultVersionId, approve,
        decisions: mg.tasks.map((t) => ({ taskId: t.id, ...dec[t.id] })), comment: $('#d-comment', m.el).value,
      } });
      toast(r.message, /chưa gửi/.test(r.message) ? 'err' : 'ok', 7000); m.close(); tabOverview();
    } catch (e) { toast(e.message, 'err', 7000); }
  };
  act('#d-approve', () => submitReview(true));
  act('#d-draft', () => submitReview(false));
  act('#d-reopen-plan', async () => {
    if (!(await confirmBox('Mở lại kế hoạch để Manager chỉnh sửa và nộp lại? Bản đã nộp vẫn hiệu lực cho tới khi nộp lại.'))) return;
    try { const r = await api('plan-reopen', { method: 'POST', body: { periodId: period.id, userId: mg.userId } }); toast(r.message); m.close(); tabOverview(); }
    catch (e) { toast(e.message, 'err', 7000); }
  });
  act('#d-reopen-res', async () => {
    if (!(await confirmBox(`Mở lại báo cáo để Manager chỉnh sửa?${approved ? ' <b>Kết quả BĐH đã duyệt sẽ chuyển về nháp.</b>' : ''}`, { danger: approved }))) return;
    try { const r = await api('result-reopen', { method: 'POST', body: { periodId: period.id, userId: mg.userId } }); toast(r.message); m.close(); tabOverview(); }
    catch (e) { toast(e.message, 'err', 7000); }
  });
  act('[data-resend]', async (b) => {
    try { const r = await api('resend-mail', { method: 'POST', body: { kind: b.dataset.resend, periodId: period.id, userId: mg.userId } }); toast(r.message, r.sent ? 'ok' : 'err'); }
    catch (e) { toast(e.message, 'err', 7000); }
  });
}

// ====================================================================== YÊU CẦU SỬA KẾ HOẠCH
async function tabEdits() {
  const rows = await api('edit-requests', { query: { status: S.editStatus } });
  const ST = { PENDING: ['Chờ duyệt', 'warn'], APPROVED: ['Đã duyệt', 'ok'], REJECTED: ['Từ chối', 'err'] };
  $('#tab').innerHTML = `<div class="row" style="margin-bottom:10px"><select id="e-st" style="width:auto">
      ${[['PENDING', 'Chờ duyệt'], ['APPROVED', 'Đã duyệt'], ['REJECTED', 'Từ chối'], ['ALL', 'Tất cả']].map(([v, l]) => `<option value="${v}" ${v === S.editStatus ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="tbl-wrap"><table class="t stack"><thead><tr><th>Thời gian</th><th>Manager</th><th>Kỳ</th><th style="min-width:260px">Lý do</th><th>Trạng thái</th><th></th></tr></thead><tbody>
    ${rows.length ? rows.map((r) => `<tr data-id="${r.id}"><td data-label="Thời gian" class="nowrap">${fmtDT(r.created_at)}</td>
      <td data-label="Manager"><b>${esc(r.full_name)}</b><div class="muted small">${esc(r.email)} · ${esc(r.department)}</div></td><td data-label="Kỳ">${esc(r.period_name)}</td>
      <td data-label="Lý do"><div class="pre">${esc(r.reason)}</div>${r.decision_note ? `<div class="muted small">HR: ${esc(r.decision_note)}</div>` : ''}</td>
      <td data-label="Trạng thái"><span class="badge ${ST[r.status][1]}">${ST[r.status][0]}</span>${r.decided_by_email ? `<div class="muted small">${esc(r.decided_by_email)} · ${fmtDT(r.decided_at)}</div>` : ''}</td>
      <td class="nowrap">${r.status === 'PENDING' ? '<button class="btn sm ok" data-a="1">Chấp thuận</button> <button class="btn sm danger" data-a="0">Từ chối</button>' : ''}</td></tr>`).join('')
      : '<tr><td colspan="6" class="empty">Không có yêu cầu</td></tr>'}</tbody></table></div>`;
  $('#e-st').onchange = (e) => { S.editStatus = e.target.value; showTab(); };
  $('#tab tbody').onclick = async (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const approve = b.dataset.a === '1';
    const note = await promptBox(approve ? 'Chấp thuận yêu cầu sửa kế hoạch' : 'Từ chối yêu cầu sửa kế hoạch', approve ? 'Ghi chú gửi Manager (không bắt buộc)' : 'Lý do từ chối (gửi Manager)', { required: !approve, ok: approve ? 'Chấp thuận' : 'Từ chối' });
    if (note === null) return;
    try {
      await api('edit-decide', { method: 'POST', body: { id: Number(b.closest('tr').dataset.id), approve, note } });
      toast(approve ? 'Đã chấp thuận – kế hoạch được mở lại cho Manager.' : 'Đã từ chối.'); showTab(); refreshEditCount();
    } catch (err) { toast(err.message, 'err', 7000); }
  };
}

// ====================================================================== NGƯỜI DÙNG
async function tabUsers() {
  S.users = await api('users');
  $('#tab').innerHTML = `<div class="row" style="margin-bottom:10px">
      <input id="u-q" type="search" placeholder="Tìm theo tên, email, phòng…" style="max-width:320px" value="${esc(S.uq)}">
      <span class="muted small" id="u-n"></span><div class="grow"></div><button class="btn primary" id="u-add">+ Thêm người dùng</button></div>
    <div class="tbl-wrap"><table class="t stack"><thead><tr><th>Họ tên</th><th>Email</th><th>Phòng / Nhóm</th><th>Role</th><th>Quyền</th><th>Email CC (cột N)</th><th>Trạng thái</th></tr></thead><tbody id="u-rows"></tbody></table></div>`;
  const draw = () => {
    const q = S.uq.toLocaleLowerCase('vi');
    const list = S.users.filter((u) => !q || `${u.full_name} ${u.email} ${u.department} ${u.team}`.toLocaleLowerCase('vi').includes(q));
    $('#u-n').textContent = `${list.length}/${S.users.length} người dùng`;
    $('#u-rows').innerHTML = list.map((u) => `<tr class="click" data-id="${u.id}" style="${u.active ? '' : 'opacity:.55'}">
      <td data-label="Họ tên"><b>${esc(u.full_name)}</b></td><td data-label="Email">${esc(u.email)}</td><td data-label="Phòng / Nhóm">${esc(u.department)}${u.team ? `<div class="muted small">${esc(u.team)}</div>` : ''}</td>
      <td data-label="Role">${esc(u.role)}</td><td data-label="Quyền">${u.is_admin ? '<span class="badge brand">Admin</span> ' : ''}${u.is_hr ? '<span class="badge info">isHR</span>' : ''}</td>
      <td data-label="CC" class="small">${esc((u.cc_emails || []).join(', '))}</td><td data-label="Trạng thái">${u.active ? '<span class="badge ok">Hoạt động</span>' : '<span class="badge">Đã khóa</span>'}</td></tr>`).join('');
  };
  $('#u-q').oninput = (e) => { S.uq = e.target.value; draw(); };
  $('#u-add').onclick = () => userForm(null);
  $('#u-rows').onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) userForm(S.users.find((u) => u.id === Number(tr.dataset.id))); };
  draw();
}
function userForm(u) {
  const admin = S.me.isAdmin;
  const m = modal({
    title: u ? 'Sửa người dùng' : 'Thêm người dùng',
    body: `<div class="grid g2">
      <div><label class="f">Email *</label><input id="f-email" type="email" value="${esc(u?.email || '')}" placeholder="ten@fpt.com"></div>
      <div><label class="f">Họ tên</label><input id="f-name" value="${esc(u?.full_name || '')}"></div>
      <div><label class="f">Phòng</label><input id="f-dept" value="${esc(u?.department || '')}"></div>
      <div><label class="f">Nhóm</label><input id="f-team" value="${esc(u?.team || '')}"></div>
      <div><label class="f">Role</label><input id="f-role" list="roles" value="${esc(u?.role || 'Manager')}"><datalist id="roles"><option>Manager</option><option>HR</option><option>Khác</option></datalist>
        <div class="muted small">Chỉ Role = <b>Manager</b> mới lập KPI.</div></div>
      <div style="padding-top:22px"><label><input type="checkbox" id="f-hr" ${u?.is_hr ? 'checked' : ''} ${admin ? '' : 'disabled'}> isHR (xem trang HR)</label><br>
        <label><input type="checkbox" id="f-admin" ${u?.is_admin ? 'checked' : ''} ${admin ? '' : 'disabled'}> Admin (cấp quyền HR)</label>
        ${admin ? '' : '<div class="muted small">Chỉ Admin được đổi quyền HR/Admin.</div>'}</div></div>
    <div style="margin-top:12px"><label class="f">Email CC khi gửi xác nhận (cột N – cách nhau bằng dấu phẩy)</label><input id="f-cc" value="${esc((u?.cc_emails || []).join(', '))}"></div>
    <label style="display:block;margin-top:12px"><input type="checkbox" id="f-active" ${u?.active === false ? '' : 'checked'}> Đang hoạt động (bỏ chọn để khóa và thu hồi phiên đăng nhập ngay)</label>`,
    footer: '<button class="btn" data-close>Hủy</button><button class="btn primary" id="f-save">Lưu</button>',
  });
  const b = $('#f-save', m.el);
  b.onclick = () => busy(b, async () => {
    try {
      await api('user-save', { method: 'POST', body: {
        id: u?.id, email: $('#f-email', m.el).value, full_name: $('#f-name', m.el).value, department: $('#f-dept', m.el).value,
        team: $('#f-team', m.el).value, role: $('#f-role', m.el).value, is_hr: $('#f-hr', m.el).checked, is_admin: $('#f-admin', m.el).checked,
        cc_emails: $('#f-cc', m.el).value, active: $('#f-active', m.el).checked,
      } });
      toast('Đã lưu người dùng.'); m.close(); tabUsers();
    } catch (e) { toast(e.message, 'err', 7000); }
  });
}

// ====================================================================== KỲ KPI
async function tabPeriods() {
  const rows = await api('periods');
  const stBadge = (s) => `<span class="badge ${{ OPEN: 'ok', CLOSED: '', DRAFT: 'warn' }[s]}">${s}</span>`;
  $('#tab').innerHTML = `<div class="alert info small">Quy trình: tạo kỳ (DRAFT) → <b>OPEN</b> + giai đoạn <b>PLAN</b> (Manager đăng ký mục tiêu) → chuyển <b>RESULT</b> (Manager báo cáo, BĐH duyệt) → <b>CLOSED</b>. Chỉ được có 1 kỳ OPEN.</div>
    <div class="row" style="margin-bottom:10px"><div class="grow"></div><button class="btn primary" id="p-add">+ Tạo kỳ KPI</button></div>
    <div class="tbl-wrap"><table class="t stack"><thead><tr><th>Kì KPI</th><th>Tên kỳ</th><th>Trạng thái kỳ</th><th>Giai đoạn</th><th>Hạn nộp KH</th><th>Hạn nộp BC</th></tr></thead><tbody id="p-rows">
    ${rows.length ? rows.map((p) => `<tr class="click" data-id="${esc(p.id)}"><td data-label="Kì KPI"><b>${esc(p.id)}</b></td><td data-label="Tên kỳ">${esc(p.name)}</td>
      <td data-label="Trạng thái kỳ">${stBadge(p.status)}</td><td data-label="Giai đoạn">${PHASE[p.phase]}</td><td data-label="Hạn nộp KH">${fmtDT(p.plan_deadline) || '—'}</td><td data-label="Hạn nộp BC">${fmtDT(p.result_deadline) || '—'}</td></tr>`).join('')
      : '<tr><td colspan="6" class="empty">Chưa có kỳ KPI</td></tr>'}</tbody></table></div>`;
  $('#p-add').onclick = () => periodForm(null);
  $('#p-rows').onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) periodForm(rows.find((p) => p.id === tr.dataset.id)); };
}
function periodForm(p) {
  const m = modal({
    title: p ? `Sửa kỳ ${p.id}` : 'Tạo kỳ KPI',
    body: `<div class="grid g2">
      <div><label class="f">Kì KPI (mã) *</label><input id="k-id" value="${esc(p?.id || '')}" ${p ? 'disabled' : ''} placeholder="2026-12"></div>
      <div><label class="f">Tên kỳ</label><input id="k-name" value="${esc(p?.name || '')}" placeholder="Tháng 12/2026"></div>
      <div><label class="f">Trạng thái kỳ</label><select id="k-status">${['DRAFT', 'OPEN', 'CLOSED'].map((s) => `<option ${(p?.status || 'DRAFT') === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div><label class="f">Giai đoạn</label><select id="k-phase">${Object.entries(PHASE).map(([k, v]) => `<option value="${k}" ${(p?.phase || 'PLAN') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div><label class="f">Hạn nộp kế hoạch</label><input id="k-pd" type="datetime-local" value="${toLocalInput(p?.plan_deadline)}"></div>
      <div><label class="f">Hạn nộp báo cáo</label><input id="k-rd" type="datetime-local" value="${toLocalInput(p?.result_deadline)}"></div></div>`,
    footer: '<button class="btn" data-close>Hủy</button><button class="btn primary" id="k-save">Lưu</button>',
  });
  const b = $('#k-save', m.el);
  b.onclick = () => busy(b, async () => {
    const status = $('#k-status', m.el).value, phase = $('#k-phase', m.el).value;
    if (p && (p.status !== status || p.phase !== phase)
      && !(await confirmBox(`Chuyển kỳ <b>${esc(p.name)}</b> sang <b>${status} / ${phase}</b>? Manager sẽ thấy thay đổi ngay.`))) return;
    const iso = (v) => (v ? new Date(v).toISOString() : null);
    try {
      await api('period-save', { method: 'POST', body: { id: p?.id || $('#k-id', m.el).value.trim(), name: $('#k-name', m.el).value, status, phase,
        plan_deadline: iso($('#k-pd', m.el).value), result_deadline: iso($('#k-rd', m.el).value) } });
      toast('Đã lưu kỳ KPI.'); m.close(); showTab();
    } catch (e) { toast(e.message, 'err', 7000); }
  });
}

boot();
