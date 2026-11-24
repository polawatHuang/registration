// จุดเริ่มต้นสำหรับ Plesk/Passenger ซึ่งโหลดไฟล์แบบ CommonJS
import('./backend/server.js').catch((err) => {
  console.error(err.message);
  process.exit(1);
});
