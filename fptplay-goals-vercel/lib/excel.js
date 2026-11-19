// Xuất báo cáo XLSX – giữ đúng cột của ManagerExcelExport.gs, thêm cột BĐH ở cuối.
import ExcelJS from 'exceljs';

const vnTime = (d) => (d ? new Date(d).toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }) : '');
const n = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? '' : Number(v));
const completionLabel = (v) => (v === 'COMPLETED' ? 'Hoàn thành' : v === 'NOT_COMPLETED' ? 'Không hoàn thành' : '');

function header(ws, headers, widths) {
  ws.columns = headers.map((h, i) => ({ header: h, width: widths[i] || 16 }));
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0876E8' } };
  row.alignment = { vertical: 'middle', wrapText: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

export async function buildManagerReportXlsx(overview) {
  const { period, managers } = overview;
  const exportedAt = vnTime(new Date());
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FPT Play Goals';

  // ---------------- TongHop
  const s = wb.addWorksheet('TongHop');
  header(s, ['Kỳ KPI', 'Thời điểm xuất', 'Manager', 'Email', 'Phòng', 'Trạng thái kế hoạch', 'Trạng thái báo cáo',
    'Điểm tự đánh giá /10', 'Trạng thái BĐH', 'Điểm BĐH /10', 'Người duyệt BĐH', 'Thời điểm duyệt BĐH', 'Cảnh báo',
    'Xếp hạng tự ĐG', 'Hệ số tự ĐG', 'Xếp hạng BĐH', 'Hệ số KPI BĐH'],
  [16, 20, 26, 28, 20, 18, 18, 14, 18, 12, 26, 20, 36, 12, 12, 12, 12]);
  for (const m of managers) {
    const hasReport = m.resultStatus === 'Đã nộp';
    const approved = m.bdhStatus === 'Đã duyệt';
    s.addRow([period.name || period.id, exportedAt, m.name, m.email, m.department, m.planStatus, m.resultStatus,
      hasReport ? n(m.selfScore) : '',                       // chưa nộp: để trống, KHÔNG ghi 0
      m.bdhStatus || (hasReport ? 'Chờ duyệt' : 'Chưa đến bước'),
      approved ? n(m.bdhScore) : '', approved ? m.reviewerEmail : '', approved ? vnTime(m.approvedAt) : '', m.warning,
      hasReport ? m.selfRank : '', hasReport ? n(m.selfCoefficient) : '', approved ? m.bdhRank : '', approved ? n(m.bdhCoefficient) : '']);
  }
  s.getColumn(8).numFmt = '0.00';
  s.getColumn(10).numFmt = '0.00';
  s.getColumn(15).numFmt = '0.0';
  s.getColumn(17).numFmt = '0.0';

  // ---------------- ChiTietMucTieu
  const d = wb.addWorksheet('ChiTietMucTieu');
  header(d, ['Kỳ KPI', 'Manager', 'Email', 'Phòng', 'Trạng thái báo cáo', 'Mục tiêu', 'Nhóm MSC', 'Kết quả cam kết',
    'Điểm nếu hoàn thành', 'Kết quả thực tế', 'Số liệu / minh chứng', 'Trạng thái hoàn thành', 'Nguyên nhân không hoàn thành',
    'Điểm tự đánh giá đạt', 'BĐH duyệt', 'Ghi chú BĐH', 'Điểm BĐH đạt'],
  [16, 24, 26, 18, 16, 30, 10, 45, 12, 45, 45, 16, 45, 12, 16, 40, 12]);
  for (const m of managers) {
    if (!Array.isArray(m.tasks) || !m.tasks.length) continue;
    const hasReport = m.resultStatus === 'Đã nộp';
    const approved = m.bdhStatus === 'Đã duyệt';
    for (const t of m.tasks) {
      d.addRow([period.name || period.id, m.name, m.email, m.department, m.resultStatus, t.title, t.msc, t.target,
        n(t.maxPoints),
        hasReport ? t.actual : '', hasReport ? t.evidence : '',      // chưa nộp: không xuất nội dung nháp
        hasReport ? completionLabel(t.completion) : '',
        hasReport && t.completion === 'NOT_COMPLETED' ? t.reason : '',
        hasReport ? n(t.earnedPoints) : '',                          // không HT sau khi nộp = 0; chưa nộp = trống
        approved ? completionLabel(t.bdhCompletion) : '', approved ? t.bdhNote : '', approved ? n(t.bdhEarned) : '']);
    }
  }
  for (const c of [9, 14, 17]) d.getColumn(c).numFmt = '0.0000';
  for (const c of [6, 8, 10, 11, 13, 16]) d.getColumn(c).alignment = { wrapText: true, vertical: 'top' };
  // ExcelJS ghi chuỗi dạng text → nội dung bắt đầu bằng "=" không bị hiểu thành công thức.
  return wb.xlsx.writeBuffer();
}
