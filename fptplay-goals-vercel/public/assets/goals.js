// Cổng Manager – FPT Play Goals (đăng ký mục tiêu MSC & báo cáo kết quả)
import {
  api, $, $$, esc, linkify, makeId, fmtPts, fmtDT, GROUPS, GROUP_POINTS, GROUP_INFO, rankFromScore,
  autoGrow, bindClamp, clampHtml, toast, busy, modal, confirmBox, promptBox, renderLogin, logout, topbar,
} from './common.js';

const root = $('#app');
const S = { me: null, data: null, plan: null, res: null, pending: null, dirty: false };
const MAX_TASKS = 20;
const PLAN_TEXT = {
  Must: { title: 'Nêu ngắn gọn kết quả trọng tâm cần đạt trong tháng', targetLabel: 'Kết quả cam kết hoàn thành',
    target: 'Nêu rõ sản phẩm/đầu ra, chỉ tiêu số lượng hoặc tiêu chí chất lượng để làm căn cứ đánh giá cuối tháng' },
  Should: { title: 'Nêu ngắn gọn nội dung công việc cần nâng cao hiệu quả.', targetLabel: 'Kết quả cam kết hoàn thành',
    target: 'Nêu rõ hiện trạng hoặc mức chuẩn, mức cải thiện cần đạt; có thể thể hiện bằng chất lượng, sản lượng, chi phí hoặc hiệu quả sử dụng nguồn lực.' },
  Could: { title: 'Nêu ngắn gọn nội dung cải tiến, đổi mới hoặc giá trị gia tăng dự kiến.', targetLabel: 'Kết quả cam kết và giá trị mang lại',
    target: 'Nêu rõ đầu ra và giá trị dự kiến mang lại cho đơn vị/Công ty.' },
};
const RULES_SCORE = `<b>Nguyên tắc tính điểm KPI</b><br>
- Mỗi mục tiêu được đánh giá Hoàn thành hoặc Không hoàn thành.<br>
- Tổng điểm tối đa: 10 điểm, gồm Must: 8 điểm; Should: 1,5 điểm; Could: 0,5 điểm.<br>
- Các mục tiêu trong cùng nhóm có điểm bằng nhau. Điểm mỗi mục tiêu = Điểm tối đa của nhóm / Số mục tiêu đã đăng ký trong nhóm.<br>
- Mục tiêu hoàn thành được ghi nhận toàn bộ điểm của mục tiêu; mục tiêu không hoàn thành được ghi nhận 0 điểm. Nhóm không đăng ký được ghi nhận 0 điểm; điểm không chuyển giữa các nhóm.<br>
- Tổng điểm KPI bằng tổng điểm các mục tiêu được ghi nhận hoàn thành.<br>
- Chỉ đăng ký nhóm Must thì tổng điểm tối đa là 8/10 điểm.`;
const RULES_UPDATE = `<b>Cập nhật và phê duyệt kết quả</b><br>
- Cuối tháng, CBQL cập nhật kết quả thực tế, minh chứng và tự đánh giá từng mục tiêu.<br>
- Mục tiêu không hoàn thành phải nêu rõ nguyên nhân.<br>
- Điểm KPI được BDH phê duyệt là căn cứ tính lương KPI theo chính sách của Công ty.`;
const RULES_PLAN = `<b>1. Đăng ký mục tiêu</b><br>
- CBQL đăng ký mục tiêu theo phương pháp MSC, tập trung vào kết quả đầu ra và giá trị đóng góp cho đơn vị:<br>
&nbsp;&nbsp;• <b>Must - Mục tiêu bắt buộc:</b> Các mục tiêu trọng yếu phải hoàn thành trong tháng, gắn với trách nhiệm quản lý và mục tiêu của đơn vị; đăng ký ít nhất 02 mục tiêu.<br>
&nbsp;&nbsp;• <b>Should - Mục tiêu nâng cao hiệu quả:</b> Các mục tiêu bổ sung giúp nâng cao hiệu quả, chất lượng, năng suất công việc.<br>
&nbsp;&nbsp;• <b>Could - Mục tiêu tạo giá trị gia tăng:</b> Các mục tiêu mở rộng ngoài yêu cầu bắt buộc và kế hoạch thông thường, nhằm cải tiến, đổi mới hoặc tạo thêm giá trị cho đơn vị/Công ty (Điều kiện ghi nhận: Kết quả đã được triển khai, có minh chứng về giá trị mang lại và được BDH xác nhận khi đánh giá cuối tháng).<br>
- Nhóm Should và Could không bắt buộc đăng ký. Mỗi mục tiêu phải nêu rõ kết quả cam kết và tiêu chí xác định hoàn thành.<br>
- Công việc, dự án kéo dài nhiều tháng chỉ đăng ký phần kết quả có thể hoàn thành, kiểm chứng trong tháng đánh giá.<br><br>
${RULES_SCORE.replace('<b>Nguyên tắc', '<b>2. Nguyên tắc')}<br><br>${RULES_UPDATE.replace('<b>Cập nhật', '<b>3. Cập nhật')}`;
const RULES_RESULT = `${RULES_SCORE.replace('<b>Nguyên tắc', '<b>1. Nguyên tắc')}<br><br>${RULES_UPDATE.replace('<b>Cập nhật', '<b>2. Cập nhật')}`;

window.addEventListener('beforeunload', (e) => { if (S.dirty || S.pending) { e.preventDefault(); e.returnValue = ''; } });

// ====================================================================== khởi động
async function boot() {
  try { S.me = await api('me', { base: '/api/auth' }); }
  catch (e) {
    if (e.status === 401) return renderLogin(root, { subtitle: 'Cổng Manager', onDone: boot });
    return fatal(e.message);
  }
  if (!S.me.isManager) {
    root.innerHTML = `<div class="login"><div class="box"><div class="alert warn">Tài khoản <b>${esc(S.me.email)}</b> không có quyền Manager.</div>
      ${S.me.isHR ? '<a class="btn primary" href="/hr">Mở trang HR</a> ' : ''}<button class="btn" id="lo">Đổi tài khoản</button></div></div>`;
    $('#lo').onclick = logout;
    return;
  }
  load();
}
function fatal(msg) {
  root.innerHTML = `<div class="wrap"><div class="alert err">${esc(msg)}</div><button class="btn" onclick="location.reload()">Tải lại</button></div>`;
}
async function load() {
  root.innerHTML = topbarHtml() + '<main class="wrap"><div class="loading">Đang tải dữ liệu KPI…</div></main>';
  bindTop();
  try {
    S.data = await api('workspace');
    S.pending = null; S.dirty = false;
    render();
  } catch (e) {
    if (e.status === 401) return renderLogin(root, { subtitle: 'Cổng Manager', onDone: boot, message: e.message });
    $('main').innerHTML = `<div class="card"><div class="alert err" style="margin:0 0 12px">${esc(e.message)}</div><button class="btn" id="retry">Tải lại</button></div>`;
    $('#retry').onclick = load;
  }
}
const topbarHtml = () => topbar(S.me, 'Cổng Manager',
  `${S.me.isHR ? '<a class="btn sm" href="/hr">Trang HR</a>' : ''}<button class="btn sm" id="btn-reload">Tải lại</button>`);
function bindTop() {
  $('#btn-logout').onclick = async () => {
    if ((S.dirty || S.pending) && !(await confirmBox('Các thay đổi chưa lưu có thể mất. Anh/Chị muốn đổi tài khoản?'))) return;
    S.dirty = false; logout();
  };
  $('#btn-reload').onclick = async () => {
    if (S.pending) return toast('Lần lưu trước chưa rõ kết quả. Hãy bấm "Thử lại" hoặc liên hệ HR trước khi thao tác tiếp.', 'err', 7000);
    if (S.dirty && !(await confirmBox('Các thay đổi chưa lưu sẽ mất. Tải lại?'))) return;
    load();
  };
}

// ====================================================================== khung trang
function render() {
  const d = S.data;
  const isPlan = d.phase === 'PLAN';
  const title = `${isPlan ? 'Đăng ký mục tiêu công việc' : 'Báo cáo kết quả'} — ${d.period.name}`;
  const deadline = isPlan ? d.period.planDeadline : d.period.resultDeadline;
  const statusBadge = { NEW: '<span class="badge">Chưa lập</span>', DRAFT: '<span class="badge warn">Bản nháp</span>', SUBMITTED: '<span class="badge ok">Đã nộp</span>' }[d.status] || '';
  root.innerHTML = topbarHtml() + `<main class="wrap">
    <div class="card row">
      <div class="grow"><h2 style="margin:0">${esc(title)}</h2>
        <div class="muted small">Email đã xác minh: ${esc(d.account.email)} · Phòng: ${esc(d.account.department || '—')} · Trạng thái: ${statusBadge}
        ${deadline ? ` · Hạn nộp: <b>${fmtDT(deadline)}</b>` : ''}</div></div>
      <button class="btn sm link" id="btn-rules">ⓘ Nguyên tắc MSC & tính điểm</button>
    </div>
    <div id="banners"></div><div id="body"></div></main>`;
  bindTop();
  $('#btn-rules').onclick = () => modal({ title: 'Nguyên tắc đăng ký & tính điểm', body: `<div class="rules">${isPlan ? RULES_PLAN : RULES_RESULT}</div>`, size: 'lg' });
  isPlan ? renderPlan() : renderResult();
}
const banner = (type, html) => { $('#banners').insertAdjacentHTML('beforeend', `<div class="alert ${type}">${html}</div>`); };

// ====================================================================== PLAN
function renderPlan() {
  const d = S.data;
  const p = d.plan;
  if (p?.reopened && d.editable) banner('info', `Kế hoạch đã được mở lại để chỉnh sửa (lần ${p.revision + 1}). Bản đã nộp lần ${p.revision} vẫn có hiệu lực cho đến khi Anh/Chị nộp lại.`);
  else if (d.status === 'SUBMITTED') banner('ok', `Kế hoạch đã nộp lúc ${fmtDT(p?.submittedAt)}. Nội dung đã khóa.${p?.mailStatus === 'SENT' ? ' Email xác nhận đã gửi.' : ''}`);
  else if (d.status === 'DRAFT') banner('warn', 'Đã tải bản nháp. Kế hoạch <b>chưa được nộp</b>.');
  const er = d.editRequest;
  if (!d.editable && d.status === 'SUBMITTED' && er) {
    if (er.status === 'PENDING') banner('warn', `Yêu cầu sửa kế hoạch gửi lúc ${fmtDT(er.created_at)} đang <b>chờ HR duyệt</b>.`);
    else if (er.status === 'REJECTED' && new Date(er.created_at) > new Date(p.submittedAt)) banner('err', `Yêu cầu sửa kế hoạch không được chấp thuận${er.decision_note ? `: ${esc(er.decision_note)}` : '.'}`);
  }

  // dữ liệu làm việc
  S.plan = Object.fromEntries(GROUPS.map((g) => [g, d.tasks.filter((t) => t.msc === g).map((t) => ({ id: t.id, title: t.title || '', target: t.target || '' }))]));
  if (d.editable) while (S.plan.Must.length < 2) S.plan.Must.push(blank());

  $('#body').innerHTML = `
    <div class="card sec"><div class="row"><div class="grow"><b>Điểm tối đa theo mục tiêu đã đăng ký</b><div class="legend" id="legend"></div></div>
      <div style="font-size:26px;font-weight:800" id="possible"></div></div><div class="bar" id="bar"></div></div>
    ${GROUPS.map((g) => `<div class="card sec grp ${g.toLowerCase()}" data-g="${g}"></div>`).join('')}
    <div class="card footer-bar"><span class="muted" id="counts"></span><div class="grow"></div>
      ${d.editable ? '<button class="btn" id="save-draft">Lưu nháp</button><button class="btn primary" id="submit">Nộp kế hoạch</button>'
    : d.status === 'SUBMITTED' && (!er || er.status !== 'PENDING') ? '<button class="btn" id="req-edit">Xin sửa kế hoạch</button>' : ''}</div>`;
  GROUPS.forEach(drawGroup);
  updatePlanTotals();
  const body = $('#body');
  bindClamp(body);
  if (d.editable) {
    body.addEventListener('input', onPlanInput);
    body.addEventListener('click', onPlanClick);
    $('#save-draft').onclick = (e) => busy(e.currentTarget, () => save('DRAFT'));
    $('#submit').onclick = (e) => busy(e.currentTarget, () => save('SUBMITTED'));
    updateButtons();
  }
  const re = $('#req-edit');
  if (re) re.onclick = async () => {
    const reason = await promptBox('Xin sửa kế hoạch đã nộp', 'Lý do cần điều chỉnh', { placeholder: 'VD: thay đổi ưu tiên dự án, bổ sung mục tiêu…' });
    if (!reason) return;
    try { const r = await api('plan-request-edit', { method: 'POST', body: { reason } }); toast(r.message); load(); }
    catch (e) { toast(e.message, 'err', 7000); }
  };
}
const blank = () => ({ id: makeId('task'), title: '', target: '' });
const isBlank = (r) => !r.title.trim() && !r.target.trim();
const entered = (g) => (g === 'Must' ? S.plan.Must : S.plan[g].filter((r) => !isBlank(r)));
const counts = () => Object.fromEntries(GROUPS.map((g) => [g, entered(g).length]));
const totalEntered = () => GROUPS.reduce((s, g) => s + entered(g).length, 0);

function drawGroup(g) {
  const box = $(`[data-g="${g}"]`);
  const info = GROUP_INFO[g], text = PLAN_TEXT[g];
  const rows = S.plan[g];
  const editable = S.data.editable;
  const head = `<h3><span class="chip ${g.toLowerCase()}">${info.label}</span> ${info.title} <span class="muted small" style="font-weight:400">${info.hint}</span></h3>`;
  if (!rows.length) {
    box.innerHTML = head + `<div class="empty" style="padding:14px">Chưa đăng ký mục tiêu ${g}.${editable ? ` <button class="btn sm" data-add="${g}">+ Thêm ${g}</button>` : ''}</div>`;
    return;
  }
  const cg = editable ? '<colgroup><col style="width:44px"><col style="width:30%"><col><col style="width:110px"><col style="width:48px"></colgroup>'
    : '<colgroup><col style="width:44px"><col style="width:30%"><col><col style="width:110px"></colgroup>';
  box.innerHTML = head + `<div class="tbl-wrap"><table class="t fixed stack">${cg}<thead><tr><th>#</th><th>Tên mục tiêu${editable ? ' *' : ''}</th>
    <th>${text.targetLabel}${editable ? ' *' : ''}</th><th class="right">Điểm khi HT</th>${editable ? '<th></th>' : ''}</tr></thead><tbody>
    ${rows.map((r, i) => editable ? `<tr data-id="${esc(r.id)}">
      <td data-label="#">${i + 1}</td>
      <td data-label="Tên mục tiêu"><input data-k="title" maxlength="200" value="${esc(r.title)}" placeholder="${esc(text.title)}"></td>
      <td data-label="${text.targetLabel}"><textarea class="auto" data-k="target" maxlength="2000" rows="2" placeholder="${esc(text.target)}">${esc(r.target)}</textarea><span class="cnt"></span></td>
      <td class="pts" data-label="Điểm khi hoàn thành" data-pts></td>
      <td><button type="button" class="btn link" data-del title="Xóa mục tiêu">✕</button></td></tr>`
    : `<tr><td data-label="#">${i + 1}</td><td data-label="Tên mục tiêu"><b>${esc(r.title)}</b></td>
      <td data-label="${text.targetLabel}">${clampHtml(r.target).replace('muted small ', '')}</td><td class="pts" data-label="Điểm khi hoàn thành" data-pts></td></tr>`).join('')}
    </tbody></table></div>${editable ? `<button class="btn sm" style="margin-top:10px" data-add="${g}">+ Thêm ${g}</button>` : ''}`;
  $$('textarea.auto', box).forEach(autoGrow);
}

function updatePlanTotals() {
  const c = counts();
  const possible = GROUP_POINTS.Must + (c.Should ? GROUP_POINTS.Should : 0) + (c.Could ? GROUP_POINTS.Could : 0);
  $('#possible').innerHTML = `${fmtPts(possible)}<span class="muted" style="font-size:15px">/10</span>`;
  $('#bar').innerHTML = `<span style="width:80%;background:var(--must)"></span>${c.Should ? '<span style="width:15%;background:var(--should)"></span>' : ''}${c.Could ? '<span style="width:5%;background:var(--could)"></span>' : ''}`;
  $('#legend').innerHTML = GROUPS.map((g) => `<span><b style="background:${c[g] ? `var(--${g.toLowerCase()})` : '#e5e7eb'}"></b>${g} ${c[g] ? `${c[g]} mục tiêu · ${fmtPts(GROUP_POINTS[g])} đ` : 'chưa đăng ký · 0 đ'}</span>`).join('');
  $('#counts').textContent = `Tổng ${totalEntered()}/${MAX_TASKS} mục tiêu · Must ${c.Must} · Should ${c.Should} · Could ${c.Could}`;
  for (const g of GROUPS) {
    $$(`[data-g="${g}"] tbody tr`).forEach((tr, i) => {
      const r = S.plan[g][i];
      const counted = g === 'Must' || !isBlank(r);
      const cell = $('[data-pts]', tr);
      if (cell) cell.textContent = counted && c[g] ? fmtPts(GROUP_POINTS[g] / c[g]) : '—';
    });
  }
}
function updateButtons() {
  const sd = $('#save-draft'), sb = $('#submit');
  if (!sd) return;
  sd.textContent = S.pending?.status === 'DRAFT' ? 'Thử lại lưu nháp' : 'Lưu nháp';
  sb.textContent = S.pending?.status === 'SUBMITTED' ? 'Thử lại nộp' : S.data.phase === 'RESULT' ? 'Nộp báo cáo' : 'Nộp kế hoạch';
  sd.disabled = !!(S.pending && S.pending.status !== 'DRAFT');
  sb.disabled = !!(S.pending && S.pending.status !== 'SUBMITTED');
  $$('#body input, #body textarea, #body [data-seg] button').forEach((el) => { el.disabled = !!S.pending; });
  $$('[data-add]').forEach((b) => { b.disabled = !!S.pending || totalEntered() >= MAX_TASKS; });
  $$('[data-g="Must"] [data-del]').forEach((b) => { b.disabled = !!S.pending || S.plan.Must.length <= 2; });
}
function findRow(tr) {
  const g = tr.closest('[data-g]').dataset.g;
  return { g, i: S.plan[g].findIndex((r) => r.id === tr.dataset.id) };
}
function onPlanInput(e) {
  const k = e.target.dataset.k; if (!k) return;
  const { g, i } = findRow(e.target.closest('tr'));
  S.plan[g][i][k] = e.target.value;
  e.target.classList.remove('err');
  S.dirty = true;
  updatePlanTotals(); updateButtons();
}
function onPlanClick(e) {
  if (S.pending) return;
  const add = e.target.closest('[data-add]');
  if (add) {
    if (totalEntered() >= MAX_TASKS) return toast(`Kế hoạch tối đa ${MAX_TASKS} mục tiêu.`, 'err');
    const g = add.dataset.add;
    S.plan[g].push(blank()); S.dirty = true;
    drawGroup(g); updatePlanTotals(); updateButtons();
    $$(`[data-g="${g}"] tbody tr`).at(-1).querySelector('input').focus();
    return;
  }
  const del = e.target.closest('[data-del]');
  if (del) {
    const { g, i } = findRow(del.closest('tr'));
    if (g === 'Must' && S.plan.Must.length <= 2) return;
    S.plan[g].splice(i, 1); S.dirty = true;
    drawGroup(g); updatePlanTotals(); updateButtons();
  }
}
function collectPlan() {
  return GROUPS.flatMap((g) => entered(g).map((r) => ({ id: r.id, title: r.title.trim(), target: r.target.trim(), msc: g })));
}
function planError(status) {
  const c = counts();
  if (c.Must < 2) return 'Cần ít nhất 2 mục tiêu Must.';
  if (totalEntered() > MAX_TASKS) return `Kế hoạch tối đa ${MAX_TASKS} mục tiêu.`;
  if (status === 'SUBMITTED') {
    let bad = false;
    for (const g of GROUPS) {
      $$(`[data-g="${g}"] tbody tr`).forEach((tr, i) => {
        const r = S.plan[g][i];
        if (g !== 'Must' && isBlank(r)) return;
        if (!r.title.trim()) { $('[data-k=title]', tr).classList.add('err'); bad = true; }
        if (!r.target.trim()) { $('[data-k=target]', tr).classList.add('err'); bad = true; }
      });
    }
    if (bad) return 'Mỗi mục tiêu đã đăng ký cần có tên và kết quả cam kết.';
  }
  return '';
}

// ====================================================================== RESULT
function renderResult() {
  const d = S.data;
  const editable = d.editable;
  const review = d.review;
  if (d.result?.reopened && editable) banner('info', 'Báo cáo đã được HR mở lại để chỉnh sửa. Vui lòng cập nhật và nộp lại.');
  else if (d.status === 'SUBMITTED') banner('ok', `Báo cáo đã nộp lúc ${fmtDT(d.result?.submittedAt)}. Nội dung đã khóa.${review ? '' : ' Điểm sẽ được cập nhật khi Ban Điều hành phê duyệt.'}`);
  else if (d.status === 'DRAFT') banner('warn', 'Đã tải bản nháp. Báo cáo <b>chưa được nộp</b>.');

  S.res = d.tasks.map((t) => ({ ...t }));
  const showBdh = !!review && !editable;
  $('#body').innerHTML = `
    <div class="card sec"><div class="row" style="align-items:flex-start">
      <div class="grow"><b>Kết quả tự đánh giá</b><div class="muted small">Kế hoạch đã nộp ${fmtDT(d.plan?.submittedAt)} · Điểm có thể đạt theo mục tiêu đã đăng ký: ${fmtPts(d.availableScore)}/10</div></div>
      <div class="scorebox" id="selfbox"></div>
      ${review ? `<div class="scorebox" style="border-left:1px solid var(--line);padding-left:20px">
        <div><div class="muted small">BĐH phê duyệt</div><div class="big">${fmtPts(review.score)}<span class="muted" style="font-size:15px">/10</span></div></div>
        <div><div class="muted small">Xếp hạng</div><div class="rank">${esc(review.rank)}</div></div>
        <div><div class="muted small">Hệ số KPI</div><div class="rank">${esc(String(review.coefficient).replace('.', ','))}</div></div></div>` : ''}
    </div>${review?.comment ? `<div class="alert info" style="margin:12px 0 0"><b>Nhận xét của Ban Điều hành:</b><br><span class="pre">${esc(review.comment)}</span></div>` : ''}</div>
    ${GROUPS.map((g) => resultGroupHtml(g, editable, showBdh)).join('')}
    <div class="card footer-bar"><span class="alert info small" style="margin:0">Điểm KPI được BĐH phê duyệt là căn cứ tính lương KPI theo chính sách của Công ty.</span><div class="grow"></div>
      ${editable ? '<button class="btn" id="save-draft">Lưu nháp</button><button class="btn primary" id="submit">Nộp báo cáo</button>' : ''}</div>`;
  $$('#body textarea.auto').forEach(autoGrow);
  bindClamp($('#body'));
  updateResultTotal();
  if (editable) {
    const body = $('#body');
    body.addEventListener('input', onResInput);
    body.addEventListener('click', onResClick);
    $('#save-draft').onclick = (e) => busy(e.currentTarget, () => save('DRAFT'));
    $('#submit').onclick = (e) => busy(e.currentTarget, () => save('SUBMITTED'));
    updateButtons();
  }
}
const segHtml = (v, disabled) => `<span class="seg" data-seg>
  <button type="button" data-v="COMPLETED" class="${v === 'COMPLETED' ? 'on ok' : ''}" ${disabled ? 'disabled' : ''}>✓ Hoàn thành</button>
  <button type="button" data-v="NOT_COMPLETED" class="${v === 'NOT_COMPLETED' ? 'on no' : ''}" ${disabled ? 'disabled' : ''}>✕ Không HT</button></span>`;
const doneBadge = (v) => (v === 'COMPLETED' ? '<span class="badge ok">Hoàn thành</span>' : v === 'NOT_COMPLETED' ? '<span class="badge err">Không hoàn thành</span>' : '<span class="muted">—</span>');

function resultGroupHtml(g, editable, showBdh) {
  const items = S.res.filter((t) => t.msc === g);
  if (!items.length) return '';
  const info = GROUP_INFO[g];
  const cg = showBdh
    ? '<colgroup><col style="width:24%"><col style="width:22%"><col style="width:14%"><col style="width:12%"><col style="width:18%"><col style="width:10%"></colgroup>'
    : '<colgroup><col style="width:26%"><col style="width:30%"><col style="width:16%"><col style="width:18%"><col style="width:10%"></colgroup>';
  const n = showBdh ? 6 : 5;
  return `<div class="card sec grp ${g.toLowerCase()}"><h3><span class="chip ${g.toLowerCase()}">${info.label}</span> ${items.length} mục tiêu · ${fmtPts(GROUP_POINTS[g])} điểm</h3>
    <div class="tbl-wrap"><table class="t fixed stack">${cg}<thead><tr><th>Mục tiêu</th><th>Kết quả thực hiện${editable ? ' *' : ''}</th>
      <th>Minh chứng</th><th>Tự đánh giá${editable ? ' *' : ''}</th>${showBdh ? '<th>BĐH duyệt</th><th class="right">Điểm BĐH</th>' : '<th class="right">Điểm</th>'}</tr></thead><tbody>
    ${items.map((t) => {
      const goal = `<td data-label="Mục tiêu"><b>${esc(t.title)}</b>${clampHtml(t.target)}<div class="muted small">Điểm khi hoàn thành: <b>${fmtPts(t.maxPoints)}</b></div></td>`;
      if (editable) {
        return `<tr data-id="${esc(t.id)}">${goal}
          <td data-label="Kết quả thực hiện"><textarea class="auto" data-k="actual" maxlength="4000" rows="2" placeholder="Kết quả thực tế đạt được">${esc(t.actual)}</textarea><span class="cnt"></span></td>
          <td data-label="Minh chứng"><textarea class="auto" data-k="evidence" maxlength="2000" rows="2" placeholder="Dán link báo cáo, tài liệu… (nếu có)">${esc(t.evidence)}</textarea></td>
          <td data-label="Tự đánh giá">${segHtml(t.completion, false)}</td><td class="pts" data-label="Điểm" data-pts></td></tr>
          <tr class="reason ${t.completion === 'NOT_COMPLETED' ? '' : 'hidden'}" data-reason="${esc(t.id)}"><td colspan="${n}">
            <label class="f" style="color:#991b1b">Lý do không hoàn thành *</label>
            <textarea class="auto" data-k="reason" maxlength="2000" rows="2" placeholder="Nêu phần kết quả chưa hoàn thành và nguyên nhân">${esc(t.reason)}</textarea><span class="cnt"></span></td></tr>`;
      }
      const diff = showBdh && t.bdh && t.bdh.completion !== t.completion;
      return `<tr class="${diff ? 'diff' : ''}">${goal}<td data-label="Kết quả thực hiện"><div class="pre">${esc(t.actual)}</div></td>
        <td data-label="Minh chứng">${t.evidence ? linkify(t.evidence) : '—'}</td><td data-label="Tự đánh giá">${doneBadge(t.completion)}</td>
        ${showBdh ? `<td data-label="BĐH duyệt">${doneBadge(t.bdh?.completion)}${t.bdh?.note ? `<div class="small pre" style="margin-top:4px">${esc(t.bdh.note)}</div>` : ''}</td>
          <td class="pts" data-label="Điểm BĐH">${t.bdh ? fmtPts(t.bdh.earnedPoints) : '—'}</td>`
          : `<td class="pts" data-label="Điểm">${t.completion ? fmtPts(t.completion === 'COMPLETED' ? t.maxPoints : 0) : '—'}</td>`}</tr>
        ${t.completion === 'NOT_COMPLETED' && t.reason ? `<tr class="reason"><td colspan="${n}"><b class="small" style="color:#991b1b">Nguyên nhân không hoàn thành:</b> <span class="pre small">${esc(t.reason)}</span></td></tr>` : ''}`;
    }).join('')}</tbody></table></div></div>`;
}
function updateResultTotal() {
  let earned = 0, chosen = 0;
  for (const t of S.res) {
    if (t.completion) chosen++;
    if (t.completion === 'COMPLETED') earned += t.maxPoints;
    const cell = $(`tr[data-id="${CSS.escape(t.id)}"] [data-pts]`);
    if (cell) cell.textContent = t.completion ? fmtPts(t.completion === 'COMPLETED' ? t.maxPoints : 0) : '—';
  }
  const score = Number(earned.toFixed(4));
  const rk = chosen === S.res.length ? rankFromScore(score) : null;
  $('#selfbox').innerHTML = `<div><div class="muted small">Điểm tự đánh giá</div><div class="big">${fmtPts(score)}<span class="muted" style="font-size:15px">/10</span></div></div>
    <div><div class="muted small">Xếp hạng</div><div class="rank">${rk ? rk.rank : '<span class="muted small">Chưa xác định</span>'}</div></div>
    <div><div class="muted small">Hệ số KPI</div><div class="rank">${rk ? rk.coefficient : '<span class="muted small">Chưa xác định</span>'}</div></div>`;
}
function onResInput(e) {
  const k = e.target.dataset.k; if (!k) return;
  const id = e.target.closest('[data-id]')?.dataset.id || e.target.closest('[data-reason]')?.dataset.reason;
  S.res.find((t) => t.id === id)[k] = e.target.value;
  e.target.classList.remove('err');
  S.dirty = true;
}
function onResClick(e) {
  const b = e.target.closest('[data-seg] button'); if (!b || b.disabled) return;
  const tr = b.closest('tr'); const t = S.res.find((x) => x.id === tr.dataset.id);
  t.completion = b.dataset.v; S.dirty = true;
  const seg = b.parentElement;
  seg.classList.remove('err');
  $$('button', seg).forEach((x) => { x.className = x.dataset.v === t.completion ? `on ${t.completion === 'COMPLETED' ? 'ok' : 'no'}` : ''; });
  const rr = $(`tr[data-reason="${CSS.escape(t.id)}"]`);
  rr.classList.toggle('hidden', t.completion !== 'NOT_COMPLETED');
  if (t.completion === 'NOT_COMPLETED') { const ta = $('textarea', rr); ta.dispatchEvent(new Event('input')); ta.focus(); }
  updateResultTotal();
}
function resultError(status) {
  if (status !== 'SUBMITTED') return '';
  for (const t of S.res) {
    const tr = $(`tr[data-id="${CSS.escape(t.id)}"]`);
    if (!t.actual.trim() || !t.completion) {
      if (!t.actual.trim()) $('[data-k=actual]', tr).classList.add('err');
      if (!t.completion) $('[data-seg]', tr).classList.add('err');
      tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return 'Mỗi mục tiêu cần kết quả thực tế và trạng thái hoàn thành.';
    }
    if (t.completion === 'NOT_COMPLETED' && !t.reason.trim()) {
      const ta = $(`tr[data-reason="${CSS.escape(t.id)}"] textarea`);
      ta.classList.add('err'); ta.focus();
      return 'Mục tiêu không hoàn thành cần nêu rõ nguyên nhân.';
    }
  }
  return '';
}
const collectResults = () => S.res.map((t) => ({
  taskId: t.id, actual: t.actual.trim(), evidence: t.evidence.trim(), completion: t.completion,
  reason: t.completion === 'NOT_COMPLETED' ? t.reason.trim() : '',
}));

// ====================================================================== LƯU (RequestID + baseVersionId, giữ RequestID khi lỗi mạng để thử lại)
async function save(status) {
  const d = S.data;
  if (!d?.editable) return;
  if (!S.pending) {
    const err = d.phase === 'PLAN' ? planError(status) : resultError(status);
    if (err) return toast(err, 'err', 6000);
    if (status === 'SUBMITTED' && !(await confirmBox('Nộp và khóa nội dung? Anh/Chị sẽ không thể tự sửa sau khi nộp.', { ok: d.phase === 'PLAN' ? 'Nộp kế hoạch' : 'Nộp báo cáo' }))) return;
    S.pending = { requestId: makeId('request'), baseVersionId: d.latestVersionId || '', periodId: d.period.id, status };
    if (d.phase === 'PLAN') S.pending.tasks = collectPlan();
    else { S.pending.planVersionId = d.planVersionId; S.pending.results = collectResults(); }
  } else if (S.pending.status !== status) return;
  updateButtons();
  try {
    const r = await api(d.phase === 'PLAN' ? 'plan-save' : 'result-save', { method: 'POST', body: S.pending });
    S.pending = null; S.dirty = false;
    const extra = d.phase === 'RESULT' && r.status === 'SUBMITTED' ? ` Điểm tự đánh giá: ${fmtPts(r.totalScore)}/10.` : '';
    toast(r.message + extra, /chưa gửi/.test(r.message) ? 'err' : 'ok', 7000);
    if (r.status === 'SUBMITTED') return load();
    d.latestVersionId = r.versionId; d.status = 'DRAFT';
    updateButtons();
  } catch (e) {
    if (e.code === 'NETWORK' || (e.status || 0) >= 500) {
      // Giữ RequestID: bấm "Thử lại" sẽ không tạo bản trùng
      toast('Chưa rõ yêu cầu đã lưu hay chưa. Bấm "Thử lại" để gửi lại đúng yêu cầu này.', 'err', 9000);
    } else {
      S.pending = null;
      toast(e.message, 'err', 8000);
      if (e.status === 401) return renderLogin(root, { subtitle: 'Cổng Manager', onDone: boot, message: e.message });
    }
    updateButtons();
  }
}

boot();
