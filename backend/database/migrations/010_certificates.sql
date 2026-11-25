-- แบบที่ใช้ออกใบแล้วแก้ไม่ได้ การแก้สร้างแถวใหม่ ใบที่ออกไปแล้วจึงหน้าตาเดิมเสมอ
CREATE TABLE certificate_templates (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  course_id INT UNSIGNED NULL,
  storage_name VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL,
  mime_type VARCHAR(50) NULL,
  layout_json TEXT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_ctpl_course (course_id, is_active),
  CONSTRAINT fk_ctpl_course FOREIGN KEY (course_id) REFERENCES courses (id),
  CONSTRAINT fk_ctpl_admin FOREIGN KEY (created_by) REFERENCES admin_users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE certificate_counters (
  prefix VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  year SMALLINT UNSIGNED NOT NULL,
  last_no INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (prefix, year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- เมื่อลบข้อมูลบุคคล application_id และ holder_name เป็น NULL เหลือเพียงหลักฐานว่าเลขนี้ออกจริง
CREATE TABLE certificates (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  certificate_no VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  verify_code CHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  application_id INT UNSIGNED NULL,
  holder_name VARCHAR(200) NULL,
  course_name VARCHAR(255) NOT NULL,
  university_name VARCHAR(200) NOT NULL,
  session_name VARCHAR(150) NOT NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  template_id INT UNSIGNED NULL,
  status ENUM('valid','revoked') NOT NULL DEFAULT 'valid',
  revoke_reason VARCHAR(500) NULL,
  revoked_at DATETIME NULL,
  revoked_by INT UNSIGNED NULL,
  issued_at DATETIME NOT NULL,
  issued_by INT UNSIGNED NULL,
  valid_flag TINYINT AS (CASE WHEN status = 'valid' THEN 1 ELSE NULL END) STORED,
  UNIQUE KEY uq_cert_no (certificate_no),
  UNIQUE KEY uq_cert_code (verify_code),
  UNIQUE KEY uq_cert_app (application_id, valid_flag),
  KEY ix_cert_issued (issued_at),
  CONSTRAINT fk_cert_app FOREIGN KEY (application_id) REFERENCES applications (id),
  CONSTRAINT fk_cert_tpl FOREIGN KEY (template_id) REFERENCES certificate_templates (id),
  CONSTRAINT fk_cert_issuer FOREIGN KEY (issued_by) REFERENCES admin_users (id),
  CONSTRAINT fk_cert_revoker FOREIGN KEY (revoked_by) REFERENCES admin_users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
