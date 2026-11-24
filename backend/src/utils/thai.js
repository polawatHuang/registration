/** ตรวจเลขประจำตัวประชาชน/ผู้เสียภาษี 13 หลักด้วย checksum */
export function isValidThaiId(id) {
  if (!/^[1-9]\d{12}$/.test(id) && !/^0\d{12}$/.test(id)) return false;
  const sum = [...id.slice(0, 12)].reduce((s, d, i) => s + Number(d) * (13 - i), 0);
  return (11 - (sum % 11)) % 10 === Number(id[12]);
}
export const maskThaiId = (id) => `${id[0]}-xxxx-xxxxx-${id.slice(10, 12)}-${id[12]}`;
export const maskMobile = (m) => `${m.slice(0, 3)}-xxx-${m.slice(-4)}`;
export function maskEmail(e) {
  const [user, domain] = e.split('@');
  return `${user.slice(0, 2)}***@${domain}`;
}
export const toAsciiDigits = (s) => String(s).replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50));
