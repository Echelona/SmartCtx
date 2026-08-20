/**
 * eventBus.util.js — จุดกลางสำหรับแจ้งเหตุการณ์ข้าม module (ใบเบิกใหม่, จัดส่งแล้ว, รับเข้าแล้ว, ฯลฯ)
 * db module ต่างๆ emit เข้ามาที่นี่ (ไม่ต้องรู้จัก socket.io เลย) แล้ว server.js เป็นคนเดียว
 * ที่ผูก event เหล่านี้เข้ากับ io.emit() จริง — แยกชั้นกันไว้ไม่ให้ตรรกะข้อมูลผูกกับ transport
 */

const { EventEmitter } = require('events');

class SmartCtxEventBus extends EventEmitter {}

module.exports = new SmartCtxEventBus();
