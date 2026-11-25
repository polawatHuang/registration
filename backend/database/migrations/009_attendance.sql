-- เกณฑ์การเข้าอบรมกำหนดรายรุ่น
ALTER TABLE training_sessions ADD COLUMN require_checkout TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN min_minutes INT UNSIGNED NULL, ADD COLUMN min_days INT UNSIGNED NOT NULL DEFAULT 1;

-- QR เก็บเฉพาะเลขสุ่ม ลายเซ็นคำนวณจากกุญแจฝั่ง server; ออกใหม่ = เปลี่ยนเลขสุ่ม ใบเดิมใช้ไม่ได้ทันที
CREATE TABLE attendance_qr (
  application_id INT UNSIGNED PRIMARY KEY,
  nonce CHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  issue_count INT UNSIGNED NOT NULL DEFAULT 1,
  issued_at DATETIME NOT NULL,
  CONSTRAINT fk_aqr_app FOREIGN KEY (application_id) REFERENCES applications (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- หนึ่งแถวต่อคนต่อวัน (วันตามเวลาไทย)
CREATE TABLE attendance_records (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  application_id INT UNSIGNED NOT NULL,
  session_id INT UNSIGNED NOT NULL,
  day DATE NOT NULL,
  check_in_at DATETIME NOT NULL,
  check_in_by INT UNSIGNED NULL,
  check_in_method ENUM('qr','manual') NOT NULL,
  check_out_at DATETIME NULL,
  check_out_by INT UNSIGNED NULL,
  check_out_method ENUM('qr','manual') NULL,
  note VARCHAR(500) NULL,
  UNIQUE KEY uq_att_day (application_id, day),
  KEY ix_att_session (session_id, day),
  CONSTRAINT fk_att_app FOREIGN KEY (application_id) REFERENCES applications (id),
  CONSTRAINT fk_att_session FOREIGN KEY (session_id) REFERENCES training_sessions (id),
  CONSTRAINT fk_att_in FOREIGN KEY (check_in_by) REFERENCES admin_users (id),
  CONSTRAINT fk_att_out FOREIGN KEY (check_out_by) REFERENCES admin_users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- บันทึกทุกการสแกนรวมที่ไม่ผ่าน เพื่อตรวจสอบการทุจริต
CREATE TABLE attendance_scans (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id INT UNSIGNED NOT NULL,
  application_id INT UNSIGNED NULL,
  admin_id INT UNSIGNED NULL,
  action ENUM('in','out') NOT NULL,
  method ENUM('qr','manual') NOT NULL,
  result VARCHAR(20) NOT NULL,
  ip_address VARCHAR(45) NULL,
  created_at DATETIME NOT NULL,
  KEY ix_scan_session (session_id, id),
  KEY ix_scan_app (application_id),
  KEY ix_scan_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
