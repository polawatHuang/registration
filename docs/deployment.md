# ติดตั้งบน Plesk (Shared Linux, Node.js 22)

## 1. เตรียม
1. สร้างฐานข้อมูลใน Plesk จดชื่อ/ผู้ใช้/รหัสผ่าน และตรวจว่าเป็น MySQL 8 หรือ MariaDB เวอร์ชันใด
2. เปิด SSL (Let's Encrypt) และ redirect เป็น HTTPS
3. นำโค้ดขึ้น (Git หรืออัปโหลด) ไปที่โฟลเดอร์แอป **ไม่ต้อง** อัปโหลด `node_modules`, `.local`

## 2. ตั้งค่า Node.js ใน Plesk
| ช่อง | ค่า |
|---|---|
| Node.js version | 22 |
| Application root | โฟลเดอร์ที่มี `app.cjs` |
| Document root | โฟลเดอร์ย่อย `frontend` |
| Application startup file | `app.cjs` |
| Application mode | production |

กด **NPM install** แล้วสร้าง `.env` ใน Application root จาก `.env.example` กุญแจสร้างด้วย `npm run keys:generate`

> **สำคัญ:** เก็บ `DATA_ENCRYPTION_KEY` และ `DATA_HASH_KEY` สำรองแยกจากฐานข้อมูล ถ้าหาย เลขบัตร เอกสาร และ API key จะถอดรหัสไม่ได้ถาวร ถ้าเปลี่ยน `DATA_HASH_KEY` จะค้นเลขบัตรเดิมไม่เจอ

## 3. สร้างตารางและผู้ดูแล (Run script หรือ SSH)
`db:migrate` (อัปเดตสิทธิ์ให้ด้วย ต้องรันทุกครั้งที่อัปเดตโค้ด) → `knowledge:import` แล้วสร้าง Super Admin:
```bash
ADMIN_PASSWORD='ตั้งรหัสอย่างน้อย12ตัว' npm run admin:create -- ชื่อผู้ใช้ "ชื่อที่แสดง"
```
ถ้าไม่มี SSH ให้ขอผู้ให้บริการรันให้ จากนั้นเปลี่ยนรหัสผ่านที่หน้าผู้ใช้ทันที

## 4. งานตั้งเวลา (จำเป็น: ส่งอีเมลซ้ำ ประมวลผลแชตค้าง และล้าง session)
Scheduled Tasks ทุก 5 นาที:
```bash
curl -fsS -X POST -H "X-Jobs-Secret: ค่าใน.env" https://โดเมน/api/v1/internal/jobs/run
```

## 5. Security headers
nginx ของ Plesk อาจส่งไฟล์ใน `frontend` เองโดยไม่ผ่าน Node ให้เพิ่มใน Additional nginx directives:
```
add_header X-Content-Type-Options nosniff always;
add_header X-Frame-Options SAMEORIGIN always;
add_header Referrer-Policy same-origin always;
client_max_body_size 25m;
```
`client_max_body_size` ต้องรองรับ 4 ไฟล์ × `MAX_UPLOAD_MB`

## 6. ตรวจหลังติดตั้ง
- `https://โดเมน/api/v1/health` ตอบ `ok`
- `/.env`, `/package.json`, `/app.cjs`, `/storage/` **ต้องได้ 403/404**
- Admin > ตั้งค่า ใส่ LINE Login, SMTP, MiniMax แล้วกดทดสอบ
- เพิ่มมหาวิทยาลัย ตัวเลือกระยะเวลาเปิดร้าน และรุ่น (สถานะ "เปิดรับสมัคร") แล้วลองสมัคร 1 ใบ

## กฎหมายก่อนเปิดรับสมัครจริง
1. Admin > ตั้งค่า > กฎหมาย/PDPA กรอกให้ครบ ให้ฝ่ายกฎหมาย/DPO ตรวจ แล้วเผยแพร่
2. ให้ Plesk เก็บ access log ไม่น้อยกว่า 90 วัน หากหน่วยงานเข้าข่ายผู้ให้บริการตามประกาศ พ.ศ. 2564 (ข้อ 12)
3. ทำข้อตกลงประมวลผลข้อมูล (DPA) กับผู้ให้บริการ hosting อีเมล และ AI
4. จัดทำบันทึกรายการกิจกรรม (มาตรา 39) และแผนรับมือเหตุละเมิดภายใน 72 ชั่วโมง
5. แก้ข้อความใน privacy.html หรือ policy.html เมื่อใด ให้เพิ่มเลข TEMPLATE ใน legalService.js

## 7. สำรองและกู้คืน
สำรองทุกวัน 3 ส่วน: ฐานข้อมูล, `STORAGE_PATH`, และกุญแจใน `.env` (เก็บคนละที่)
กู้คืน: restore DB → วางโฟลเดอร์ storage → ใช้กุญแจชุดเดิม → วาง `purge-ledger.jsonl` ฉบับล่าสุด → `db:migrate` → **`retention:reapply`** ([เหตุผล](data-retention.md)) → ตรวจ health และเปิดเอกสารเก่า 1 ฉบับ ซ้อมอย่างน้อยไตรมาสละครั้ง
