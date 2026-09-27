import OpenAI from 'openai';
import config from './config.js';
import { loadSystemPrompt, retrieveContext } from './rag.js';

let client = null;
let systemPromptCache = null;

function getClient() {
  if (!config.proxyapi.apiKey) {
    throw new Error('PROXYAPI_KEY не задан');
  }
  if (!client) {
    client = new OpenAI({
      apiKey: config.proxyapi.apiKey,
      baseURL: config.proxyapi.baseURL,
    });
  }
  return client;
}

function getSystemPrompt() {
  if (!systemPromptCache) {
    systemPromptCache = loadSystemPrompt();
  }
  return systemPromptCache;
}

function stripHandoffMarker(text) {
  const marker = /\[HANDOFF:\s*reason=([^\]]+)\]/i;
  const match = String(text || '').match(marker);
  const clean = String(text || '').replace(marker, '').trim();
  return {
    reply: clean,
    handoff: match
      ? { reason: match[1].trim() }
      : null,
  };
}

/** Убираем markdown/служебную разметку — ответ как в обычном чате */
function humanizeReply(text) {
  return String(text || '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\*\*(.+?)\*\*/gs, '$1')
    .replace(/__(.+?)__/gs, '$1')
    .replace(/\*(.+?)\*/gs, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '— ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const GREETING_PREFIX =
  /^(?:здравствуйте|добрый\s+день|доброе\s+утро|добрый\s+вечер|приветствую)[!.,]?\s*/i;

/** Повторные «Здравствуйте» — частая ошибка маленьких моделей */
function stripRedundantGreeting(text, { history, channel }) {
  const alreadyGreeted =
    channel === 'website'
    || history.some((m) => m.role === 'assistant');
  if (!alreadyGreeted) return text;

  let out = String(text || '').trim();
  // Снимаем только зачин первого абзаца, не трогая текст дальше
  const firstParaEnd = out.search(/\n\n/);
  const head = firstParaEnd === -1 ? out : out.slice(0, firstParaEnd);
  const tail = firstParaEnd === -1 ? '' : out.slice(firstParaEnd);

  const cleanedHead = head.replace(GREETING_PREFIX, '').trim();
  if (!cleanedHead) {
    out = (tail || 'Чем могу помочь — подбор, монтаж, доставка или заказ?').trim();
  } else {
    out = `${cleanedHead}${tail}`.trim();
  }
  return out;
}

/**
 * Генерация ответа через ProxyAPI (OpenAI-compatible).
 */
export async function generateReply({ userMessage, history = [], channel = 'website' }) {
  const ragContext = retrieveContext(userMessage);
  const system = `${getSystemPrompt()}

═══════════════════════════════════════
КОНТЕКСТ ИЗ БАЗЫ ЗНАНИЙ (RAG)
═══════════════════════════════════════
Канал клиента: ${channel}

${ragContext}

═══════════════════════════════════════
НАПОМИНАНИЕ К ЭТОМУ ОТВЕТУ
═══════════════════════════════════════
Пиши обычным текстом без ** и прочей разметки.
Не начинай ответ с «Здравствуйте» / «Добрый день», если в истории уже есть твои сообщения или канал website (там уже поздоровался виджет). Здоровайся максимум один раз за диалог.
Если для точной рекомендации не хватает вводных — сначала вежливо уточни (1–2 вопроса), не выдавай готовый набор моделей «вслепую».
Тон: вежливый, участливый, профессиональный.
НЕ ставь маркер [HANDOFF: ...] на обычный подбор (площадь, модель, цена, монтаж, доставка). HANDOFF только если клиент явно просит менеджера/оператора, оформляет заказ с контактами, жалуется, просит скидку/выезд мастера, или после нескольких неудачных попыток помочь.
`;

  const messages = [
    { role: 'system', content: system },
    ...history.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content).slice(0, config.maxMessageLength),
    })),
    { role: 'user', content: String(userMessage).slice(0, config.maxMessageLength) },
  ];

  const completion = await getClient().chat.completions.create({
    model: config.proxyapi.model,
    messages,
    temperature: 0.45,
    max_tokens: 800,
  });

  let raw = completion.choices?.[0]?.message?.content?.trim()
    || 'Сейчас не удалось ответить. Напишите ещё раз, пожалуйста — или попросите соединить с менеджером, подключу.';

  raw = humanizeReply(raw);
  raw = stripRedundantGreeting(raw, { history, channel });

  return stripHandoffMarker(raw);
}

export default { generateReply };
