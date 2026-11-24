export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const badRequest = (code, message, details) => new AppError(400, code, message, details);
export const unauthorized = (message = 'กรุณาเข้าสู่ระบบ') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'คุณไม่มีสิทธิ์ทำรายการนี้') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'ไม่พบข้อมูลที่ต้องการ') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (code, message) => new AppError(409, code, message);
export const tooMany = (message = 'ทำรายการบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่') => new AppError(429, 'TOO_MANY_REQUESTS', message);
