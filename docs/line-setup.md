# ตั้งค่า LINE

1. LINE Developers: ให้ **LINE Login** และ **Messaging API อยู่ Provider เดียวกัน** (ย้ายภายหลังไม่ได้) ไม่เช่นนั้น User ID จะไม่ตรงกันและส่งแจ้งเตือนไม่ได้
2. LINE Login > Callback URL: คัดลอกจาก Admin > ตั้งค่า
3. ใส่ Channel ID / secret ที่ Admin > ตั้งค่า > LINE Login แล้วเปลี่ยน channel เป็น Published
4. ต้องการให้ชวนเพิ่มเพื่อน OA ตอนล็อกอิน ให้ผูก OA ที่ LINE Login > Linked LINE Official Account
5. Messaging API / LIFF ใส่เตรียมไว้ได้ แต่ webhook จะเปิดในรอบ 2 อย่าเพิ่งตั้ง Webhook URL
