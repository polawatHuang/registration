ALTER TABLE consents ADD COLUMN withdrawn_at DATETIME NULL;

-- หลักฐานว่าแต่ละรุ่นของประกาศมีข้อความตัวแปรใด ใช้คู่กับ git ของ privacy.html/policy.html
CREATE TABLE legal_versions (
  version VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  fields_json TEXT NOT NULL,
  published_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_legal_admin FOREIGN KEY (published_by) REFERENCES admin_users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
