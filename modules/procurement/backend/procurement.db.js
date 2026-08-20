/**
 * procurement.db.js — ตรรกะข้อมูลฝั่งงานจัดซื้อ (1.1)
 * รับใบเบิก (รายการจัดซื้อ) ที่งานคลังเคมีบำบัด (1.2) ส่งมา แล้วบันทึกการจัดส่ง/ส่งของ — จัดส่งไม่ครบได้ (ค้างจ่าย)
 */

const { dbRun, dbGet, dbAll, withTransaction, nextDocNumber } = require('../../_shared/backend/warehouseSchema.db');
const eventBus = require('../../_shared/backend/eventBus.util');

function todayIso() {
    return new Date().toISOString().slice(0, 10);
}

function computeShipStatus(items) {
    if (!items.length) return 'not_shipped';
    const totalReq = items.reduce((s, it) => s + it.qty_requested, 0);
    const totalShipped = items.reduce((s, it) => s + it.qty_shipped, 0);
    if (totalShipped <= 0) return 'not_shipped';
    if (totalShipped >= totalReq) return 'shipped';
    return 'partially_shipped';
}

async function listRequisitionsForFulfillment() {
    const rows = await dbAll(`SELECT * FROM requisitions ORDER BY id DESC`);
    const out = [];
    for (const r of rows) {
        const items = await dbAll(`SELECT * FROM requisition_items WHERE requisition_id = ?`, [r.id]);
        out.push({ ...r, itemCount: items.length, shipStatus: computeShipStatus(items) });
    }
    return out;
}

async function getRequisitionForFulfillment(id) {
    const r = await dbGet(`SELECT * FROM requisitions WHERE id = ?`, [id]);
    if (!r) return null;
    const items = await dbAll(`SELECT * FROM requisition_items WHERE requisition_id = ?`, [id]);
    return { ...r, items, shipStatus: computeShipStatus(items) };
}

// items: [{ reqItemId, qty }] — จัดส่งบางส่วนได้ ส่วนที่เหลือค้างไว้จัดส่งรอบถัดไป
async function createShipment({ reqId, shipmentDate, note, items, shippedBy }) {
    if (!items || !items.length) {
        const err = new Error('ต้องเลือกรายการยาที่จะจัดส่งอย่างน้อย 1 รายการ');
        err.status = 400;
        throw err;
    }
    const date = shipmentDate || todayIso();

    return withTransaction(async () => {
        const requisition = await dbGet(`SELECT * FROM requisitions WHERE id = ?`, [reqId]);
        if (!requisition) {
            const err = new Error('ไม่พบใบเบิกที่ระบุ');
            err.status = 404;
            throw err;
        }
        if (requisition.status === 'cancelled') {
            const err = new Error('ใบเบิกนี้ถูกยกเลิกแล้ว ไม่สามารถจัดส่งได้');
            err.status = 409;
            throw err;
        }

        const shipmentNo = await nextDocNumber('SHP', 'shipments', 'shipment_date', date);
        const { lastID: shipmentId } = await dbRun(
            `INSERT INTO shipments (requisition_id, shipment_no, shipment_date, note, shipped_by) VALUES (?, ?, ?, ?, ?)`,
            [reqId, shipmentNo, date, note || null, shippedBy || null]
        );

        for (const it of items) {
            const reqItem = await dbGet(`SELECT * FROM requisition_items WHERE id = ? AND requisition_id = ?`, [it.reqItemId, reqId]);
            if (!reqItem) {
                const err = new Error(`ไม่พบรายการยาที่ระบุ (id ${it.reqItemId}) ในใบเบิกนี้`);
                err.status = 400;
                throw err;
            }
            const qty = Number(it.qty);
            const remaining = reqItem.qty_requested - reqItem.qty_shipped;
            if (qty <= 0 || qty > remaining + 1e-9) {
                const err = new Error(`จำนวนที่จัดส่งของ ${reqItem.drug_name} เกินยอดคงเหลือที่เบิก (เหลือ ${remaining})`);
                err.status = 400;
                throw err;
            }
            await dbRun(`UPDATE requisition_items SET qty_shipped = qty_shipped + ? WHERE id = ?`, [qty, reqItem.id]);
            await dbRun(`INSERT INTO shipment_items (shipment_id, requisition_item_id, qty_shipped) VALUES (?, ?, ?)`,
                [shipmentId, reqItem.id, qty]);
        }

        return { id: shipmentId, shipment_no: shipmentNo };
    }).then(result => {
        eventBus.emit('shipment:created', { id: result.id, shipment_no: result.shipment_no, reqId: Number(reqId) });
        return result;
    });
}

async function listShipments() {
    const shipments = await dbAll(`SELECT * FROM shipments ORDER BY id DESC`);
    const out = [];
    for (const s of shipments) {
        const requisition = await dbGet(`SELECT req_no FROM requisitions WHERE id = ?`, [s.requisition_id]);
        const shipmentItems = await dbAll(
            `SELECT si.qty_shipped AS qty_shipped, ri.drug_name AS drug_name, ri.strength AS strength, ri.unit AS unit
             FROM shipment_items si
             JOIN requisition_items ri ON ri.id = si.requisition_item_id
             WHERE si.shipment_id = ?`,
            [s.id]
        );
        out.push({ ...s, req_no: requisition?.req_no || '-', items: shipmentItems });
    }
    return out;
}

// รายการที่ยังจัดส่งไม่ครบ (ค้างจ่ายฝั่งงานจัดซื้อ) — ไว้ตรวจสอบว่าต้องจัดหาของเพิ่มอะไรบ้าง
async function listPendingFulfillment() {
    const all = await listRequisitionsForFulfillment();
    return all.filter(r => r.status !== 'cancelled' && (r.shipStatus === 'not_shipped' || r.shipStatus === 'partially_shipped'));
}

module.exports = {
    listRequisitionsForFulfillment,
    getRequisitionForFulfillment,
    createShipment,
    listShipments,
    listPendingFulfillment
};
