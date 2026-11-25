# REST API (`/api/v1`)

ตอบเป็น `{success, message, data, meta}` เมื่อผิดพลาด `meta.code` และ `meta.errors[{field,message}]`
คำขอที่ใช้ cookie และไม่ใช่ GET ต้องส่ง `X-CSRF-Token` (จาก `/auth/session` หรือ `/admin/auth/me`)

## สาธารณะ
`GET /health` · `GET /catalog/universities` · `GET /catalog/sessions?universityId=` · `GET /catalog/options` · `GET /catalog/site-info` · `GET /catalog/legal`
`POST /applications` (multipart: ช่องข้อมูล + `id_card`, `previous_certificate`, `payment_slip`, `portrait_photo`, ต้องมี `idempotencyKey` UUID)

## ผู้สมัคร
| | |
|---|---|
| `GET /auth/session`, `POST /auth/logout` | สถานะ session |
| `GET /auth/line/start`, `GET /auth/line/callback` | LINE Login |
| `POST /line/link-account`, `POST /line/unlink-account` | ผูก/ยกเลิก (ต้องล็อกอิน LINE) |
| `POST /applications/access` | ยืนยันด้วยเลขที่ใบสมัคร + เลขบัตร + มือถือ |
| `GET /applications/me/status` | ใบสมัครที่มีสิทธิ์เห็น |
| `POST /applications/me/:id/erasure-request`, `/cancel` | ขอลบข้อมูล/ยกเลิกคำขอ |
| `POST /applications/me/:id/withdraw-consent` | ถอนความยินยอมข้อมูลอ่อนไหว |
| `POST /applications/me/:id/documents` | ส่งเอกสารที่ไม่ผ่านใหม่ |

## เจ้าหน้าที่ (`/admin`)
| Endpoint | สิทธิ์ |
|---|---|
| `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | — |
| `GET /dashboard`, `GET /applications`, `GET /applications/:id` | applicants.view |
| `POST /applications/:id/status`, `/documents/:docId/review`, `/resend-email` | applicants.review |
| `GET /applications/:id/documents/:docId`, `POST /applications/:id/reveal-ids` | documents.view (ลง audit) |
| `GET /applications/export` | applicants.export |
| `GET /catalog`, `POST/PUT/DELETE /catalog/{universities,options,sessions}` | catalog.manage |
| `GET/PUT /settings`, `GET/PUT /legal` | settings.manage |
| `GET/PUT /integrations`, `POST /integrations/test/:target` | integrations.manage (Super Admin, PUT ต้องยืนยันรหัสผ่าน) |
| `GET/POST/PUT /users` | users.manage |
| `GET /retention/{summary,due/:kind,requests,log}`, `POST /retention/purge`, `/retention/requests/:id/{decide,notice}`, `POST /applications/:id/hold` | retention.manage (Super Admin) |
| `GET /audit-logs` | audit.view |

## AI (`/ai`, สิทธิ์ ai.manage)
`GET/POST /knowledge` · `GET/PUT/DELETE /knowledge/:id` · `POST /documents` (อัปโหลด) · `POST /chat` (ทดสอบถาม)

## แชต (`/admin/chat`)
| Endpoint | สิทธิ์ |
|---|---|
| `GET /state`, `GET /poll`, `GET /:id`, `GET /:id/messages` | chat.reply |
| `POST /:id/messages` (text, clientId), `POST /:id/messages/:mid/retry`, `GET …/media` | chat.reply |
| `POST /:id/update` (aiMode, status, assign, readUpTo, attention), `POST /:id/suggest` | chat.reply |
| `PUT /ai` เปิด/ปิด AI ทั้งระบบ | chat.manage |

`POST /line/webhook` ตรวจ `x-line-signature` จาก raw body

## แจ้งเตือน (`/admin/notifications`, สิทธิ์ notifications.manage)
`GET /state` · `PUT /settings` · `GET/POST /templates`, `PUT/DELETE /templates/:key` · `POST /preview`, `/test` · `GET /queue`, `/queue/:id/logs`, `POST /queue/:id` (retry/cancel) · `POST /campaigns/estimate`, `GET/POST /campaigns`, `POST /campaigns/:id/cancel` · `GET /recipients`, `PUT /recipients/:id`
`POST /link-code`, `/unlink` ใช้ได้ทุกคนที่ล็อกอิน (เชื่อม LINE ของตัวเอง)

## เช็กชื่อ (`/admin/attendance`, สิทธิ์ attendance.manage)
`GET /sessions` · `GET /sessions/:id/roster` (filter all/present/absent/ready/failing, q, day) · `GET /sessions/:id/export`, `/scans` · `POST /sessions/:id/scan {token, action: in|out}` · `GET /sessions/:id/people/:appId`, `/portrait` · `POST /sessions/:id/people/:appId {action, at?, note}`
ต้องมี attendance.result: `POST /sessions/:id/announce {ids, override, reason}` · `POST /records/:id/undo {what, reason}`
ผลสแกน: ok · already · not_in · wrong_session · wrong_day · unauthorized · revoked · invalid

## ใบประกาศ (`/admin/certificates`, สิทธิ์ certificates.manage)
`GET /`, `GET /:id/pdf`, `POST /:id/revoke` · `GET /candidates/:sessionId`, `POST /issue {ids}` · `GET/POST /templates`, `PUT|POST|DELETE /templates/:id`, `POST /templates[/:id]/preview` · `PUT /prefix`
สาธารณะ: `GET /certificates/verify/:code` และหน้า `/certificate/verify/:code`

## พื้นที่ผู้สมัครและ LIFF
`POST /auth/liff/session {idToken}` · `GET /applications/me/:id/qr`, `/qr.svg`, `POST /qr/renew` · `GET /applications/me/:id/attendance`, `/certificate.pdf` · `GET /catalog/schedule`

## LINE OA (`/admin/line`, สิทธิ์ notifications.manage)
`GET /state`, `/users` · `POST|DELETE /rich-menu` · `PUT /welcome`

## AI (`/ai`, สิทธิ์ ai.manage)
`GET /report`, `/history` · `POST /report/resolve {ids}` · `PUT /settings`

## หลักสูตร (`/admin/catalog/courses`) `POST`, `PUT|DELETE /:id`

## งานตั้งเวลา
`GET /admin/system` ความพร้อมและสถานะสำรอง (settings.manage) · `POST /admin/system/backup` สำรองทันที (integrations.manage)

`POST /internal/jobs/run` พร้อม header `X-Jobs-Secret` · 200 เมื่อทุกงานสำเร็จ · 500 `JOBS_FAILED` พร้อมชื่องานและรหัสสาเหตุเมื่อมีงานล้ม (งานอื่นยังทำต่อ) · 403 secret ไม่ตรง
