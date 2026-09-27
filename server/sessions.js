import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import config from './config.js';

/** Сессии в памяти + снимок на диск в data/dialogs/ */
const sessions = new Map();

const SESSION_TTL_MS = 1000 * 60 * 60 * 24; // 24 часа в памяти
const dialogsDir = path.join(config.rootDir, 'data', 'dialogs');
const handoffsDir = path.join(config.rootDir, 'data', 'handoffs');

function ensureDirs() {
  fs.mkdirSync(dialogsDir, { recursive: true });
  fs.mkdirSync(handoffsDir, { recursive: true });
}

ensureDirs();

function now() {
  return Date.now();
}

function safeSessionId(id) {
  if (!id || typeof id !== 'string') return null;
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  if (!safe || safe !== id) return null;
  return safe;
}

function dialogPath(id) {
  const safe = safeSessionId(id);
  if (!safe) throw new Error('bad session id');
  return path.join(dialogsDir, `${safe}.json`);
}

function persistSession(session) {
  try {
    ensureDirs();
    const payload = {
      id: session.id,
      channel: session.channel,
      peerId: session.peerId,
      meta: session.meta,
      history: session.history,
      handoff: session.handoff,
      handoffReason: session.handoffReason || null,
      createdAt: new Date(session.createdAt).toISOString(),
      updatedAt: new Date(session.updatedAt).toISOString(),
    };
    fs.writeFileSync(dialogPath(session.id), JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    console.error('[sessions] не удалось сохранить диалог:', err.message);
  }
}

export function saveHandoffSnapshot(session, reason) {
  try {
    ensureDirs();
    const file = path.join(
      handoffsDir,
      `${new Date().toISOString().replace(/[:.]/g, '-')}_${session.id}.json`,
    );
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          reason,
          dialog_id: session.id,
          channel: session.channel,
          saved_at: new Date().toISOString(),
          summary: summarizeHistory(session, 30),
          history: session.history,
        },
        null,
        2,
      ),
      'utf8',
    );
    return file;
  } catch (err) {
    console.error('[sessions] handoff snapshot:', err.message);
    return null;
  }
}

function pruneExpired() {
  const t = now();
  for (const [id, session] of sessions) {
    if (t - session.updatedAt > SESSION_TTL_MS) {
      persistSession(session);
      sessions.delete(id);
    }
  }
}

function loadSessionFromDisk(id) {
  if (!safeSessionId(id)) return null;
  try {
    const file = dialogPath(id);
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const session = {
      id: safeSessionId(id),
      channel: raw.channel || 'website',
      peerId: raw.peerId ?? null,
      meta: raw.meta || {},
      history: Array.isArray(raw.history) ? raw.history : [],
      handoff: Boolean(raw.handoff),
      handoffReason: raw.handoffReason || null,
      createdAt: Date.parse(raw.createdAt) || now(),
      updatedAt: Date.parse(raw.updatedAt) || now(),
    };
    sessions.set(session.id, session);
    return session;
  } catch {
    return null;
  }
}

export function createSession({ channel = 'website', peerId = null, meta = {} } = {}) {
  pruneExpired();
  const id = randomUUID();
  const session = {
    id,
    channel,
    peerId,
    meta: sanitizeMeta(meta),
    history: [],
    handoff: false,
    createdAt: now(),
    updatedAt: now(),
  };
  sessions.set(id, session);
  persistSession(session);
  return session;
}

export function getSession(id) {
  if (!safeSessionId(id)) return null;
  pruneExpired();
  let session = sessions.get(id);
  if (!session) {
    session = loadSessionFromDisk(id);
  }
  if (!session) return null;
  if (now() - session.updatedAt > SESSION_TTL_MS) {
    persistSession(session);
    sessions.delete(id);
    return null;
  }
  return session;
}

export function getOrCreateVkSession(peerId) {
  pruneExpired();
  for (const session of sessions.values()) {
    if (session.channel === 'vk' && session.peerId === peerId) {
      session.updatedAt = now();
      return session;
    }
  }
  return createSession({ channel: 'vk', peerId });
}

export function appendMessage(session, role, content) {
  session.history.push({
    role,
    content: String(content).slice(0, config.maxMessageLength),
    at: new Date().toISOString(),
  });
  while (session.history.length > config.maxHistoryMessages) {
    session.history.shift();
  }
  session.updatedAt = now();
  persistSession(session);
}

export function markHandoff(session, reason) {
  session.handoff = true;
  session.handoffReason = reason;
  session.updatedAt = now();
  persistSession(session);
  return saveHandoffSnapshot(session, reason);
}

export function clearHandoff(session) {
  session.handoff = false;
  session.handoffReason = null;
  session.updatedAt = now();
  persistSession(session);
}

export function summarizeHistory(session, max = 12) {
  return session.history
    .slice(-max)
    .map((m) => `${m.role === 'user' ? 'Клиент' : 'Бот'}: ${m.content}`)
    .join('\n');
}

export function listRecentDialogs(limit = 20) {
  ensureDirs();
  const files = fs
    .readdirSync(dialogsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const full = path.join(dialogsDir, f);
      const st = fs.statSync(full);
      return { file: f, mtime: st.mtimeMs, full };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);

  return files.map(({ file, full, mtime }) => {
    try {
      const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
      return {
        id: raw.id || file.replace(/\.json$/, ''),
        channel: raw.channel,
        handoff: Boolean(raw.handoff),
        messages: Array.isArray(raw.history) ? raw.history.length : 0,
        updatedAt: raw.updatedAt || new Date(mtime).toISOString(),
        preview: raw.history?.find((m) => m.role === 'user')?.content?.slice(0, 120) || '',
      };
    } catch {
      return { id: file, error: true };
    }
  });
}

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== 'object') return {};
  const out = {};
  if (typeof meta.pageUrl === 'string') {
    out.pageUrl = meta.pageUrl.slice(0, 500);
  }
  if (typeof meta.userAgent === 'string') {
    out.userAgent = meta.userAgent.slice(0, 200);
  }
  return out;
}

export function getOpenSessionStats() {
  pruneExpired();
  return {
    total: sessions.size,
    website: [...sessions.values()].filter((s) => s.channel === 'website').length,
    vk: [...sessions.values()].filter((s) => s.channel === 'vk').length,
    savedOnDisk: fs.existsSync(dialogsDir)
      ? fs.readdirSync(dialogsDir).filter((f) => f.endsWith('.json')).length
      : 0,
  };
}

export function getDialogsDir() {
  return dialogsDir;
}

/** Полный диалог с диска (для админки / API). */
export function getDialogById(id) {
  const safe = safeSessionId(id);
  if (!safe) return null;
  try {
    const file = dialogPath(safe);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
