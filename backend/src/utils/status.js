export const STATUS_LABELS = {
  submitted: 'สมัครสำเร็จ รอตรวจเอกสาร', under_review: 'กำลังตรวจสอบเอกสาร', documents_incomplete: 'เอกสารไม่ครบ/ต้องแก้ไข',
  documents_approved: 'เอกสารผ่านการตรวจสอบ', approved: 'อนุมัติการสมัคร', awaiting_training: 'รอเข้ารับการอบรม', attended: 'เข้าอบรมแล้ว',
  passed: 'ผ่านการอบรม', certified: 'ได้รับใบประกาศนียบัตร', rejected: 'ไม่ผ่านการอนุมัติ', cancelled: 'ยกเลิก',
};
/** ขั้นที่เจ้าหน้าที่เปลี่ยนเองได้ ส่วน attended/passed/certified มาจากระบบเช็กชื่อและใบประกาศ (รอบ 4) */
export const ADMIN_TRANSITIONS = {
  submitted: ['under_review', 'documents_incomplete', 'documents_approved', 'rejected', 'cancelled'],
  under_review: ['documents_incomplete', 'documents_approved', 'rejected', 'cancelled'],
  documents_incomplete: ['rejected', 'cancelled'],
  documents_approved: ['under_review', 'approved', 'rejected', 'cancelled'],
  approved: ['awaiting_training', 'cancelled'],
  awaiting_training: ['cancelled'],
  attended: [], passed: [], certified: [], rejected: [], cancelled: [],
};
export const NEEDS_REASON = ['documents_incomplete', 'rejected', 'cancelled'];
/** สถานะที่เจ้าหน้าที่ตรวจตัวตนจากเอกสารแล้ว */
export const IDENTITY_VERIFIED = ['documents_approved', 'approved', 'awaiting_training', 'attended', 'passed', 'certified'];
export const TIMELINE = ['สมัครสำเร็จ', 'รอตรวจสอบเอกสาร', 'ตรวจสอบเอกสาร', 'ผ่านการตรวจสอบ', 'อนุมัติการสมัคร', 'รอเข้ารับการอบรม', 'เข้าอบรมแล้ว', 'ผ่านการอบรม', 'ได้รับใบประกาศนียบัตร'];
export const TIMELINE_STEP = { submitted: 2, under_review: 3, documents_incomplete: 3, documents_approved: 4, approved: 5, awaiting_training: 6, attended: 7, passed: 8, certified: 9 };
export const DOC_LABELS = { id_card: 'ภาพถ่ายบัตรประจำตัวประชาชน', previous_certificate: 'ภาพถ่ายประกาศนียบัตรเดิม', payment_slip: 'สลิปใบโอนเงินค่าลงทะเบียนอบรม', portrait_photo: 'ภาพถ่ายหน้าตรง สี ขนาด 3 นิ้ว' };
