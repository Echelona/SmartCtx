/**
 * concurrency.util.js — pattern กลางสำหรับป้องกันผู้ใช้หลายคนแก้ไข/ตัดยอดข้อมูลเดียวกันพร้อมกัน
 * (optimistic concurrency control) ใช้ร่วมกันทุกโมดูล (stock-management, procurement, ฯลฯ)
 *
 * ปัญหาที่แก้: โค้ดเดิมหลายจุดทำแบบ "SELECT เช็คเงื่อนไขในโค้ด JS แล้วค่อย UPDATE แยกคำสั่งกัน"
 * (เช่น อ่านยอดคงเหลือ เช็คว่าพอไหมใน if, แล้วค่อยยิง UPDATE) — ระหว่างสองคำสั่งนี้ ผู้ใช้อีกคนสามารถ
 * แทรกมาแก้ข้อมูลเดิมได้พอดี ทำให้การเช็คที่ทำไปก่อนหน้ากลายเป็นเช็คจากข้อมูลเก่าที่ไม่จริงแล้ว
 * (classic check-then-act race condition) ผลคือข้อมูลเพี้ยนแบบเงียบๆ โดยไม่มีใครรู้ตัว
 *
 * วิธีแก้ (pattern กลางที่ใช้ทุกจุด): ฝังเงื่อนไขทางธุรกิจที่ต้องเช็คไว้ใน WHERE ของคำสั่ง UPDATE
 * เดียวจบ แทนที่จะแยก SELECT-เช็ค-UPDATE — เพราะ SQLite รับประกันว่า UPDATE หนึ่งคำสั่งเป็น atomic
 * เสมอ (ไม่มีใครแทรกกลางระหว่างการประเมิน WHERE กับการเขียนค่าได้) แล้วเช็คว่า UPDATE นั้นแก้ไปกี่แถว
 * (changes) — ถ้าเป็น 0 แปลว่าเงื่อนไขไม่ผ่าน ณ เวลาที่เขียนจริง (มีคนอื่นแก้ไปก่อนแล้ว) ให้ปฏิเสธ
 * ทันทีเป็น 409 Conflict บอกผู้ใช้ให้โหลดข้อมูลใหม่แล้วลองอีกครั้ง แทนที่จะเขียนทับข้อมูลของคนอื่น
 *
 * ใช้ได้กับ 3 สถานการณ์หลักในระบบนี้ (ดูตัวอย่างการใช้จริงใน stock.db.js / procurement.db.js):
 *   1) แก้ไขข้อมูล (drug master, lookup options) — เช็คด้วยคอลัมน์ version: WHERE id=? AND version=?
 *   2) เปลี่ยนสถานะ (ยกเลิกใบเบิก) — เช็คด้วยสถานะปัจจุบัน: WHERE id=? AND status='pending'
 *   3) ตัดยอด/จำนวน (จัดส่ง, รับเข้า, ปรับยอดคลัง) — เช็คด้วยยอดคงเหลือจริง ณ เวลานั้น:
 *      WHERE id=? AND (qty_requested - qty_shipped) >= ?
 */

class ConflictError extends Error {
    constructor(message) {
        super(message);
        this.status = 409;
        this.name = 'ConflictError';
    }
}

// รัน UPDATE ที่มีเงื่อนไขป้องกันการชนกันฝังอยู่ใน WHERE ของ sql อยู่แล้ว (ผู้เรียกต้องเขียนเงื่อนไขเอง
// ให้ครบตามสถานการณ์ — ดูตัวอย่าง 3 แบบด้านบน) ถ้าไม่มีแถวไหนถูกแก้เลย (changes === 0) แปลว่าเงื่อนไข
// ไม่ผ่าน ณ เวลาที่เขียนจริง — throw ConflictError ทันทีพร้อมข้อความที่กำหนดเอง ให้ route handler
// (ผ่าน err.status = 409 ที่ ConflictError ตั้งไว้ให้แล้ว) ส่ง HTTP 409 กลับไปแบบเดียวกันทุกจุดในระบบ
async function runGuardedUpdate(dbRun, sql, params, conflictMessage) {
    const result = await dbRun(sql, params);
    if (!result || !result.changes) {
        throw new ConflictError(conflictMessage);
    }
    return result;
}

module.exports = { ConflictError, runGuardedUpdate };
