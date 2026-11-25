-- คำถามตัดข้อมูลส่วนบุคคลแล้วและเข้ารหัส ลบตามระยะเวลาเก็บแชต
CREATE TABLE ai_interactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  conversation_id BIGINT UNSIGNED NULL,
  channel ENUM('line','suggest','test') NOT NULL,
  mode VARCHAR(20) NOT NULL,
  intent VARCHAR(60) NULL,
  question_enc TEXT NOT NULL,
  sources_json VARCHAR(1000) NULL,
  model VARCHAR(80) NULL,
  tokens_in INT UNSIGNED NULL,
  tokens_out INT UNSIGNED NULL,
  tokens_total INT UNSIGNED NOT NULL DEFAULT 0,
  response_ms INT UNSIGNED NOT NULL DEFAULT 0,
  resolved_at DATETIME NULL,
  resolved_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL,
  KEY ix_ai_created (created_at),
  KEY ix_ai_open (mode, resolved_at, created_at),
  KEY ix_ai_conv (conversation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
