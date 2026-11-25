import * as chat from '../services/chatService.js';
import { parse } from '../middleware/validate.js';
import * as s from '../utils/schemas.js';
import { ok } from '../utils/response.js';

const actor = (req) => ({ adminId: req.admin.id, ip: req.ip });
const idOf = (req, k = 'id') => parse(s.id, req.params[k]);

export async function webhook(req, res) {
  await chat.receive(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), req.get('x-line-signature'));
  res.status(200).json({ success: true, message: 'ok', data: {}, meta: {} });
  chat.kickEvents();
}
export const state = async (_req, res) => ok(res, await chat.state());
export const setAi = async (req, res) => ok(res, await chat.setAi(parse(s.chatAiSchema, req.body).enabled, actor(req)));
export const poll = async (req, res) => ok(res, await chat.poll(parse(s.chatPollSchema, req.query), req.admin.id));
export const detail = async (req, res) => ok(res, await chat.detail(idOf(req)));
export const messages = async (req, res) => ok(res, await chat.messages(idOf(req), parse(s.chatBeforeSchema, req.query).before));
export const send = async (req, res) => ok(res, await chat.send(idOf(req), parse(s.chatSendSchema, req.body), actor(req)));
export const retry = async (req, res) => ok(res, await chat.retry(idOf(req), idOf(req, 'messageId'), actor(req)));
export const update = async (req, res) => ok(res, await chat.update(idOf(req), parse(s.chatUpdateSchema, req.body), actor(req)));
export const suggest = async (req, res) => ok(res, await chat.suggest(idOf(req)));
export async function media(req, res) {
  const { buffer, mime } = await chat.media(idOf(req), idOf(req, 'messageId'), actor(req));
  res.set({ 'Content-Type': mime, 'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'self'" });
  res.end(buffer);
}
