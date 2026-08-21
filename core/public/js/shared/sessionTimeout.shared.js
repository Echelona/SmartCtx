/**
 * sessionTimeout.shared.js — แจ้งเตือนก่อน session หมดอายุจาก idle timeout
 * ทำงานร่วมกับ session cookie ที่ตั้ง maxAge ไว้ที่ server.js (rolling, 5 นาที)
 *
 * พฤติกรรม: ไม่มีการใช้งาน (mouse/keyboard/touch) ครบ 4.5 นาที (270 วิ) จะเด้ง popup
 * นับถอยหลัง 30 วิ ถ้าไม่กดต่ออายุก่อนครบ จะ logout อัตโนมัติแล้วพากลับหน้า login ของโมดูลนั้น
 *
 * แต่ละหน้าที่ใช้สคริปต์นี้ต้องประกาศตัวแปรนี้ไว้ก่อนโหลดสคริปต์:
 *   <script>window.SMARTCTX_MODULE = 'procurement';</script>
 *   <script src="/core/js/shared/sessionTimeout.shared.js"></script>
 * สคริปต์จะเรียก logout ที่ /modules/<module>/api/auth/logout และ redirect ไป
 * /modules/<module>/login.html โดยอัตโนมัติตามชื่อโมดูลที่ประกาศไว้
 */

(function () {
    const IDLE_LIMIT_MS = 5 * 60 * 1000;   // 5 นาที รวม (ต้องตรงกับ cookie maxAge ฝั่ง server)
    const WARNING_LEAD_MS = 30 * 1000;      // เริ่มเตือนเมื่อเหลืออีก 30 วิ
    const moduleKey = window.SMARTCTX_MODULE;

    if (!moduleKey) {
        console.warn('sessionTimeout.shared.js: ไม่พบ window.SMARTCTX_MODULE — ปิดการทำงานของตัวจับเวลา session');
        return;
    }

    const logoutUrl = `/modules/${moduleKey}/api/auth/logout`;
    const loginUrl = `/modules/${moduleKey}/login.html`;

    let lastActivity = Date.now();
    let warningTimer = null;
    let countdownTimer = null;
    let overlayEl = null;

    function resetActivity() {
        lastActivity = Date.now();
        if (overlayEl) return; // popup เปิดอยู่แล้ว ไม่นับ activity จนกว่าจะกดต่ออายุเอง (กันมือเลื่อนเมาส์ผ่านจอโดยไม่ตั้งใจ)
        scheduleWarning();
    }

    function scheduleWarning() {
        clearTimeout(warningTimer);
        const elapsed = Date.now() - lastActivity;
        const remaining = IDLE_LIMIT_MS - WARNING_LEAD_MS - elapsed;
        warningTimer = setTimeout(showWarning, Math.max(remaining, 0));
    }

    function showWarning() {
        if (overlayEl) return;
        let secondsLeft = Math.round(WARNING_LEAD_MS / 1000);

        overlayEl = document.createElement('div');
        overlayEl.className = 'session-timeout-overlay';
        overlayEl.innerHTML = `
            <div class="session-timeout-box">
                <h3>⏳ ระบบใกล้ออกจากระบบอัตโนมัติ</h3>
                <p>ไม่มีการใช้งานเป็นเวลานาน ระบบจะออกจากระบบให้อัตโนมัติเพื่อความปลอดภัย</p>
                <div class="session-timeout-countdown" id="sessionTimeoutCountdown">${secondsLeft}</div>
                <button class="btn-primary" id="sessionTimeoutExtendBtn" style="width:100%;">✅ ยังอยู่ตรงนี้ ต่ออายุการใช้งาน</button>
            </div>
        `;
        document.body.appendChild(overlayEl);

        const countdownEl = overlayEl.querySelector('#sessionTimeoutCountdown');
        countdownTimer = setInterval(() => {
            secondsLeft -= 1;
            if (countdownEl) countdownEl.textContent = secondsLeft;
            if (secondsLeft <= 0) {
                clearInterval(countdownTimer);
                doLogout();
            }
        }, 1000);

        overlayEl.querySelector('#sessionTimeoutExtendBtn').addEventListener('click', extendSession);
    }

    async function extendSession() {
        clearInterval(countdownTimer);
        const btn = overlayEl?.querySelector('#sessionTimeoutExtendBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'กำลังต่ออายุ...'; }

        // ยิง request ไปฝั่ง server เพื่อต่ออายุ session cookie (rolling) — และเช็คผลจริงว่า session
        // ยังไม่หมดอายุไปก่อนหน้านี้ (เช่น แท็บถูก throttle ตอนไม่ได้โฟกัส ทำให้ popup โผล่ช้ากว่า
        // cookie จริงที่หมดอายุไปแล้วฝั่ง server) ไม่ใช่แค่ยิงแล้วเชื่อว่าสำเร็จเฉยๆ
        let authenticated = false;
        try {
            const res = await fetch(`/modules/${moduleKey}/api/auth/status`);
            const data = await res.json();
            authenticated = !!data.authenticated;
        } catch (err) {
            // เน็ตเวิร์กมีปัญหาชั่วคราว — ปล่อยให้ authenticated เป็น false แล้วลองใหม่ด้านล่าง ไม่ถือว่าต่ออายุสำเร็จ
        }

        if (authenticated) {
            if (overlayEl) { overlayEl.remove(); overlayEl = null; }
            lastActivity = Date.now();
            scheduleWarning();
        } else {
            // session ตายไปแล้วจริงๆ ฝั่ง server (หรือเช็คไม่สำเร็จ) — บอกผู้ใช้ตรงๆ แล้วพาไป login
            // แทนที่จะปิด popup แล้วทำเหมือนต่ออายุสำเร็จ ทั้งที่จริงๆ ผู้ใช้กลายเป็น anonymous session ไปแล้ว
            if (overlayEl) {
                overlayEl.querySelector('.session-timeout-box').innerHTML = `
                    <h3>⚠️ Session หมดอายุแล้ว</h3>
                    <p>กรุณาเข้าสู่ระบบใหม่อีกครั้ง</p>
                `;
            }
            doLogout();
        }
    }

    async function doLogout() {
        try { await fetch(logoutUrl, { method: 'POST' }); }
        catch (err) { /* noop — จะ redirect ไป login อยู่ดี */ }
        finally { window.location.href = loginUrl; }
    }

    ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'].forEach(evt => {
        document.addEventListener(evt, resetActivity, { passive: true });
    });

    scheduleWarning();
})();