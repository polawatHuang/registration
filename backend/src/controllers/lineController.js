import * as rich from '../services/richMenuService.js';
import { parse } from '../middleware/validate.js';
import * as s from '../utils/schemas.js';
import { ok } from '../utils/response.js';

const actor = (req) => ({ adminId: req.admin.id, ip: req.ip });
export const state = async (_req, res) => ok(res, await rich.state());
export const publish = async (req, res) => ok(res, await rich.publish(req.file, parse(s.richMenuSchema, req.body).chatBarText, actor(req)), { message: 'เผยแพร่เมนูแล้ว' });
export const remove = async (req, res) => ok(res, await rich.remove(actor(req)), { message: 'ปิดเมนูแล้ว' });
export async function welcome(req, res) { await rich.saveWelcome(parse(s.welcomeSchema, req.body), actor(req)); ok(res, await rich.state(), { message: 'บันทึกแล้ว' }); }
export async function users(req, res) { const f = parse(s.lineUsersSchema, req.query); const { items, total } = await rich.users(f); ok(res, items, { meta: { total, page: f.page, pageSize: f.pageSize } }); }
