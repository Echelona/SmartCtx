/**
 * procurement.routes.js — API ของงานจัดซื้อ (1.1)
 * mounted ที่ /modules/procurement/api (ผ่าน requireAuth ของโมดูลนี้แล้ว — ดู server.js)
 */

const express = require('express');
const router = express.Router();
const procurement = require('./procurement.db');

function handleError(res, err, fallbackMsg) {
    console.error(fallbackMsg, err);
    res.status(err.status || 500).json({ error: err.message || fallbackMsg });
}

router.get('/requisitions', async (req, res) => {
    try { res.json(await procurement.listRequisitionsForFulfillment()); }
    catch (err) { handleError(res, err, 'ดึงรายการใบเบิกไม่สำเร็จ'); }
});

router.get('/requisitions/:id', async (req, res) => {
    try {
        const row = await procurement.getRequisitionForFulfillment(req.params.id);
        if (!row) return res.status(404).json({ error: 'ไม่พบใบเบิกที่ระบุ' });
        res.json(row);
    } catch (err) { handleError(res, err, 'ดึงข้อมูลใบเบิกไม่สำเร็จ'); }
});

router.post('/requisitions/:id/ship', async (req, res) => {
    try {
        const { shipmentDate, note, items, senderName } = req.body;
        if (!senderName || !senderName.trim()) {
            return res.status(400).json({ error: 'กรุณาระบุชื่อผู้ส่ง' });
        }
        const result = await procurement.createShipment({
            reqId: req.params.id, shipmentDate, note, items, shippedBy: senderName.trim()
        });
        res.status(201).json(result);
    } catch (err) { handleError(res, err, 'บันทึกการจัดส่งไม่สำเร็จ'); }
});

router.get('/shipments', async (req, res) => {
    try { res.json(await procurement.listShipments()); }
    catch (err) { handleError(res, err, 'ดึงประวัติการจัดส่งไม่สำเร็จ'); }
});

router.get('/pending', async (req, res) => {
    try { res.json(await procurement.listPendingFulfillment()); }
    catch (err) { handleError(res, err, 'ดึงรายการค้างจัดส่งไม่สำเร็จ'); }
});

module.exports = router;
