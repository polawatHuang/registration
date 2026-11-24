CREATE TABLE universities (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_universities_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE courses (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_courses_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE training_sessions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  course_id INT UNSIGNED NOT NULL,
  university_id INT UNSIGNED NOT NULL,
  session_name VARCHAR(150) NOT NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  location VARCHAR(255) NULL,
  map_url VARCHAR(500) NULL,
  details TEXT NULL,
  capacity INT UNSIGNED NULL,
  registration_opens_at DATETIME NULL,
  registration_closes_at DATETIME NULL,
  status ENUM('draft','open','closed','completed','cancelled') NOT NULL DEFAULT 'draft',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY ix_sessions_lookup (university_id, status, starts_at),
  CONSTRAINT fk_sessions_course FOREIGN KEY (course_id) REFERENCES courses (id),
  CONSTRAINT fk_sessions_university FOREIGN KEY (university_id) REFERENCES universities (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE lookup_options (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  category VARCHAR(50) NOT NULL,
  label VARCHAR(150) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_lookup (category, label)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE line_users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  line_user_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(255) NULL,
  picture_url VARCHAR(1000) NULL,
  status ENUM('active','blocked') NOT NULL DEFAULT 'active',
  linked_at DATETIME NULL,
  last_interaction_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_line_user (line_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE applicants (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(200) NOT NULL,
  national_id_enc VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  national_id_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  deleted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_applicants_nid (national_id_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- active_flag เป็น NULL เมื่อยกเลิกเชื่อมแล้ว: 1 LINE = 1 ผู้สมัคร และ 1 ผู้สมัคร = 1 LINE ในเวลาเดียวกัน
CREATE TABLE line_account_links (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  line_user_id INT UNSIGNED NOT NULL,
  applicant_id INT UNSIGNED NOT NULL,
  link_method ENUM('registration','verification') NOT NULL,
  status ENUM('active','unlinked') NOT NULL DEFAULT 'active',
  active_flag TINYINT AS (CASE WHEN status = 'active' THEN 1 ELSE NULL END) STORED,
  linked_at DATETIME NOT NULL,
  unlinked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_link_line (line_user_id, active_flag),
  UNIQUE KEY uq_link_applicant (applicant_id, active_flag),
  CONSTRAINT fk_links_line FOREIGN KEY (line_user_id) REFERENCES line_users (id),
  CONSTRAINT fk_links_applicant FOREIGN KEY (applicant_id) REFERENCES applicants (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- applications เก็บ snapshot ณ วันสมัคร: การสมัครครั้งใหม่ไม่ทับข้อมูลเดิมของบุคคล
CREATE TABLE applications (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  application_no VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  applicant_id INT UNSIGNED NOT NULL,
  session_id INT UNSIGNED NOT NULL,
  line_user_id INT UNSIGNED NULL,
  idempotency_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  full_name VARCHAR(200) NOT NULL,
  address VARCHAR(500) NOT NULL,
  mobile VARCHAR(15) NOT NULL,
  line_contact_id VARCHAR(100) NULL,
  email VARCHAR(200) NOT NULL,
  shop_name VARCHAR(200) NOT NULL,
  shop_address VARCHAR(500) NOT NULL,
  shop_duration_option_id INT UNSIGNED NOT NULL,
  has_trained_before TINYINT(1) NOT NULL,
  receipt_name VARCHAR(200) NOT NULL,
  receipt_address VARCHAR(500) NOT NULL,
  tax_id_enc VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status ENUM('submitted','under_review','documents_incomplete','documents_approved','approved','awaiting_training','attended','passed','certified','rejected','cancelled') NOT NULL DEFAULT 'submitted',
  status_reason VARCHAR(500) NULL,
  active_flag TINYINT AS (CASE WHEN status IN ('rejected','cancelled') THEN NULL ELSE 1 END) STORED,
  submitted_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_applications_no (application_no),
  UNIQUE KEY uq_applications_idem (idempotency_key),
  UNIQUE KEY uq_applications_person_session (applicant_id, session_id, active_flag),
  KEY ix_applications_status (status, submitted_at),
  KEY ix_applications_session (session_id, active_flag),
  KEY ix_applications_submitted (submitted_at),
  KEY ix_applications_line (line_user_id),
  KEY ix_applications_mobile (mobile),
  CONSTRAINT fk_app_applicant FOREIGN KEY (applicant_id) REFERENCES applicants (id),
  CONSTRAINT fk_app_session FOREIGN KEY (session_id) REFERENCES training_sessions (id),
  CONSTRAINT fk_app_line FOREIGN KEY (line_user_id) REFERENCES line_users (id),
  CONSTRAINT fk_app_duration FOREIGN KEY (shop_duration_option_id) REFERENCES lookup_options (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE roles (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  role_key VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  UNIQUE KEY uq_roles (role_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE permissions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  permission_key VARCHAR(50) NOT NULL,
  name VARCHAR(150) NOT NULL,
  UNIQUE KEY uq_permissions (permission_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE role_permissions (
  role_id INT UNSIGNED NOT NULL,
  permission_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles (id),
  CONSTRAINT fk_rp_perm FOREIGN KEY (permission_id) REFERENCES permissions (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE admin_users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(60) NOT NULL,
  password_hash VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(150) NOT NULL,
  role_id INT UNSIGNED NOT NULL,
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_admin_username (username),
  CONSTRAINT fk_admin_role FOREIGN KEY (role_id) REFERENCES roles (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE admin_sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  csrf_token CHAR(43) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  admin_id INT UNSIGNED NOT NULL,
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_admin_session (token_hash),
  KEY ix_admin_session_exp (expires_at),
  CONSTRAINT fk_as_admin FOREIGN KEY (admin_id) REFERENCES admin_users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE application_documents (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  application_id INT UNSIGNED NOT NULL,
  doc_type ENUM('id_card','previous_certificate','payment_slip','portrait_photo') NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  is_current TINYINT(1) NOT NULL DEFAULT 1,
  original_name VARCHAR(255) NOT NULL,
  storage_name VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  mime_type VARCHAR(50) NOT NULL,
  size_bytes INT UNSIGNED NOT NULL,
  sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  review_status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  review_reason VARCHAR(500) NULL,
  reviewed_by INT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_doc_version (application_id, doc_type, version),
  UNIQUE KEY uq_doc_storage (storage_name),
  CONSTRAINT fk_doc_app FOREIGN KEY (application_id) REFERENCES applications (id),
  CONSTRAINT fk_doc_admin FOREIGN KEY (reviewed_by) REFERENCES admin_users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE application_status_history (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  application_id INT UNSIGNED NOT NULL,
  from_status VARCHAR(30) NULL,
  to_status VARCHAR(30) NOT NULL,
  reason VARCHAR(500) NULL,
  actor_type ENUM('applicant','admin','system') NOT NULL,
  actor_id INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_history_app (application_id, id),
  CONSTRAINT fk_history_app FOREIGN KEY (application_id) REFERENCES applications (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE consents (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  application_id INT UNSIGNED NOT NULL,
  purpose VARCHAR(50) NOT NULL,
  notice_version VARCHAR(30) NOT NULL,
  ip_address VARCHAR(45) NULL,
  accepted_at DATETIME NOT NULL,
  UNIQUE KEY uq_consent (application_id, purpose),
  CONSTRAINT fk_consent_app FOREIGN KEY (application_id) REFERENCES applications (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- session ของผู้สมัคร: มาจาก LINE Login (line_user_id) หรือยืนยันด้วยเลขที่ใบสมัคร (application_id)
CREATE TABLE applicant_sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  csrf_token CHAR(43) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  line_user_id INT UNSIGNED NULL,
  application_id INT UNSIGNED NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_applicant_session (token_hash),
  KEY ix_applicant_session_exp (expires_at),
  CONSTRAINT fk_aps_line FOREIGN KEY (line_user_id) REFERENCES line_users (id),
  CONSTRAINT fk_aps_app FOREIGN KEY (application_id) REFERENCES applications (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE line_login_states (
  state_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  browser_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  nonce CHAR(43) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  code_verifier CHAR(43) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  return_to VARCHAR(100) NOT NULL,
  expires_at DATETIME NOT NULL,
  KEY ix_login_state_exp (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE auth_attempts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scope VARCHAR(40) NOT NULL,
  key_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_attempts (scope, key_hash, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE admin_audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_type ENUM('admin','applicant','system') NOT NULL DEFAULT 'admin',
  admin_id INT UNSIGNED NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(50) NULL,
  entity_id VARCHAR(50) NULL,
  ip_address VARCHAR(45) NULL,
  metadata_json TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_audit_created (created_at),
  KEY ix_audit_admin (admin_id, created_at),
  KEY ix_audit_action (action, created_at),
  CONSTRAINT fk_audit_admin FOREIGN KEY (admin_id) REFERENCES admin_users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Notification Engine (รอบ 3) อ่านจากตารางนี้ เขียนใน transaction เดียวกับการเปลี่ยนสถานะ
CREATE TABLE domain_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_type VARCHAR(80) NOT NULL,
  aggregate_type VARCHAR(50) NOT NULL,
  aggregate_id INT UNSIGNED NOT NULL,
  payload_json TEXT NULL,
  processed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_events_pending (processed_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE system_settings (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(80) NOT NULL,
  setting_value TEXT NULL,
  is_encrypted TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_settings (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE job_locks (
  job_name VARCHAR(80) PRIMARY KEY,
  locked_until DATETIME NOT NULL,
  last_finished_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
