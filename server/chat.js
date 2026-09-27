import config from './config.js';
import { generateReply } from './ai.js';
import {
  appendMessage,
  createSession,
  getOrCreateVkSession,
  getSession,
  markHandoff,
  clearHandoff,
  summarizeHistory,
} from './sessions.js';
import { dispatchAdminAlert, sendMessage } from './vk.js';

function isExplicitManagerRequest(text) {
  const t = String(text || '').toLowerCase();
  return (
    /менеджер|оператор|живой человек|живого человека/.test(t)
    || /соедините|переведите на|позовите|позвать/.test(t)
    || /хочу (поговорить|связаться) с (менеджером|оператором|человеком)/.test(t)
  );
}

/**
 * HANDOFF от модели принимаем только по реальным причинам —
 * не из‑за «сложной» площади на первом сообщении.
 */
function shouldAcceptHandoff(reason, userMessage, session) {
  const userCount = session.history.filter((m) => m.role === 'user').length;
  const text = String(userMessage || '');
  const r = String(reason || '').toLowerCase();

  if (isExplicitManagerRequest(text)) return true;

  if (/complaint|return_exchange|service_visit/.test(r)) return true;

  if (/client_request/.test(r)) {
    return isExplicitManagerRequest(text) || userCount >= 2;
  }

  if (/discount/.test(r)) {
    return /скидк|индивидуальн|опт|юр\s*лиц/i.test(text) || userCount >= 2;
  }

  if (/^order$|order\b/.test(r)) {
    return /заказ|оформи|купить|заявк|оставить\s+контакт/i.test(text) && userCount >= 2;
  }

  if (/low_confidence/.test(r)) {
    return userCount >= 3;
  }

  return userCount >= 3 && isExplicitManagerRequest(text);
}

function buildAdminPing({ session, reason, channel }) {
  const panel = config.adminPanelUrl;
  const summary = summarizeHistory(session, 12).slice(0, 2500);
  const lines = [
    'ТеплоДом: на сайте ждут ответа менеджера.',
    `Сессия: ${session.id}`,
    `Канал: ${channel === 'vk' ? 'VK' : 'сайт'}`,
    `Причина: ${reason}`,
  ];
  if (panel) {
    lines.push(`Открыть: ${panel}`);
  } else {
    lines.push('Зайдите в админку сайта и ответьте клиенту.');
  }
  if (summary) {
    lines.push('', 'История (сохранена на сервере):', summary);
  }
  return lines.join('\n').slice(0, 4000);
}

async function handleHandoff(session, reason, channel) {
  const snapshot = markHandoff(session, reason);
  if (snapshot) {
    console.log(`[handoff] история сохранена: ${snapshot}`);
  }

  const text = buildAdminPing({ session, reason, channel });
  const result = await dispatchAdminAlert(text);
  console.log('[handoff] vk notify sent=', result.sent, 'errors=', result.errors?.length || 0);
}

/**
 * Единый пайплайн ответа для сайта и VK.
 */
export async function processUserMessage({
  session,
  text,
  channel,
}) {
  const cleaned = String(text || '').trim().slice(0, config.maxMessageLength);
  if (!cleaned) {
    return { reply: 'Напишите, пожалуйста, ваш вопрос.', handoff: null };
  }

  if (session.handoff) {
    if (isExplicitManagerRequest(cleaned)) {
      const reply =
        'Уже передал ваш запрос менеджеру. Он ответит здесь, как сможет.';
      appendMessage(session, 'user', cleaned);
      appendMessage(session, 'assistant', reply);
      // Повторный пинг + handoff:true, чтобы виджет снова показал служебную пометку
      await handleHandoff(session, 'client_request_repeat', channel);
      return { reply, handoff: { reason: 'client_request_repeat' } };
    }
    clearHandoff(session);
  }

  appendMessage(session, 'user', cleaned);

  const history = session.history.slice(0, -1).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let { reply, handoff } = await generateReply({
    userMessage: cleaned,
    history,
    channel,
  });

  if (handoff && !shouldAcceptHandoff(handoff.reason, cleaned, session)) {
    handoff = null;
    reply = reply
      .replace(/сейчас подключу[\s\S]{0,80}?(?:менеджер|оператор)[^.?!]*[.?!]?/gi, '')
      .replace(/вас подключают[\s\S]{0,80}?(?:менеджер|оператор)[^.?!]*[.?!]?/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!reply) {
      reply =
        'Подскажу с удовольствием. Чтобы подобрать точнее, напишите площадь помещения и примерно какой бюджет рассматриваете.';
    }
  }

  appendMessage(session, 'assistant', reply);

  if (handoff) {
    await handleHandoff(session, handoff.reason, channel);
  }

  return { reply, handoff };
}

export async function handleWebsiteChat({ sessionId, message, meta }) {
  let session = getSession(sessionId);
  if (!session) {
    session = createSession({ channel: 'website', meta });
  }

  const result = await processUserMessage({
    session,
    text: message,
    channel: 'website',
  });

  return {
    sessionId: session.id,
    reply: result.reply,
    handoff: Boolean(result.handoff),
    handoffReason: result.handoff?.reason || null,
  };
}

export async function handleVkIncoming({ peerId, text }) {
  const session = getOrCreateVkSession(peerId);
  const result = await processUserMessage({
    session,
    text,
    channel: 'vk',
  });
  await sendMessage(peerId, result.reply);
  return result;
}
