import rateLimit from 'express-rate-limit';
import config from './config.js';

export function createChatLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    max: config.maxMessagesPerMinute,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Слишком много запросов. Подождите минуту.' },
  });
}

export function corsOriginChecker(origin, callback) {
  // Запросы без Origin (same-origin, curl, сервер-сервер) — ок
  if (!origin) return callback(null, true);

  const allowed = config.corsOrigins;
  if (!allowed.length) {
    if (config.isDev) return callback(null, true);
    return callback(new Error('CORS: origin не разрешён'));
  }

  if (allowed.includes(origin) || allowed.includes('*')) {
    return callback(null, true);
  }

  return callback(new Error('CORS: origin не разрешён'));
}

export function requireWidgetKey(req, res, next) {
  if (!config.widgetApiKey) return next();
  const key = req.get('X-Widget-Key') || '';
  if (key !== config.widgetApiKey) {
    return res.status(401).json({ error: 'Неверный ключ виджета' });
  }
  return next();
}

export function sanitizeIncomingMessage(raw) {
  if (typeof raw !== 'string') return '';
  // Убираем управляющие символы, ограничиваем длину
  return raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim()
    .slice(0, config.maxMessageLength);
}

/** Не логируем секреты */
export function safeErrorMessage(err) {
  const msg = err?.message || 'Internal error';
  return msg
    .replace(/sk-[A-Za-z0-9._-]+/g, '[REDACTED]')
    .replace(/vk1\.[A-Za-z0-9._-]+/g, '[REDACTED]');
}
