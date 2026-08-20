/**
 * printPreview.shared.js — ตัวอย่างก่อนพิมพ์ + พิมพ์ PDF ใช้ร่วมกันทุกโมดูล
 * ใช้แนวทางเดียวกับ admin.js (SmartPharmacy): แสดงตัวอย่างใน modal (iframe) ก่อนเสมอ
 * ตอนพิมพ์จริงจะพิมพ์จาก "เอกสารหลัก" โดยตรง ไม่ใช่จาก iframe — เพราะบางเบราว์เซอร์ไม่ทำซ้ำหัวตาราง
 * <thead> ข้ามหน้าให้ถ้าพิมพ์เนื้อหาที่มาจาก iframe แม้ตั้ง CSS ถูกต้องแล้ว
 *
 * หน้าที่ใช้ต้องมี markup นี้ (ดูตัวอย่างใน procurement.html):
 *   <div id="report-preview-modal" class="report-preview-modal">
 *     <div class="report-preview-body"><iframe id="report-preview-frame"></iframe></div>
 *     <div class="report-preview-actions">
 *       <button onclick="printReportPreview()">🖨️ พิมพ์ / บันทึก PDF</button>
 *       <button onclick="closeReportPreview()">ปิด</button>
 *     </div>
 *   </div>
 *   <div id="direct-print-container" class="direct-print-container"></div>
 */

// escapeHtml ของตัวเอง (ไม่พึ่งพา escapeHtml ของ page.js) เพื่อไม่ให้ผูกลำดับการโหลด script
function escapeHtmlLocal(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
}

function getReportStyleCss() {
    return `
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Sarabun', sans-serif; color: #24292f; margin: 0; }
    .print-header { text-align: center; margin-bottom: 26px; padding-bottom: 14px; border-bottom: 3px solid #0d8a72; }
    .print-header h2 { margin: 0 0 6px 0; font-size: 19pt; font-weight: 700; color: #1a1a18; }
    .print-header div { font-size: 11pt; margin: 2px 0; color: #5a5a56; }

    .print-meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin-bottom: 20px; font-size: 10.5pt; }
    .print-meta-grid .label { color: #5a5a56; }
    .print-meta-grid .value { font-weight: 600; color: #1a1a18; }

    table { width: 100%; border-collapse: separate; border-spacing: 0; margin-bottom: 18px; page-break-inside: auto; break-inside: auto; }
    th {
        text-align: left; font-size: 10.5pt; font-weight: 700; color: #1a1a18;
        background-color: #e6f7f3; padding: 10px 12px; border-bottom: 2px solid #0d8a72;
        word-wrap: break-word; -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    td { font-size: 10.5pt; padding: 9px 12px; border-bottom: 1px solid #e3e6e9; color: #2a2a28; word-wrap: break-word; }
    tbody tr:nth-child(even) td { background-color: #fafbfc; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    tr { page-break-inside: avoid !important; break-inside: avoid !important; }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }

    .report-total-row td {
        font-weight: 700; background-color: #e6f7f3 !important; border-top: 2px solid #0d8a72;
        border-bottom: none; color: #1a1a18; -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    `;
}

function buildReportHtml(title, subtitle, contentHtml) {
    const printTime = 'พิมพ์เมื่อ: ' + formatDateDisplay(new Date().toISOString());
    return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>${escapeHtmlLocal(title)}</title>
<style>
    @page { size: A4; margin: 1.5cm; }
    body { padding: 16px 12px; }
${getReportStyleCss()}
</style>
</head>
<body>
    <div class="print-header">
        <h2>${escapeHtmlLocal(title)}</h2>
        <div>${escapeHtmlLocal(subtitle)}</div>
        <div>${escapeHtmlLocal(printTime)}</div>
    </div>
    <div>${contentHtml}</div>
</body>
</html>`;
}

let pendingPrintReport = null; // { title, subtitle, contentHtml }

function openPrintPreview(title, subtitle, contentHtml) {
    const modal = document.getElementById('report-preview-modal');
    const iframe = document.getElementById('report-preview-frame');
    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(buildReportHtml(title, subtitle, contentHtml));
    doc.close();
    pendingPrintReport = { title, subtitle, contentHtml };
    modal.style.display = 'flex';
}

function closeReportPreview() {
    document.getElementById('report-preview-modal').style.display = 'none';
}

function printReportPreview() {
    if (!pendingPrintReport) { alert('ไม่พบเนื้อหาสำหรับพิมพ์ กรุณาเปิดตัวอย่างใหม่อีกครั้ง'); return; }
    const { title, subtitle, contentHtml } = pendingPrintReport;
    const printTime = 'พิมพ์เมื่อ: ' + formatDateDisplay(new Date().toISOString());
    const container = document.getElementById('direct-print-container');

    container.innerHTML = `
        <style>${getReportStyleCss()}</style>
        <div class="print-header">
            <h2>${escapeHtmlLocal(title)}</h2>
            <div>${escapeHtmlLocal(subtitle)}</div>
            <div>${escapeHtmlLocal(printTime)}</div>
        </div>
        <div>${contentHtml}</div>
    `;

    const originalTitle = document.title;
    document.title = title.replace(/[\\/:*?"<>|]/g, '_');
    document.body.classList.add('direct-printing');
    const cleanup = () => {
        document.body.classList.remove('direct-printing');
        document.title = originalTitle;
        window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
}
