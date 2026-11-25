-- ค่าใช้จ่ายโดยประมาณ ณ เวลาที่เรียก ราคาเปลี่ยนภายหลังไม่กระทบยอดเก่า
ALTER TABLE ai_interactions ADD COLUMN cost DECIMAL(14,8) NULL;

-- balance = ยอดจริงที่อ่านจากหน้า MiniMax (ตั้งต้นใหม่), topup = เติมเพิ่มจากยอดเดิม
CREATE TABLE ai_credit_entries (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  kind ENUM('balance','topup') NOT NULL,
  amount DECIMAL(12,4) NOT NULL,
  note VARCHAR(200) NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL,
  KEY ix_credit_created (created_at),
  CONSTRAINT fk_credit_admin FOREIGN KEY (created_by) REFERENCES admin_users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
