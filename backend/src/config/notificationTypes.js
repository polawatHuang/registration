/** ข้อความเริ่มต้น แก้ได้จาก Admin; status = สถานะที่ต้องยังเป็นอยู่ตอนส่ง มิฉะนั้นข้อความล้าสมัยและถูกยกเลิก */
export const VARIABLES = { name: 'ชื่อผู้สมัคร', application_no: 'เลขที่ใบสมัคร', course: 'หลักสูตร', university: 'มหาวิทยาลัย', session: 'รุ่น', date: 'วันอบรม', time: 'เวลาเริ่ม', location: 'สถานที่', status: 'สถานะล่าสุด', reason: 'เหตุผล' };
const track = { label: 'ดูรายละเอียด', path: '/tracking.html' };
export const APPLICANT_TYPES = {
  linked: { title: 'เชื่อมบัญชี LINE สำเร็จ', tone: 'green', heading: 'เชื่อมบัญชีเรียบร้อย 🔗', body: 'สวัสดีคุณ{{name}} ใบสมัคร {{application_no}} เชื่อมกับ LINE นี้แล้ว จะได้รับแจ้งทุกความคืบหน้าที่นี่', button: { label: 'เปิดพื้นที่ของฉัน', path: '/me.html' } },
  submitted: { title: 'สมัครสำเร็จ', tone: 'green', heading: 'เมล็ดของคุณลงดินแล้ว 🌱', body: 'สวัสดีคุณ{{name}} เราได้รับใบสมัคร {{application_no}} แล้ว เจ้าหน้าที่จะตรวจเอกสารต่อจากนี้', button: track },
  documents_received: { title: 'ได้รับเอกสารใหม่', tone: 'purple', heading: 'ได้รับเอกสารแล้ว', body: 'คุณ{{name}} เราได้รับเอกสารที่ส่งใหม่แล้ว กำลังตรวจให้อีกครั้ง', button: track },
  documents_incomplete: { title: 'เอกสารไม่ครบ', tone: 'orange', status: 'documents_incomplete', heading: 'ต้นกล้าต้องการน้ำอีกนิด 💧', body: 'คุณ{{name}} มีเอกสารที่ต้องแก้ไข\n{{reason}}', button: { label: 'ส่งเอกสารใหม่', path: '/tracking.html' } },
  documents_approved: { title: 'เอกสารผ่าน', tone: 'green', status: 'documents_approved', heading: 'เอกสารผ่านแล้ว 🌿', body: 'คุณ{{name}} เอกสารครบถ้วน รออนุมัติการสมัครเป็นขั้นสุดท้าย', button: track },
  approved: { title: 'อนุมัติการสมัคร', tone: 'green', status: 'approved', heading: 'คุณได้รับการอนุมัติ 🎉', body: 'ยินดีด้วยคุณ{{name}} พบกันวันที่ {{date}} เวลา {{time}} น. {{location}}', button: track },
  rejected: { title: 'ไม่ผ่านการอนุมัติ', tone: 'grey', status: 'rejected', heading: 'ผลการพิจารณาใบสมัคร', body: 'คุณ{{name}} ใบสมัครนี้ไม่ผ่านการอนุมัติ\n{{reason}}', button: track },
  cancelled: { title: 'ยกเลิกใบสมัคร', tone: 'grey', status: 'cancelled', heading: 'ใบสมัครถูกยกเลิก', body: 'คุณ{{name}} ใบสมัคร {{application_no}} ถูกยกเลิก\n{{reason}}', button: track },
  reminder_day: { title: 'เตือนก่อนวันอบรม', tone: 'purple', heading: 'ใกล้วันเก็บเกี่ยวแล้ว 🌾', body: 'คุณ{{name}} มีอบรมวันที่ {{date}} เวลา {{time}} น.\n{{location}}', button: track },
  reminder_hour: { title: 'เตือนก่อนเริ่มอบรม', tone: 'orange', heading: 'อีกไม่นานจะเริ่มอบรม ⏰', body: 'คุณ{{name}} เริ่มเวลา {{time}} น. {{location}}', button: track },
  evaluation: { title: 'ส่งแบบประเมิน', tone: 'purple', heading: 'ขอเสียงของคุณหน่อย 💬', body: 'ขอบคุณคุณ{{name}}ที่เข้าอบรม {{session}} ช่วยประเมินเพื่อให้เราพัฒนาต่อ', button: { label: 'ทำแบบประเมิน', path: 'evaluation' } },
  passed: { title: 'ผ่านการอบรม', tone: 'green', status: 'passed', heading: 'คุณผ่านการอบรม 🏆', body: 'ยินดีด้วยคุณ{{name}} กำลังจัดทำใบประกาศนียบัตร', button: track },
  certified: { title: 'ออกใบประกาศแล้ว', tone: 'green', status: 'certified', heading: 'ดอกไม้บานแล้ว 🌸', body: 'คุณ{{name}} ใบประกาศนียบัตรของคุณพร้อมแล้ว', button: { label: 'ดูใบประกาศ', path: '/me.html?view=certificates' } },
};
export const STATUS_TO_TYPE = Object.fromEntries(Object.entries(APPLICANT_TYPES).filter(([, t]) => t.status).map(([k, t]) => [t.status, k]));
/** แจ้งเจ้าหน้าที่: ส่งเฉพาะผู้ที่ยังมีสิทธิ์เกี่ยวข้อง และรวมเหตุการณ์ในช่วง window วินาทีเป็นข้อความเดียว */
export const ADMIN_EVENTS = {
  new_applicant: { title: 'ผู้สมัครใหม่', permission: 'applicants.view', text: 'มีผู้สมัครใหม่ {{count}} คน', path: '/admin/applications.html' },
  documents_received: { title: 'ส่งเอกสารใหม่', permission: 'applicants.review', text: 'มีการส่งเอกสารแก้ไข {{count}} ใบ', path: '/admin/applications.html?status=under_review' },
  help_requested: { window: 60, title: 'ขอคุยกับเจ้าหน้าที่', permission: 'chat.reply', text: 'มีลูกค้าขอคุยกับเจ้าหน้าที่ {{count}} คน', path: '/admin/chat.html' },
  ai_unanswered: { title: 'AI ตอบไม่ได้', permission: 'chat.reply', text: 'AI ตอบไม่ได้ {{count}} ครั้ง', path: '/admin/chat.html' },
  send_failed: { title: 'ส่งแจ้งเตือนไม่สำเร็จ', permission: 'notifications.manage', text: 'ส่งข้อความไม่สำเร็จ {{count}} รายการ', path: '/admin/notifications.html' },
  privacy_request: { title: 'คำขอลบ/ถอนความยินยอม', permission: 'retention.manage', text: 'มีคำขอใช้สิทธิ PDPA {{count}} รายการ', path: '/admin/retention.html' },
};
