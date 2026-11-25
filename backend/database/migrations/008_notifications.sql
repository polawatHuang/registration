-- เหตุการณ์ที่สะสมก่อนมีระบบแจ้งเตือน ต้องไม่ถูกส่งย้อนหลัง
UPDATE domain_events SET processed_at = UTC_TIMESTAMP() WHERE processed_at IS NULL;

ALTER TABLE line_users ADD COLUMN campaign_opt_out TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE admin_users ADD COLUMN line_user_id INT UNSIGNED NULL, ADD UNIQUE KEY uq_admin_line (line_user_id), ADD CONSTRAINT fk_admin_line FOREIGN KEY (line_user_id) REFERENCES line_users (id);

CREATE TABLE admin_line_codes (
  code_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  admin_id INT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL,
  UNIQUE KEY uq_code_admin (admin_id),
  CONSTRAINT fk_code_admin FOREIGN KEY (admin_id) REFERENCES admin_users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE admin_notification_prefs (
  admin_id INT UNSIGNED NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  PRIMARY KEY (admin_id, event_type),
  CONSTRAINT fk_pref_admin FOREIGN KEY (admin_id) REFERENCES admin_users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notification_templates (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  template_key VARCHAR(50) NOT NULL,
  title VARCHAR(100) NOT NULL,
  message_type VARCHAR(20) NOT NULL DEFAULT 'flex',
  content_json TEXT NOT NULL,
  is_custom TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  updated_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_template_key (template_key),
  CONSTRAINT fk_template_admin FOREIGN KEY (updated_by) REFERENCES admin_users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notification_campaigns (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(100) NOT NULL,
  content_json TEXT NOT NULL,
  filter_json TEXT NOT NULL,
  recipient_count INT UNSIGNED NOT NULL,
  scheduled_at DATETIME NOT NULL,
  status ENUM('active','cancelled') NOT NULL DEFAULT 'active',
  client_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uq_campaign_client (client_key),
  CONSTRAINT fk_campaign_admin FOREIGN KEY (created_by) REFERENCES admin_users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ไม่เก็บเนื้อหาส่วนบุคคล: ข้อความสร้างจากข้อมูลล่าสุดตอนส่งจริง
CREATE TABLE notification_queue (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  line_user_id INT UNSIGNED NULL,
  application_id INT UNSIGNED NULL,
  admin_id INT UNSIGNED NULL,
  campaign_id INT UNSIGNED NULL,
  notification_type VARCHAR(50) NOT NULL,
  payload_json VARCHAR(500) NULL,
  item_count INT UNSIGNED NOT NULL DEFAULT 1,
  scheduled_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  next_attempt_at DATETIME NOT NULL,
  sent_at DATETIME NULL,
  status ENUM('pending','processing','sent','failed','cancelled') NOT NULL DEFAULT 'pending',
  retry_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_message VARCHAR(200) NULL,
  idempotency_key VARCHAR(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  retry_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  claim_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  claimed_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uq_notify_idem (idempotency_key),
  KEY ix_notify_due (status, next_attempt_at),
  KEY ix_notify_claim (claim_token),
  KEY ix_notify_app (application_id),
  KEY ix_notify_campaign (campaign_id, status),
  CONSTRAINT fk_notify_line FOREIGN KEY (line_user_id) REFERENCES line_users (id),
  CONSTRAINT fk_notify_app FOREIGN KEY (application_id) REFERENCES applications (id),
  CONSTRAINT fk_notify_admin FOREIGN KEY (admin_id) REFERENCES admin_users (id),
  CONSTRAINT fk_notify_campaign FOREIGN KEY (campaign_id) REFERENCES notification_campaigns (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notification_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  queue_id BIGINT UNSIGNED NOT NULL,
  request_payload VARCHAR(300) NULL,
  response_payload VARCHAR(1000) NULL,
  status VARCHAR(20) NOT NULL,
  error_code VARCHAR(20) NULL,
  created_at DATETIME NOT NULL,
  KEY ix_nlog_queue (queue_id, id),
  CONSTRAINT fk_nlog_queue FOREIGN KEY (queue_id) REFERENCES notification_queue (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
