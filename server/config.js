import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(rootDir, '.env') });

function required(name, { allowEmpty = false } = {}) {
  const value = process.env[name];
  if (!allowEmpty && (!value || value.includes('your-') || value.includes('change-me'))) {
    return null;
  }
  return value || null;
}

function parseGroupId(raw) {
  if (!raw) return null;
  const cleaned = String(raw)
    .trim()
    .replace(/^-/, '')
    .replace(/^(club|public|event|gim)/i, '');
  if (!cleaned || cleaned === '123456789') return null;
  // Только цифры — иначе Long Poll / API отвалятся
  if (!/^\d+$/.test(cleaned)) return null;
  return cleaned;
}

const config = {
  rootDir,
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: (process.env.NODE_ENV || 'development') !== 'production',

  proxyapi: {
    apiKey: required('PROXYAPI_KEY'),
    baseURL: process.env.PROXYAPI_BASE_URL || 'https://api.proxyapi.ru/v1',
    model: process.env.PROXYAPI_MODEL || 'qwen/qwen3.8-flash',
  },

  vk: {
    token: required('VK_GROUP_TOKEN'),
    groupId: parseGroupId(required('VK_GROUP_ID')),
    apiVersion: process.env.VK_API_VERSION || '5.199',
    managerIds: (process.env.VK_MANAGER_IDS || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0),
    notifyChatPeerId: (() => {
      const raw = (process.env.VK_NOTIFY_CHAT_PEER_ID || '').trim();
      if (!raw) return null;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : null;
    })(),
  },

  /** Ссылка в уведомлении админу (куда зайти ответить). Можно оставить пустой. */
  adminPanelUrl: (process.env.ADMIN_PANEL_URL || '').trim() || null,

  sessionSecret: process.env.SESSION_SECRET || '',
  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  widgetApiKey: process.env.WIDGET_API_KEY || '',
  maxHistoryMessages: Number(process.env.MAX_HISTORY_MESSAGES) || 20,
  maxMessageLength: 2000,
  maxMessagesPerMinute: 20,
};

export function assertRuntimeConfig() {
  const missing = [];
  if (!config.proxyapi.apiKey) missing.push('PROXYAPI_KEY');
  if (!config.vk.token) missing.push('VK_GROUP_TOKEN');
  if (!config.vk.groupId) missing.push('VK_GROUP_ID');
  return missing;
}

export default config;
