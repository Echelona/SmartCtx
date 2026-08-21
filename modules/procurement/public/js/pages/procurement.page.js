/**
 * procurement.page.js — หน้าเว็บฝั่งงานจัดซื้อ (1.1)
 * เชื่อมกับ modules/procurement/backend/procurement.routes.js ผ่าน /modules/procurement/api/*
 */

const API_BASE = '/modules/procurement/api';

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
}
function showToast(message, type = 'info') {
    const stack = document.getElementById('toastStack');
    if (!stack) { alert(message); return; }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 5000);
}
function formatNumber(n) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return '0';
    return Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 });
}
function todayIso() { return new Date().toISOString().slice(0, 10); }

// ตรวจสอบช่วงวันที่ (from/to) ก่อนยิง query ทุกครั้ง — เดียวกับ validateDateRangeInputs ใน stock.page.js (1.2)
// คืนค่าข้อความ error ถ้าช่วงกลับด้าน (จาก > ถึง) แล้วเน้นกรอบสีแดงให้ผู้ใช้เห็นทันที มิเช่นนั้นคืน null และล้างสถานะ error
function validateDateRangeInputs(fromEl, toEl) {
    fromEl.classList.remove('input-error');
    toEl.classList.remove('input-error');
    const from = getDateValue(fromEl);
    const to = getDateValue(toEl);
    if (from && to && from > to) {
        fromEl.classList.add('input-error');
        toEl.classList.add('input-error');
        return 'ช่วงวันที่ไม่ถูกต้อง: วันที่ "จาก" ต้องไม่เกินวันที่ "ถึง"';
    }
    return null;
}

async function apiGet(url) {
    const res = await fetch(API_BASE + url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาดในการดึงข้อมูล');
    return data;
}
async function apiPost(url, body) {
    const res = await fetch(API_BASE + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'บันทึกข้อมูลไม่สำเร็จ');
    return data;
}

async function logout() {
    try { await fetch(API_BASE + '/auth/logout', { method: 'POST' }); }
    catch (err) { /* noop */ }
    finally { window.location.href = '/modules/procurement/login.html'; }
}

async function loadUserChip() {
    try {
        const data = await fetch(API_BASE + '/auth/status').then(r => r.json());
        if (data.authenticated) document.getElementById('userChip').textContent = `👤 ${data.username} (งานจัดซื้อ)`;
    } catch (err) { /* noop */ }
}

function shipStatusLabel(s) { return { not_shipped: 'ยังไม่ได้จัดส่ง', partially_shipped: 'จัดส่งบางส่วน', shipped: 'จัดส่งครบแล้ว' }[s] || s; }
function shipStatusClass(s) { return { not_shipped: 'pending', partially_shipped: 'partially_shipped', shipped: 'shipped' }[s] || ''; }
function reqStatusLabel(s) { return { pending: 'รอรับเข้า', partially_received: 'รับบางส่วน', received: 'รับครบแล้ว', cancelled: 'ยกเลิก' }[s] || s; }

// ===================== Tabs =====================
function initTabs() {
    document.querySelectorAll('#tabBar .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#tabBar .tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
            if (btn.dataset.tab === 'history') loadShipmentHistory();
        });
    });
}

// ===================== รายการใบเบิก =====================
let requisitionCache = [];
let openRowIdx = null;

async function loadRequisitionList() {
    try {
        requisitionCache = await apiGet('/requisitions');
        renderKpis();
        renderRequisitionList();
    } catch (err) { showToast(err.message, 'error'); }
}

function renderKpis() {
    const active = requisitionCache.filter(r => r.status !== 'cancelled');
    document.getElementById('kpiTotal').textContent = formatNumber(active.length);
    document.getElementById('kpiNotShipped').textContent = formatNumber(active.filter(r => r.shipStatus === 'not_shipped').length);
    document.getElementById('kpiPartial').textContent = formatNumber(active.filter(r => r.shipStatus === 'partially_shipped').length);
    document.getElementById('kpiShipped').textContent = formatNumber(active.filter(r => r.shipStatus === 'shipped').length);
}

function renderRequisitionList() {
    const tbody = document.getElementById('requisitionBody');
    const query = (document.getElementById('reqSearch')?.value || '').trim().toLowerCase();
    const shipFilter = document.getElementById('shipStatusFilter')?.value || '';
    const rows = requisitionCache.filter(r => {
        if (shipFilter && r.shipStatus !== shipFilter) return false;
        if (!query) return true;
        return r.req_no.toLowerCase().includes(query) || (r.requested_by || '').toLowerCase().includes(query);
    });
    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="table-empty">ไม่พบใบเบิกที่ตรงเงื่อนไข</td></tr>`;
        return;
    }
    tbody.innerHTML = rows.map((r, idx) => {
        const canShip = r.status !== 'cancelled' && r.shipStatus !== 'shipped';
        return `
        <tr>
            <td><strong>${escapeHtml(r.req_no)}</strong></td>
            <td>${escapeHtml(formatDateDisplay(r.req_date))}</td>
            <td>${escapeHtml(r.requested_by || '-')}</td>
            <td>${formatNumber(r.itemCount)}</td>
            <td><span class="status-pill ${shipStatusClass(r.shipStatus)}">${shipStatusLabel(r.shipStatus)}</span></td>
            <td><span class="status-pill ${r.status}">${reqStatusLabel(r.status)}</span></td>
            <td style="white-space:nowrap;">
                <button class="btn-primary btn-sm" onclick="toggleDetail(${r.id}, ${idx})">${canShip ? '📦 จัดส่ง' : '📋 ดูรายการ'}</button>
                <button class="btn-outline btn-sm" onclick="viewPurchaseOrder(${r.id})">📄 ใบสั่งซื้อ</button>
            </td>
        </tr>
        <tr class="expand-row" id="row-${idx}" style="display:none;"><td colspan="7"></td></tr>`;
    }).join('');
}

async function toggleDetail(reqId, idx) {
    const row = document.getElementById(`row-${idx}`);
    if (!row) return;
    if (openRowIdx === idx) { row.style.display = 'none'; openRowIdx = null; return; }
    document.querySelectorAll('.expand-row').forEach(r => r.style.display = 'none');
    openRowIdx = idx;
    row.querySelector('td').innerHTML = `<div class="expand-content">กำลังโหลด...</div>`;
    row.style.display = 'table-row';
    try {
        const detail = await apiGet(`/requisitions/${reqId}`);
        const canShip = detail.status !== 'cancelled' && detail.shipStatus !== 'shipped';
        canShip ? renderShipForm(row, detail, reqId, idx) : renderReadOnly(row, detail);
    } catch (err) {
        row.querySelector('td').innerHTML = `<div class="expand-content text-danger">โหลดไม่สำเร็จ: ${escapeHtml(err.message)}</div>`;
    }
}

function renderReadOnly(row, detail) {
    const itemRows = detail.items.map(it => `
        <div class="ship-item-row view-only">
            <span>${escapeHtml(it.drug_name)}${it.strength ? ' (' + escapeHtml(it.strength) + ')' : ''}</span>
            <span>ขอเบิก ${formatNumber(it.qty_requested)} ${escapeHtml(it.unit || '')}</span>
            <span>จัดส่งแล้ว ${formatNumber(it.qty_shipped)}</span>
        </div>`).join('');
    row.querySelector('td').innerHTML = `
        <div class="expand-content ship-form">
            <div class="ship-form-header"><strong>รายการยาในใบเบิก ${escapeHtml(detail.req_no)}</strong>
                <span class="status-pill ${shipStatusClass(detail.shipStatus)}">${shipStatusLabel(detail.shipStatus)}</span></div>
            <div class="line-items">
                <div class="ship-item-row view-only header-row"><span>ยา</span><span>ขอเบิก</span><span>จัดส่งแล้ว</span></div>
                ${itemRows}
            </div>
        </div>`;
}

function renderShipForm(row, detail, reqId, idx) {
    const itemRows = detail.items.map(it => {
        const remaining = it.qty_requested - it.qty_shipped;
        const disabled = remaining <= 0;
        return `
        <div class="ship-item-row">
            <input type="checkbox" class="ship-check" data-item-id="${it.id}" ${disabled ? 'disabled' : 'checked'} onchange="onShipCheckChange(${it.id})">
            <span>${escapeHtml(it.drug_name)}${it.strength ? ' (' + escapeHtml(it.strength) + ')' : ''}</span>
            <span>ขอเบิก ${formatNumber(it.qty_requested)} ${escapeHtml(it.unit || '')}</span>
            <span>จัดส่งแล้ว ${formatNumber(it.qty_shipped)}</span>
            <span class="${disabled ? 'remaining-zero' : ''}">${disabled ? 'ครบแล้ว' : `เหลือ ${formatNumber(remaining)}`}</span>
            <input type="number" min="0" max="${remaining}" step="1" value="${disabled ? 0 : remaining}" id="shipQty-${it.id}" ${disabled ? 'disabled' : ''}>
        </div>`;
    }).join('');

    row.querySelector('td').innerHTML = `
        <div class="expand-content ship-form">
            <div class="ship-form-header"><strong>เตรียมจัดส่งสำหรับใบเบิก ${escapeHtml(detail.req_no)}</strong></div>
            <div class="select-all-row"><input type="checkbox" id="selectAllShip" checked onchange="toggleSelectAllShip()"> เลือกทั้งหมด (จัดส่งเต็มจำนวนที่เหลือ)</div>
            <div class="line-items">
                <div class="ship-item-row header-row"><span></span><span>ยา</span><span>ขอเบิก</span><span>จัดส่งแล้ว</span><span>คงเหลือ</span><span>จัดส่งครั้งนี้</span></div>
                ${itemRows}
            </div>
            <div class="ship-meta-fields">
                <div class="form-group"><label>วันที่จัดส่ง:</label><input type="text" id="shipDate-${reqId}"></div>
                <div class="form-group"><label>ชื่อผู้ส่ง: <span class="required-mark">*</span></label><input type="text" id="shipSender-${reqId}" placeholder="ชื่อ-นามสกุลผู้จัดส่งจริง" required></div>
                <div class="form-group"><label>หมายเหตุ:</label><input type="text" id="shipNote-${reqId}" placeholder="ไม่บังคับ"></div>
            </div>
            <div class="action-bar align-left">
                <button class="btn-primary" onclick="submitShipment(${reqId}, ${idx})">✅ ยืนยันการจัดส่งรายการที่เลือก</button>
            </div>
        </div>`;
    const shipDateInput = document.getElementById(`shipDate-${reqId}`);
    initThaiDatePicker(shipDateInput);
    setDateValue(shipDateInput, todayIso());
}

function onShipCheckChange(itemId) {
    const cb = document.querySelector(`.ship-check[data-item-id="${itemId}"]`);
    const qty = document.getElementById(`shipQty-${itemId}`);
    if (qty) qty.disabled = !cb.checked;
}
function toggleSelectAllShip() {
    const master = document.getElementById('selectAllShip');
    document.querySelectorAll('.ship-check:not(:disabled)').forEach(cb => { cb.checked = master.checked; onShipCheckChange(cb.dataset.itemId); });
}

async function submitShipment(reqId, idx) {
    const items = [];
    document.querySelectorAll('.ship-check').forEach(cb => {
        if (!cb.checked) return;
        const itemId = cb.dataset.itemId;
        const qty = Number(document.getElementById(`shipQty-${itemId}`)?.value);
        if (qty > 0) items.push({ reqItemId: Number(itemId), qty });
    });
    if (!items.length) { showToast('กรุณาเลือกรายการยาที่จะจัดส่งอย่างน้อย 1 รายการ', 'error'); return; }

    const senderName = document.getElementById(`shipSender-${reqId}`).value.trim();
    if (!senderName) { showToast('กรุณาระบุชื่อผู้ส่ง', 'error'); document.getElementById(`shipSender-${reqId}`).focus(); return; }

    if (!confirm('ยืนยันการจัดส่ง? เมื่อยืนยันแล้วจะแก้ไขรายการนี้ไม่ได้อีก ส่วนที่เหลือจะค้างไว้ให้จัดส่งเพิ่มภายหลัง')) return;

    try {
        const result = await apiPost(`/requisitions/${reqId}/ship`, {
            shipmentDate: getDateValue(document.getElementById(`shipDate-${reqId}`)) || todayIso(),
            senderName,
            note: document.getElementById(`shipNote-${reqId}`).value,
            items
        });
        showToast(`บันทึกการจัดส่งสำเร็จ เลขที่ ${result.shipment_no}`, 'success');
        document.getElementById(`row-${idx}`).style.display = 'none';
        openRowIdx = null;
        loadRequisitionList();
    } catch (err) { showToast(err.message, 'error'); }
}

// ===================== ประวัติการจัดส่ง =====================
let shipmentHistoryCache = [];
let openShipHistIdx = null;

function shipmentHistoryQuery() {
    const from = getDateValue(document.getElementById('shipHistFrom'));
    const to = getDateValue(document.getElementById('shipHistTo'));
    const reqNo = document.getElementById('shipHistReqNo').value.trim();
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (reqNo) params.set('reqNo', reqNo);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
}

async function loadShipmentHistory() {
    const rangeError = validateDateRangeInputs(document.getElementById('shipHistFrom'), document.getElementById('shipHistTo'));
    if (rangeError) {
        showToast(rangeError, 'error');
        document.getElementById('shipmentHistoryBody').innerHTML = `<tr><td colspan="5" class="table-empty text-danger">${escapeHtml(rangeError)}</td></tr>`;
        return;
    }
    try {
        const rows = await apiGet(`/shipments${shipmentHistoryQuery()}`);
        shipmentHistoryCache = rows;
        openShipHistIdx = null;
        const tbody = document.getElementById('shipmentHistoryBody');
        if (!rows.length) { tbody.innerHTML = `<tr><td colspan="5" class="table-empty">ไม่พบประวัติการจัดส่งตามเงื่อนไขที่ค้นหา</td></tr>`; return; }
        tbody.innerHTML = rows.map((s, idx) => `
            <tr>
                <td><a class="expand-toggle" onclick="toggleShipmentHistoryDetail(${idx})"><strong>${escapeHtml(s.shipment_no)}</strong></a></td>
                <td>${escapeHtml(formatDateDisplay(s.shipment_date))}</td>
                <td>${escapeHtml(s.shipped_by || '-')}</td>
                <td>${escapeHtml(s.req_no)}</td>
                <td>${formatNumber(s.items.length)}</td>
            </tr>
            <tr class="expand-row" id="shipHistDetail-${idx}" style="display:none;"><td colspan="5"></td></tr>`).join('');
    } catch (err) { showToast(err.message, 'error'); }
}
let debouncedLoadShipmentHistoryTimer = null;
function debouncedLoadShipmentHistory() {
    clearTimeout(debouncedLoadShipmentHistoryTimer);
    debouncedLoadShipmentHistoryTimer = setTimeout(loadShipmentHistory, 350);
}
function resetShipmentHistoryFilter() {
    setDateValue(document.getElementById('shipHistFrom'), todayIso());
    setDateValue(document.getElementById('shipHistTo'), todayIso());
    document.getElementById('shipHistReqNo').value = '';
    loadShipmentHistory();
}

// ขยายแถวดูรายการยาที่จัดส่งในใบนั้น (ยา / จำนวนที่จัดส่ง / หน่วย) — ข้อมูล items มากับ /shipments อยู่แล้ว
// จึงใช้ shipmentHistoryCache ที่โหลดไว้แสดงได้ทันที ไม่ต้องยิง API เพิ่ม (ต่างจาก toggleReceiptHistoryDetail ฝั่งคลังที่ต้องเรียก /receipts/:id)
function toggleShipmentHistoryDetail(idx) {
    const row = document.getElementById(`shipHistDetail-${idx}`);
    if (!row) return;
    if (openShipHistIdx === idx) { row.style.display = 'none'; openShipHistIdx = null; return; }
    document.querySelectorAll('#shipmentHistoryBody .expand-row').forEach(r => r.style.display = 'none');
    openShipHistIdx = idx;

    const s = shipmentHistoryCache[idx];
    if (!s) return;
    if (!s.items.length) {
        row.querySelector('td').innerHTML = `<div class="expand-content text-faint">ไม่มีรายการยาในใบจัดส่งนี้</div>`;
        row.style.display = 'table-row';
        return;
    }
    const itemChips = s.items.map(it => `
        <span class="ship-history-item-chip">${escapeHtml(it.drug_name)}${it.strength ? ' (' + escapeHtml(it.strength) + ')' : ''} — ${formatNumber(it.qty_shipped)} ${escapeHtml(it.unit || '')}</span>`).join('');
    row.querySelector('td').innerHTML = `
        <div class="expand-content">
            ${s.note ? `<p class="text-faint" style="margin-bottom:8px;">หมายเหตุ: ${escapeHtml(s.note)}</p>` : ''}
            <div class="ship-history-items-row">${itemChips}</div>
        </div>`;
    row.style.display = 'table-row';
}

// ===================== ใบสั่งซื้อ (ดู/พิมพ์ PDF) =====================
async function viewPurchaseOrder(reqId) {
    try {
        const detail = await apiGet(`/requisitions/${reqId}`);
        const itemRows = detail.items.map((it, i) => `
            <tr>
                <td>${i + 1}</td>
                <td>${escapeHtml(it.drug_name)}</td>
                <td>${escapeHtml(it.strength || '-')}</td>
                <td>${escapeHtml(it.pack_size || '-')}</td>
                <td style="text-align:right;">${formatNumber(it.qty_requested)}</td>
                <td>${escapeHtml(it.unit || '-')}</td>
                <td style="text-align:right;">${formatNumber(it.qty_shipped)}</td>
            </tr>`).join('');

        const content = `
            <div class="print-meta-grid">
                <div><span class="label">เลขที่ใบสั่งซื้อ: </span><span class="value">${escapeHtml(detail.req_no)}</span></div>
                <div><span class="label">วันที่: </span><span class="value">${escapeHtml(formatDateDisplay(detail.req_date))}</span></div>
                <div><span class="label">ผู้เบิก: </span><span class="value">${escapeHtml(detail.requested_by || '-')}</span></div>
                <div><span class="label">สถานะ: </span><span class="value">${escapeHtml(reqStatusLabel(detail.status))} / ${escapeHtml(shipStatusLabel(detail.shipStatus))}</span></div>
                <div style="grid-column:1/-1;"><span class="label">หมายเหตุ: </span><span class="value">${escapeHtml(detail.note || '-')}</span></div>
            </div>
            <table>
                <thead><tr><th>#</th><th>ยา</th><th>ความแรง</th><th>ขนาดบรรจุ</th><th style="text-align:right;">จำนวนสั่งซื้อ</th><th>หน่วย</th><th style="text-align:right;">จัดส่งแล้ว</th></tr></thead>
                <tbody>${itemRows}</tbody>
            </table>
        `;
        openPrintPreview(`ใบสั่งซื้อ ${detail.req_no}`, 'งานจัดซื้อ — SmartCtx', content);
    } catch (err) { showToast(err.message, 'error'); }
}

document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    loadUserChip();
    loadRequisitionList();

    // ตัวกรองประวัติการจัดส่ง — ค่าเริ่มต้นเป็นวันปัจจุบันทั้งสองช่อง (ผู้ใช้ปรับช่วงวันที่เองได้ภายหลัง)
    // อยู่ในแท็บที่ไม่ได้ active ตอนโหลดหน้า แต่ initThaiDatePicker ทำงานได้แม้ element ถูกซ่อนด้วย CSS
    initThaiDatePicker(document.getElementById('shipHistFrom')); setDateValue(document.getElementById('shipHistFrom'), todayIso());
    initThaiDatePicker(document.getElementById('shipHistTo')); setDateValue(document.getElementById('shipHistTo'), todayIso());

    // เหตุการณ์เรียลไทม์: ฝั่งคลังเคมีบำบัดสร้างใบเบิกใหม่ หรือรับเข้าคลัง (อาจกระทบสถานะที่แสดง) — รีเฟรชทันที
    // ข้ามการรีเฟรชถ้ามีแถวเปิดค้างอยู่ (กำลังกรอกฟอร์มจัดส่ง) กันข้อมูลที่พิมพ์ค้างหาย
    if (typeof io === 'function') {
        const socket = io();
        const refreshIfIdle = () => { if (openRowIdx === null) loadRequisitionList(); };
        socket.on('requisition:created', refreshIfIdle);
        socket.on('receipt:created', refreshIfIdle);
        socket.on('data:cleared', () => {
            showToast('ข้อมูลถูกล้างจากฝั่งงานคลังเคมีบำบัด — รีเฟรชข้อมูลแล้ว', 'info');
            document.querySelectorAll('.expand-row').forEach(r => r.style.display = 'none');
            openRowIdx = null;
            loadRequisitionList();
            loadShipmentHistory();
        });
    }

    // fallback poll ห่างๆ เผื่อ socket หลุดการเชื่อมต่อชั่วคราว
    setInterval(() => { if (document.querySelector('.tab-btn[data-tab="pending"]').classList.contains('active') && openRowIdx === null) loadRequisitionList(); }, 60000);
});