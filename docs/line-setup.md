# ตั้งค่า LINE

1. LINE Developers: ให้ **LINE Login** และ **Messaging API อยู่ Provider เดียวกัน** (ย้ายภายหลังไม่ได้) ไม่เช่นนั้น User ID จะไม่ตรงกันและส่งแจ้งเตือนไม่ได้
2. LINE Login > Callback URL: คัดลอกจาก Admin > ตั้งค่า
3. ใส่ Channel ID / secret ที่ Admin > ตั้งค่า > LINE Login แล้วเปลี่ยน channel เป็น Published
4. ต้องการให้ชวนเพิ่มเพื่อน OA ตอนล็อกอิน ให้ผูก OA ที่ LINE Login > Linked LINE Official Account
5. Messaging API: ใส่ Channel secret และ Channel access token ที่ Admin > ตั้งค่า แล้วกดทดสอบ
6. LINE Developers > Messaging API: วาง Webhook URL จากหน้าตั้งค่า กด Verify (ต้องได้ Success) เปิด **Use webhook** และเปิด **Webhook redelivery**
7. LINE Official Account Manager > การตอบกลับ: **ปิด** ข้อความตอบกลับอัตโนมัติและข้อความทักทาย (ระบบนี้ส่งให้แล้ว) ไม่เช่นนั้นลูกค้าจะได้ข้อความซ้ำ
8. LIFF: LINE Login channel > LIFF > Add: Size **Full**, Endpoint URL `https://โดเมน/me.html`, Scope **openid** และ **profile**, Add friend option **On (Normal)** แล้วใส่ LIFF ID ที่ Admin > ตั้งค่า (ต้องขึ้นต้นด้วย LINE Login Channel ID เดียวกัน)
9. Rich Menu: Admin > LINE OA เลือกธีม แล้วกดเผยแพร่ ถ้ายังไม่มี LIFF เมนูจะเปิดเว็บแทน **เปลี่ยน LIFF ID แล้วต้องเผยแพร่เมนูใหม่**
10. Rich Menu ที่สร้างใน LINE Official Account Manager มีลำดับก่อนเมนูจาก API ให้ปิดก่อน
