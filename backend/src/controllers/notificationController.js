import * as n from '../services/notificationService.js';
import { parse } from '../middleware/validate.js';
import * as s from '../utils/schemas.js';
import { ok } from '../utils/response.js';

const actor = (req) => ({ adminId: req.admin.id, ip: req.ip });
const idOf = (req) => parse(s.id, req.params.id);
const keyOf = (req) => parse(s.templateKey, req.params.key);
const done = (message = 'บันทึกแล้ว') => [{}, { message }];
export const state = async (req, res) => ok(res, await n.state(req.admin.id));
export async function settings(req, res) { await n.saveSettings(parse(s.notifySettingsSchema, req.body), actor(req)); ok(res, await n.state(req.admin.id)); }
export const templates = async (_req, res) => ok(res, await n.listTemplates());
export async function saveTemplate(req, res) { await n.saveTemplate(keyOf(req), parse(s.templateSchema, req.body), actor(req)); ok(res, ...done()); }
export const createTemplate = async (req, res) => ok(res, { key: await n.createTemplate(parse(s.templateSchema, req.body), actor(req)) }, { status: 201 });
export async function removeTemplate(req, res) { await n.removeTemplate(keyOf(req), actor(req)); ok(res, ...done('ลบแล้ว')); }
export async function preview(req, res) { const d = parse(s.templateSchema, req.body); ok(res, await n.preview(d.key ?? null, d)); }
export async function test(req, res) { const d = parse(s.templateSchema, req.body); await n.sendTest(d.key ?? null, d, actor(req)); ok(res, ...done('ส่งทดสอบไปที่ LINE ของคุณแล้ว')); }
export async function queue(req, res) { const f = parse(s.notifyListSchema, req.query); const { items, total } = await n.queue(f); ok(res, items, { meta: { total, page: f.page, pageSize: f.pageSize } }); }
export const logs = async (req, res) => ok(res, await n.logs(idOf(req)));
export async function act(req, res) { await n.act(idOf(req), parse(s.notifyActSchema, req.body).action, actor(req)); ok(res); }
export const estimate = async (req, res) => ok(res, await n.estimate(parse(s.campaignFilterSchema, req.body)));
export const campaigns = async (_req, res) => ok(res, await n.campaigns());
export const createCampaign = async (req, res) => ok(res, await n.createCampaign(parse(s.campaignSchema, req.body), actor(req)), { status: 201 });
export const cancelCampaign = async (req, res) => ok(res, await n.cancelCampaign(idOf(req), actor(req)));
export const recipients = async (_req, res) => ok(res, await n.recipients());
export async function setRecipient(req, res) { await n.setRecipient(idOf(req), parse(s.recipientSchema, req.body).events, actor(req)); ok(res, ...done()); }
export const linkCode = async (req, res) => ok(res, await n.linkCode(actor(req)));
export async function unlink(req, res) { await n.unlinkAdmin(actor(req)); ok(res); }
