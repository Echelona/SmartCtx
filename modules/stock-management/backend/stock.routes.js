/**
 * stock.routes.js — API ของงานคลังเคมีบำบัด (1.2 Stock management)
 * mounted ที่ /modules/stock-management/api (ผ่าน requireAuth ของโมดูลนี้แล้ว — ดู server.js)
 */

const express = require('express');
const router = express.Router();
const stock = require('./stock.db');

function getUser(req) {
    return req.session?.moduleAuth?.['stock-management_user'] || null;
}

function handleError(res, err, fallbackMsg) {
    console.error(fallbackMsg, err);
    res.status(err.status || 500).json({ error: err.message || fallbackMsg });
}

// ---------- Sudo gate: middleware ใช้ป้องกัน endpoint ที่ต้องการสิทธิ์สูงกว่าการ login ปกติ ----------
// ใช้กับ route ในอนาคตได้เลยแค่แทรกเป็น middleware ตัวที่สอง เช่น:
//   router.post('/some-sensitive-action', requireSudo, async (req, res) => {...})
// รหัสผ่านตั้งค่าที่ SUDO_SUPERADMIN_PASSWORD ใน .env (ไม่ hardcode ในโค้ด — ดูเหตุผลเดียวกับรหัสผ่าน sudo อื่นๆ ในระบบนี้)
// รับรหัสผ่านจาก req.body.sudoPassword เท่านั้น (ไม่รับจาก query string กัน log ไฟล์เผลอบันทึกรหัสผ่านไว้)
// สำคัญ: ห้ามใช้ status 401/403 กับรหัสผ่านผิด — apiRequest ฝั่ง frontend (stock_page.js) ตีความ 401/403
// ทุกตัวว่า "เซสชันหมดอายุ" เสมอ (เปิด popup login ใหม่) ถ้าใช้ 403 ตรงนี้ ผู้ใช้จะเห็น "session หมดอายุ" ผิดๆ
// แทนที่จะเห็นข้อความ "รหัสผ่าน sudo ไม่ถูกต้อง" ที่ควรจะเป็น จึงใช้ 400 (Bad Request) แทนโดยเจตนา
function requireSudo(req, res, next) {
    if (!process.env.SUDO_SUPERADMIN_PASSWORD) {
        return res.status(500).json({ error: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า SUDO_SUPERADMIN_PASSWORD ใน .env — ติดต่อผู้ดูแลระบบ' });
    }
    const password = req.body?.sudoPassword;
    if (!password || password !== process.env.SUDO_SUPERADMIN_PASSWORD) {
        return res.status(400).json({ error: 'รหัสผ่าน sudo ไม่ถูกต้อง' });
    }
    next();
}

// endpoint เปล่าๆ ไว้ให้ frontend เรียกยืนยันรหัสผ่าน sudo ก่อนทำ action ฝั่ง client ล้วนๆ ที่ไม่มี endpoint
// ของตัวเอง (เช่น กดปุ่ม "+ เพิ่มเงื่อนไข" ในฟอร์ม — แค่เพิ่มแถวในหน่วยความจำ ยังไม่ได้บันทึกอะไรลง DB จริง)
router.post('/admin/verify-sudo', requireSudo, (req, res) => {
    res.json({ ok: true });
});

// ตรวจสอบพารามิเตอร์ช่วงวันที่ (from/to) ก่อนนำไป query เสมอ — ใช้ร่วมกันทุก endpoint ที่รับ from/to
// (/requisitions, /receipts, /movements) กันทั้งรูปแบบวันที่ผิด (ไม่ใช่ YYYY-MM-DD) และช่วงกลับด้าน (จาก > ถึง)
// โยน error status 400 พร้อมข้อความภาษาไทยที่ชัดเจน ให้ handleError ส่งกลับเป็น JSON error ตามปกติ
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function validateDateRangeQuery(from, to) {
    if (from && !ISO_DATE_RE.test(from)) {
        const err = new Error(`รูปแบบวันที่ "จาก" ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD): ${from}`);
        err.status = 400;
        throw err;
    }
    if (to && !ISO_DATE_RE.test(to)) {
        const err = new Error(`รูปแบบวันที่ "ถึง" ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD): ${to}`);
        err.status = 400;
        throw err;
    }
    if (from && to && from > to) {
        const err = new Error('ช่วงวันที่ไม่ถูกต้อง: วันที่ "จาก" ต้องไม่เกินวันที่ "ถึง"');
        err.status = 400;
        throw err;
    }
}

// ---------- Rate limit: กันเดารหัสผ่านยกเลิกใบเบิกซ้ำๆ (in-memory, ต่อ session) ----------
// หมายเหตุ: เก็บใน memory ของ process เดียว ถ้ารันหลาย instance (cluster/load balancer หลายเครื่อง)
// จะไม่ sync กัน แต่ละ instance นับแยกกัน — เพียงพอสำหรับ deploy แบบ single process ตอนนี้
const cancelAttempts = new Map(); // sessionID -> { count, lockUntil }
const MAX_CANCEL_ATTEMPTS = 5;
const CANCEL_LOCK_MS = 5 * 60 * 1000; // ล็อก 5 นาทีเมื่อผิดครบจำนวน

function checkCancelRateLimit(req) {
    const key = req.sessionID;
    const entry = cancelAttempts.get(key);
    if (entry?.lockUntil && Date.now() < entry.lockUntil) {
        const secondsLeft = Math.ceil((entry.lockUntil - Date.now()) / 1000);
        const err = new Error(`กรอกรหัสผ่านผิดหลายครั้งเกินไป กรุณาลองใหม่ในอีก ${secondsLeft} วินาที`);
        err.status = 429;
        throw err;
    }
}
function recordCancelFailure(req) {
    const key = req.sessionID;
    const entry = cancelAttempts.get(key) || { count: 0 };
    entry.count += 1;
    if (entry.count >= MAX_CANCEL_ATTEMPTS) {
        entry.lockUntil = Date.now() + CANCEL_LOCK_MS;
        entry.count = 0;
    }
    cancelAttempts.set(key, entry);
}
function recordCancelSuccess(req) {
    cancelAttempts.delete(req.sessionID);
}

// ---------- ล้างข้อมูลทดสอบ (เฉพาะช่วงทดสอบระบบ — ต้องมีรหัสผ่านแยกต่างหากจาก login ปกติ) ----------

router.post('/admin/clear-test-data', async (req, res) => {
    try {
        const { password } = req.body;
        res.json(await stock.clearTestData(password));
    } catch (err) { handleError(res, err, 'ล้างข้อมูลทดสอบไม่สำเร็จ'); }
});

// ---------- Checkpoint ฐานข้อมูล (WAL → ไฟล์หลัก) — ใช้ก่อนสำรอง/ย้ายฐานข้อมูล ----------
// ไม่ใช่การลบข้อมูล (ไม่ต้องใช้รหัสผ่านยืนยันแบบ clear-test-data) แค่รวมข้อมูลจากไฟล์ WAL เข้าไฟล์
// warehouse.db หลัก ทำให้สำรอง/ย้ายได้แค่ไฟล์เดียว ไม่ต้อง zip รวม -wal/-shm ไปด้วย
router.post('/admin/checkpoint-database', async (req, res) => {
    try { res.json(await stock.checkpointDatabase()); }
    catch (err) { handleError(res, err, 'Checkpoint ฐานข้อมูลไม่สำเร็จ'); }
});

// ---------- ตรวจสอบ/แก้ไขรหัสยาเดิมที่ไม่ตรงรูปแบบ yymmxxx อัตโนมัติ (เฉพาะที่ปลอดภัยจริง — ดู stock.db.js) ----------
router.get('/admin/legacy-code-check', async (req, res) => {
    try { res.json(await stock.checkLegacyDrugCodes()); }
    catch (err) { handleError(res, err, 'ตรวจสอบรหัสยาเดิมไม่สำเร็จ'); }
});
router.post('/admin/legacy-code-autofix', async (req, res) => {
    try { res.json(await stock.autoFixLegacyDrugCodes()); }
    catch (err) { handleError(res, err, 'แก้ไขรหัสยาเดิมอัตโนมัติไม่สำเร็จ'); }
});

// ---------- Lookup options (หน่วย / ขนาดบรรจุ / หน่วยความแรง / หมวดหมู่) ----------
// GET ไม่ gate ด้วย sudo เพราะใช้ populate dropdown ทั่วทั้งแอป (strength unit, category, ฯลฯ) การแก้ไข/ลบ
// เท่านั้นที่ต้องใช้สิทธิ์ sudo (จัดการตัวเลือก dropdown ต้องใช้สิทธิ์ superadmin)

router.get('/lookup-options', async (req, res) => {
    try {
        const { type, activeOnly } = req.query;
        res.json(await stock.listLookupOptions(type, { activeOnly: activeOnly === 'true' }));
    } catch (err) { handleError(res, err, 'ดึงตัวเลือกไม่สำเร็จ'); }
});

// ปิดการเพิ่มตัวเลือกใหม่แล้วตามคำขอ — ตั้งใจไม่ลบ stock.createLookupOption() ออกจาก stock.db.js (เผื่อต้อง
// seed ข้อมูลเองทาง DB ตรงๆ ในอนาคต) แค่ปิด endpoint นี้ไม่ให้เรียกผ่าน API/UI ได้อีก คืน 410 Gone ให้ชัดเจน
// ว่าปิดตั้งใจ ไม่ใช่ route หาย/พังโดยไม่ได้ตั้งใจ (ต่างจาก 404 ที่บอกไม่ได้ว่าหายเพราะอะไร)
router.post('/lookup-options', (req, res) => {
    res.status(410).json({ error: 'ปิดการเพิ่มตัวเลือกใหม่แล้ว ติดต่อผู้ดูแลระบบถ้าจำเป็นต้องเพิ่มตัวเลือกใหม่จริงๆ' });
});

router.put('/lookup-options/:id', requireSudo, async (req, res) => {
    try {
        const { value, active, version } = req.body;
        res.json(await stock.updateLookupOption(req.params.id, { value, active, version }));
    } catch (err) { handleError(res, err, 'แก้ไขตัวเลือกไม่สำเร็จ'); }
});

router.delete('/lookup-options/:id', requireSudo, async (req, res) => {
    try { res.json(await stock.deleteLookupOption(req.params.id)); }
    catch (err) { handleError(res, err, 'ลบตัวเลือกไม่สำเร็จ'); }
});

// ---------- Drug master (item / ความแรง / ขนาดบรรจุ) ----------

router.get('/drugs', async (req, res) => {
    try { res.json(await stock.listDrugs({ activeOnly: req.query.activeOnly === 'true' })); }
    catch (err) { handleError(res, err, 'ดึงรายการยาไม่สำเร็จ'); }
});

router.post('/drugs', async (req, res) => {
    try {
        const {
            name, strength, strengthValue, strengthUnit, packSize, packSizeValue, packSizeUnit, category, unit, defaultCost,
            tradeName, drugType, dosageForm, remark, concBeforeMix, shelfLifeAfterOpen, maxConcAfterMix, diluent,
            compatibleDrugs, incompatibleDrugs, sellingPrice, minStockQty, maxStockQty
        } = req.body;
        res.status(201).json(await stock.createDrug({
            name, strength, strengthValue, strengthUnit, packSize, packSizeValue, packSizeUnit, category, unit, defaultCost,
            tradeName, drugType, dosageForm, remark, concBeforeMix, shelfLifeAfterOpen, maxConcAfterMix, diluent,
            compatibleDrugs, incompatibleDrugs, sellingPrice, minStockQty, maxStockQty
        }));
    } catch (err) { handleError(res, err, 'เพิ่มรายการยาไม่สำเร็จ'); }
});

router.put('/drugs/:id', async (req, res) => {
    try {
        const {
            name, strength, strengthValue, strengthUnit, packSize, packSizeValue, packSizeUnit, category, unit, defaultCost, active, version,
            tradeName, drugType, dosageForm, remark, concBeforeMix, shelfLifeAfterOpen, maxConcAfterMix, diluent,
            compatibleDrugs, incompatibleDrugs, sellingPrice, minStockQty, maxStockQty
        } = req.body;
        res.json(await stock.updateDrug(req.params.id, {
            name, strength, strengthValue, strengthUnit, packSize, packSizeValue, packSizeUnit, category, unit, defaultCost, active, version,
            tradeName, drugType, dosageForm, remark, concBeforeMix, shelfLifeAfterOpen, maxConcAfterMix, diluent,
            compatibleDrugs, incompatibleDrugs, sellingPrice, minStockQty, maxStockQty
        }));
    } catch (err) { handleError(res, err, 'แก้ไขรายการยาไม่สำเร็จ'); }
});

// ตั้งค่า/ล้าง "รหัสยาที่ใช้แทน" (successor) — ใช้คู่กับการปิดใช้งานรายการเดิมตอนต้องย้ายไปรหัสใหม่ (ดู stock.db.js)
router.put('/drugs/:id/superseded-by', async (req, res) => {
    try {
        const { supersededByCode } = req.body;
        res.json(await stock.setSupersededBy(req.params.id, supersededByCode));
    } catch (err) { handleError(res, err, 'ตั้งค่ารหัสยาที่ใช้แทนไม่สำเร็จ'); }
});

router.delete('/drugs/:id', async (req, res) => {
    try { res.json(await stock.deleteDrug(req.params.id)); }
    catch (err) { handleError(res, err, 'ลบรายการยาไม่สำเร็จ'); }
});

// ลบถาวรจริง (ลบแถวออกจากตาราง) — แยกจาก DELETE /drugs/:id ด้านบนซึ่งเป็น soft-delete (ปิดใช้งาน) เท่านั้น
router.delete('/drugs/:id/permanent', async (req, res) => {
    try {
        const { password } = req.body;
        res.json(await stock.hardDeleteDrug(req.params.id, password));
    } catch (err) { handleError(res, err, 'ลบรายการยาถาวรไม่สำเร็จ'); }
});

// เปิดใช้งานกลับรายการยาที่เคยปิดใช้งาน (soft-deleted) — undo ของ DELETE /drugs/:id
router.post('/drugs/:id/reactivate', async (req, res) => {
    try { res.json(await stock.reactivateDrug(req.params.id)); }
    catch (err) { handleError(res, err, 'เปิดใช้งานรายการยาไม่สำเร็จ'); }
});

// ---------- Requisitions (รายการจัดซื้อที่ส่งไปให้งานจัดซื้อ) ----------

router.post('/requisitions', async (req, res) => {
    try {
        const { reqDate, note, items, requesterName } = req.body;
        if (!requesterName || !requesterName.trim()) {
            return res.status(400).json({ error: 'กรุณาระบุชื่อผู้เบิก' });
        }
        const result = await stock.createRequisition({
            reqDate, requestedBy: requesterName.trim(), note, items
        });
        res.status(201).json(result);
    } catch (err) { handleError(res, err, 'สร้างใบเบิกไม่สำเร็จ'); }
});

router.get('/requisitions', async (req, res) => {
    try {
        const { status, from, to, reqNo } = req.query;
        validateDateRangeQuery(from, to);
        res.json(await stock.listRequisitions({ status, from, to, reqNo }));
    } catch (err) { handleError(res, err, 'ดึงรายการใบเบิกไม่สำเร็จ'); }
});

router.get('/requisitions/:id', async (req, res) => {
    try {
        const row = await stock.getRequisition(req.params.id);
        if (!row) return res.status(404).json({ error: 'ไม่พบใบเบิกที่ระบุ' });
        res.json(row);
    } catch (err) { handleError(res, err, 'ดึงข้อมูลใบเบิกไม่สำเร็จ'); }
});

router.post('/requisitions/:id/cancel', async (req, res) => {
    try {
        checkCancelRateLimit(req);
        const { password } = req.body;
        const result = await stock.cancelRequisition(req.params.id, password, getUser(req));
        recordCancelSuccess(req);
        res.json(result);
    } catch (err) {
        if (err.status === 403) recordCancelFailure(req);
        handleError(res, err, 'ยกเลิกใบเบิกไม่สำเร็จ');
    }
});

// ---------- Receipts (รับเข้าตามใบส่งของ) ----------

router.post('/receipts', async (req, res) => {
    try {
        const { receiptDate, reqId, note, items, receiverName } = req.body;
        if (!receiverName || !receiverName.trim()) {
            return res.status(400).json({ error: 'กรุณาระบุชื่อผู้รับ' });
        }
        const result = await stock.createReceipt({ receiptDate, reqId, receivedBy: receiverName.trim(), note, items });
        res.status(201).json(result);
    } catch (err) { handleError(res, err, 'บันทึกรับเข้าคลังไม่สำเร็จ'); }
});

router.get('/receipts', async (req, res) => {
    try {
        const { from, to, reqNo } = req.query;
        validateDateRangeQuery(from, to);
        res.json(await stock.listReceipts({ from, to, reqNo }));
    } catch (err) { handleError(res, err, 'ดึงรายการรับเข้าคลังไม่สำเร็จ'); }
});

router.get('/receipts/:id', async (req, res) => {
    try {
        const row = await stock.getReceipt(req.params.id);
        if (!row) return res.status(404).json({ error: 'ไม่พบใบรับเข้าที่ระบุ' });
        res.json(row);
    } catch (err) { handleError(res, err, 'ดึงข้อมูลใบรับเข้าไม่สำเร็จ'); }
});

// ---------- ยอดค้างจ่าย ----------

router.get('/backorders', async (req, res) => {
    try { res.json(await stock.listBackorders()); }
    catch (err) { handleError(res, err, 'ดึงรายการค้างจ่ายไม่สำเร็จ'); }
});

// ---------- คลังคงเหลือ ----------

router.get('/lots', async (req, res) => {
    try {
        const { drugCode, status, onlyAvailable } = req.query;
        res.json(await stock.listLots({ drugCode, status, onlyAvailable: onlyAvailable === 'true' }));
    } catch (err) { handleError(res, err, 'ดึงข้อมูล Lot ไม่สำเร็จ'); }
});

router.get('/stock-summary', async (req, res) => {
    try { res.json(await stock.getStockSummary()); }
    catch (err) { handleError(res, err, 'ดึงข้อมูลสรุปคลังไม่สำเร็จ'); }
});

router.post('/adjustments', async (req, res) => {
    try {
        const { lotId, qtyChange, reason } = req.body;
        res.status(201).json(await stock.adjustLot({ lotId, qtyChange, reason, user: getUser(req) }));
    } catch (err) { handleError(res, err, 'ปรับปรุงยอดคลังไม่สำเร็จ'); }
});

router.get('/movements', async (req, res) => {
    try {
        const { from, to, drugCode, movementType, limit } = req.query;
        validateDateRangeQuery(from, to);
        res.json(await stock.listMovements({ from, to, drugCode, movementType, limit }));
    } catch (err) { handleError(res, err, 'ดึงประวัติความเคลื่อนไหวไม่สำเร็จ'); }
});

router.get('/reports/near-expiry', async (req, res) => {
    try { res.json(await stock.reportNearExpiry(req.query.days || 90)); }
    catch (err) { handleError(res, err, 'ดึงรายงานยาใกล้หมดอายุไม่สำเร็จ'); }
});

module.exports = router;
