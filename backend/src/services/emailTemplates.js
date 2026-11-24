import { env } from '../config/env.js';
import { maskMobile, maskThaiId } from '../utils/thai.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/** กันข้อความที่ผู้สมัครกรอกกลายเป็นลิงก์ในอีเมล (ใช้เว็บเราส่ง phishing ไม่ได้) */
const plain = (v) => String(v ?? '').replace(/https?:\/\//gi, '').replace(/[.@](?=\S)/g, '$&⁠');
const D = new Intl.DateTimeFormat('th-TH', { dateStyle: 'long', timeZone: 'Asia/Bangkok' });
const T = new Intl.DateTimeFormat('th-TH', { timeStyle: 'short', timeZone: 'Asia/Bangkok' });

export function erasureEmail(done, { code, reason }, site) {
  const contact = [site.contact_phone && `โทร ${site.contact_phone}`, site.contact_email && `อีเมล ${site.contact_email}`].filter(Boolean).join(' · ');
  const lines = done
    ? ['เราลบข้อมูลใบสมัครและเอกสารแนบของท่านออกจากระบบแล้วตามคำขอ', 'วิธีดำเนินการ: ลบข้อมูลและไฟล์ ไม่ใช่การทำให้เป็นข้อมูลนิรนาม', 'สำเนาในข้อมูลสำรองจะถูกเขียนทับตามรอบ และหากมีการกู้คืน ระบบจะลบซ้ำก่อนนำกลับมาใช้', 'ท่านจะเข้าหน้าติดตามสถานะของใบสมัครนี้ไม่ได้อีก']
    : ['เราไม่สามารถลบข้อมูลตามคำขอของท่านได้ในขณะนี้', `เหตุผล: ${plain(reason)}`, 'ท่านมีสิทธิร้องเรียนต่อสำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคล'];
  const font = "font-family:Prompt,'Sukhumvit Set','Leelawadee UI',Tahoma,sans-serif";
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#efe8fb;${font}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" style="max-width:600px;background:#fff;border-radius:24px" cellpadding="0" cellspacing="0"><tr><td bgcolor="#49378a" style="padding:28px;color:#fff;border-radius:24px 24px 0 0;${font}"><div style="font-size:24px;font-weight:700;font-style:italic">E-Training</div><div style="margin-top:12px;font-size:18px">ผลคำขอลบข้อมูล ${esc(code)}</div></td></tr><tr><td style="padding:24px 28px;font-size:15px;line-height:1.7;color:#202124;${font}">${lines.map((l) => `<p style="margin:0 0 12px">${esc(l)}</p>`).join('')}${contact ? `<p style="margin:0;color:#5b5870">${esc(contact)}</p>` : ''}</td></tr></table></td></tr></table></body></html>`;
  return { subject: `ผลคำขอลบข้อมูล ${code} | E-Training`, html, text: [`ผลคำขอลบข้อมูล ${code}`, '', ...lines, contact].join('\n') };
}

export function registrationEmail(row, nationalId, site) {
  const days = D.format(row.starts_at) === D.format(row.ends_at) ? D.format(row.starts_at) : `${D.format(row.starts_at)} – ${D.format(row.ends_at)}`;
  const groups = [
    ['การอบรม', [['หลักสูตร', row.course_name], ['สถานที่จัด', row.university_name], ['รุ่น', row.session_name], ['วันอบรม', `${days} เวลา ${T.format(row.starts_at)} น.`], ['ห้อง/สถานที่', row.location]]],
    ['ผู้สมัคร', [['ชื่อ-นามสกุล', plain(row.full_name)], ['เลขประจำตัวประชาชน', maskThaiId(nationalId)], ['มือถือ', maskMobile(row.mobile)]]],
    ['ร้านค้าและใบเสร็จ', [['ร้านค้า', plain(row.shop_name)], ['ระยะเวลาเปิดร้าน', row.shop_duration], ['ชื่อในใบเสร็จ', plain(row.receipt_name)]]],
  ].map(([t, rows]) => [t, rows.filter(([, v]) => v)]);
  const link = `${env.APP_URL}/tracking.html`;
  const contact = [site.contact_phone && `โทร ${site.contact_phone}`, site.contact_email && `อีเมล ${site.contact_email}`].filter(Boolean).join(' · ');
  const font = "font-family:Prompt,'Sukhumvit Set','Leelawadee UI',Tahoma,sans-serif";
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ลงทะเบียนสำเร็จ</title></head>
<body style="margin:0;background:#efe8fb;${font};color:#202124"><div style="display:none;max-height:0;overflow:hidden">เลขที่ใบสมัคร ${esc(row.application_no)} เจ้าหน้าที่จะตรวจเอกสารต่อจากนี้</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#efe8fb"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:24px;overflow:hidden">
<tr><td bgcolor="#168447" style="background:linear-gradient(135deg,#168447,#49378a);padding:34px 28px;color:#ffffff;${font}">
<div style="font-size:26px;font-weight:700;font-style:italic">E-Training &#127793;</div><div style="font-size:15px;margin-top:18px">เมล็ดของคุณลงดินแล้ว ลงทะเบียนสำเร็จ!</div>
<div style="font-size:34px;font-weight:700;letter-spacing:2px;margin-top:6px">${esc(row.application_no)}</div><div style="font-size:13px">โปรดเก็บเลขที่นี้ไว้ติดตามสถานะ</div></td></tr>
<tr><td style="padding:24px 28px 4px;${font}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${Array.from({ length: 9 }, (_, i) => `<td style="padding:0 2px"><div style="height:8px;border-radius:8px;background:${i === 0 ? '#2f9a48' : i === 1 ? '#f5821f' : '#e7dff8'};font-size:0">&nbsp;</div></td>`).join('')}</tr></table>
<p style="margin:10px 0 0;font-size:14px;color:#5b5870">ขั้นที่ 2 จาก 9: รอเจ้าหน้าที่ตรวจเอกสาร ยังไม่ต้องทำอะไรเพิ่ม</p></td></tr>
${groups.map(([t, rows]) => `<tr><td style="padding:18px 28px 0;${font}"><div style="font-weight:700;color:#168447;border-bottom:2px solid #e7dff8;padding-bottom:6px">${esc(t)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.map(([k, v]) => `<tr><td valign="top" style="padding:8px 10px 0 0;width:38%;font-size:14px;color:#5b5870;${font}">${esc(k)}</td><td valign="top" style="padding:8px 0 0;font-size:15px;font-weight:500;${font}">${esc(v)}</td></tr>`).join('')}</table></td></tr>`).join('')}
<tr><td align="center" style="padding:28px;${font}"><a href="${esc(link)}" style="display:inline-block;background:#168447;color:#ffffff;text-decoration:none;font-weight:700;font-size:17px;padding:14px 34px;border-radius:999px">ติดตามสถานะ</a></td></tr>
<tr><td style="padding:0 28px 28px;font-size:13px;color:#5b5870;${font}">${contact ? `${esc(contact)}<br>` : ''}ระบบปิดบังข้อมูลบางส่วนเพื่อความปลอดภัย หากคุณไม่ได้สมัคร โปรดลบอีเมลนี้และแจ้งเจ้าหน้าที่</td></tr>
</table></td></tr></table></body></html>`;
  const text = [`ลงทะเบียนสำเร็จ เลขที่ใบสมัคร ${row.application_no}`, '', ...groups.flatMap(([t, rows]) => [`[${t}]`, ...rows.map(([k, v]) => `${k}: ${v}`), '']), `ติดตามสถานะ: ${link}`, contact].join('\n');
  return { subject: `ลงทะเบียนสำเร็จ ${row.application_no} | E-Training`, html, text };
}
