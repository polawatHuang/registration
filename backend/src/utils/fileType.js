const TYPES = [
  { mime: 'image/jpeg', ext: ['jpg', 'jpeg'], test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: ['png'], test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'application/pdf', ext: ['pdf'], test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
];
/** คืน mime จากเนื้อไฟล์จริง เมื่อนามสกุลตรงกับเนื้อไฟล์เท่านั้น */
export function detectFileType(buffer, filename) {
  const ext = filename.toLowerCase().split('.').pop();
  const type = TYPES.find((t) => buffer.length > 8 && t.test(buffer));
  return type && type.ext.includes(ext) ? type.mime : null;
}
