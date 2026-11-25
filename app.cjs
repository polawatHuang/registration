// จุดเริ่มต้นสำหรับ Plesk/Passenger ซึ่งโหลดไฟล์แบบ CommonJS
// เก็บโค้ดที่คอมไพล์แล้วไว้ใช้รอบหน้า: โฮสต์ปิดแอปเมื่อว่าง การเปิดใหม่จึงต้องเร็ว (ใช้ไม่ได้ก็ทำงานตามปกติ)
try { require('node:module').enableCompileCache(require('node:path').join(__dirname, 'tmp', 'compile-cache')); } catch { /* ไม่มีสิทธิ์เขียน */ }
import('./backend/server.js').catch((err) => {
  console.error(err.message);
  process.exit(1);
});
