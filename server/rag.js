import fs from 'fs';
import path from 'path';
import config from './config.js';

function loadJsonFiles() {
  const files = fs
    .readdirSync(config.rootDir)
    .filter((name) => name.startsWith('Qwen_json_') && name.endsWith('.json'));

  const bag = {
    products: [],
    faq: [],
    knowledge_base: [],
    scenarios: {},
    handoff_triggers: [],
    notification_templates: {},
  };

  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(config.rootDir, file), 'utf8'));
    if (Array.isArray(raw.products)) bag.products = raw.products;
    if (Array.isArray(raw.faq)) bag.faq = raw.faq;
    if (Array.isArray(raw.knowledge_base)) bag.knowledge_base = raw.knowledge_base;
    if (raw.scenarios && typeof raw.scenarios === 'object') {
      bag.scenarios = raw.scenarios;
      if (Array.isArray(raw.handoff_triggers)) bag.handoff_triggers = raw.handoff_triggers;
    }
    if (raw.notification_templates) bag.notification_templates = raw.notification_templates;
  }

  return bag;
}

const knowledge = loadJsonFiles();

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function scoreText(queryTokens, haystack) {
  if (!queryTokens.length || !haystack) return 0;
  const hay = String(haystack).toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (hay.includes(token)) score += 1;
  }
  return score;
}

function formatProduct(p) {
  return [
    `Товар: ${p.name}`,
    `ID: ${p.id}`,
    `Бренд: ${p.brand}`,
    `Площадь: до ${p.room_area} м²`,
    `Охлаждение: ${p.power_cooling} Вт / обогрев: ${p.power_heating} Вт`,
    `Тип: ${p.type}`,
    `Шум: ${p.noise_level} дБ, класс: ${p.energy_class}`,
    `Цена: ${p.price} ₽, монтаж: ${p.installation_price} ₽`,
    `В наличии: ${p.in_stock ? 'да' : 'нет'}`,
    `Особенности: ${(p.features || []).join(', ')}`,
    `Описание: ${p.description}`,
  ].join('\n');
}

/**
 * Простой keyword-RAG по локальной базе знаний.
 */
export function retrieveContext(userMessage, { limit = 8 } = {}) {
  const tokens = tokenize(userMessage);
  const chunks = [];

  for (const item of knowledge.faq) {
    const score =
      scoreText(tokens, item.question) * 2 +
      scoreText(tokens, (item.keywords || []).join(' ')) * 3 +
      scoreText(tokens, item.answer);
    if (score > 0) {
      chunks.push({
        score,
        type: 'faq',
        text: `FAQ: ${item.question}\nОтвет: ${item.answer}\nПримеры: ${(item.examples || []).join('; ')}`,
      });
    }
  }

  for (const item of knowledge.knowledge_base) {
    const score =
      scoreText(tokens, item.topic) * 2 +
      scoreText(tokens, (item.tags || []).join(' ')) * 2 +
      scoreText(tokens, item.content);
    if (score > 0) {
      chunks.push({
        score,
        type: 'kb',
        text: `Статья: ${item.topic}\n${item.content}`,
      });
    }
  }

  for (const product of knowledge.products) {
    const score =
      scoreText(tokens, product.name) * 3 +
      scoreText(tokens, product.brand) * 2 +
      scoreText(tokens, product.description) +
      scoreText(tokens, (product.features || []).join(' ')) +
      scoreText(tokens, String(product.room_area));
    if (score > 0 || /кондиц|сплит|модель|подобр|выбер|купить|цена|балл|lg|electrolux|mitsubishi/i.test(userMessage)) {
      chunks.push({
        score: score || 1,
        type: 'product',
        text: formatProduct(product),
      });
    }
  }

  chunks.sort((a, b) => b.score - a.score);
  const top = chunks.slice(0, limit);

  // Если ничего не нашлось — даём краткий каталог в наличии
  if (!top.length) {
    const inStock = knowledge.products.filter((p) => p.in_stock).slice(0, 5);
    return inStock.map(formatProduct).join('\n\n');
  }

  return top.map((c) => c.text).join('\n\n---\n\n');
}

export function loadSystemPrompt() {
  const mdPath = path.join(config.rootDir, 'system_prompt.md');
  const md = fs.readFileSync(mdPath, 'utf8');
  const match = md.match(/```\n([\s\S]*?)\n```/);
  if (!match) {
    throw new Error('Не удалось извлечь SYSTEM PROMPT из system_prompt.md');
  }
  return match[1].trim();
}

export function getNotificationTemplates() {
  return knowledge.notification_templates;
}

export function getKnowledgeStats() {
  return {
    products: knowledge.products.length,
    faq: knowledge.faq.length,
    articles: knowledge.knowledge_base.length,
    scenarios: Object.keys(knowledge.scenarios).length,
  };
}

export default knowledge;
