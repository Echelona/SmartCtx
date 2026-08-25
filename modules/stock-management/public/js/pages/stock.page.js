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

// ---------- ตัวกลางเรียก API ทุกจุด: จับ session หมดอายุแบบเดียวกันทั้งแอป ----------
// เดิมมีแค่ saveDrug() ที่เช็ค session ก่อน/หลังยิง request — ตอนนี้รวมทุกจุดที่ยิง fetch ไปที่ API
// (ปิดใช้งาน/เปิดใช้งาน/ลบถาวร/จัดการตัวเลือก/ล้างข้อมูลทดสอบ ฯลฯ) ให้ผ่านทางเดียวกันหมด กันหลุดจุดใดจุดหนึ่ง
// นโยบาย: คำขอที่ "อ่านอย่างเดียว" (GET) ไม่มีข้อมูลกรอกอะไรจะเสีย → พา redirect ไป login ได้เลยตรงๆ
// คำขอที่ "เขียน/เปลี่ยนแปลงข้อมูล" (POST/PUT/DELETE) → ไม่ redirect ทั้งหน้าเด็ดขาด (อาจมีข้อมูลกรอกอยู่ที่อื่น
// ในหน้าเดียวกันที่ยังไม่ได้ส่ง) ให้เปิด login ในแท็บใหม่แทนเสมอ แล้วโยน error ที่มี .sessionExpired = true
// กลับไปให้ผู้เรียกตัดสินใจเองว่าจะแสดงผลยังไงต่อ (เช่นไม่ต้องซ้อน toast error ทับ popup ที่ขึ้นไปแล้ว)
async function apiRequest(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    let res;
    try {
        res = await fetch(API_BASE + url, options);
    } catch (err) {
        throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต');
    }
    if (res.status === 401 || res.status === 403) {
        if (method === 'GET') { redirectToLoginIfExpired(); }
        else { showSessionExpiredNotice(); }
        const err = new Error('เซสชันหมดอายุ');
        err.sessionExpired = true;
        throw err;
    }
    let data = {};
    try {
        data = await res.json();
    } catch (err) {
        // เผื่อ backend/proxy บางจุด redirect ไปหน้า login (HTML) โดยไม่ได้ตอบ 401/403 ตรงๆ — ถือเป็นสัญญาณ
        // session หลุดเช่นกัน แม้ status จะดูเหมือนสำเร็จ (200) ก็ตาม
        if (method === 'GET') { redirectToLoginIfExpired(); }
        else { showSessionExpiredNotice(); }
        const e = new Error('เซสชันหมดอายุ');
        e.sessionExpired = true;
        throw e;
    }
    if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
    return data;
}
async function apiGet(url) { return apiRequest(url, { method: 'GET' }); }
async function apiPost(url, body) {
    return apiRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
}
async function apiPut(url, body) {
    return apiRequest(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
}
async function apiDelete(url, body) {
    return apiRequest(url, body !== undefined
        ? { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : { method: 'DELETE' });
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

// ---------- ตรวจสอบอายุ session/สถานะ login ก่อนแก้ไขข้อมูล ----------
// กันปัญหาแก้ไขฟอร์มไปนานแล้วกด "บันทึก" แต่ session หมดอายุไปก่อนหน้านั้นแล้วโดยไม่รู้ตัว (ได้ error แปลกๆ
// เพราะเซิร์ฟเวอร์ส่งหน้า login กลับมาแทน JSON) เช็คผ่าน /auth/status ที่มีอยู่แล้ว
async function checkSessionValid() {
    try {
        const res = await fetch(API_BASE + '/auth/status');
        const data = await res.json().catch(() => ({}));
        return !!(res.ok && data.authenticated);
    } catch (err) {
        return false; // ต่อเซิร์ฟเวอร์ไม่ได้/เน็ตหลุด ก็ถือว่าเช็คไม่ผ่าน ให้ระวังไว้ก่อนดีกว่าปล่อยผ่าน
    }
}
// แจ้งเตือนตอนพบว่า session หมดอายุ "ก่อนเริ่มแก้ไข" — ยังไม่มีข้อมูลอะไรจะเสีย จึงพาไปหน้า login ได้เลย
function redirectToLoginIfExpired() {
    window.location.href = '/modules/stock-management/login.html';
}
// แจ้งเตือนตอนพบว่า session หมดอายุ "ตอนกำลังจะบันทึก/แก้ไขข้อมูล" — อาจมีข้อมูลกรอกอยู่ในหน้า ห้าม redirect
// ทั้งหน้าเพราะจะทำให้ข้อมูลที่กรอกหายหมด ให้เปิดหน้า login ในแท็บใหม่แทน แล้วกลับมาทำรายการซ้ำที่แท็บเดิมได้เลย
// (คุกกี้ session เป็นของเบราว์เซอร์เดียวกัน ล็อกอินที่แท็บใหม่แล้วแท็บนี้จะใช้ session ใหม่ได้ทันที)
// กันแจ้งซ้ำซ้อนถ้าหลายคำขอพร้อมกันเจอ session หมดอายุพร้อมกัน (เช่น loadDrugs + loadLookupOptions ยิงพร้อมกัน)
let sessionExpiredNoticeShown = false;
function showSessionExpiredNotice() {
    if (sessionExpiredNoticeShown) return;
    sessionExpiredNoticeShown = true;
    const proceed = confirm(
        'เซสชันการเข้าสู่ระบบหมดอายุแล้ว\n\n' +
        'ข้อมูลที่กรอกไว้ในฟอร์มจะไม่หายไป — กด "ตกลง" เพื่อเปิดหน้าเข้าสู่ระบบในแท็บใหม่ ' +
        'จากนั้นกลับมาทำรายการซ้ำที่แท็บนี้ได้เลย'
    );
    sessionExpiredNoticeShown = false;
    if (proceed) window.open('/modules/stock-management/login.html', '_blank');
}

// ---------- Session heartbeat: กัน session หมดอายุระหว่างกรอกฟอร์มยาวๆ ----------
// session cookie อายุแค่ 5 นาทีแบบ rolling (ต่ออายุเมื่อมี request เข้า server เท่านั้น — ดู server.js)
// การพิมพ์ในฟอร์มเฉยๆ ไม่ได้คุยกับ server เลย ถ้ากรอกฟอร์มรายละเอียดยา (มีหลาย field) นานเกิน 5 นาที
// session จะหมดอายุเงียบๆ โดยที่ยังไม่ได้กดบันทึก — ระหว่างฟอร์มเปิดอยู่ จึง ping endpoint เบาๆ (auth/status)
// เป็นระยะ (ถี่กว่าอายุ session พอสมควร) เพื่อต่ออายุ session ให้ทันเวลาเสมอ ไม่ต้องรอจนกดบันทึกแล้วค่อยรู้ว่าหมดอายุ
let sessionHeartbeatTimer = null;
function startSessionHeartbeat() {
    stopSessionHeartbeat();
    sessionHeartbeatTimer = setInterval(() => {
        fetch(API_BASE + '/auth/status').catch(() => {});
    }, 2 * 60 * 1000); // ทุก 2 นาที — สั้นกว่าอายุ session (5 นาที) พอสมควร
}
function stopSessionHeartbeat() {
    if (sessionHeartbeatTimer) { clearInterval(sessionHeartbeatTimer); sessionHeartbeatTimer = null; }
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
    // กฎ: อ้างอิงใบเบิกได้ครั้งละใบเท่านั้น — ขณะเลือกใบเบิกอยู่ ห้ามเพิ่มรายการยาเองปนเข้าไป
    // (รายการต้องมาจากใบเบิกที่เลือกเท่านั้น ไม่งั้นจะกลายเป็นรายการนอกใบเบิกปนกับใบเบิกที่อ้างอิง)
    if (document.getElementById('receiptReqSelect').value) {
        showToast('ขณะอ้างอิงใบเบิกอยู่ ไม่สามารถเพิ่มรายการยาเองได้ — เลือก "รับเข้าโดยไม่อ้างอิงใบเบิก" ก่อนหากต้องการเพิ่มรายการอื่น', 'error');
        return;
    }
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

// แถวในตะกร้ายังแก้ Lot No./วันที่/ราคาได้ในตาราง — จำเป็นเพราะรายการที่เติมอัตโนมัติจากใบเบิก (onReceiptReqSelected)
// รู้แค่ชนิดยา+จำนวนที่ค้าง แต่ Lot No./วันหมดอายุจริงต้องกรอกตามของจริงที่ได้รับในแต่ละครั้งเสมอ
// ยกเว้น "จำนวน" (qty) — ถ้ารายการมาจากใบเบิก (sourceReqId ไม่ใช่ null) ห้ามแก้ไข ต้องล็อกตามยอดที่ระบบคำนวณให้
// (จัดส่งแล้วแต่ยังไม่ได้ลงรับ) เท่านั้น เพื่อกันพิมพ์จำนวนผิดจากที่ระบบรู้จริง — ดู createReceipt ใน stock.db.js
// ที่ตรวจซ้ำอีกชั้นเป็นตัวบังคับจริงฝั่ง backend
function renderReceiptCart() {
    const tbody = document.getElementById('receiptCartBody');
    if (!receiptCart.length) { tbody.innerHTML = `<tr><td colspan="7" class="table-empty">ยังไม่มีรายการในตะกร้า</td></tr>`; return; }
    tbody.innerHTML = receiptCart.map((it, idx) => {
        const qtyLocked = it.sourceReqId !== null && it.sourceReqId !== undefined;
        return `
        <tr>
            <td>${escapeHtml(it.drugName)}${it.strength ? ' (' + escapeHtml(it.strength) + ')' : ''}</td>
            <td><input type="text" value="${escapeHtml(it.lotNo)}" onchange="receiptCart[${idx}].lotNo=this.value"></td>
            <td><input type="text" id="cartMfg-${idx}" readonly></td>
            <td><input type="text" id="cartExp-${idx}" readonly></td>
            <td><input type="number" min="1" step="1" value="${it.qty}" ${qtyLocked ? 'readonly title="จำนวนถูกล็อกตามยอดที่จัดส่งมาจริงจากใบเบิก — แก้ไขไม่ได้" style="background:#f4f6f9;color:#586069;"' : ''} onchange="receiptCart[${idx}].qty=Number(this.value)"></td>
            <td><input type="number" min="0" step="0.01" value="${it.unitCost}" onchange="receiptCart[${idx}].unitCost=this.value"></td>
            <td><button class="line-item-remove" onclick="removeFromReceiptCart(${idx})">✕</button></td>
        </tr>`;
    }).join('');
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

// เปิด/ปิดช่องเพิ่มรายการยาเอง (pick-drug panel) — ปิดไว้เสมอขณะอ้างอิงใบเบิก เพื่อบังคับว่ารายการทั้งใบ
// ต้องมาจากใบเบิกที่เลือกเท่านั้น (กฎ: อ้างอิงใบเบิกได้ครั้งละใบ ห้ามมีรายการนอกใบเบิกปนมา)
function setManualReceiptPickEnabled(enabled) {
    ['rcvPickDrug', 'rcvPickLot', 'rcvPickQty', 'rcvPickCost', 'rcvPickMfg', 'rcvPickExp'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = !enabled;
    });
}

async function onReceiptReqSelected() {
    const reqId = document.getElementById('receiptReqSelect').value;

    // แก้บั๊ก: เดิมกรองลบเฉพาะรายการที่ตรงกับใบเบิกที่เพิ่งเลือกใหม่ (sourceReqId === reqId) เท่านั้น
    // ถ้าก่อนหน้านี้เคยเลือกใบเบิกอื่นไว้แล้ว รายการนั้นจะยังค้างอยู่ในตะกร้า แล้วถูกส่งไปพร้อม reqId ใหม่
    // ตอนบันทึก กลายเป็นบันทึกรับเข้าใบเดียวที่อ้างอิงใบเบิกสองใบปนกัน — ตอนนี้เคลียร์ตะกร้าทั้งหมดทุกครั้ง
    // ที่เปลี่ยนตัวเลือก (รวมถึงตอนเปลี่ยนกลับไป "ไม่อ้างอิงใบเบิก") บังคับให้บันทึกรับเข้าอ้างอิงใบเบิก
    // ได้ครั้งละใบเท่านั้นเสมอ
    receiptCart = [];
    renderReceiptCart();
    setManualReceiptPickEnabled(!reqId);

    if (!reqId) return; // เลือก "รับเข้าโดยไม่อ้างอิงใบเบิก" — เคลียร์ตะกร้าแล้วปล่อยให้เพิ่มรายการเองได้ตามปกติ

    try {
        const detail = await apiGet(`/requisitions/${reqId}`);
        // สำคัญ: เติมเฉพาะยาที่ "จัดส่งมาแล้วจริง" แต่ยังไม่ได้ลงรับ (qty_shipped - qty_received)
        // ไม่ใช่ยอดที่ "เบิกไปแต่ยังไม่ส่ง" (qty_requested - qty_received) — ไม่งั้นจะลงรับของที่ยังไม่ได้ส่งมาได้
        const receivable = detail.items.filter(it => (it.qty_shipped - it.qty_received) > 0);
        const notYetShipped = detail.items.filter(it => (it.qty_shipped - it.qty_received) <= 0 && (it.qty_requested - it.qty_received) > 0);

        if (!receivable.length) {
            showToast(
                notYetShipped.length
                    ? 'ใบเบิกนี้ยังไม่มีรายการที่จัดส่งมาให้ลงรับ (ยังค้างส่งอยู่ที่งานจัดซื้อ)'
                    : 'ใบเบิกนี้รับเข้าครบทุกรายการแล้ว',
                'info'
            );
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
        let msg = `เติมรายการยาลงตะกร้าแล้ว ${receivable.length} รายการ (เฉพาะที่จัดส่งมาแล้ว) — กรุณากรอก Lot No. และวันหมดอายุให้ครบก่อนบันทึก จำนวนรับถูกล็อกตามยอดที่จัดส่งมาจริง แก้ไขเองไม่ได้`;
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
const LOOKUP_LIST_TYPES = ['unit', 'pack_size_unit', 'strength_unit', 'category', 'drug_type', 'dosage_form'];
let lookupCache = { unit: [], pack_size_unit: [], strength_unit: [], category: [], drug_type: [], dosage_form: [] };
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
    populateLookupSelect('d-drug-type', 'drug_type');
    populateLookupSelect('d-dosage-form', 'dosage_form');
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

// Conc.ก่อนผสม (mg/ml) คำนวณอัตโนมัติจากความแรง (strength_value) ÷ ขนาดบรรจุ (pack_size_value) — readonly โดยปกติ
// ตัดเลข 0 ท้ายทศนิยมที่ไม่จำเป็นออก (เช่น 10.0000 -> 10, 0.5000 -> 0.5) ให้อ่านง่าย
function computeConcBeforeMix() {
    const strength = parseFloat(document.getElementById('d-strength-value').value);
    const packSize = parseFloat(document.getElementById('d-pack-value').value);
    if (!strength || !packSize) return null;
    const conc = strength / packSize;
    if (!Number.isFinite(conc)) return null;
    return Math.round(conc).toString(); // ปัดเศษเป็นจำนวนเต็ม (เช่น 20.8 -> 21)
}

// ปุ่ม "📋 Leaflet conc." / "🧮 Calc. conc." — สลับระหว่างค่าที่แก้เองตามเอกสารกำกับยา (leaflet) กับค่าคำนวณ
// อัตโนมัติจาก strength ÷ pack size (เช่น ยาบางตัวค่าจริงตาม leaflet ไม่ตรงกับค่าคำนวณเป๊ะๆ) ระหว่างอยู่ในโหมด
// leaflet ช่องจะไม่ถูกคำนวณทับอัตโนมัติอีก และจะมีตัวอักษรสีส้ม + เครื่องหมาย * สีส้มกำกับไว้ให้เห็นชัดว่าเป็นค่าที่แก้เอง
let concBeforeOverridden = false;

function applyConcBeforeOverrideStyle(active) {
    const input = document.getElementById('d-conc-before');
    const mark = document.getElementById('d-conc-before-override-mark');
    const leafletBtn = document.getElementById('d-conc-before-leaflet-btn');
    const calcBtn = document.getElementById('d-conc-before-calc-btn');
    input.readOnly = !active;
    input.style.background = active ? '#fff' : 'var(--color-bg-subtle,#f0f0f0)';
    input.style.cursor = active ? 'text' : 'not-allowed';
    input.style.color = active ? '#e8590c' : '';
    input.style.fontWeight = active ? '600' : '';
    if (mark) mark.style.display = active ? 'inline' : 'none';
    // ไฮไลต์ปุ่มที่ตรงกับโหมดปัจจุบันด้วยสีส้ม (leaflet = active) เพื่อให้เห็นชัดว่าตอนนี้อยู่โหมดไหน
    if (leafletBtn) {
        leafletBtn.style.borderColor = active ? '#e8590c' : '';
        leafletBtn.style.color = active ? '#e8590c' : '';
        leafletBtn.style.fontWeight = active ? '600' : '';
    }
    if (calcBtn) {
        calcBtn.style.borderColor = !active ? '#e8590c' : '';
        calcBtn.style.color = !active ? '#e8590c' : '';
        calcBtn.style.fontWeight = !active ? '600' : '';
    }
}

function setConcBeforeOverride(active) {
    concBeforeOverridden = active;
    applyConcBeforeOverrideStyle(active);
    if (active) {
        document.getElementById('d-conc-before').focus();
    } else {
        updateConcBeforePreview(); // กด Calc. conc. — กลับไปใช้ค่าคำนวณอัตโนมัติทันที
    }
}

// พิมพ์ค่าตาม leaflet เสร็จแล้วคลิกออกจากช่อง (blur) — ล็อกกลับเป็น readonly ทันทีกันพิมพ์ผิดโดยไม่ตั้งใจภายหลัง
// ค่า/สีส้ม/* ที่บ่งชี้ว่าเป็นค่าที่แก้เองยังคงอยู่เหมือนเดิม (ไม่รีเซ็ต concBeforeOverridden) ต้องกดปุ่ม
// "📋 Leaflet" ใหม่ถึงจะพิมพ์แก้ได้อีกครั้ง
function lockConcBeforeInput() {
    const input = document.getElementById('d-conc-before');
    input.readOnly = true;
    input.style.cursor = 'not-allowed';
    input.style.background = 'var(--color-bg-subtle,#f0f0f0)';
}

function updateConcBeforePreview() {
    if (concBeforeOverridden) return; // อยู่ในโหมดแก้ตาม leaflet เอง ไม่ต้องคำนวณทับค่าที่ผู้ใช้กรอกไว้
    const computed = computeConcBeforeMix();
    document.getElementById('d-conc-before').value = computed !== null ? computed : '';
}

// หัวข้อ "รายละเอียดยา" ในฟอร์ม แสดงชื่อยาที่กำลังกรอก/แก้ไขอยู่แบบสดๆ (แทนข้อความอ้างอิงไฟล์ตายตัวเดิม)
function updateDrugDetailTitle() {
    const name = document.getElementById('d-name').value.trim();
    document.getElementById('drug-detail-title').textContent = name ? `รายละเอียดยา — ${name}` : 'รายละเอียดยา';
}

function updateStrengthPreview() {
    const value = document.getElementById('d-strength-value').value;
    const unit = document.getElementById('d-strength-unit').value;
    const preview = document.getElementById('d-strength-preview');
    preview.textContent = value ? `${value}${unit ? ' ' + unit : ''}` : '-';
    updateConcBeforePreview();
}

function updatePackSizePreview() {
    const value = document.getElementById('d-pack-value').value;
    const unit = document.getElementById('d-pack-unit').value;
    const preview = document.getElementById('d-pack-preview');
    preview.textContent = value ? `${value}${unit ? ' ' + unit : ''}` : '-';
    updateConcBeforePreview();
}

// ---------- Max conc.หลังผสม — ออกแบบให้เป็นข้อมูลโครงสร้าง (ไม่ใช่ข้อความอิสระ) เพื่อให้โมดูลคำนวณ/เตรียมยา
// เรียกใช้ต่อได้จริง รองรับ 3 กรณี: (1) ค่าเดียว — 1 entry มีแค่ min (2) ค่าเป็นช่วง — 1 entry มี min+max
// (3) หลายค่าตามเงื่อนไข RT/อุณหภูมิ/ระยะเวลาต่างกัน — หลาย entry แต่ละอันระบุ tempType+duration ของตัวเอง
// เก็บลง DB เป็น JSON string ก้อนเดียวในคอลัมน์ TEXT เดิม (ไม่ต้องแก้ schema) รูปแบบ:
// [{"min":0.5,"max":null,"tempType":"","tempLabel":"","durationValue":null,"durationUnit":"hr"}, ...]
let maxConcEntries = [];

// ตัวเลือกเงื่อนไขการเก็บ ใช้ร่วมกันทั้ง Max conc.หลังผสม และ อายุหลังเปิดขวดยา (ทั้งคู่ค่าอาจต่างกันตามอุณหภูมิเก็บ)
const STORAGE_TEMP_OPTIONS = [
    { value: '', label: 'ไม่ระบุเงื่อนไข (ค่าเดียว/ช่วงเดียว)' },
    { value: 'RT', label: 'RT (อุณหภูมิห้อง)' },
    { value: 'fridge', label: '2-8°C (แช่เย็น)' },
    { value: 'freezer', label: 'แช่แข็ง' },
    { value: 'other', label: 'อื่นๆ (ระบุเอง)' }
];

function escapeHtmlAttr(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function parseMaxConcEntries(str) {
    if (!str) return [];
    const s = String(str).trim();
    if (!s) return [];
    if (s.startsWith('[')) {
        try {
            const parsed = JSON.parse(s);
            if (Array.isArray(parsed)) {
                return parsed.map(e => ({
                    min: e.min ?? null,
                    max: e.max ?? null,
                    tempType: e.tempType || '',
                    tempLabel: e.tempLabel || '',
                    durationValue: e.durationValue ?? null,
                    durationUnit: e.durationUnit || 'hr'
                }));
            }
        } catch (err) { /* ไม่ใช่ JSON ที่ถูกต้อง — ตกไป parse แบบข้อความเดิมด้านล่างแทน (ข้อมูลเก่าก่อนเปลี่ยนมาเก็บ JSON) */ }
    }
    // รูปแบบเก่า: "ค่า(เงื่อนไข), ค่า(เงื่อนไข)" หรือ "min-max" หรือค่าเดียวเปล่าๆ — แปลงเป็นโครงสร้างใหม่ให้ดีที่สุด
    // เท่าที่ทำได้ ตัวเลขจะถูกดึงมาคำนวณได้ปกติ ส่วนข้อความเงื่อนไขเดิมที่ parse เป็นอุณหภูมิ/เวลาไม่ได้จะถูกเก็บ
    // ไว้ที่ tempLabel (ยังแสดงผลได้ ไม่ข้อมูลหาย แต่ยังใช้ในการคำนวณอัตโนมัติไม่ได้จนกว่าจะบันทึกซ้ำผ่านฟอร์มนี้)
    return s.split(',').map(item => item.trim()).filter(Boolean).map(item => {
        const condMatch = item.match(/^(.*?)\(([^)]*)\)\s*$/);
        const valuePart = condMatch ? condMatch[1].trim() : item;
        const condPart = condMatch ? condMatch[2].trim() : '';
        const rangeMatch = valuePart.match(/^([\d.]+)\s*-\s*([\d.]+)$/);
        let min = null, max = null;
        if (rangeMatch) {
            min = Number(rangeMatch[1]);
            max = Number(rangeMatch[2]);
        } else if (!Number.isNaN(Number(valuePart)) && valuePart !== '') {
            min = Number(valuePart);
        }
        return { min, max, tempType: condPart ? 'other' : '', tempLabel: condPart, durationValue: null, durationUnit: 'hr' };
    });
}

function composeMaxConcEntries() {
    const toNumOrNull = v => (v === '' || v === null || v === undefined || Number.isNaN(Number(v))) ? null : Number(v);
    const cleaned = maxConcEntries
        .map(e => ({
            min: toNumOrNull(e.min),
            max: toNumOrNull(e.max),
            tempType: e.tempType || '',
            tempLabel: e.tempType === 'other' ? (e.tempLabel || '').trim() : '',
            durationValue: e.tempType ? toNumOrNull(e.durationValue) : null,
            durationUnit: e.durationUnit || 'hr'
        }))
        .filter(e => e.min !== null); // ต้องมีค่าอย่างน้อย min ถึงจะเก็บแถวนี้
    return cleaned.length ? JSON.stringify(cleaned) : null;
}

function renderMaxConcRows() {
    const container = document.getElementById('d-max-conc-list');
    if (maxConcEntries.length === 0) maxConcEntries.push({ min: '', max: '', tempType: '', tempLabel: '', durationValue: '', durationUnit: 'hr' });

    container.innerHTML = maxConcEntries.map((entry, idx) => `
        <div class="max-conc-entry" data-idx="${idx}" style="border:1px solid var(--color-border,#ddd); border-radius:6px; padding:8px; display:flex; flex-direction:column; gap:6px;">
            <div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
                <input type="number" step="any" class="mc-min" placeholder="ค่า (mg/ml)" value="${escapeHtmlAttr(entry.min ?? '')}" style="width:100px;">
                <span>-</span>
                <input type="number" step="any" class="mc-max" placeholder="ถึง (ถ้าเป็นช่วง)" value="${escapeHtmlAttr(entry.max ?? '')}" style="width:120px;">
                <button type="button" class="btn-outline btn-sm mc-remove" style="margin-left:auto;">✕</button>
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
                <select class="mc-temp-type" style="min-width:180px;">
                    ${STORAGE_TEMP_OPTIONS.map(o => `<option value="${o.value}" ${entry.tempType === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
                </select>
                ${entry.tempType === 'other' ? `<input type="text" class="mc-temp-label" placeholder="ระบุอุณหภูมิ/เงื่อนไขเอง" value="${escapeHtmlAttr(entry.tempLabel ?? '')}" style="flex:1 1 140px; min-width:0;">` : ''}
                <input type="number" step="any" class="mc-duration-value" placeholder="ระยะเวลา" value="${escapeHtmlAttr(entry.durationValue ?? '')}" style="width:90px;" ${entry.tempType ? '' : 'disabled title="เลือกเงื่อนไขอุณหภูมิก่อนถึงจะระบุระยะเวลาได้"'}>
                <select class="mc-duration-unit" style="width:80px;" ${entry.tempType ? '' : 'disabled'}>
                    <option value="hr" ${entry.durationUnit === 'hr' ? 'selected' : ''}>ชม.</option>
                    <option value="day" ${entry.durationUnit === 'day' ? 'selected' : ''}>วัน</option>
                </select>
            </div>
        </div>
    `).join('');

    container.querySelectorAll('.max-conc-entry').forEach(row => {
        const idx = Number(row.dataset.idx);
        row.querySelector('.mc-min').oninput = e => { maxConcEntries[idx].min = e.target.value; };
        row.querySelector('.mc-max').oninput = e => { maxConcEntries[idx].max = e.target.value; };
        row.querySelector('.mc-temp-type').onchange = e => { maxConcEntries[idx].tempType = e.target.value; renderMaxConcRows(); };
        const labelInput = row.querySelector('.mc-temp-label');
        if (labelInput) labelInput.oninput = e => { maxConcEntries[idx].tempLabel = e.target.value; };
        row.querySelector('.mc-duration-value').oninput = e => { maxConcEntries[idx].durationValue = e.target.value; };
        row.querySelector('.mc-duration-unit').onchange = e => { maxConcEntries[idx].durationUnit = e.target.value; };
        row.querySelector('.mc-remove').onclick = () => removeMaxConcRow(idx);
    });
}

function addMaxConcRow() {
    maxConcEntries.push({ min: '', max: '', tempType: '', tempLabel: '', durationValue: '', durationUnit: 'hr' });
    renderMaxConcRows();
    const mins = document.querySelectorAll('#d-max-conc-list .mc-min');
    if (mins.length) mins[mins.length - 1].focus();
}

function removeMaxConcRow(idx) {
    maxConcEntries.splice(idx, 1);
    renderMaxConcRows();
}

// ---------- ใช้คำนวณต่อ: หาค่า Max conc.หลังผสมที่ใช้ได้จริงตามเงื่อนไขการเก็บจริง (อุณหภูมิ + เวลาที่ผ่านไปหลังผสม) ----------
// เรียกด้วย entries จาก parseMaxConcEntries(drug.max_conc_after_mix) โดยตรง จากโมดูลคำนวณ/เตรียมยาอื่นๆ ได้เลย เช่น
//   findApplicableMaxConc(parseMaxConcEntries(drug.max_conc_after_mix), { tempType: 'RT', elapsedHours: 20 })
// ถ้ามีหลายแถวตรงเงื่อนไข จะคืนแถวที่ค่าสูงสุด (max หรือ min ถ้าไม่มี max) ต่ำที่สุด (เข้มงวดสุด) ไว้ก่อนเพื่อความปลอดภัย
function findApplicableMaxConc(entries, { tempType, elapsedHours } = {}) {
    const matches = (entries || []).filter(e => {
        if (!e.tempType) return !tempType; // แถวที่ไม่ระบุเงื่อนไข ใช้ได้เฉพาะตอนไม่ได้ระบุเงื่อนไขค้นหาด้วยเช่นกัน
        if (tempType && e.tempType !== tempType) return false;
        if (elapsedHours != null && e.durationValue != null) {
            const limitHours = e.durationUnit === 'day' ? e.durationValue * 24 : e.durationValue;
            if (elapsedHours > limitHours) return false;
        }
        return true;
    });
    if (!matches.length) return null;
    return matches.reduce((best, e) => {
        const val = e.max ?? e.min;
        const bestVal = best.max ?? best.min;
        return val < bestVal ? e : best;
    });
}

// ตัวเลือกเงื่อนไข "วิธีการให้ยา" — ใช้กับอายุหลังเปิดขวดยา (บางตัว stability ต่างกันตามวิธีให้ ไม่ใช่แค่อุณหภูมิเก็บ)
const ROUTE_OPTIONS = [
    { value: '', label: 'ไม่ระบุวิธีให้' },
    { value: 'IV', label: 'IV (ฉีดเข้าหลอดเลือดดำ)' },
    { value: 'IM', label: 'IM (ฉีดเข้ากล้ามเนื้อ)' },
    { value: 'IT', label: 'IT (ฉีดเข้าช่องไขสันหลัง)' },
    { value: 'SC', label: 'SC (ฉีดใต้ผิวหนัง)' },
    { value: 'other', label: 'อื่นๆ (ระบุเอง)' }
];

// ---------- อายุหลังเปิดขวดยา — ออกแบบข้อมูลเหมือน Max conc.หลังผสม (ค่าเดียว/ช่วง/หลายเงื่อนไขตามอุณหภูมิ+วิธีให้ยา)
// ต่างกันแค่ "ค่า" ในที่นี้คือระยะเวลาเอง (มีหน่วยวัน/ชม. เลือกได้) ไม่ต้องมี durationValue แยกอีกชั้นแบบ Max conc.
// เก็บเป็น JSON string ก้อนเดียวในคอลัมน์ TEXT เดิม (shelf_life_after_open) ไม่ต้องแก้ schema เช่นกัน รูปแบบ:
// [{"value":15,"max":null,"unit":"day","tempType":"","tempLabel":"","route":"","routeLabel":""}, ...]
let shelfLifeEntries = [];

function parseShelfLifeEntries(str) {
    if (!str) return [];
    const s = String(str).trim();
    if (!s) return [];
    if (s.startsWith('[')) {
        try {
            const parsed = JSON.parse(s);
            if (Array.isArray(parsed)) {
                return parsed.map(e => ({
                    value: e.value ?? null, max: e.max ?? null, unit: e.unit || 'day',
                    tempType: e.tempType || '', tempLabel: e.tempLabel || '',
                    route: e.route || '', routeLabel: e.routeLabel || ''
                }));
            }
        } catch (err) { /* ไม่ใช่ JSON — ตกไป parse แบบข้อความเดิมด้านล่าง (ข้อมูลเก่าก่อนเปลี่ยนมาเก็บ JSON) */ }
    }
    // รูปแบบเก่า: ตัวเลขค่าเดียวล้วนๆ เช่น "15" — แปลงเป็นโครงสร้างใหม่ตรงๆ ไม่มีเงื่อนไขอุณหภูมิ/วิธีให้
    const n = Number(s);
    if (!Number.isNaN(n)) return [{ value: n, max: null, unit: 'day', tempType: '', tempLabel: '', route: '', routeLabel: '' }];
    // เผื่อข้อความอื่นที่ parse เป็นตัวเลขไม่ได้เลย — เก็บทั้งก้อนไว้ที่ tempLabel ไม่ให้ข้อมูลหาย
    return [{ value: null, max: null, unit: 'day', tempType: 'other', tempLabel: s, route: '', routeLabel: '' }];
}

function composeShelfLifeEntries() {
    const toNumOrNull = v => (v === '' || v === null || v === undefined || Number.isNaN(Number(v))) ? null : Number(v);
    const cleaned = shelfLifeEntries
        .map(e => ({
            value: toNumOrNull(e.value),
            max: toNumOrNull(e.max),
            unit: e.unit || 'day',
            tempType: e.tempType || '',
            tempLabel: e.tempType === 'other' ? (e.tempLabel || '').trim() : '',
            route: e.route || '',
            routeLabel: e.route === 'other' ? (e.routeLabel || '').trim() : ''
        }))
        .filter(e => e.value !== null);
    return cleaned.length ? JSON.stringify(cleaned) : null;
}

function renderShelfLifeRows() {
    const container = document.getElementById('d-shelf-life-list');
    if (shelfLifeEntries.length === 0) shelfLifeEntries.push({ value: '', max: '', unit: 'day', tempType: '', tempLabel: '', route: '', routeLabel: '' });

    container.innerHTML = shelfLifeEntries.map((entry, idx) => `
        <div class="shelf-life-entry" data-idx="${idx}" style="border:1px solid var(--color-border,#ddd); border-radius:6px; padding:8px; display:flex; flex-direction:column; gap:6px;">
            <div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
                <input type="number" step="any" class="sl-value" placeholder="อายุ" value="${escapeHtmlAttr(entry.value ?? '')}" style="width:90px;">
                <span>-</span>
                <input type="number" step="any" class="sl-max" placeholder="ถึง (ถ้าเป็นช่วง)" value="${escapeHtmlAttr(entry.max ?? '')}" style="width:120px;">
                <select class="sl-unit" style="width:80px;">
                    <option value="day" ${entry.unit === 'day' ? 'selected' : ''}>วัน</option>
                    <option value="hr" ${entry.unit === 'hr' ? 'selected' : ''}>ชม.</option>
                </select>
                <button type="button" class="btn-outline btn-sm sl-remove" style="margin-left:auto;">✕</button>
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
                <select class="sl-temp-type" style="min-width:180px;">
                    ${STORAGE_TEMP_OPTIONS.map(o => `<option value="${o.value}" ${entry.tempType === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
                </select>
                ${entry.tempType === 'other' ? `<input type="text" class="sl-temp-label" placeholder="ระบุอุณหภูมิ/เงื่อนไขเอง" value="${escapeHtmlAttr(entry.tempLabel ?? '')}" style="flex:1 1 140px; min-width:0;">` : ''}
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
                <select class="sl-route" style="min-width:180px;">
                    ${ROUTE_OPTIONS.map(o => `<option value="${o.value}" ${entry.route === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
                </select>
                ${entry.route === 'other' ? `<input type="text" class="sl-route-label" placeholder="ระบุวิธีให้เอง" value="${escapeHtmlAttr(entry.routeLabel ?? '')}" style="flex:1 1 140px; min-width:0;">` : ''}
            </div>
        </div>
    `).join('');

    container.querySelectorAll('.shelf-life-entry').forEach(row => {
        const idx = Number(row.dataset.idx);
        row.querySelector('.sl-value').oninput = e => { shelfLifeEntries[idx].value = e.target.value; };
        row.querySelector('.sl-max').oninput = e => { shelfLifeEntries[idx].max = e.target.value; };
        row.querySelector('.sl-unit').onchange = e => { shelfLifeEntries[idx].unit = e.target.value; };
        row.querySelector('.sl-temp-type').onchange = e => { shelfLifeEntries[idx].tempType = e.target.value; renderShelfLifeRows(); };
        const tempLabelInput = row.querySelector('.sl-temp-label');
        if (tempLabelInput) tempLabelInput.oninput = e => { shelfLifeEntries[idx].tempLabel = e.target.value; };
        row.querySelector('.sl-route').onchange = e => { shelfLifeEntries[idx].route = e.target.value; renderShelfLifeRows(); };
        const routeLabelInput = row.querySelector('.sl-route-label');
        if (routeLabelInput) routeLabelInput.oninput = e => { shelfLifeEntries[idx].routeLabel = e.target.value; };
        row.querySelector('.sl-remove').onclick = () => removeShelfLifeRow(idx);
    });
}

function addShelfLifeRow() {
    shelfLifeEntries.push({ value: '', max: '', unit: 'day', tempType: '', tempLabel: '', route: '', routeLabel: '' });
    renderShelfLifeRows();
    const vals = document.querySelectorAll('#d-shelf-life-list .sl-value');
    if (vals.length) vals[vals.length - 1].focus();
}

function removeShelfLifeRow(idx) {
    shelfLifeEntries.splice(idx, 1);
    renderShelfLifeRows();
}

// ---------- ใช้คำนวณต่อ: หาอายุหลังเปิดขวดที่ใช้ได้จริงตามเงื่อนไขการเก็บ+วิธีให้ยา (เหมือน findApplicableMaxConc) ----------
//   findApplicableShelfLife(parseShelfLifeEntries(drug.shelf_life_after_open), { tempType: 'RT', route: 'IV' })
function findApplicableShelfLife(entries, { tempType, route } = {}) {
    const matches = (entries || []).filter(e => {
        const tempOk = e.tempType ? (!tempType || e.tempType === tempType) : !tempType;
        const routeOk = e.route ? (!route || e.route === route) : !route;
        return tempOk && routeOk;
    });
    if (!matches.length) return null;
    // ถ้ามีหลายแถวตรงเงื่อนไข ให้ค่าที่สั้นที่สุด (เข้มงวดสุด) ไว้ก่อนเพื่อความปลอดภัย — แปลงหน่วยเป็นชั่วโมงก่อนเทียบ
    const toHours = e => (e.unit === 'day' ? (e.max ?? e.value) * 24 : (e.max ?? e.value));
    return matches.reduce((best, e) => (toHours(e) < toHours(best) ? e : best));
}

// ---------- ช่วยจัดการช่องกรอกแบบหลายค่า (chip/tag) — Dilution / Compatible / Incompatible ----------
// เก็บใน DB เป็น string เดียวคั่นด้วยจุลภาค (comma) เหมือนรูปแบบเดิมจากไฟล์ listยาเคมีบำบัด (เช่น "NSS, D5W")
const CHIP_FIELDS = ['diluent', 'compatible', 'incompatible'];
let chipState = { diluent: [], compatible: [], incompatible: [] };

function setChipValues(field, str) {
    // บังคับตัวพิมพ์ใหญ่เสมอ (เหมือน drug_code) — เผื่อข้อมูลเก่าที่ยังไม่ใช่ตัวพิมพ์ใหญ่ ให้แสดงผลสม่ำเสมอกัน
    chipState[field] = (str || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    renderChips(field);
}
function renderChips(field) {
    const container = document.getElementById(`d-${field}-chips`);
    if (!container) return;
    container.innerHTML = chipState[field].map((v, i) => `
        <span style="display:inline-flex; align-items:center; gap:4px; background:var(--color-bg-subtle,#eee); border-radius:12px; padding:2px 8px; font-size:12.5px;">
            ${escapeHtml(v)}
            <button type="button" onclick="removeChipValue('${field}', ${i})" style="border:none; background:none; cursor:pointer; font-weight:bold; line-height:1; padding:0;">&times;</button>
        </span>`).join('');
    document.getElementById(`d-${field}`).value = chipState[field].join(',');
}
function addChipValue(field) {
    const input = document.getElementById(`d-${field}-input`);
    const v = input.value.trim().toUpperCase(); // บังคับตัวพิมพ์ใหญ่เสมอ (ช่อง text-transform:uppercase ใน HTML ทำแค่แสดงผล ไม่ได้เปลี่ยนค่าจริง)
    if (!v) return;
    if (!chipState[field].includes(v)) chipState[field].push(v);
    input.value = '';
    renderChips(field);
}
function removeChipValue(field, idx) {
    chipState[field].splice(idx, 1);
    renderChips(field);
}

async function openAddDrug() {
    // เช็ค session ก่อนเริ่มกรอกฟอร์มใหม่ทุกครั้ง — ยังไม่มีข้อมูลอะไรจะเสีย ถ้าหมดอายุพาไป login ได้เลย
    if (!(await checkSessionValid())) { redirectToLoginIfExpired(); return; }
    editingDrugId = null;
    document.getElementById('drug-form-title').textContent = 'เพิ่มรายการยา';
    document.getElementById('d-code').value = 'สร้างอัตโนมัติเมื่อบันทึก';
    document.getElementById('d-name').value = '';
    updateDrugDetailTitle();
    document.getElementById('d-strength-value').value = '';
    populateLookupSelect('d-strength-unit', 'strength_unit', '');
    document.getElementById('d-strength-preview').textContent = '-';
    document.getElementById('d-pack-value').value = '';
    populateLookupSelect('d-pack-unit', 'pack_size_unit', '');
    document.getElementById('d-pack-preview').textContent = '-';
    populateLookupSelect('d-category', 'category', '');
    populateLookupSelect('d-unit', 'unit', '');
    document.getElementById('d-cost').value = '';
    document.getElementById('d-selling-price').value = '';
    document.getElementById('d-trade-name').value = '';
    populateLookupSelect('d-drug-type', 'drug_type', '');
    populateLookupSelect('d-dosage-form', 'dosage_form', '');
    document.getElementById('d-remark').value = '';
    setConcBeforeOverride(false);
    document.getElementById('d-conc-before').value = '';
    shelfLifeEntries = [];
    renderShelfLifeRows();
    maxConcEntries = [];
    renderMaxConcRows();
    document.getElementById('d-min-stock').value = '';
    document.getElementById('d-max-stock').value = '';
    CHIP_FIELDS.forEach(f => setChipValues(f, ''));
    document.getElementById('add-drug-form').classList.add('open');
    document.getElementById('add-drug-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
    startSessionHeartbeat();
}

async function openEditDrug(drug) {
    // เช็ค session ก่อนเริ่มแก้ไขทุกครั้ง — ยังไม่มีข้อมูลอะไรจะเสีย ถ้าหมดอายุพาไป login ได้เลย
    if (!(await checkSessionValid())) { redirectToLoginIfExpired(); return; }
    editingDrugId = drug.id;
    document.getElementById('drug-form-title').textContent = `แก้ไขรายการยา — ${drug.name}`;
    document.getElementById('d-code').value = drug.drug_code; // รหัสยาสร้างอัตโนมัติตอนสร้างรายการ แก้ไขภายหลังไม่ได้เลย (ดูเหตุผลใน createDrug/generateDrugCode)
    document.getElementById('d-name').value = drug.name;
    updateDrugDetailTitle();
    document.getElementById('d-strength-value').value = drug.strength_value ?? '';
    populateLookupSelect('d-strength-unit', 'strength_unit', drug.strength_unit || '');
    updateStrengthPreview();
    document.getElementById('d-pack-value').value = drug.pack_size_value ?? '';
    populateLookupSelect('d-pack-unit', 'pack_size_unit', drug.pack_size_unit || '');
    updatePackSizePreview();
    populateLookupSelect('d-category', 'category', drug.category || '');
    populateLookupSelect('d-unit', 'unit', drug.unit || '');
    document.getElementById('d-cost').value = drug.default_cost || '';
    document.getElementById('d-selling-price').value = drug.selling_price || '';
    document.getElementById('d-trade-name').value = drug.trade_name || '';
    populateLookupSelect('d-drug-type', 'drug_type', drug.drug_type || '');
    populateLookupSelect('d-dosage-form', 'dosage_form', drug.dosage_form || '');
    document.getElementById('d-remark').value = drug.remark || '';
    // d-conc-before คำนวณอัตโนมัติจาก updateStrengthPreview()/updatePackSizePreview() ที่เรียกไปแล้วด้านบน — แต่ถ้าค่าที่
    // บันทึกไว้จริงไม่ตรงกับค่าคำนวณ (เช่น เคยแก้ตามเอกสารกำกับยา/leaflet ไว้) ให้เปิดโหมด Leaflet conc. คืนให้อัตโนมัติ
    const computedConcOnLoad = computeConcBeforeMix();
    const savedConc = drug.conc_before_mix != null ? String(drug.conc_before_mix).trim() : '';
    if (savedConc && savedConc !== (computedConcOnLoad || '')) {
        setConcBeforeOverride(true);
        document.getElementById('d-conc-before').value = savedConc;
    } else {
        setConcBeforeOverride(false);
    }
    shelfLifeEntries = parseShelfLifeEntries(drug.shelf_life_after_open);
    renderShelfLifeRows();
    maxConcEntries = parseMaxConcEntries(drug.max_conc_after_mix);
    renderMaxConcRows();
    document.getElementById('d-min-stock').value = drug.min_stock_qty ?? '';
    document.getElementById('d-max-stock').value = drug.max_stock_qty ?? '';
    setChipValues('diluent', drug.diluent);
    setChipValues('compatible', drug.compatible_drugs);
    setChipValues('incompatible', drug.incompatible_drugs);
    document.getElementById('add-drug-form').classList.add('open');
    document.getElementById('add-drug-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
    startSessionHeartbeat();
}

function closeAddDrug() {
    document.getElementById('add-drug-form').classList.remove('open');
    stopSessionHeartbeat();
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
    renderMaxConcRows();
    renderShelfLifeRows();
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
    // ส่ง version ของแถวที่โหลดไว้ตอน render กลับไปด้วย (window._lookupOptionMap) — backend ใช้เช็คว่ามีคนอื่น
    // แก้ตัวเลือกนี้ไปก่อนหน้าหรือไม่ ถ้า version ไม่ตรงจะได้ error 409 กลับมาแทนการเขียนทับเงียบๆ
    const version = window._lookupOptionMap?.[id]?.version;
    try {
        await apiPut(`/lookup-options/${id}`, { value, active, version });
        showToast('บันทึกตัวเลือกสำเร็จ', 'success');
        await loadLookupOptions();
        renderManageOptionsList();
    } catch (err) { if (!err.sessionExpired) showToast(err.message, 'error'); }
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
        name: document.getElementById('d-name').value.trim(),
        strengthValue: strengthValueRaw !== '' ? Number(strengthValueRaw) : null,
        strengthUnit: document.getElementById('d-strength-unit').value.trim(),
        packSizeValue: packSizeValueRaw !== '' ? Number(packSizeValueRaw) : null,
        packSizeUnit: document.getElementById('d-pack-unit').value.trim(),
        category: document.getElementById('d-category').value.trim(),
        unit: document.getElementById('d-unit').value.trim(),
        defaultCost: document.getElementById('d-cost').value ? Number(document.getElementById('d-cost').value) : null,
        sellingPrice: document.getElementById('d-selling-price').value ? Number(document.getElementById('d-selling-price').value) : null,
        tradeName: document.getElementById('d-trade-name').value.trim() || null,
        drugType: document.getElementById('d-drug-type').value.trim() || null,
        dosageForm: document.getElementById('d-dosage-form').value.trim() || null,
        remark: document.getElementById('d-remark').value.trim() || null,
        concBeforeMix: concBeforeOverridden
            ? (document.getElementById('d-conc-before').value.trim() || null)
            : computeConcBeforeMix(),
        shelfLifeAfterOpen: composeShelfLifeEntries(),
        maxConcAfterMix: composeMaxConcEntries(),
        diluent: document.getElementById('d-diluent').value.trim() || null,
        minStockQty: document.getElementById('d-min-stock').value ? Number(document.getElementById('d-min-stock').value) : null,
        maxStockQty: document.getElementById('d-max-stock').value ? Number(document.getElementById('d-max-stock').value) : null,
        compatibleDrugs: document.getElementById('d-compatible').value.trim() || null,
        incompatibleDrugs: document.getElementById('d-incompatible').value.trim() || null
    };
    if (!payload.name) { showToast('กรุณาระบุชื่อยา', 'error'); return; }

    // เช็ค session ก่อนส่งบันทึกทุกครั้ง — กันกรณีกรอกฟอร์มอยู่นานจน session หมดอายุไปโดยไม่รู้ตัว (ชั้นป้องกันแรก)
    // ชั้นที่สองคือ apiPost/apiPut ด้านล่างที่ดัก 401/403 (และ HTML ที่หลุดมาแทน JSON) ให้เองอยู่แล้วเผื่อกรณี
    // session หมดอายุพอดีตอนกำลังส่ง (race condition ระหว่างเช็คกับส่งจริง) ไม่ต้องดักซ้ำเองในนี้อีก
    if (!(await checkSessionValid())) { showSessionExpiredNotice(); return; }

    try {
        if (editingDrugId) {
            // ส่ง version ของแถวที่โหลดไว้ตอนเปิดฟอร์มแก้ไข (window._drugMap) กลับไปด้วย — backend ใช้เช็คว่ามี
            // คนอื่นแก้ยารายการนี้ไปก่อนหน้าหรือไม่ ถ้า version ไม่ตรงจะได้ error 409 กลับมาแทนการเขียนทับเงียบๆ
            payload.version = window._drugMap?.[editingDrugId]?.version;
            await apiPut(`/drugs/${editingDrugId}`, payload);
            showToast('บันทึกรายการยาสำเร็จ', 'success');
        } else {
            const created = await apiPost('/drugs', payload); // ไม่ส่ง drugCode — backend สร้างรหัสอัตโนมัติให้ (รูปแบบ yymmxxx)
            showToast(`เพิ่มรายการยาสำเร็จ — รหัสยา: ${created.drug_code}`, 'success');
        }
        closeAddDrug();
        await loadDrugs();
    } catch (err) {
        // apiRequest แจ้ง session หมดอายุ (popup + เปิดแท็บใหม่) ให้เองแล้วถ้า err.sessionExpired — ไม่ต้องซ้อน
        // toast error ทับ popup ที่ขึ้นไปแล้ว ฟอร์มยังอยู่ครบเพราะยังไม่ได้เรียก closeAddDrug()
        if (!err.sessionExpired) showToast(err.message, 'error');
    }
}

async function loadDrugs() {
    try {
        drugCache = await apiGet('/drugs');
        renderDrugTable();
        populateReqPickDrug();
        populateRcvPickDrug();
    } catch (err) { showToast(err.message, 'error'); }
}

// ---------- ค้นหา/กรองรายการยา: รหัสยา, ชื่อยา, สถานะการใช้งาน (client-side จาก drugCache ที่โหลดมาแล้ว) ----------
function getFilteredDrugs() {
    const searchEl = document.getElementById('drug-search-input');
    const statusEl = document.getElementById('drug-search-status');
    const q = searchEl ? searchEl.value.trim().toLowerCase() : '';
    const status = statusEl ? statusEl.value : '';
    return drugCache.filter(d => {
        if (status === 'active' && !d.active) return false;
        if (status === 'inactive' && d.active) return false;
        if (q) {
            const code = (d.drug_code || '').toLowerCase();
            const name = (d.name || '').toLowerCase();
            if (!code.includes(q) && !name.includes(q)) return false;
        }
        return true;
    });
}
function applyDrugFilters() {
    renderDrugTable();
}
function clearDrugFilters() {
    document.getElementById('drug-search-input').value = '';
    document.getElementById('drug-search-status').value = '';
    renderDrugTable();
}

function renderDrugTable() {
    const tbody = document.getElementById('drugBody');
    const filtered = getFilteredDrugs();
    if (!drugCache.length) { tbody.innerHTML = `<tr><td colspan="11" class="table-empty">ยังไม่มีรายการยา</td></tr>`; return; }
    if (!filtered.length) { tbody.innerHTML = `<tr><td colspan="11" class="table-empty">ไม่พบรายการยาที่ตรงกับเงื่อนไขค้นหา</td></tr>`; return; }
    window._drugMap = {};
    tbody.innerHTML = filtered.map(d => {
        window._drugMap[d.id] = d;
        const priceText = (d.default_cost || d.selling_price)
            ? `${d.default_cost != null ? formatNumber(d.default_cost) : '-'} / ${d.selling_price != null ? formatNumber(d.selling_price) : '-'}`
            : '-';
        const stockRangeText = (d.min_stock_qty != null || d.max_stock_qty != null)
            ? `${d.min_stock_qty != null ? formatNumber(d.min_stock_qty) : '-'} - ${d.max_stock_qty != null ? formatNumber(d.max_stock_qty) : '-'}`
            : '-';
        return `
        <tr ${!d.active ? 'style="opacity:0.5;"' : ''}>
            <td><strong>${escapeHtml(d.drug_code)}</strong></td>
            <td>${escapeHtml(d.name)}</td>
            <td>${escapeHtml(d.strength || '-')}</td>
            <td>${escapeHtml(d.pack_size || '-')}</td>
            <td>${escapeHtml(d.trade_name || '-')}</td>
            <td>${escapeHtml(d.category || '-')}</td>
            <td>${escapeHtml(d.unit || '-')}</td>
            <td>${priceText}</td>
            <td>${stockRangeText}</td>
            <td>
                <span class="status-pill ${d.active ? 'active' : 'cancelled'}">${d.active ? 'ใช้งาน' : 'ปิดใช้งาน'}</span>
                ${!d.active && d.superseded_by_code ? `<div style="font-size:12px; color:var(--color-text-faint,#666); margin-top:2px;">→ ${escapeHtml(d.superseded_by_code)}</div>` : ''}
            </td>
            <td style="white-space:normal; min-width:210px;">
                <div style="display:flex; flex-wrap:wrap; gap:4px;">
                ${d.active ? `<button class="btn-outline btn-sm" data-drug-id="${d.id}" onclick="openEditDrug(window._drugMap[this.dataset.drugId])">✏️ แก้ไข</button>` : ''}
                ${d.active ? `<button class="btn-outline btn-sm" style="color:var(--color-danger-text); border-color:var(--color-danger-text);" onclick="deleteDrugItem(${d.id})">❌ ปิดใช้งาน</button>` : `<button class="btn-outline btn-sm" style="color:var(--color-success-text,#1a7f37); border-color:var(--color-success-text,#1a7f37);" onclick="reactivateDrugItem(${d.id})">🔓 เปิดใช้งาน</button>`}
                ${!d.active ? `<button class="btn-outline btn-sm" onclick="setSupersededByItem(${d.id}, '${escapeHtml(d.superseded_by_code || '').replace(/'/g, "\\'")}')">🔗 ${d.superseded_by_code ? 'แก้ไข' : 'ระบุ'}รหัสใหม่แทน</button>` : ''}
                ${!d.active ? `<button class="btn-outline btn-sm" style="color:var(--color-danger-text); border-color:var(--color-danger-text);" onclick="hardDeleteDrugItem(${d.id}, '${escapeHtml(d.name).replace(/'/g, "\\'")}')">🗑️ ลบถาวร</button>` : ''}
                </div>
            </td>
        </tr>`;
    }).join('');
}

async function deleteDrugItem(id) {
    if (!confirm('ปิดใช้งานรายการยานี้? (จะไม่แสดงในตัวเลือกใหม่ แต่ประวัติเก่ายังอยู่ครบ)')) return;
    try {
        await apiDelete(`/drugs/${id}`);
        showToast('ปิดใช้งานรายการยาแล้ว', 'success');
        loadDrugs();
    } catch (err) { if (!err.sessionExpired) showToast(err.message, 'error'); }
}

// เปิดใช้งานกลับรายการยาที่เคยปิดใช้งาน (soft-deleted) — undo ของ deleteDrugItem ด้านบน ไม่ทำลายข้อมูลอะไร
// จึงไม่ต้องยืนยันด้วยรหัสผ่านเหมือนลบถาวร
async function reactivateDrugItem(id) {
    try {
        await apiPost(`/drugs/${id}/reactivate`);
        showToast('เปิดใช้งานรายการยาแล้ว', 'success');
        loadDrugs();
    } catch (err) { if (!err.sessionExpired) showToast(err.message, 'error'); }
}

// ลบถาวรจริง — ต่างจาก deleteDrugItem (ปิดใช้งาน/soft delete) ด้านบน ต้องกรอกรหัสผ่านยืนยันก่อนเพราะกู้คืนไม่ได้
async function hardDeleteDrugItem(id, drugName) {
    if (!confirm(`⚠️ ลบรายการยา "${drugName}" ถาวร กู้คืนไม่ได้! ยืนยันหรือไม่?`)) return;
    const password = prompt('กรอกรหัสผ่านยืนยัน (รหัสเดียวกับล้างข้อมูลทดสอบ):');
    if (!password) return;
    try {
        await apiDelete(`/drugs/${id}/permanent`, { password });
        showToast('ลบรายการยาถาวรแล้ว', 'success');
        loadDrugs();
    } catch (err) { if (!err.sessionExpired) showToast(err.message, 'error'); }
}

// ตั้งค่า/แก้ไข/ล้าง "รหัสยาที่ใช้แทน" (successor) — ใช้กับรายการที่ปิดใช้งานแล้วเพราะย้ายไปรหัสใหม่ (ดู
// setSupersededBy ใน stock.db.js) กรอกช่องว่างแล้วกดตกลง = ล้างลิงก์ทิ้ง ไม่ต้องกดยืนยันรหัสผ่านใดๆ
// เพราะไม่กระทบข้อมูลธุรกรรม เป็นแค่ metadata ช่วยนำทางเท่านั้น
async function setSupersededByItem(id, currentCode) {
    const input = prompt('รหัสยาใหม่ที่ใช้แทนรายการนี้ (เว้นว่างเพื่อล้างลิงก์):', currentCode || '');
    if (input === null) return; // กดยกเลิก
    try {
        await apiPut(`/drugs/${id}/superseded-by`, { supersededByCode: input.trim() });
        showToast(input.trim() ? 'ระบุรหัสยาที่ใช้แทนแล้ว' : 'ล้างลิงก์รหัสยาที่ใช้แทนแล้ว', 'success');
        loadDrugs();
    } catch (err) { if (!err.sessionExpired) showToast(err.message, 'error'); }
}

// ===================== บำรุงรักษาฐานข้อมูล: Checkpoint WAL → ไฟล์หลัก =====================
// ไม่ลบข้อมูลใดๆ แค่รวมไฟล์ WAL เข้าไฟล์ warehouse.db หลัก ให้สำรอง/ย้ายได้ไฟล์เดียวจบ ไม่ต้อง zip
async function checkpointDatabase() {
    try {
        const result = await apiPost('/admin/checkpoint-database');
        if (result.busy) {
            showToast('Checkpoint สำเร็จบางส่วน (มีการเชื่อมต่ออื่นใช้งานอยู่พร้อมกัน) ลองกดซ้ำอีกครั้งถ้าจำเป็น', 'info');
        } else {
            showToast(`Checkpoint สำเร็จ — รวมข้อมูล ${result.checkpointedPages ?? 0} หน้าเข้าไฟล์หลักแล้ว พร้อมสำรอง/ย้ายไฟล์เดียวได้`, 'success');
        }
    } catch (err) { if (!err.sessionExpired) showToast(err.message, 'error'); }
}

// ===================== ตรวจสอบ/แก้ไขรหัสยาเดิมอัตโนมัติ (เฉพาะที่ปลอดภัย — ดู stock.db.js) =====================
function renderLegacyCodeReport(report) {
    const el = document.getElementById('legacy-code-report');
    const btn = document.getElementById('legacy-code-autofix-btn');
    if (report.nonConformingCount === 0) {
        el.innerHTML = `<span style="color:var(--color-success-text,#1a7f37);">✅ รหัสยาทุกรายการ (${report.totalChecked}) ตรงรูปแบบ yymmxxx แล้ว</span>`;
        btn.style.display = 'none';
        return;
    }
    el.innerHTML = `
        <div>ตรวจสอบทั้งหมด ${report.totalChecked} รายการ — พบ ${report.nonConformingCount} รายการไม่ตรงรูปแบบ</div>
        <div style="color:var(--color-success-text,#1a7f37); margin-top:4px;">✅ แก้ไขอัตโนมัติได้ทันที (ยังไม่เคยใช้งาน): ${report.safeToFix.length} รายการ
            ${report.safeToFix.length ? `<div style="font-size:12.5px; color:var(--color-text-faint,#666);">${report.safeToFix.map(x => escapeHtml(x.oldCode)).join(', ')}</div>` : ''}
        </div>
        <div style="color:var(--color-danger-text,#c0392b); margin-top:4px;">⚠️ ต้องแก้เอง (เคยมีธุรกรรมแล้ว): ${report.needsManualMigration.length} รายการ
            ${report.needsManualMigration.length ? `<div style="font-size:12.5px; color:var(--color-text-faint,#666);">${report.needsManualMigration.map(x => `${escapeHtml(x.oldCode)} (${x.usageCount} ธุรกรรม)`).join(', ')}</div>` : ''}
        </div>`;
    btn.style.display = report.safeToFix.length ? 'inline-block' : 'none';
}

async function checkLegacyDrugCodes() {
    try {
        const report = await apiGet('/admin/legacy-code-check');
        renderLegacyCodeReport(report);
    } catch (err) { if (!err.sessionExpired) showToast(err.message, 'error'); }
}

async function autoFixLegacyDrugCodes() {
    if (!confirm('ยืนยันแก้ไขรหัสยาอัตโนมัติเฉพาะรายการที่ยังไม่เคยใช้งาน (ปลอดภัย 100%)? รายการที่เคยใช้แล้วจะไม่ถูกแตะต้อง')) return;
    try {
        const result = await apiPost('/admin/legacy-code-autofix');
        showToast(`แก้ไขรหัสยาอัตโนมัติแล้ว ${result.fixed.length} รายการ`, 'success');
        loadDrugs();
        checkLegacyDrugCodes(); // รีเฟรชรายงานให้ตรงกับสถานะล่าสุด
    } catch (err) { if (!err.sessionExpired) showToast(err.message, 'error'); }
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
        await apiPost('/admin/clear-test-data', { password });
        showToast('ล้างข้อมูลทดสอบสำเร็จ', 'success');
        document.getElementById('clearPassword').value = '';
        reloadAllViews();
    } catch (err) { if (!err.sessionExpired) showToast(err.message, 'error'); }
}

function reloadAllViews() {
    reqCart = []; renderReqCart();
    receiptCart = []; renderReceiptCart(); setManualReceiptPickEnabled(true);
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
