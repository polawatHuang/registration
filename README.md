# LINE SMART TRAINING — ระบบรับสมัครอบรม E-Training

Node.js 22 + Express 5 + MySQL 8 · Frontend เป็น HTML/CSS/Vanilla JS ล้วน ไม่ต้อง build

| ส่วน | ใช้งานได้แล้ว |
|---|---|
| ผู้สมัคร | ฟอร์ม 19 ข้อ, ติดตามสถานะ, แก้เอกสาร, LINE Login/LIFF, พื้นที่ของฉัน (QR กำหนดการ ใบประกาศ ประวัติ), คำขอลบข้อมูล |
| เช็กชื่อ | สแกน QR บนมือถือ, เช็กอิน/เอาต์, เช็กเอง, เกณฑ์ผ่านรายรุ่น, ประกาศผล, Excel, ประวัติสแกน |
| ใบประกาศ | ออกแบบด้วยการลาก, PDF ภาษาไทย, เลขเรียง, QR ตรวจสอบ, เพิกถอน, แจ้งทาง LINE |
| LINE OA | Rich Menu 6 ปุ่ม, ต้อนรับ, รวมแชต, AI (MiniMax), แจ้งเตือน/ส่งกลุ่ม, อีเมลแทนเมื่อไม่เชื่อม LINE |
| AI | คลังความรู้, รายงานคำถามที่ตอบไม่ได้, ค่าใช้จ่าย, เพดาน token, ตั้งค่า |
| ดูแลระบบ | Dashboard, ตรวจเอกสาร, หลักสูตร/รุ่น, ผู้ใช้/RBAC, Audit, PDPA, สำรอง/กู้คืนเข้ารหัส, ตัวตั้งเวลาในแอป |

## ลองบนเครื่อง (ไม่ต้องติดตั้ง MySQL)
```bash
npm install
```
```bash
npm run dev:local
```
เปิด http://localhost:3000 และ /admin/login.html (บัญชีทดสอบอยู่ใน `.local/dev-admin.txt`) ข้อมูลและ LINE เป็นของจำลอง หายเมื่อปิด

## ทดสอบ
```bash
npm test
```
```bash
npm run test:load
```

## เอกสาร
[สถาปัตยกรรม](docs/architecture.md) · [ฐานข้อมูล](docs/database.md) · [API](docs/api-documentation.md) · [User journey](docs/user-journey.md) · [ติดตั้งบน Plesk](docs/deployment.md) · [ตั้งค่า LINE](docs/line-setup.md) · [แจ้งเตือน](docs/notifications.md) · [รวมแชต](docs/chat.md) · [AI และคลังความรู้](docs/ai-setup.md) · [การลบข้อมูล](docs/data-retention.md) · [คู่มือผู้ใช้](docs/user-manual.md) · [รายการตรวจเครื่องจริง](docs/device-checklist.md) · [รายงานทดสอบ](docs/test-report.md)
