# ฐานข้อมูล

Migration อยู่ที่ `backend/database/migrations` รันด้วย `npm run db:migrate` ไฟล์ที่ใช้แล้วห้ามแก้ (มี checksum) ให้เพิ่มไฟล์ใหม่
เวลาเก็บเป็น UTC ทุกตาราง แสดงผลเป็น Asia/Bangkok

| กลุ่ม | ตาราง |
|---|---|
| อบรม | universities, courses, training_sessions, lookup_options |
| สมัคร | applicants, applications, application_documents, application_status_history, consents |
| LINE | line_users, line_account_links, line_login_states, applicant_sessions |
| เจ้าหน้าที่ | admin_users, roles, permissions, role_permissions, admin_sessions, admin_audit_logs, auth_attempts |
| ระบบ | domain_events, legal_versions, notification_queue, notification_logs, notification_templates, notification_campaigns, admin_notification_prefs, admin_line_codes, chat_conversations, chat_messages, line_webhook_events, data_requests, purge_log, purge_files, email_queue, ai_knowledge, system_settings, job_locks, schema_migrations |

ข้อบังคับหลัก: `uq_applications_person_session` (1 คน 1 รุ่น เว้นใบที่ยกเลิก/ไม่ผ่าน), `uq_applications_idem` (กันส่งซ้ำ), `uq_link_line`/`uq_link_applicant` (1 LINE ↔ 1 คน), ที่นั่งนับหลังล็อกแถวรุ่น

## สถานะใบสมัคร
`submitted → under_review → documents_approved → approved → awaiting_training → attended → passed → certified`
แยกไป `documents_incomplete` (ผู้สมัครส่งใหม่ครบแล้วกลับ `under_review` เอง), `rejected`, `cancelled`
`attended/passed/certified` เจ้าหน้าที่กดเองไม่ได้ มาจากระบบเช็กชื่อ/ใบประกาศในรอบ 4

ทดสอบบน MySQL 8.4 แล้ว **ยังไม่ได้ทดสอบบน MariaDB** (เขียนให้เลี่ยง syntax เฉพาะเจ้า ต้องใช้ 10.2 ขึ้นไป)
