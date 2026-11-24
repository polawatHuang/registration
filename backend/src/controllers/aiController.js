import * as knowledge from '../services/knowledgeService.js';
import { answer } from '../services/aiService.js';
import { isConfigured } from '../integrations/minimaxClient.js';
import { parse } from '../middleware/validate.js';
import * as s from '../utils/schemas.js';
import { badRequest } from '../utils/errors.js';
import { ok } from '../utils/response.js';

const actor = (req) => ({ adminId: req.admin.id, ip: req.ip });
const idOf = (req) => parse(s.id, req.params.id);
export const list = async (_req, res) => ok(res, { items: await knowledge.list(), categories: knowledge.CATEGORIES, aiReady: await isConfigured() });
export const get = async (req, res) => ok(res, await knowledge.get(idOf(req)));
export const create = async (req, res) => ok(res, { id: await knowledge.create(parse(s.knowledgeSchema, req.body), actor(req)) }, { status: 201 });
export async function upload(req, res) {
  if (!req.file) throw badRequest('NO_FILES', 'กรุณาเลือกไฟล์');
  ok(res, { id: await knowledge.upload(req.file, parse(s.knowledgeCategory, req.body?.category ?? 'FAQ'), actor(req)) }, { status: 201 });
}
export async function update(req, res) { await knowledge.update(idOf(req), parse(s.knowledgeSchema, req.body), actor(req)); ok(res); }
export async function remove(req, res) { await knowledge.remove(idOf(req), actor(req)); ok(res); }
export const ask = async (req, res) => ok(res, await answer(parse(s.askSchema, req.body).question));
