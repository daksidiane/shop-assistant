import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { getKnowledgeStats } from './rag.js';
import {
  getOpenSessionStats,
  listRecentDialogs,
  getDialogById,
} from './sessions.js';
import { handleWebsiteChat, handleVkIncoming } from './chat.js';
import { startLongPoll } from './vk.js';
import config, { assertRuntimeConfig } from './config.js';
import {
  corsOriginChecker,
  createChatLimiter,
  requireWidgetKey,
  sanitizeIncomingMessage,
  safeErrorMessage,
} from './security.js';

const app = express();

app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'script-src': ["'self'", "'unsafe-inline'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:'],
        'connect-src': ["'self'", ...config.corsOrigins],
      },
    },
  }),
);
app.use(
  cors({
    origin: corsOriginChecker,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Widget-Key'],
    maxAge: 600,
  }),
);
app.use(express.json({ limit: '32kb' }));

app.use((err, _req, res, next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Некорректный JSON' });
  }
  if (err?.message?.startsWith('CORS:')) {
    return res.status(403).json({ error: 'Origin не разрешён' });
  }
  return next(err);
});

const publicDir = path.join(config.rootDir, 'public');
app.use(express.static(publicDir, { index: 'index.html', maxAge: config.isDev ? 0 : '1h' }));

app.get('/api/health', (_req, res) => {
  const missing = assertRuntimeConfig();
  res.json({
    ok: missing.length === 0,
    missingEnv: missing,
    model: config.proxyapi.model,
    knowledge: getKnowledgeStats(),
    sessions: getOpenSessionStats(),
    vkLongPoll: Boolean(config.vk.token && config.vk.groupId),
    vkManagersConfigured: config.vk.managerIds.length > 0,
    adminPanelUrl: config.adminPanelUrl,
  });
});

/** Список диалогов только если явно включён. По умолчанию закрыт. */
function dialogsApiAllowed() {
  return process.env.ALLOW_DIALOGS_API === '1';
}

app.get('/api/dialogs', (_req, res) => {
  if (!dialogsApiAllowed()) {
    return res.status(404).json({ error: 'Not found' });
  }
  return res.json({ dialogs: listRecentDialogs(30) });
});

app.get('/api/dialogs/:id', (req, res) => {
  if (!dialogsApiAllowed()) {
    return res.status(404).json({ error: 'Not found' });
  }
  const dialog = getDialogById(req.params.id);
  if (!dialog) {
    return res.status(404).json({ error: 'Диалог не найден' });
  }
  return res.json({ dialog });
});

app.post('/api/chat', createChatLimiter(), requireWidgetKey, async (req, res) => {
  try {
    const missing = assertRuntimeConfig().filter((k) => k === 'PROXYAPI_KEY');
    if (missing.length) {
      return res.status(503).json({
        error: 'Сервер не настроен: добавьте PROXYAPI_KEY в файл .env',
      });
    }

    const message = sanitizeIncomingMessage(req.body?.message);
    if (!message) {
      return res.status(400).json({ error: 'Пустое сообщение' });
    }

    const sessionId =
      typeof req.body?.sessionId === 'string' ? req.body.sessionId.slice(0, 64) : null;

    const meta = {
      pageUrl: typeof req.body?.pageUrl === 'string' ? req.body.pageUrl.slice(0, 500) : '',
      userAgent: String(req.get('user-agent') || '').slice(0, 200),
    };

    const result = await handleWebsiteChat({ sessionId, message, meta });
    return res.json(result);
  } catch (err) {
    console.error('[api/chat]', safeErrorMessage(err));
    return res.status(500).json({
      error: 'Не удалось получить ответ. Попробуйте позже.',
    });
  }
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error('[error]', safeErrorMessage(err));
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

const missing = assertRuntimeConfig();
if (missing.length) {
  console.warn(
    `[boot] Не заданы переменные: ${missing.join(', ')}. Скопируйте .env.example → .env и заполните ключи.`,
  );
}

const server = app.listen(config.port, () => {
  console.log(`Сервер: http://localhost:${config.port}`);
  console.log(`Демо-сайт и виджет: http://localhost:${config.port}/`);
  console.log(`Модель: ${config.proxyapi.model}`);
  console.log(`База знаний:`, getKnowledgeStats());
  if (!config.vk.managerIds.length) {
    console.warn(
      '[vk] VK_MANAGER_IDS пуст — при HANDOFF пинг админу в ВК не уйдёт (только data/notifications/).',
    );
  } else {
    console.log(`[vk] пинг админам: ${config.vk.managerIds.length} получател(ей)`);
  }
});

let longPoll = null;
if (config.vk.token && config.vk.groupId) {
  longPoll = startLongPoll({
    onMessage: async ({ peerId, text }) => {
      await handleVkIncoming({ peerId, text });
    },
  });
  console.log('[vk] Bots Long Poll запущен, group_id=', config.vk.groupId);
} else {
  console.warn(
    '[vk] Long Poll не запущен — нужен VK_GROUP_TOKEN и реальный VK_GROUP_ID ' +
      '(не заглушка 123456789). ID: vk.com/clubXXXXXXXX → XXXXXXXX',
  );
}

async function shutdown() {
  console.log('Остановка...');
  if (longPoll) longPoll.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
