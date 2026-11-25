-- ละเอียดระดับมิลลิวินาที: ภาพบัตรใหม่ที่ส่งในวินาทีเดียวกับการถอนความยินยอมต้องไม่ถูกนับว่าส่งก่อนถอน
ALTER TABLE consents MODIFY withdrawn_at DATETIME(3) NULL;
ALTER TABLE application_documents MODIFY created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);
