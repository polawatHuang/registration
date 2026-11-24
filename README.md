# LINE SMART TRAINING — ระบบรับสมัครอบรม E-Training

Node.js 22 + Express 5 + MySQL 8 · Frontend เป็น HTML/CSS/Vanilla JS ล้วน ไม่ต้อง build

| ใช้งานได้แล้ว (รอบ 1) | ยังไม่ได้ทำ |
|---|---|
| ฟอร์มสมัคร 19 ข้อ, ติดตามสถานะ, แก้เอกสาร | รอบ 2: LINE OA webhook, Rich Menu, LIFF |
| LINE Login บนเว็บ, ผูก/ยกเลิกบัญชี | รอบ 3: แจ้งเตือนผ่าน LINE |
| อีเมลยืนยันการสมัคร (คิว + ส่งซ้ำ) | รอบ 4: QR เช็กชื่อ, ใบประกาศ |
| Admin: Dashboard, ตรวจเอกสารจอคู่, รุ่นอบรม, ผู้ใช้/RBAC, Audit | รอบ 5: AI ตอบในแชต LINE, ประวัติสนทนา, ต้นทุน |
| คำขอลบข้อมูลและระบบลบเมื่อครบกำหนด, ประกาศ/เงื่อนไขตาม PDPA | |
| ตั้งค่า API key (LINE, MiniMax, SMTP) และคลังความรู้ AI พร้อมหน้าทดสอบ | รอบ 6: load test, คู่มือผู้ใช้ |

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

## เอกสาร
[สถาปัตยกรรม](docs/architecture.md) · [ฐานข้อมูล](docs/database.md) · [API](docs/api-documentation.md) · [User journey](docs/user-journey.md) · [ติดตั้งบน Plesk](docs/deployment.md) · [ตั้งค่า LINE](docs/line-setup.md) · [AI และคลังความรู้](docs/ai-setup.md) · [การลบข้อมูล](docs/data-retention.md) · [รายงานทดสอบ](docs/test-report.md)
