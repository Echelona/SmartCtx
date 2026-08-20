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

// ---------- ล้างข้อมูลทดสอบ (เฉพาะช่วงทดสอบระบบ — ต้องมีรหัสผ่านแยกต่างหากจาก login ปกติ) ----------

router.post('/admin/clear-test-data', async (req, res) => {
    try {
        const { password } = req.body;
        res.json(await stock.clearTestData(password));
    } catch (err) { handleError(res, err, 'ล้างข้อมูลทดสอบไม่สำเร็จ'); }
});

// ---------- Lookup options (หน่วย / ขนาดบรรจุ / หน่วยความแรง / หมวดหมู่) ----------

router.get('/lookup-options', async (req, res) => {
    try {
        const { type, activeOnly } = req.query;
        res.json(await stock.listLookupOptions(type, { activeOnly: activeOnly === 'true' }));
    } catch (err) { handleError(res, err, 'ดึงตัวเลือกไม่สำเร็จ'); }
});

router.post('/lookup-options', async (req, res) => {
    try {
        const { listType, value } = req.body;
        res.status(201).json(await stock.createLookupOption(listType, value));
    } catch (err) { handleError(res, err, 'เพิ่มตัวเลือกไม่สำเร็จ'); }
});

router.put('/lookup-options/:id', async (req, res) => {
    try {
        const { value, active } = req.body;
        res.json(await stock.updateLookupOption(req.params.id, { value, active }));
    } catch (err) { handleError(res, err, 'แก้ไขตัวเลือกไม่สำเร็จ'); }
});

// ---------- Drug master (item / ความแรง / ขนาดบรรจุ) ----------

router.get('/drugs', async (req, res) => {
    try { res.json(await stock.listDrugs({ activeOnly: req.query.activeOnly === 'true' })); }
    catch (err) { handleError(res, err, 'ดึงรายการยาไม่สำเร็จ'); }
});

router.post('/drugs', async (req, res) => {
    try {
        const { drugCode, name, strength, strengthValue, strengthUnit, packSize, packSizeValue, packSizeUnit, category, unit, defaultCost } = req.body;
        res.status(201).json(await stock.createDrug({ drugCode, name, strength, strengthValue, strengthUnit, packSize, packSizeValue, packSizeUnit, category, unit, defaultCost }));
    } catch (err) { handleError(res, err, 'เพิ่มรายการยาไม่สำเร็จ'); }
});

router.put('/drugs/:id', async (req, res) => {
    try {
        const { name, strength, strengthValue, strengthUnit, packSize, packSizeValue, packSizeUnit, category, unit, defaultCost, active } = req.body;
        res.json(await stock.updateDrug(req.params.id, { name, strength, strengthValue, strengthUnit, packSize, packSizeValue, packSizeUnit, category, unit, defaultCost, active }));
    } catch (err) { handleError(res, err, 'แก้ไขรายการยาไม่สำเร็จ'); }
});

router.delete('/drugs/:id', async (req, res) => {
    try { res.json(await stock.deleteDrug(req.params.id)); }
    catch (err) { handleError(res, err, 'ลบรายการยาไม่สำเร็จ'); }
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
    try { res.json(await stock.listRequisitions({ status: req.query.status })); }
    catch (err) { handleError(res, err, 'ดึงรายการใบเบิกไม่สำเร็จ'); }
});

router.get('/requisitions/:id', async (req, res) => {
    try {
        const row = await stock.getRequisition(req.params.id);
        if (!row) return res.status(404).json({ error: 'ไม่พบใบเบิกที่ระบุ' });
        res.json(row);
    } catch (err) { handleError(res, err, 'ดึงข้อมูลใบเบิกไม่สำเร็จ'); }
});

router.post('/requisitions/:id/cancel', async (req, res) => {
    try { res.json(await stock.cancelRequisition(req.params.id)); }
    catch (err) { handleError(res, err, 'ยกเลิกใบเบิกไม่สำเร็จ'); }
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
    try { res.json(await stock.listReceipts()); }
    catch (err) { handleError(res, err, 'ดึงรายการรับเข้าคลังไม่สำเร็จ'); }
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
        res.json(await stock.listMovements({ from, to, drugCode, movementType, limit }));
    } catch (err) { handleError(res, err, 'ดึงประวัติความเคลื่อนไหวไม่สำเร็จ'); }
});

router.get('/reports/near-expiry', async (req, res) => {
    try { res.json(await stock.reportNearExpiry(req.query.days || 90)); }
    catch (err) { handleError(res, err, 'ดึงรายงานยาใกล้หมดอายุไม่สำเร็จ'); }
});

module.exports = router;
