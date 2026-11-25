ALTER TABLE line_users ADD COLUMN friend_status ENUM('unknown','friend','blocked') NOT NULL DEFAULT 'unknown', ADD COLUMN profile_at DATETIME NULL;

-- บันทึกก่อนตอบ 200 ให้ LINE เพราะการส่ง webhook ซ้ำปิดเป็นค่าเริ่มต้น payload เข้ารหัสและล้างเมื่อประมวลผลเสร็จ
CREATE TABLE line_webhook_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_enc MEDIUMTEXT CHARACTER SET ascii COLLATE ascii_bin NULL,
  status ENUM('pending','processing','done','failed') NOT NULL DEFAULT 'pending',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  claim_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  claimed_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uq_webhook_event (event_id),
  KEY ix_webhook_due (status, id),
  KEY ix_webhook_claim (claim_token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE chat_conversations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  line_user_id INT UNSIGNED NOT NULL,
  status ENUM('open','closed') NOT NULL DEFAULT 'open',
  ai_mode ENUM('auto','off') NOT NULL DEFAULT 'auto',
  attention_reason VARCHAR(100) NULL,
  unread_count INT UNSIGNED NOT NULL DEFAULT 0,
  message_count INT UNSIGNED NOT NULL DEFAULT 0,
  assigned_admin_id INT UNSIGNED NULL,
  preview_enc VARCHAR(1000) CHARACTER SET ascii COLLATE ascii_bin NULL,
  last_sender ENUM('user','admin','ai','system') NULL,
  last_message_at DATETIME(3) NULL,
  reply_token VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL,
  reply_token_at DATETIME(3) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_chat_line (line_user_id),
  KEY ix_chat_list (status, last_message_at),
  CONSTRAINT fk_chat_line FOREIGN KEY (line_user_id) REFERENCES line_users (id),
  CONSTRAINT fk_chat_admin FOREIGN KEY (assigned_admin_id) REFERENCES admin_users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- เนื้อหาเข้ารหัส เพราะผู้ใช้มักพิมพ์เลขบัตรหรือเบอร์โทรมาในแชต
CREATE TABLE chat_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT UNSIGNED NOT NULL,
  direction ENUM('in','out') NOT NULL,
  sender ENUM('user','admin','ai','system') NOT NULL,
  admin_id INT UNSIGNED NULL,
  message_type VARCHAR(20) NOT NULL,
  content_enc MEDIUMTEXT CHARACTER SET ascii COLLATE ascii_bin NULL,
  line_message_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  media_storage_name VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL,
  media_mime VARCHAR(50) NULL,
  status ENUM('received','pending','sent','failed') NOT NULL,
  delivered_via ENUM('reply','push') NULL,
  error_message VARCHAR(200) NULL,
  retry_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ai_state ENUM('working','done') NULL,
  ai_meta_json VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_chat_line_message (line_message_id),
  UNIQUE KEY uq_chat_retry (retry_key),
  KEY ix_chat_thread (conversation_id, id),
  KEY ix_chat_created (created_at),
  CONSTRAINT fk_msg_conversation FOREIGN KEY (conversation_id) REFERENCES chat_conversations (id),
  CONSTRAINT fk_msg_admin FOREIGN KEY (admin_id) REFERENCES admin_users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE purge_log MODIFY kind ENUM('documents','applications','rejected','withdrawn','line_users','logs','chats') NOT NULL;
