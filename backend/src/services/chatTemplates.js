import { env } from '../config/env.js';

const https = env.APP_URL.startsWith('https://');
const uri = (label, path) => (https ? [{ type: 'action', action: { type: 'uri', label, uri: `${env.APP_URL}${path}` } }] : []);
export const HUMAN_TEXT = 'คุยกับเจ้าหน้าที่';
const quickReply = () => ({ items: [...uri('ติดตามสถานะ', '/tracking.html'), ...uri('สมัครอบรม', '/'), { type: 'action', action: { type: 'message', label: HUMAN_TEXT, text: HUMAN_TEXT } }] });

/** LINE จำกัด 5000 หน่วย UTF-16 */
export const clip = (t) => (t.length > 4900 ? `${t.slice(0, 4900)}…` : t);
export const aiMessage = (text) => ({ type: 'text', text: clip(text), sender: { name: 'ผู้ช่วย AI' }, quickReply: quickReply() });
export const adminMessage = (text) => ({ type: 'text', text });
export const HANDOFF = 'รับทราบครับ ส่งต่อให้เจ้าหน้าที่แล้ว เจ้าหน้าที่จะตอบในแชตนี้โดยเร็ว ระหว่างนี้ผู้ช่วย AI จะหยุดตอบ';

/** ข้อความต้อนรับ: เมล็ดแรกของ journey */
export const contactMessage = (c, ai) => ({ type: 'text', quickReply: quickReply(), text: [ai ? 'พิมพ์คำถามได้เลยครับ ผู้ช่วย AI จะตอบให้ทันที หรือกด "คุยกับเจ้าหน้าที่"' : 'พิมพ์คำถามได้เลยครับ เจ้าหน้าที่จะตอบในแชตนี้', c.contact_phone && `โทร ${c.contact_phone}`, c.contact_email && `อีเมล ${c.contact_email}`].filter(Boolean).join('\n') });

export function welcome(name, { title, text, home } = {}) {
  const line = (icon, text) => ({ type: 'box', layout: 'baseline', spacing: 'md', contents: [{ type: 'text', text: icon, flex: 0 }, { type: 'text', text, wrap: true, size: 'sm', color: '#3b3850' }] });
  const button = (label, path, style, color) => (https ? [{ type: 'button', style, color, height: 'sm', action: { type: 'uri', label, uri: `${env.APP_URL}${path}` } }] : []);
  return {
    type: 'flex', altText: 'ยินดีต้อนรับสู่ LINE SMART TRAINING', quickReply: quickReply(),
    contents: { type: 'bubble', size: 'mega',
      header: { type: 'box', layout: 'vertical', paddingAll: '22px', background: { type: 'linearGradient', angle: '135deg', startColor: '#168447', endColor: '#49378A' }, contents: [
        { type: 'text', text: 'E-Training 🌱', weight: 'bold', size: 'xl', color: '#FFFFFF' }, { type: 'text', text: title || `ยินดีต้อนรับ${name ? `คุณ${name}` : ''}`, color: '#FFFFFF', size: 'md', margin: 'md', wrap: true }, { type: 'text', text: text || 'จากเมล็ดแรก สู่ใบประกาศของคุณ', color: '#E4F5EA', size: 'sm', wrap: true }] },
      body: { type: 'box', layout: 'vertical', spacing: 'md', contents: [line('📝', 'สมัครอบรมและแนบเอกสาร'), line('🔎', 'ติดตามสถานะใบสมัคร'), line('🎫', 'เปิด QR เข้าอบรม และดูกำหนดการ'), line('🏅', 'ดาวน์โหลดใบประกาศนียบัตร'), line('💬', 'พิมพ์ถามได้เลย มีผู้ช่วย AI และเจ้าหน้าที่คอยตอบ'), { type: 'text', text: 'โปรดอย่าส่งเลขบัตรประชาชนในแชต', size: 'xs', color: '#8a6a00', wrap: true, margin: 'lg' }] },
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: https ? [...button('สมัครอบรม', '/', 'primary', '#168447'), ...(home ? [{ type: 'button', style: 'secondary', color: '#F4F0FC', height: 'sm', action: { type: 'uri', label: 'เชื่อมบัญชี / พื้นที่ของฉัน', uri: home } }] : button('ติดตามสถานะ', '/tracking.html', 'secondary', '#F4F0FC')), ...button('ประกาศความเป็นส่วนตัว', '/privacy.html', 'link')] : [{ type: 'text', text: 'พิมพ์คำถามได้เลย', size: 'sm', align: 'center' }] } },
  };
}
