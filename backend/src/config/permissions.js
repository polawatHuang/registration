export const PERMISSIONS = {
  'applicants.view': 'ดูรายชื่อผู้สมัคร',
  'applicants.review': 'ตรวจเอกสารและเปลี่ยนสถานะ',
  'documents.view': 'เปิดเอกสารและข้อมูลส่วนบุคคลเต็ม',
  'applicants.export': 'ส่งออกข้อมูลผู้สมัคร',
  'chat.reply': 'อ่านและตอบแชต LINE OA เปิด/ปิด AI รายแชต',
  'chat.manage': 'เปิด/ปิด AI Chat Bot ทั้งระบบ',
  'catalog.manage': 'จัดการหลักสูตร รุ่น และมหาวิทยาลัย',
  'ai.manage': 'จัดการคลังความรู้ AI',
  'retention.manage': 'ลบข้อมูลและจัดการคำขอใช้สิทธิ PDPA',
  'users.manage': 'จัดการผู้ใช้',
  'audit.view': 'ดู Audit Logs',
  'settings.manage': 'ตั้งค่าเว็บไซต์',
  'integrations.manage': 'ตั้งค่า API key ของ LINE และ MiniMax',
};
export const ROLES = {
  super_admin: { name: 'Super Admin', permissions: Object.keys(PERMISSIONS) },
  admin: { name: 'Admin', permissions: ['applicants.view', 'applicants.review', 'documents.view', 'applicants.export', 'chat.reply', 'chat.manage', 'catalog.manage', 'ai.manage', 'audit.view', 'settings.manage'] },
  training_staff: { name: 'Training Staff', permissions: ['applicants.view', 'applicants.review', 'documents.view', 'chat.reply'] },
  attendance_staff: { name: 'Attendance Staff', permissions: ['applicants.view'] },
};
