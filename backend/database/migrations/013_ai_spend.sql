-- paid_thb = เงินบาทที่จ่ายจริงตอนเติม (ใช้คำนวณอัตราแลกเปลี่ยน), estimate = ยอดที่ระบบประมาณไว้ก่อนกรอกยอดจริง (ไว้เทียบความแม่น)
ALTER TABLE ai_credit_entries ADD COLUMN paid_thb DECIMAL(12,2) NULL, ADD COLUMN estimate DECIMAL(12,4) NULL;
