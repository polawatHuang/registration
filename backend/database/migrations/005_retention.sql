ALTER TABLE applications ADD COLUMN hold_reason VARCHAR(500) NULL, ADD COLUMN hold_by INT UNSIGNED NULL, ADD COLUMN hold_at DATETIME NULL;
ALTER TABLE application_documents MODIFY storage_name VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL, ADD COLUMN file_purged_at DATETIME NULL;

-- อีเมลแจ้งผลการลบต้องส่งได้แม้ใบสมัครถูกลบไปแล้ว ที่อยู่เข้ารหัสและล้างหลังส่งสำเร็จ
ALTER TABLE email_queue MODIFY application_id INT UNSIGNED NULL, ADD COLUMN recipient_enc VARCHAR(600) CHARACTER SET ascii COLLATE ascii_bin NULL, ADD COLUMN payload_json TEXT NULL;

-- ไม่มี FK ไปใบสมัคร: เก็บเป็นหลักฐานการใช้สิทธิหลังลบแล้ว โดยไม่มีชื่อหรือเลขใบสมัคร
CREATE TABLE data_requests (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_code VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  application_id INT UNSIGNED NULL,
  note VARCHAR(500) NULL,
  status ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  decision_reason VARCHAR(500) NULL,
  decided_by INT UNSIGNED NULL,
  decided_at DATETIME NULL,
  due_at DATETIME NOT NULL,
  email_id BIGINT UNSIGNED NULL,
  notified_at DATETIME NULL,
  pending_key INT UNSIGNED AS (CASE WHEN status = 'pending' THEN application_id ELSE NULL END) STORED,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uq_request_code (request_code),
  UNIQUE KEY uq_request_pending (pending_key),
  KEY ix_request_status (status, due_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ref เป็น HMAC ใช้จับคู่เพื่อลบซ้ำหลังกู้คืนข้อมูลสำรองเท่านั้น
CREATE TABLE purge_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  kind ENUM('documents','applications','rejected','withdrawn','line_users','logs') NOT NULL,
  reason ENUM('retention','request','withdrawal','restore') NOT NULL,
  ref CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  session_id INT UNSIGNED NULL,
  final_status VARCHAR(30) NULL,
  item_count INT UNSIGNED NOT NULL DEFAULT 1,
  approved_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL,
  KEY ix_purge_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ไฟล์ที่ต้องลบ: บันทึกใน transaction เดียวกับการลบข้อมูล แล้วลบไฟล์จนสำเร็จ
CREATE TABLE purge_files (
  storage_name VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
