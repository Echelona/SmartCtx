/**
 * stock.page.js — หน้าเว็บฝั่งงานคลังเคมีบำบัด (1.2)
 * เชื่อมกับ modules/stock-management/backend/stock.routes.js ผ่าน /modules/stock-management/api/*
 */

const API_BASE = '/modules/stock-management/api';

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
function formatCurrency(n) { return !n ? '0 บาท' : Number(n).toLocaleString('th-TH', { maximumFractionDigits: 0 }) + ' บาท'; }
function todayIso() { return new Date().toISOString().slice(0, 10); }

// ตรวจสอบช่วงวันที่ (from/to) ก่อนยิง query ทุกครั้ง — ใช้ร่วมกันทั้งตัวกรองประวัติการจัดส่งและประวัติการรับ
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

// ตรวจสอบวันผลิต/วันหมดอายุ — ใช้ระบบเดียวกับ validateDateRangeInputs ด้านบน (เคลียร์/เติม .input-error แล้วคืนข้อความ error
// ตัวแรกที่พบ หรือ null ถ้าไม่มีปัญหา) เพื่อให้ทั้งช่วงค้นหาประวัติการรับและวันผลิต-หมดอายุ highlight ช่องผิดแบบเดียวกัน
function validateMfgExpDateInputs(mfgEl, expEl) {
    mfgEl.classList.remove('input-error');
    expEl.classList.remove('input-error');
    const mfg = getDateValue(mfgEl);
    const exp = getDateValue(expEl);
    const today = todayIso();
    if (mfg && mfg > today) {
        mfgEl.classList.add('input-error');
        return 'วันผลิตเป็นวันที่ในอนาคต ไม่ถูกต้อง';
    }
    if (exp && exp < today) {
        expEl.classList.add('input-error');
        return 'วันหมดอายุหมดไปแล้ว ไม่สามารถรับเข้าคลังได้';
    }
    if (mfg && exp && exp <= mfg) {
        mfgEl.classList.add('input-error');
        expEl.classList.add('input-error');
        return 'วันหมดอายุต้องอยู่หลังวันผลิต';
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
    try { await fetch(API_BASE + '/auth/logout', { method: 'POST' }); } catch (err) {}
    finally { window.location.href = '/modules/stock-management/login.html'; }
}
async function loadUserChip() {
    try {
        const data = await fetch(API_BASE + '/auth/status').then(r => r.json());
        if (data.authenticated) document.getElementById('userChip').textContent = `👤 ${data.username} (คลังเคมีบำบัด)`;
    } catch (err) {}
}

let drugCache = [];

function statusLabel(s) {
    return { pending: 'รอรับเข้า', partially_received: 'รับบางส่วน', received: 'รับครบแล้ว', cancelled: 'ยกเลิก' }[s] || s;
}
function shipStatusLabel(s) { return { not_shipped: 'ยังไม่ได้จัดส่ง', partially_shipped: 'จัดส่งบางส่วน', shipped: 'จัดส่งครบแล้ว' }[s] || s; }
function shipStatusClass(s) { return { not_shipped: 'pending', partially_shipped: 'partially_shipped', shipped: 'shipped' }[s] || ''; }

function drugOptionsHtml(selectedCode) {
    return drugCache.filter(d => d.active).map(d =>
        `<option value="${escapeHtml(d.drug_code)}" ${d.drug_code === selectedCode ? 'selected' : ''}>${escapeHtml(d.name)} (${escapeHtml(d.strength || '-')})</option>`
    ).join('');
}
function findDrug(code) {
    return drugCache.find(d => d.drug_code === code) || null;
}

// ===================== Tabs =====================
function initTabs() {
    document.querySelectorAll('#tabBar .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#tabBar .tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
            if (btn.dataset.tab === 'stock') loadStockSummary();
            if (btn.dataset.tab === 'backorders') loadBackorders();
            if (btn.dataset.tab === 'movements') loadMovements();
            if (btn.dataset.tab === 'drugs') loadDrugs();
        });
    });
}

// ===================== KPI =====================
async function loadKpis() {
    try {
        const [summary, expiry, reqs, backorders] = await Promise.all([
            apiGet('/stock-summary'), apiGet('/reports/near-expiry?days=90'), apiGet('/requisitions'), apiGet('/backorders')
        ]);
        document.getElementById('kpiDrugCount').textContent = formatNumber(summary.filter(s => s.usableQty > 0).length);
        document.getElementById('kpiNearExpiry').textContent = formatNumber(expiry.filter(e => !e.isExpired).length);
        document.getElementById('kpiPendingReq').textContent = formatNumber(reqs.filter(r => r.status === 'pending' || r.status === 'partially_received').length);
        document.getElementById('kpiBackorder').textContent = formatNumber(backorders.length);
        const totalValue = summary.reduce((s, r) => s + (r.stockValue || 0), 0);
        document.getElementById('kpiTotalValue').textContent = formatCurrency(totalValue);
    } catch (err) { console.warn('โหลด KPI ไม่สำเร็จ', err); }
}

// ===================== TAB: ใบเบิก =====================
let reqCart = [];

function populateReqPickDrug() {
    const sel = document.getElementById('reqPickDrug');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- เลือกยา --</option>' + drugOptionsHtml();
}

function onReqPickDrugChange() {
    const drug = findDrug(document.getElementById('reqPickDrug').value);
    document.getElementById('reqPickStrength').textContent = drug?.strength || '-';
    document.getElementById('reqPickPack').textContent = drug?.pack_size || '-';
}

function addToReqCart() {
    const code = document.getElementById('reqPickDrug').value;
    const qty = Number(document.getElementById('reqPickQty').value);
    if (!code) { showToast('กรุณาเลือกยา', 'error'); return; }
    if (!qty || qty <= 0) { showToast('กรุณาระบุจำนวนที่ต้องการ', 'error'); return; }
    const drug = findDrug(code);
    const existing = reqCart.find(it => it.drugCode === code);
    if (existing) { existing.qtyRequested += qty; }
    else reqCart.push({ drugCode: code, drugName: drug?.name || code, strength: drug?.strength, strengthValue: drug?.strength_value, strengthUnit: drug?.strength_unit, packSize: drug?.pack_size, packSizeValue: drug?.pack_size_value, packSizeUnit: drug?.pack_size_unit, unit: drug?.unit, qtyRequested: qty });
    renderReqCart();
    document.getElementById('reqPickDrug').value = '';
    document.getElementById('reqPickQty').value = '';
    document.getElementById('reqPickStrength').textContent = '-';
    document.getElementById('reqPickPack').textContent = '-';
}

function removeFromReqCart(idx) {
    reqCart.splice(idx, 1);
    renderReqCart();
}

function renderReqCart() {
    const tbody = document.getElementById('reqCartBody');
    if (!reqCart.length) { tbody.innerHTML = `<tr><td colspan="5" class="table-empty">ยังไม่มีรายการในตะกร้า</td></tr>`; return; }
    tbody.innerHTML = reqCart.map((it, idx) => `
        <tr>
            <td>${escapeHtml(it.drugName)}</td>
            <td>${escapeHtml(it.strength || '-')}</td>
            <td>${escapeHtml(it.packSize || '-')}</td>
            <td>${formatNumber(it.qtyRequested)} ${escapeHtml(it.unit || '')}</td>
            <td><button class="line-item-remove" onclick="removeFromReqCart(${idx})">✕</button></td>
        </tr>`).join('');
}

async function submitRequisition() {
    if (!reqCart.length) { showToast('กรุณาเพิ่มรายการยาลงตะกร้าอย่างน้อย 1 รายการ', 'error'); return; }
    const requesterName = document.getElementById('reqRequester').value.trim();
    if (!requesterName) { showToast('กรุณาระบุชื่อผู้เบิก', 'error'); document.getElementById('reqRequester').focus(); return; }

    try {
        await apiPost('/requisitions', {
            reqDate: getDateValue(document.getElementById('reqDate')) || todayIso(),
            requesterName,
            note: document.getElementById('reqNote').value,
            items: reqCart
        });
        showToast('บันทึกใบเบิกสำเร็จ', 'success');
        reqCart = [];
        renderReqCart();
        document.getElementById('reqNote').value = '';
        loadRequisitions();
        loadRequisitionOptionsForReceipt();
        loadKpis();
    } catch (err) { showToast(err.message, 'error'); }
}

// เก็บผลลัพธ์ล่าสุดไว้ใช้ตอนขยายแถวดูรายละเอียด (กันเรียก API ซ้ำเวลากดยกเลิกใบเบิกแล้ว list เปลี่ยน id ไม่ตรง idx เดิม)
let requisitionHistoryCache = [];
let openReqHistIdx = null;

function requisitionHistoryQuery() {
    const status = document.getElementById('reqStatusFilter').value;
    const from = getDateValue(document.getElementById('reqHistFrom'));
    const to = getDateValue(document.getElementById('reqHistTo'));
    const reqNo = document.getElementById('reqHistNoFilter').value.trim();
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (reqNo) params.set('reqNo', reqNo);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
}

async function loadRequisitions() {
    const rangeError = validateDateRangeInputs(document.getElementById('reqHistFrom'), document.getElementById('reqHistTo'));
    if (rangeError) {
        showToast(rangeError, 'error');
        document.getElementById('requisitionBody').innerHTML = `<tr><td colspan="7" class="table-empty text-danger">${escapeHtml(rangeError)}</td></tr>`;
        return;
    }
    try {
        const rows = await apiGet(`/requisitions${requisitionHistoryQuery()}`);
        requisitionHistoryCache = rows;
        openReqHistIdx = null;
        const tbody = document.getElementById('requisitionBody');
        if (!rows.length) { tbody.innerHTML = `<tr><td colspan="7" class="table-empty">ไม่พบใบเบิกตามเงื่อนไขที่ค้นหา</td></tr>`; return; }
        tbody.innerHTML = rows.map((r, idx) => `
            <tr>
                <td><a class="expand-toggle" onclick="toggleRequisitionHistoryDetail(${r.id}, ${idx})"><strong>${escapeHtml(r.req_no)}</strong></a></td>
                <td>${escapeHtml(formatDateDisplay(r.req_date))}</td>
                <td>${escapeHtml(r.requested_by || '-')}</td>
                <td>${formatNumber(r.itemCount)}</td>
                <td><span class="status-pill ${shipStatusClass(r.shipStatus)}">${shipStatusLabel(r.shipStatus)}</span></td>
                <td><span class="status-pill ${r.status}">${statusLabel(r.status)}</span></td>
                <td>${r.status === 'pending' ? `<button class="btn-outline btn-sm" onclick="cancelRequisition(${r.id})">ยกเลิก</button>` : ''}</td>
            </tr>
            <tr class="expand-row" id="reqHistDetail-${idx}" style="display:none;"><td colspan="7"></td></tr>`).join('');
    } catch (err) { showToast(err.message, 'error'); }
}
let debouncedLoadRequisitionsTimer = null;
function debouncedLoadRequisitions() {
    clearTimeout(debouncedLoadRequisitionsTimer);
    debouncedLoadRequisitionsTimer = setTimeout(loadRequisitions, 350);
}
function resetRequisitionHistoryFilter() {
    document.getElementById('reqStatusFilter').value = '';
    setDateValue(document.getElementById('reqHistFrom'), todayIso());
    setDateValue(document.getElementById('reqHistTo'), todayIso());
    document.getElementById('reqHistNoFilter').value = '';
    loadRequisitions();
}

// ขยายแถวดูรายการยาในใบเบิกนั้น (ยา / ความแรง / เบิก / จัดส่งแล้ว / รับแล้ว / ค้างจ่าย)
async function toggleRequisitionHistoryDetail(id, idx) {
    const row = document.getElementById(`reqHistDetail-${idx}`);
    if (!row) return;
    if (openReqHistIdx === idx) { row.style.display = 'none'; openReqHistIdx = null; return; }
    document.querySelectorAll('#requisitionBody .expand-row').forEach(r => r.style.display = 'none');
    openReqHistIdx = idx;

    row.querySelector('td').innerHTML = `<div class="expand-content">กำลังโหลด...</div>`;
    row.style.display = 'table-row';
    try {
        const detail = await apiGet(`/requisitions/${id}`);
        if (!detail.items.length) {
            row.querySelector('td').innerHTML = `<div class="expand-content text-faint">ไม่มีรายการยาในใบเบิกนี้</div>`;
            return;
        }
        const itemRows = detail.items.map(it => `
            <tr>
                <td>${escapeHtml(it.drug_name)}</td>
                <td>${escapeHtml(it.strength || '-')}</td>
                <td style="text-align:right;">${formatNumber(it.qty_requested)}</td>
                <td style="text-align:right;">${formatNumber(it.qty_shipped)}</td>
                <td style="text-align:right;">${formatNumber(it.qty_received)}</td>
                <td style="text-align:right;">${formatNumber(Math.max(0, it.qty_requested - it.qty_received))}</td>
                <td>${escapeHtml(it.unit || '-')}</td>
            </tr>`).join('');
        row.querySelector('td').innerHTML = `
            <div class="expand-content">
                ${detail.note ? `<p class="text-faint" style="margin-bottom:8px;">หมายเหตุ: ${escapeHtml(detail.note)}</p>` : ''}
                ${detail.status === 'cancelled' ? `<p class="text-danger" style="margin-bottom:8px;">
                    ยกเลิกโดย: ${escapeHtml(detail.cancelled_by || '-')} เมื่อ ${detail.cancelled_at ? new Date(detail.cancelled_at).toLocaleString('th-TH') : '-'}
                </p>` : ''}
                <table class="data-table">
                    <thead><tr><th>ยา</th><th>ความแรง</th><th style="text-align:right;">เบิก</th><th style="text-align:right;">จัดส่งแล้ว</th><th style="text-align:right;">รับแล้ว</th><th style="text-align:right;">ค้างจ่าย</th><th>หน่วย</th></tr></thead>
                    <tbody>${itemRows}</tbody>
                </table>
            </div>`;
    } catch (err) {
        row.querySelector('td').innerHTML = `<div class="expand-content text-danger">โหลดรายละเอียดไม่สำเร็จ: ${escapeHtml(err.message)}</div>`;
    }
}

// ===================== Modal ยืนยันรหัสผ่าน admin (ใช้ซ้ำได้กับทุก action ที่ต้องยืนยันสิทธิ์) =====================
// ใช้ input type="password" จริง (mask ตัวอักษร) แทน prompt() ของเบราว์เซอร์ที่โชว์ข้อความเปิดเผย
// เคลียร์ค่ารหัสผ่านออกจาก DOM ทันทีหลังใช้งาน (ไม่ปล่อยค้างใน input field)
function ensurePasswordConfirmModal() {
    if (document.getElementById('pwConfirmModal')) return;
    const modal = document.createElement('div');
    modal.id = 'pwConfirmModal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;align-items:center;justify-content:center;';
    modal.innerHTML = `
        <div style="background:var(--color-bg,#fff);border-radius:8px;padding:24px;max-width:360px;width:90%;box-shadow:0 8px 24px rgba(0,0,0,.2);">
            <h3 id="pwConfirmTitle" style="margin:0 0 8px;font-size:16px;"></h3>
            <p id="pwConfirmMessage" style="margin:0 0 16px;font-size:14px;color:var(--color-text-faint,#666);"></p>
            <input type="password" id="pwConfirmInput" autocomplete="current-password"
                   style="width:100%;box-sizing:border-box;padding:8px;margin-bottom:8px;border:1px solid #ccc;border-radius:4px;"
                   placeholder="รหัสผ่าน admin">
            <p id="pwConfirmError" style="display:none;color:var(--color-danger-text,#c0392b);font-size:13px;margin:0 0 12px;"></p>
            <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button type="button" class="btn-outline btn-sm" id="pwConfirmCancelBtn">ยกเลิก</button>
                <button type="button" class="btn-outline btn-sm" id="pwConfirmOkBtn"
                        style="color:var(--color-danger-text,#c0392b);border-color:var(--color-danger-text,#c0392b);">ยืนยัน</button>
            </div>
        </div>`;
    document.body.appendChild(modal);

    const input = modal.querySelector('#pwConfirmInput');
    const errorEl = modal.querySelector('#pwConfirmError');
    const okBtn = modal.querySelector('#pwConfirmOkBtn');
    const cancelBtn = modal.querySelector('#pwConfirmCancelBtn');

    function close() {
        modal.style.display = 'none';
        input.value = ''; // เคลียร์รหัสผ่านทันทีที่ปิด modal (ไม่ว่าจะสำเร็จหรือกดยกเลิก)
        errorEl.style.display = 'none';
        modal._onConfirm = null;
    }
    cancelBtn.addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    document.addEventListener('keydown', (e) => {
        if (modal.style.display === 'none') return;
        if (e.key === 'Escape') close();
        if (e.key === 'Enter' && document.activeElement === input) okBtn.click();
    });

    async function handleConfirm() {
        const password = input.value;
        if (!password) { errorEl.textContent = 'กรุณากรอกรหัสผ่าน'; errorEl.style.display = 'block'; return; }
        okBtn.disabled = true; cancelBtn.disabled = true; okBtn.textContent = 'กำลังตรวจสอบ...';
        try {
            await modal._onConfirm(password);
            close();
        } catch (err) {
            errorEl.textContent = err.message || 'ยืนยันไม่สำเร็จ';
            errorEl.style.display = 'block';
            input.value = ''; // กรอกผิด — เคลียร์ให้กรอกใหม่ ไม่ค้างของเดิมไว้
            input.focus();
        } finally {
            okBtn.disabled = false; cancelBtn.disabled = false; okBtn.textContent = 'ยืนยัน';
        }
    }
    okBtn.addEventListener('click', handleConfirm);
}

// เปิด modal — onConfirm(password) ต้อง throw Error(message) ถ้าไม่สำเร็จ (modal จะเปิดค้างให้กรอกใหม่แทนที่จะปิดไปเฉยๆ)
function openPasswordConfirm(title, message, onConfirm) {
    ensurePasswordConfirmModal();
    const modal = document.getElementById('pwConfirmModal');
    modal.querySelector('#pwConfirmTitle').textContent = title;
    modal.querySelector('#pwConfirmMessage').textContent = message;
    modal.querySelector('#pwConfirmError').style.display = 'none';
    modal.querySelector('#pwConfirmInput').value = '';
    modal._onConfirm = onConfirm;
    modal.style.display = 'flex';
    setTimeout(() => modal.querySelector('#pwConfirmInput').focus(), 50);
}

function cancelRequisition(id) {
    openPasswordConfirm(
        'ยืนยันยกเลิกใบเบิก',
        'การยกเลิกไม่สามารถย้อนกลับได้ กรุณากรอกรหัสผ่าน admin เพื่อยืนยัน',
        async (password) => {
            await apiPost(`/requisitions/${id}/cancel`, { password });
            showToast('ยกเลิกใบเบิกแล้ว', 'success');
            loadRequisitions();
            loadRequisitionOptionsForReceipt();
        }
    );
}

// ===================== TAB: รับเข้าคลัง =====================
let receiptCart = [];

function populateRcvPickDrug() {
    const sel = document.getElementById('rcvPickDrug');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- เลือกยา --</option>' + drugOptionsHtml();
}

function addToReceiptCart() {
    const code = document.getElementById('rcvPickDrug').value;
    const lotNo = document.getElementById('rcvPickLot').value.trim();
    const qty = Number(document.getElementById('rcvPickQty').value);
    if (!code) { showToast('กรุณาเลือกยา', 'error'); return; }
    if (!lotNo) { showToast('กรุณาระบุ Lot No.', 'error'); return; }
    if (!qty || qty <= 0) { showToast('กรุณาระบุจำนวนที่รับเข้า', 'error'); return; }
    const mfgPickEl = document.getElementById('rcvPickMfg');
    const expPickEl = document.getElementById('rcvPickExp');
    const dateError = validateMfgExpDateInputs(mfgPickEl, expPickEl);
    if (dateError) { showToast(dateError, 'error'); return; }
    const drug = findDrug(code);
    receiptCart.push({
        drugCode: code, drugName: drug?.name || code, strength: drug?.strength, strengthValue: drug?.strength_value, strengthUnit: drug?.strength_unit, packSize: drug?.pack_size, packSizeValue: drug?.pack_size_value, packSizeUnit: drug?.pack_size_unit, unit: drug?.unit,
        qty, lotNo, sourceReqId: null,
        mfgDate: getDateValue(mfgPickEl) || '',
        expDate: getDateValue(expPickEl) || '',
        unitCost: document.getElementById('rcvPickCost').value || ''
    });
    renderReceiptCart();
    document.getElementById('rcvPickDrug').value = '';
    document.getElementById('rcvPickLot').value = '';
    setDateValue(mfgPickEl, '');
    setDateValue(expPickEl, '');
    document.getElementById('rcvPickQty').value = '';
    document.getElementById('rcvPickCost').value = '';
}

function removeFromReceiptCart(idx) {
    receiptCart.splice(idx, 1);
    renderReceiptCart();
}

// แถวในตะกร้ายังแก้ Lot No./วันที่/จำนวน/ราคาได้ในตาราง — จำเป็นเพราะรายการที่เติมอัตโนมัติจากใบเบิก (onReceiptReqSelected)
// รู้แค่ชนิดยา+จำนวนที่ค้าง แต่ Lot No./วันหมดอายุจริงต้องกรอกตามของจริงที่ได้รับในแต่ละครั้งเสมอ
function renderReceiptCart() {
    const tbody = document.getElementById('receiptCartBody');
    if (!receiptCart.length) { tbody.innerHTML = `<tr><td colspan="7" class="table-empty">ยังไม่มีรายการในตะกร้า</td></tr>`; return; }
    tbody.innerHTML = receiptCart.map((it, idx) => `
        <tr>
            <td>${escapeHtml(it.drugName)}${it.strength ? ' (' + escapeHtml(it.strength) + ')' : ''}</td>
            <td><input type="text" value="${escapeHtml(it.lotNo)}" onchange="receiptCart[${idx}].lotNo=this.value"></td>
            <td><input type="text" id="cartMfg-${idx}" readonly></td>
            <td><input type="text" id="cartExp-${idx}" readonly></td>
            <td><input type="number" min="1" step="1" value="${it.qty}" onchange="receiptCart[${idx}].qty=Number(this.value)"></td>
            <td><input type="number" min="0" step="0.01" value="${it.unitCost}" onchange="receiptCart[${idx}].unitCost=this.value"></td>
            <td><button class="line-item-remove" onclick="removeFromReceiptCart(${idx})">✕</button></td>
        </tr>`).join('');
    receiptCart.forEach((it, idx) => {
        const mfgEl = document.getElementById(`cartMfg-${idx}`);
        const expEl = document.getElementById(`cartExp-${idx}`);
        initThaiDatePicker(mfgEl); setDateValue(mfgEl, it.mfgDate || '');
        initThaiDatePicker(expEl); setDateValue(expEl, it.expDate || '');
        validateMfgExpDateInputs(mfgEl, expEl); // ไฮไลต์ทันทีถ้าค่าที่เติมมา (เช่นจากใบเบิก) ผิดอยู่แล้วตั้งแต่ render
        mfgEl.addEventListener('change', () => { receiptCart[idx].mfgDate = getDateValue(mfgEl); validateMfgExpDateInputs(mfgEl, expEl); });
        expEl.addEventListener('change', () => { receiptCart[idx].expDate = getDateValue(expEl); validateMfgExpDateInputs(mfgEl, expEl); });
    });
}

async function loadRequisitionOptionsForReceipt() {
    try {
        const rows = await apiGet('/requisitions');
        const select = document.getElementById('receiptReqSelect');
        const open = rows.filter(r => r.status === 'pending' || r.status === 'partially_received');
        select.innerHTML = '<option value="">-- รับเข้าโดยไม่อ้างอิงใบเบิก --</option>' +
            open.map(r => `<option value="${r.id}">${escapeHtml(r.req_no)} (${statusLabel(r.status)})</option>`).join('');
    } catch (err) {}
}

async function onReceiptReqSelected() {
    const reqId = document.getElementById('receiptReqSelect').value;
    if (!reqId) return;
    try {
        const detail = await apiGet(`/requisitions/${reqId}`);
        // สำคัญ: เติมเฉพาะยาที่ "จัดส่งมาแล้วจริง" แต่ยังไม่ได้ลงรับ (qty_shipped - qty_received)
        // ไม่ใช่ยอดที่ "เบิกไปแต่ยังไม่ส่ง" (qty_requested - qty_received) — ไม่งั้นจะลงรับของที่ยังไม่ได้ส่งมาได้
        const receivable = detail.items.filter(it => (it.qty_shipped - it.qty_received) > 0);
        const notYetShipped = detail.items.filter(it => (it.qty_shipped - it.qty_received) <= 0 && (it.qty_requested - it.qty_received) > 0);

        // แก้บั๊ก: เลือกใบเบิกเดิมซ้ำ (หรือกลับมาเลือกใหม่หลังมีการจัดส่งเพิ่ม) เคยทำให้รายการถูกเติมซ้ำสะสมเพิ่มขึ้นเรื่อยๆ
        // ตามจำนวนครั้งที่เลือก — ตอนนี้ล้างรายการเดิมที่เคยเติมมาจากใบเบิกใบนี้ (เทียบด้วย sourceReqId) ออกก่อนเสมอ
        // แล้วเติมชุดใหม่แทน ไม่ใช่เพิ่มต่อท้าย — รายการที่เพิ่มเองด้วยมือ (sourceReqId เป็น null) ไม่ถูกแตะต้อง
        receiptCart = receiptCart.filter(it => it.sourceReqId !== Number(reqId));

        if (!receivable.length) {
            showToast(
                notYetShipped.length
                    ? 'ใบเบิกนี้ยังไม่มีรายการที่จัดส่งมาให้ลงรับ (ยังค้างส่งอยู่ที่งานจัดซื้อ)'
                    : 'ใบเบิกนี้รับเข้าครบทุกรายการแล้ว',
                'info'
            );
            renderReceiptCart();
            return;
        }
        receivable.forEach(it => {
            const remaining = it.qty_shipped - it.qty_received;
            receiptCart.push({
                drugCode: it.drug_code, drugName: it.drug_name, strength: it.strength, strengthValue: it.strength_value, strengthUnit: it.strength_unit, packSize: it.pack_size, packSizeValue: it.pack_size_value, packSizeUnit: it.pack_size_unit, unit: it.unit,
                qty: remaining, lotNo: '', mfgDate: '', expDate: '', unitCost: '', sourceReqId: Number(reqId)
            });
        });
        renderReceiptCart();
        let msg = `เติมรายการยาลงตะกร้าแล้ว ${receivable.length} รายการ (เฉพาะที่จัดส่งมาแล้ว) — กรุณากรอก Lot No. และวันหมดอายุให้ครบก่อนบันทึก`;
        if (notYetShipped.length) msg += ` — ยังมีอีก ${notYetShipped.length} รายการที่ค้างส่งอยู่ที่งานจัดซื้อ ยังไม่เติมให้`;
        showToast(msg, 'success');
    } catch (err) { showToast('ดึงรายการยาจากใบเบิกไม่สำเร็จ: ' + err.message, 'error'); }
}

async function submitReceipt() {
    if (!receiptCart.length) { showToast('กรุณาเพิ่มรายการยาลงตะกร้าอย่างน้อย 1 รายการ', 'error'); return; }
    const missingLot = receiptCart.some(it => !it.lotNo || !it.lotNo.trim());
    if (missingLot) { showToast('กรุณาระบุ Lot No. ให้ครบทุกรายการในตะกร้าก่อนบันทึก', 'error'); return; }

    const receiverName = document.getElementById('receiptReceiver').value.trim();
    if (!receiverName) { showToast('กรุณาระบุชื่อผู้รับ', 'error'); document.getElementById('receiptReceiver').focus(); return; }

    // ตรวจวันผลิต/วันหมดอายุฝั่งหน้าเว็บก่อน ให้ผู้ใช้เห็น error ทันทีโดยไม่ต้องรอ round-trip ไป backend
    // (backend ก็ตรวจซ้ำอีกชั้นเป็นตัวบังคับจริง เผื่อมีการยิง API ตรงๆ ข้ามหน้าเว็บ)
    for (let idx = 0; idx < receiptCart.length; idx++) {
        const mfgEl = document.getElementById(`cartMfg-${idx}`);
        const expEl = document.getElementById(`cartExp-${idx}`);
        const dateError = validateMfgExpDateInputs(mfgEl, expEl);
        if (dateError) { showToast(`${receiptCart[idx].drugName}: ${dateError}`, 'error'); return; }
    }

    try {
        const reqId = document.getElementById('receiptReqSelect').value || null;
        const items = receiptCart.map(it => ({
            drugCode: it.drugCode, drugName: it.drugName, strength: it.strength, strengthValue: it.strengthValue, strengthUnit: it.strengthUnit, packSize: it.packSize, packSizeValue: it.packSizeValue, packSizeUnit: it.packSizeUnit,
            lotNo: it.lotNo, mfgDate: it.mfgDate || null, expDate: it.expDate || null,
            qty: Number(it.qty), unit: it.unit || '', unitCost: it.unitCost || null
        }));
        await apiPost('/receipts', { receiptDate: getDateValue(document.getElementById('receiptDate')) || todayIso(), reqId, receiverName, note: document.getElementById('receiptNote').value, items });
        showToast('บันทึกรับเข้าคลังสำเร็จ', 'success');
        receiptCart = [];
        renderReceiptCart();
        document.getElementById('receiptNote').value = '';
        loadReceipts(); loadRequisitions(); loadRequisitionOptionsForReceipt(); loadKpis();
    } catch (err) { showToast(err.message, 'error'); }
}

let openRcvHistIdx = null;

function receiptHistoryQuery() {
    const from = getDateValue(document.getElementById('rcvHistFrom'));
    const to = getDateValue(document.getElementById('rcvHistTo'));
    const reqNo = document.getElementById('rcvHistReqNo').value.trim();
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (reqNo) params.set('reqNo', reqNo);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
}

async function loadReceipts() {
    const rangeError = validateDateRangeInputs(document.getElementById('rcvHistFrom'), document.getElementById('rcvHistTo'));
    if (rangeError) {
        showToast(rangeError, 'error');
        document.getElementById('receiptBody').innerHTML = `<tr><td colspan="5" class="table-empty text-danger">${escapeHtml(rangeError)}</td></tr>`;
        return;
    }
    try {
        const rows = await apiGet(`/receipts${receiptHistoryQuery()}`);
        const tbody = document.getElementById('receiptBody');
        openRcvHistIdx = null;
        if (!rows.length) { tbody.innerHTML = `<tr><td colspan="5" class="table-empty">ไม่พบประวัติการรับเข้าคลังตามเงื่อนไขที่ค้นหา</td></tr>`; return; }
        tbody.innerHTML = rows.map((r, idx) => `
            <tr>
                <td><a class="expand-toggle" onclick="toggleReceiptHistoryDetail(${r.id}, ${idx})"><strong>${escapeHtml(r.receipt_no)}</strong></a></td>
                <td>${escapeHtml(formatDateDisplay(r.receipt_date))}</td>
                <td>${escapeHtml(r.received_by || '-')}</td>
                <td>${escapeHtml(r.source_req_no || '-')}</td>
                <td>${formatNumber(r.itemCount)}</td>
            </tr>
            <tr class="expand-row" id="rcvHistDetail-${idx}" style="display:none;"><td colspan="5"></td></tr>`).join('');
    } catch (err) { showToast(err.message, 'error'); }
}
let debouncedLoadReceiptsTimer = null;
function debouncedLoadReceipts() {
    clearTimeout(debouncedLoadReceiptsTimer);
    debouncedLoadReceiptsTimer = setTimeout(loadReceipts, 350);
}
function resetReceiptHistoryFilter() {
    setDateValue(document.getElementById('rcvHistFrom'), todayIso());
    setDateValue(document.getElementById('rcvHistTo'), todayIso());
    document.getElementById('rcvHistReqNo').value = '';
    loadReceipts();
}

// ขยายแถวดูรายการยาในใบรับเข้านั้น (ยา / Lot / วันผลิต-หมดอายุ / จำนวน / ราคาต่อหน่วย)
async function toggleReceiptHistoryDetail(id, idx) {
    const row = document.getElementById(`rcvHistDetail-${idx}`);
    if (!row) return;
    if (openRcvHistIdx === idx) { row.style.display = 'none'; openRcvHistIdx = null; return; }
    document.querySelectorAll('#receiptBody .expand-row').forEach(r => r.style.display = 'none');
    openRcvHistIdx = idx;

    row.querySelector('td').innerHTML = `<div class="expand-content">กำลังโหลด...</div>`;
    row.style.display = 'table-row';
    try {
        const detail = await apiGet(`/receipts/${id}`);
        if (!detail.items.length) {
            row.querySelector('td').innerHTML = `<div class="expand-content text-faint">ไม่มีรายการยาในใบรับเข้านี้</div>`;
            return;
        }
        const itemRows = detail.items.map(it => `
            <tr>
                <td>${escapeHtml(it.drug_name)}${it.strength ? ' (' + escapeHtml(it.strength) + ')' : ''}</td>
                <td>${escapeHtml(it.lot_no || '-')}</td>
                <td>${escapeHtml(formatDateDisplay(it.mfg_date) || '-')}</td>
                <td>${escapeHtml(formatDateDisplay(it.exp_date) || '-')}</td>
                <td style="text-align:right;">${formatNumber(it.qty)} ${escapeHtml(it.unit || '')}</td>
                <td style="text-align:right;">${it.unit_cost ? formatCurrency(it.unit_cost) : '-'}</td>
            </tr>`).join('');
        row.querySelector('td').innerHTML = `
            <div class="expand-content">
                ${detail.note ? `<p class="text-faint" style="margin-bottom:8px;">หมายเหตุ: ${escapeHtml(detail.note)}</p>` : ''}
                <table class="data-table">
                    <thead><tr><th>ยา</th><th>Lot No.</th><th>วันผลิต</th><th>วันหมดอายุ</th><th style="text-align:right;">จำนวน</th><th style="text-align:right;">ราคา/หน่วย</th></tr></thead>
                    <tbody>${itemRows}</tbody>
                </table>
            </div>`;
    } catch (err) {
        row.querySelector('td').innerHTML = `<div class="expand-content text-danger">โหลดรายละเอียดไม่สำเร็จ: ${escapeHtml(err.message)}</div>`;
    }
}

// ===================== TAB: คลังคงเหลือ =====================
let stockCache = [];
let openStockRowIdx = null;

async function loadStockSummary() {
    try { stockCache = await apiGet('/stock-summary'); renderStockSummary(); }
    catch (err) { showToast(err.message, 'error'); }
}
function renderStockSummary() {
    const tbody = document.getElementById('stockSummaryBody');
    const q = (document.getElementById('stockSearch')?.value || '').trim().toLowerCase();
    const rows = stockCache.filter(r => !q || r.drugName.toLowerCase().includes(q));
    if (!rows.length) { tbody.innerHTML = `<tr><td colspan="8" class="table-empty">ไม่พบข้อมูลคลังยา</td></tr>`; return; }
    tbody.innerHTML = rows.map((r, idx) => `
        <tr>
            <td><a class="expand-toggle" onclick="toggleLotDetail('${escapeHtml(r.drugCode)}', ${idx})">${escapeHtml(r.drugName)}</a></td>
            <td>${escapeHtml(r.strength || '-')}</td>
            <td><strong>${formatNumber(r.usableQty)}</strong></td>
            <td>${escapeHtml(r.unit || '-')}</td>
            <td>${formatNumber(r.lotCount)}</td>
            <td>${escapeHtml(formatDateDisplay(r.nearestExp) || '-')}</td>
            <td>${r.expiredQty ? `<span class="status-pill expired">${formatNumber(r.expiredQty)}</span>` : '-'}</td>
            <td>${formatCurrency(r.stockValue)}</td>
        </tr>
        <tr class="expand-row" id="lotDetail-${idx}" style="display:none;"><td colspan="8"></td></tr>`).join('');
    openStockRowIdx = null;
}

// รายละเอียดคลังคงเหลือแยกตาม Lot — จำนวน/ต้นทุน/วันผลิต-หมดอายุ/สถานะ ต่อ Lot พร้อมมูลค่ารวมของยาชนิดนั้น
async function toggleLotDetail(drugCode, idx) {
    const row = document.getElementById(`lotDetail-${idx}`);
    if (!row) return;
    if (openStockRowIdx === idx) { row.style.display = 'none'; openStockRowIdx = null; return; }
    document.querySelectorAll('#stockSummaryBody .expand-row').forEach(r => r.style.display = 'none');
    openStockRowIdx = idx;

    row.querySelector('td').innerHTML = `<div class="expand-content">กำลังโหลด...</div>`;
    row.style.display = 'table-row';
    try {
        const lots = await apiGet(`/lots?drugCode=${encodeURIComponent(drugCode)}`);
        if (!lots.length) {
            row.querySelector('td').innerHTML = `<div class="expand-content text-faint">ไม่มีข้อมูล Lot</div>`;
            return;
        }
        const totalQty = lots.reduce((s, l) => s + l.qty_balance, 0);
        const totalValue = lots.reduce((s, l) => s + (l.qty_balance * (l.unit_cost || 0)), 0);
        const lotRows = lots.map(l => {
            const lotValue = l.qty_balance * (l.unit_cost || 0);
            const statusBadge = l.isExpired
                ? '<span class="status-pill expired">หมดอายุ</span>'
                : `<span class="status-pill ${l.status}">${l.status === 'depleted' ? 'หมดล็อต' : 'ใช้งานได้'}</span>`;
            return `
                <tr>
                    <td>${escapeHtml(l.lot_no)}</td>
                    <td>${escapeHtml(formatDateDisplay(l.mfg_date) || '-')}</td>
                    <td>${escapeHtml(formatDateDisplay(l.exp_date) || '-')}</td>
                    <td style="text-align:right;">${formatNumber(l.qty_received)}</td>
                    <td style="text-align:right;"><strong>${formatNumber(l.qty_balance)}</strong></td>
                    <td style="text-align:right;">${l.unit_cost ? formatCurrency(l.unit_cost) : '-'}</td>
                    <td style="text-align:right;">${formatCurrency(lotValue)}</td>
                    <td>${statusBadge}</td>
                </tr>`;
        }).join('');
        row.querySelector('td').innerHTML = `
            <div class="expand-content">
                <table class="data-table">
                    <thead><tr><th>Lot No.</th><th>วันผลิต</th><th>วันหมดอายุ</th><th style="text-align:right;">รับเข้าสะสม</th><th style="text-align:right;">คงเหลือ</th><th style="text-align:right;">ต้นทุน/หน่วย</th><th style="text-align:right;">มูลค่ารวม</th><th>สถานะ</th></tr></thead>
                    <tbody>
                        ${lotRows}
                        <tr class="report-total-row">
                            <td colspan="4">รวม ${formatNumber(lots.length)} Lot</td>
                            <td style="text-align:right;">${formatNumber(totalQty)}</td>
                            <td></td>
                            <td style="text-align:right;">${formatCurrency(totalValue)}</td>
                            <td></td>
                        </tr>
                    </tbody>
                </table>
            </div>`;
    } catch (err) {
        row.querySelector('td').innerHTML = `<div class="expand-content text-danger">โหลดข้อมูล Lot ไม่สำเร็จ: ${escapeHtml(err.message)}</div>`;
    }
}

// ===================== TAB: ค้างจ่าย =====================
async function loadBackorders() {
    try {
        const rows = await apiGet('/backorders');
        const tbody = document.getElementById('backorderBody');
        if (!rows.length) { tbody.innerHTML = `<tr><td colspan="6" class="table-empty">ไม่มีรายการค้างจ่าย</td></tr>`; return; }
        tbody.innerHTML = rows.map(r => `
            <tr>
                <td><strong>${escapeHtml(r.req_no)}</strong></td>
                <td>${escapeHtml(formatDateDisplay(r.req_date))}</td>
                <td>${escapeHtml(r.drug_name)}${r.strength ? ' (' + escapeHtml(r.strength) + ')' : ''}</td>
                <td>${formatNumber(r.qty_requested)}</td>
                <td>${formatNumber(r.qty_received)}</td>
                <td><span class="status-pill pending">${formatNumber(r.qty_outstanding)}</span></td>
            </tr>`).join('');
    } catch (err) { showToast(err.message, 'error'); }
}

// ===================== TAB: ความเคลื่อนไหว =====================
async function loadMovements() {
    const rangeError = validateDateRangeInputs(document.getElementById('movHistFrom'), document.getElementById('movHistTo'));
    if (rangeError) {
        showToast(rangeError, 'error');
        document.getElementById('movementsBody').innerHTML = `<tr><td colspan="7" class="table-empty text-danger">${escapeHtml(rangeError)}</td></tr>`;
        return;
    }
    try {
        const from = getDateValue(document.getElementById('movHistFrom'));
        const to = getDateValue(document.getElementById('movHistTo'));
        const params = new URLSearchParams({ limit: '100' });
        if (from) params.set('from', from);
        if (to) params.set('to', to);
        const rows = await apiGet(`/movements?${params.toString()}`);
        const tbody = document.getElementById('movementsBody');
        const typeLabel = { RECEIPT: 'รับเข้า', ADJUSTMENT: 'ปรับปรุงยอด' };
        if (!rows.length) { tbody.innerHTML = `<tr><td colspan="7" class="table-empty">ไม่พบข้อมูลตามเงื่อนไขที่ค้นหา</td></tr>`; return; }
        tbody.innerHTML = rows.map(m => `
            <tr>
                <td>${escapeHtml(m.ts)}</td>
                <td>${typeLabel[m.movement_type] || escapeHtml(m.movement_type)}</td>
                <td>${escapeHtml(m.drug_name)}</td>
                <td>${escapeHtml(m.lot_no || '-')}</td>
                <td style="color:${m.qty_change < 0 ? 'var(--color-danger-text)' : 'var(--color-primary)'}; font-weight:600;">${m.qty_change > 0 ? '+' : ''}${formatNumber(m.qty_change)}</td>
                <td>${formatNumber(m.balance_after)}</td>
                <td>${escapeHtml(m.note || '-')}</td>
            </tr>`).join('');
    } catch (err) { showToast(err.message, 'error'); }
}
function resetMovementsHistoryFilter() {
    setDateValue(document.getElementById('movHistFrom'), '');
    setDateValue(document.getElementById('movHistTo'), '');
    loadMovements();
}

// ===================== TAB: รายการยา (Drug Master) =====================
// แนวทางเดียวกับ admin.js: ฟอร์ม add/edit เปิด-ปิดด้วย class, ปุ่ม Edit ดึงข้อมูลผ่าน data-map
// (window._drugMap) แทนการฝัง JSON ใน onclick ตรงๆ — กัน XSS และกันชื่อยาที่มี quote ทำให้ onclick แตก

let editingDrugId = null;
const LOOKUP_LIST_TYPES = ['unit', 'pack_size_unit', 'strength_unit', 'category'];
let lookupCache = { unit: [], pack_size_unit: [], strength_unit: [], category: [] };
const LOOKUP_ADD_NEW_SENTINEL = '__add_new__';

async function loadLookupOptions() {
    try {
        const results = await Promise.all(LOOKUP_LIST_TYPES.map(t => apiGet(`/lookup-options?type=${t}&activeOnly=true`)));
        LOOKUP_LIST_TYPES.forEach((t, i) => { lookupCache[t] = results[i]; });
        populateAllLookupSelects();
    } catch (err) { console.warn('โหลดตัวเลือก dropdown ไม่สำเร็จ', err); }
}

function populateAllLookupSelects() {
    populateLookupSelect('d-unit', 'unit');
    populateLookupSelect('d-pack-unit', 'pack_size_unit');
    populateLookupSelect('d-strength-unit', 'strength_unit');
    populateLookupSelect('d-category', 'category');
}

function populateLookupSelect(fieldId, listType, selectedValue) {
    const sel = document.getElementById(fieldId);
    if (!sel) return;
    const current = selectedValue !== undefined ? selectedValue : sel.value;
    sel.innerHTML = '<option value="">-- เลือก --</option>' +
        lookupCache[listType].map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.value)}</option>`).join('') +
        `<option value="${LOOKUP_ADD_NEW_SENTINEL}">+ เพิ่มตัวเลือกใหม่...</option>`;
    if (current) sel.value = current;
}

// เลือก "+ เพิ่มตัวเลือกใหม่..." ในดรอปดาวน์ -> ถามค่าใหม่ บันทึกเข้า lookup_options แล้วเลือกให้ทันที
async function onLookupSelectChange(fieldId, listType) {
    const sel = document.getElementById(fieldId);
    if (sel.value !== LOOKUP_ADD_NEW_SENTINEL) { updateStrengthPreview(); updatePackSizePreview(); return; }
    const value = prompt('เพิ่มตัวเลือกใหม่:');
    if (!value || !value.trim()) { sel.value = ''; return; }
    try {
        const created = await apiPost('/lookup-options', { listType, value: value.trim() });
        lookupCache[listType].push(created);
        lookupCache[listType].sort((a, b) => a.value.localeCompare(b.value));
        populateAllLookupSelects();
        sel.value = created.value;
        showToast('เพิ่มตัวเลือกใหม่แล้ว', 'success');
    } catch (err) {
        sel.value = '';
        showToast(err.message, 'error');
    }
    updateStrengthPreview();
    updatePackSizePreview();
}

function updateStrengthPreview() {
    const value = document.getElementById('d-strength-value').value;
    const unit = document.getElementById('d-strength-unit').value;
    const preview = document.getElementById('d-strength-preview');
    preview.textContent = value ? `${value}${unit ? ' ' + unit : ''}` : '-';
}

function updatePackSizePreview() {
    const value = document.getElementById('d-pack-value').value;
    const unit = document.getElementById('d-pack-unit').value;
    const preview = document.getElementById('d-pack-preview');
    preview.textContent = value ? `${value}${unit ? ' ' + unit : ''}` : '-';
}

function openAddDrug() {
    editingDrugId = null;
    document.getElementById('drug-form-title').textContent = 'เพิ่มรายการยา';
    document.getElementById('d-code').value = '';
    document.getElementById('d-code').disabled = false;
    document.getElementById('d-name').value = '';
    document.getElementById('d-strength-value').value = '';
    populateLookupSelect('d-strength-unit', 'strength_unit', '');
    document.getElementById('d-strength-preview').textContent = '-';
    document.getElementById('d-pack-value').value = '';
    populateLookupSelect('d-pack-unit', 'pack_size_unit', '');
    document.getElementById('d-pack-preview').textContent = '-';
    populateLookupSelect('d-category', 'category', '');
    populateLookupSelect('d-unit', 'unit', '');
    document.getElementById('d-cost').value = '';
    document.getElementById('add-drug-form').classList.add('open');
    document.getElementById('add-drug-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openEditDrug(drug) {
    editingDrugId = drug.id;
    document.getElementById('drug-form-title').textContent = `แก้ไขรายการยา — ${drug.name}`;
    document.getElementById('d-code').value = drug.drug_code;
    document.getElementById('d-code').disabled = true; // รหัสยาเป็น key อ้างอิง ห้ามแก้หลังสร้างแล้ว (กันข้อมูลเก่าที่อ้างรหัสเดิมสับสน)
    document.getElementById('d-name').value = drug.name;
    document.getElementById('d-strength-value').value = drug.strength_value ?? '';
    populateLookupSelect('d-strength-unit', 'strength_unit', drug.strength_unit || '');
    updateStrengthPreview();
    document.getElementById('d-pack-value').value = drug.pack_size_value ?? '';
    populateLookupSelect('d-pack-unit', 'pack_size_unit', drug.pack_size_unit || '');
    updatePackSizePreview();
    populateLookupSelect('d-category', 'category', drug.category || '');
    populateLookupSelect('d-unit', 'unit', drug.unit || '');
    document.getElementById('d-cost').value = drug.default_cost || '';
    document.getElementById('add-drug-form').classList.add('open');
    document.getElementById('add-drug-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeAddDrug() {
    document.getElementById('add-drug-form').classList.remove('open');
}

// ---------- จัดการตัวเลือก dropdown (แก้ไข/ปิดใช้งาน/เพิ่ม) ----------

let activeManageTab = 'unit';

function openManageOptions() {
    document.getElementById('manage-options-panel').classList.add('open');
    renderManageOptionsList();
}
function closeManageOptions() {
    document.getElementById('manage-options-panel').classList.remove('open');
}

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('#manage-options-tabs .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#manage-options-tabs .tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeManageTab = btn.dataset.listType;
            renderManageOptionsList();
        });
    });
});

async function renderManageOptionsList() {
    const container = document.getElementById('manage-options-list');
    container.innerHTML = '<div class="text-faint">กำลังโหลด...</div>';
    try {
        const options = await apiGet(`/lookup-options?type=${activeManageTab}`);
        if (!options.length) { container.innerHTML = '<div class="text-faint">ยังไม่มีตัวเลือก</div>'; return; }
        window._lookupOptionMap = {};
        container.innerHTML = options.map(o => {
            window._lookupOptionMap[o.id] = o;
            return `
                <div class="manage-options-item ${o.active ? '' : 'inactive'}">
                    <input type="text" id="lo-value-${o.id}" value="${escapeHtml(o.value)}">
                    <label style="font-size:12.5px; white-space:nowrap;"><input type="checkbox" id="lo-active-${o.id}" ${o.active ? 'checked' : ''}> ใช้งาน</label>
                    <button class="btn-outline btn-sm" data-opt-id="${o.id}" onclick="saveManageOption(this.dataset.optId)">บันทึก</button>
                </div>`;
        }).join('');
    } catch (err) { container.innerHTML = `<div class="text-danger">โหลดไม่สำเร็จ: ${escapeHtml(err.message)}</div>`; }
}

async function saveManageOption(id) {
    const value = document.getElementById(`lo-value-${id}`).value.trim();
    const active = document.getElementById(`lo-active-${id}`).checked;
    if (!value) { showToast('กรุณาระบุค่าตัวเลือก', 'error'); return; }
    try {
        await fetch(`${API_BASE}/lookup-options/${id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value, active })
        }).then(async res => { if (!res.ok) throw new Error((await res.json()).error || 'บันทึกไม่สำเร็จ'); });
        showToast('บันทึกตัวเลือกสำเร็จ', 'success');
        await loadLookupOptions();
        renderManageOptionsList();
    } catch (err) { showToast(err.message, 'error'); }
}

async function addManageOption() {
    const input = document.getElementById('manage-options-new-value');
    const value = input.value.trim();
    if (!value) { showToast('กรุณากรอกค่าตัวเลือกใหม่', 'error'); return; }
    try {
        await apiPost('/lookup-options', { listType: activeManageTab, value });
        input.value = '';
        showToast('เพิ่มตัวเลือกใหม่แล้ว', 'success');
        await loadLookupOptions();
        renderManageOptionsList();
    } catch (err) { showToast(err.message, 'error'); }
}

async function saveDrug() {
    const strengthValueRaw = document.getElementById('d-strength-value').value;
    const packSizeValueRaw = document.getElementById('d-pack-value').value;
    const payload = {
        drugCode: document.getElementById('d-code').value.trim(),
        name: document.getElementById('d-name').value.trim(),
        strengthValue: strengthValueRaw !== '' ? Number(strengthValueRaw) : null,
        strengthUnit: document.getElementById('d-strength-unit').value.trim(),
        packSizeValue: packSizeValueRaw !== '' ? Number(packSizeValueRaw) : null,
        packSizeUnit: document.getElementById('d-pack-unit').value.trim(),
        category: document.getElementById('d-category').value.trim(),
        unit: document.getElementById('d-unit').value.trim(),
        defaultCost: document.getElementById('d-cost').value ? Number(document.getElementById('d-cost').value) : null
    };
    if (!payload.drugCode || !payload.name) { showToast('กรุณาระบุรหัสยาและชื่อยา', 'error'); return; }

    try {
        if (editingDrugId) {
            await fetch(`${API_BASE}/drugs/${editingDrugId}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
            }).then(async res => { if (!res.ok) throw new Error((await res.json()).error || 'บันทึกไม่สำเร็จ'); });
        } else {
            await apiPost('/drugs', payload);
        }
        showToast('บันทึกรายการยาสำเร็จ', 'success');
        closeAddDrug();
        await loadDrugs();
    } catch (err) { showToast(err.message, 'error'); }
}

async function loadDrugs() {
    try {
        drugCache = await apiGet('/drugs');
        renderDrugTable();
        populateReqPickDrug();
        populateRcvPickDrug();
    } catch (err) { showToast(err.message, 'error'); }
}

function renderDrugTable() {
    const tbody = document.getElementById('drugBody');
    if (!drugCache.length) { tbody.innerHTML = `<tr><td colspan="8" class="table-empty">ยังไม่มีรายการยา</td></tr>`; return; }
    window._drugMap = {};
    tbody.innerHTML = drugCache.map(d => {
        window._drugMap[d.id] = d;
        return `
        <tr ${!d.active ? 'style="opacity:0.5;"' : ''}>
            <td><strong>${escapeHtml(d.drug_code)}</strong></td>
            <td>${escapeHtml(d.name)}</td>
            <td>${escapeHtml(d.strength || '-')}</td>
            <td>${escapeHtml(d.pack_size || '-')}</td>
            <td>${escapeHtml(d.category || '-')}</td>
            <td>${escapeHtml(d.unit || '-')}</td>
            <td><span class="status-pill ${d.active ? 'active' : 'cancelled'}">${d.active ? 'ใช้งาน' : 'ปิดใช้งาน'}</span></td>
            <td style="white-space:nowrap;">
                <button class="btn-outline btn-sm" data-drug-id="${d.id}" onclick="openEditDrug(window._drugMap[this.dataset.drugId])">✏️ แก้ไข</button>
                ${d.active ? `<button class="btn-outline btn-sm" style="color:var(--color-danger-text); border-color:var(--color-danger-text);" onclick="deleteDrugItem(${d.id})">🗑️ ปิดใช้งาน</button>` : ''}
            </td>
        </tr>`;
    }).join('');
}

async function deleteDrugItem(id) {
    if (!confirm('ปิดใช้งานรายการยานี้? (จะไม่แสดงในตัวเลือกใหม่ แต่ประวัติเก่ายังอยู่ครบ)')) return;
    try {
        await fetch(`${API_BASE}/drugs/${id}`, { method: 'DELETE' });
        showToast('ปิดใช้งานรายการยาแล้ว', 'success');
        loadDrugs();
    } catch (err) { showToast(err.message, 'error'); }
}

// ===================== Danger Zone: ล้างข้อมูลทดสอบ =====================
async function clearTestData() {
    const password = document.getElementById('clearPassword').value;
    if (!password) { showToast('กรุณากรอกรหัสผ่านยืนยัน', 'error'); return; }

    const confirmed = confirm(
        '⚠️ ยืนยันการล้างข้อมูล?\n\n' +
        'การกดตกลงจะลบใบเบิก/การจัดส่ง/การรับเข้าคลัง/สต๊อกคงเหลือ/ประวัติความเคลื่อนไหวทั้งหมดถาวร กู้คืนไม่ได้\n' +
        '(รายการยา/Drug Master จะไม่ถูกลบ)\n\nใช้เฉพาะช่วงทดสอบระบบเท่านั้น'
    );
    if (!confirmed) return;

    try {
        const res = await fetch(`${API_BASE}/admin/clear-test-data`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'ล้างข้อมูลไม่สำเร็จ');
        showToast('ล้างข้อมูลทดสอบสำเร็จ', 'success');
        document.getElementById('clearPassword').value = '';
        reloadAllViews();
    } catch (err) { showToast(err.message, 'error'); }
}

// เรียกใหม่ทุกมุมมองหลังข้อมูลถูกล้าง (จากปุ่มของตัวเอง หรือจาก event data:cleared ที่มาจากอีกฝั่ง)
function reloadAllViews() {
    reqCart = []; renderReqCart();
    receiptCart = []; renderReceiptCart();
    loadRequisitions();
    loadRequisitionOptionsForReceipt();
    loadReceipts();
    loadStockSummary();
    loadBackorders();
    loadMovements();
    loadKpis();
}

document.addEventListener('DOMContentLoaded', async () => {
    initTabs();
    loadUserChip();
    loadKpis();

    initThaiDatePicker(document.getElementById('reqDate')); setDateValue(document.getElementById('reqDate'), todayIso());
    initThaiDatePicker(document.getElementById('receiptDate')); setDateValue(document.getElementById('receiptDate'), todayIso());
    initThaiDatePicker(document.getElementById('rcvPickMfg'));
    initThaiDatePicker(document.getElementById('rcvPickExp'));
    // เช็ควันผลิต/วันหมดอายุทันทีที่เลือก (ไม่ต้องรอกดเพิ่มลงตะกร้า) — ใช้ระบบเดียวกับตัวกรองประวัติการรับด้านล่าง
    document.getElementById('rcvPickMfg').addEventListener('change', () =>
        validateMfgExpDateInputs(document.getElementById('rcvPickMfg'), document.getElementById('rcvPickExp')));
    document.getElementById('rcvPickExp').addEventListener('change', () =>
        validateMfgExpDateInputs(document.getElementById('rcvPickMfg'), document.getElementById('rcvPickExp')));

    // ตัวกรองประวัติการจัดส่ง/รับ — ค่าเริ่มต้นเป็นวันปัจจุบันทั้งสองช่อง (ผู้ใช้ปรับช่วงวันที่เองได้ภายหลัง)
    initThaiDatePicker(document.getElementById('reqHistFrom')); setDateValue(document.getElementById('reqHistFrom'), todayIso());
    initThaiDatePicker(document.getElementById('reqHistTo')); setDateValue(document.getElementById('reqHistTo'), todayIso());
    initThaiDatePicker(document.getElementById('rcvHistFrom')); setDateValue(document.getElementById('rcvHistFrom'), todayIso());
    initThaiDatePicker(document.getElementById('rcvHistTo')); setDateValue(document.getElementById('rcvHistTo'), todayIso());
    // ตัวกรองความเคลื่อนไหว — ไม่ตั้งค่าเริ่มต้นเป็นวันนี้ (ต่างจากประวัติใบเบิก/รับเข้า) เพราะเป็น log ยาวที่มักต้องไล่ดูย้อนหลังทั้งหมด
    initThaiDatePicker(document.getElementById('movHistFrom'));
    initThaiDatePicker(document.getElementById('movHistTo'));

    await loadLookupOptions(); // ต้องโหลดตัวเลือก dropdown ก่อน loadDrugs() ถึงจะ populate select ในฟอร์มถูกต้อง
    await loadDrugs(); // ต้องโหลดรายการยาก่อน ถึงจะสร้าง dropdown ตัวเลือกในตะกร้าใบเบิก/รับเข้าได้ถูกต้อง
    renderReqCart();
    renderReceiptCart();
    loadRequisitions();
    loadRequisitionOptionsForReceipt();
    loadReceipts();

    // เหตุการณ์เรียลไทม์: ฝั่งจัดซื้อจัดส่งแล้ว (กระทบสถานะจัดส่ง) หรือรายการยา/ตัวเลือก dropdown ถูกแก้ไข (โดยผู้ใช้อื่น) — รีเฟรชทันที
    if (typeof io === 'function') {
        const socket = io();
        socket.on('shipment:created', () => {
            loadRequisitions();
            loadKpis();
            if (document.getElementById('tab-backorders').classList.contains('active')) loadBackorders();
        });
        socket.on('drug:changed', () => loadDrugs());
        socket.on('lookup:changed', async () => {
            await loadLookupOptions();
            if (document.getElementById('manage-options-panel').classList.contains('open')) renderManageOptionsList();
        });
        socket.on('data:cleared', () => { showToast('ข้อมูลถูกล้างจากอีกหน้าจอหนึ่ง — รีเฟรชข้อมูลแล้ว', 'info'); reloadAllViews(); });
    }

    // fallback poll ห่างๆ เผื่อ socket หลุดการเชื่อมต่อชั่วคราว
    setInterval(() => {
        if (document.querySelector('.tab-btn[data-tab="requisitions"]').classList.contains('active')) loadRequisitions();
    }, 60000);
});
