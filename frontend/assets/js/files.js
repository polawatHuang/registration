const MIME = { 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'application/pdf': ['pdf'] };

/** ตรวจชนิด/ขนาด และย่อรูปใหญ่จากมือถือ (ตัดพิกัด GPS ในรูปออกไปด้วย) คืน { file } หรือ { error } */
export async function prepareFile(file, docType, maxMb) {
  const ext = file.name.toLowerCase().split('.').pop();
  const type = Object.keys(MIME).find((m) => MIME[m].includes(ext));
  if (!type) return { error: 'รองรับเฉพาะ JPG, PNG หรือ PDF' };
  if (docType === 'portrait_photo' && type === 'application/pdf') return { error: 'ภาพถ่ายหน้าตรงต้องเป็น JPG หรือ PNG' };
  if (type !== 'application/pdf') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const k = Math.min(1, 2200 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      const blob = await new Promise((r) => { c.toBlob(r, 'image/jpeg', 0.88); });
      if (blob) file = new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' });
    } catch { return { error: 'เปิดไฟล์ภาพนี้ไม่ได้ กรุณาเลือกภาพอื่น' }; }
  }
  if (file.size > maxMb * 1024 * 1024) return { error: `ไฟล์ต้องไม่เกิน ${maxMb} MB` };
  return { file };
}
