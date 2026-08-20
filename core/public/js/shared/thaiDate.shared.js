/**
 * thaiDate.shared.js — แสดง/เลือกวันที่แบบไทย (พ.ศ., dd/mm/yyyy) ทั่วทั้งระบบ
 * input ที่ผูกไว้เป็น type="text" readonly — ค่าจริง (ISO ค.ศ.) เก็บใน input.dataset.iso
 * อ่าน/เขียนผ่าน getDateValue()/setDateValue() เท่านั้น — ห้ามยุ่งกับ .value ตรงๆ
 */

const THAI_MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const THAI_DOW = ['อา','จ','อ','พ','พฤ','ศ','ส'];

function pad2(n) { return String(n).padStart(2, '0'); }
function isoToParts(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) } : null;
}
function partsToIso(y, mo, d) { return `${y}-${pad2(mo)}-${pad2(d)}`; }
function isoToThaiDisplay(iso) {
    const p = isoToParts(iso);
    return p ? `${pad2(p.d)}/${pad2(p.mo)}/${p.y + 543}` : '';
}
function getDateValue(input) { return input?.dataset.iso || ''; }
function setDateValue(input, iso) {
    if (!input) return;
    if (!iso) { input.value = ''; input.dataset.iso = ''; return; }
    input.dataset.iso = iso;
    input.value = isoToThaiDisplay(iso);
}
function daysInMonth(y, mo) { return new Date(y, mo, 0).getDate(); }

let activePopup = null;
function closeActivePopup() { if (activePopup) { activePopup.remove(); activePopup = null; } }
document.addEventListener('click', (e) => {
    if (activePopup && !activePopup.contains(e.target) && !e.target.classList.contains('thai-date-input')) closeActivePopup();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeActivePopup(); });

function buildCalendarPopup(input, opts) {
    closeActivePopup();
    const t = new Date();
    const today = { y: t.getFullYear(), mo: t.getMonth() + 1, d: t.getDate() };
    const current = isoToParts(getDateValue(input)) || today;
    let viewY = current.y, viewMo = current.mo;

    const popup = document.createElement('div');
    popup.className = 'thai-datepicker-popup';

    function render() {
        popup.innerHTML = '';
        const header = document.createElement('div');
        header.className = 'thai-datepicker-header';
        const monthSel = document.createElement('select');
        THAI_MONTHS.forEach((name, idx) => {
            const o = document.createElement('option');
            o.value = idx + 1; o.textContent = name;
            if (idx + 1 === viewMo) o.selected = true;
            monthSel.appendChild(o);
        });
        monthSel.onchange = () => { viewMo = Number(monthSel.value); render(); };
        const yearSel = document.createElement('select');
        const minY = (opts && opts.minYear) || today.y - 15;
        const maxY = (opts && opts.maxYear) || today.y + 5;
        for (let y = maxY; y >= minY; y--) {
            const o = document.createElement('option');
            o.value = y; o.textContent = y + 543;
            if (y === viewY) o.selected = true;
            yearSel.appendChild(o);
        }
        yearSel.onchange = () => { viewY = Number(yearSel.value); render(); };
        header.append(monthSel, yearSel);
        popup.appendChild(header);

        const grid = document.createElement('div');
        grid.className = 'thai-datepicker-grid';
        THAI_DOW.forEach(d => { const s = document.createElement('span'); s.className = 'thai-datepicker-dow'; s.textContent = d; grid.appendChild(s); });
        const firstDow = new Date(viewY, viewMo - 1, 1).getDay();
        for (let i = 0; i < firstDow; i++) grid.appendChild(document.createElement('span'));
        const selectedIso = getDateValue(input);
        for (let d = 1; d <= daysInMonth(viewY, viewMo); d++) {
            const iso = partsToIso(viewY, viewMo, d);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'thai-datepicker-day' + (iso === selectedIso ? ' selected' : '');
            btn.textContent = d;
            btn.onclick = () => { setDateValue(input, iso); closeActivePopup(); input.dispatchEvent(new Event('change')); };
            grid.appendChild(btn);
        }
        popup.appendChild(grid);

        const footer = document.createElement('div');
        footer.className = 'thai-datepicker-footer';
        const todayBtn = document.createElement('button');
        todayBtn.type = 'button'; todayBtn.className = 'btn-outline btn-sm'; todayBtn.textContent = 'วันนี้';
        todayBtn.onclick = () => { setDateValue(input, partsToIso(today.y, today.mo, today.d)); closeActivePopup(); input.dispatchEvent(new Event('change')); };
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button'; clearBtn.className = 'btn-outline btn-sm'; clearBtn.textContent = 'ล้างค่า';
        clearBtn.onclick = () => { setDateValue(input, ''); closeActivePopup(); input.dispatchEvent(new Event('change')); };
        footer.append(todayBtn, clearBtn);
        popup.appendChild(footer);
    }

    render();
    document.body.appendChild(popup);
    activePopup = popup;
    const rect = input.getBoundingClientRect();
    popup.style.position = 'absolute';
    popup.style.top = `${window.scrollY + rect.bottom + 4}px`;
    popup.style.left = `${window.scrollX + rect.left}px`;
}

function initThaiDatePicker(input, opts) {
    if (!input || input.dataset.thaiDatepickerBound) return;
    input.dataset.thaiDatepickerBound = 'true';
    input.classList.add('thai-date-input');
    input.setAttribute('readonly', 'readonly');
    input.setAttribute('autocomplete', 'off');
    if (!input.placeholder) input.placeholder = 'วว/ดด/ปปปป';
    input.addEventListener('click', (e) => { e.stopPropagation(); buildCalendarPopup(input, opts); });
}

// ใช้แสดงผลวันที่ ISO ที่ได้จาก backend เป็น dd/mm/yyyy พ.ศ. แบบอ่านอย่างเดียว (ไม่ผูก picker)
function formatDateDisplay(iso) {
    if (!iso) return '';
    const datePart = String(iso).slice(0, 10);
    const disp = isoToThaiDisplay(datePart);
    return disp || iso;
}
