import config from './config.js';
import fs from 'fs';
import path from 'path';

const VK_API = 'https://api.vk.com/method';

function assertVkConfigured() {
  if (!config.vk.token || !config.vk.groupId) {
    throw new Error('VK_GROUP_TOKEN / VK_GROUP_ID не заданы');
  }
}

export async function vkCallWithToken(token, method, params = {}) {
  if (!token) throw new Error('VK token не задан');
  const body = new URLSearchParams({
    access_token: token,
    v: config.vk.apiVersion,
    ...Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, v == null ? '' : String(v)]),
    ),
  });

  const res = await fetch(`${VK_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = await res.json();
  if (data.error) {
    const err = new Error(data.error.error_msg || 'VK API error');
    err.code = data.error.error_code;
    err.vk = data.error;
    throw err;
  }
  return data.response;
}

export async function vkCall(method, params = {}) {
  assertVkConfigured();
  return vkCallWithToken(config.vk.token, method, params);
}

function saveNotificationLocal(text) {
  try {
    const dir = path.join(config.rootDir, 'data', 'notifications');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `${stamp}.txt`);
    fs.writeFileSync(file, text, 'utf8');
    fs.writeFileSync(path.join(dir, 'latest.txt'), text, 'utf8');
    console.log(`[vk] копия уведомления: ${file}`);
    return file;
  } catch (err) {
    console.warn('[vk] не удалось сохранить уведомление на диск:', err.message);
    return null;
  }
}

/**
 * Короткий пинг админам: «на сайте ждут ответа».
 * Шлётся ключом сообщества в ЛС по VK_MANAGER_IDS (и опционально в беседу).
 */
export async function notifyManagers(text) {
  saveNotificationLocal(text);

  const ids = config.vk.managerIds;
  const chatPeer = config.vk.notifyChatPeerId;
  const targets = [...ids];
  if (chatPeer) targets.push(chatPeer);

  if (!targets.length) {
    console.warn(
      '[vk] VK_MANAGER_IDS пуст — уведомление только на диск (data/notifications/).',
    );
    return { sent: 0, errors: ['no_targets'] };
  }

  let sent = 0;
  const errors = [];
  for (const id of targets) {
    try {
      await sendMessage(id, text);
      sent += 1;
      console.log(`[vk] уведомление отправлено peer=${id}`);
    } catch (err) {
      const code = err.code || err.vk?.error_code;
      const msg = err.message || '';
      console.error(`[vk] не удалось уведомить peer=${id}: [${code}] ${msg}`);
      if (code === 901 || code === 902) {
        console.error(
          '[vk] Получатель должен хотя бы раз написать сообществу (или разрешить сообщения), иначе API не доставит ЛС.',
        );
      }
      errors.push({ peer: id, code, msg });
    }
  }
  return { sent, errors };
}

/** @deprecated alias — оставляем имя для chat.js */
export async function dispatchAdminAlert(text) {
  return notifyManagers(text);
}

export async function getLongPollServer() {
  return vkCall('groups.getLongPollServer', {
    group_id: config.vk.groupId,
  });
}

export async function ensureLongPollSettings() {
  await vkCall('groups.setLongPollSettings', {
    group_id: config.vk.groupId,
    enabled: 1,
    api_version: config.vk.apiVersion,
    message_new: 1,
    message_reply: 0,
    message_allow: 1,
  });
}

export async function sendMessage(peerId, message, { keyboard = null } = {}) {
  const params = {
    peer_id: peerId,
    message: String(message).slice(0, 4000),
    random_id: Math.floor(Math.random() * 2_000_000_000),
  };
  if (keyboard) {
    params.keyboard = JSON.stringify(keyboard);
  }
  return vkCall('messages.send', params);
}

/**
 * Long Poll цикл. Не падает при временных ошибках — переподключается.
 */
export function startLongPoll({ onMessage }) {
  let stopped = false;
  let serverState = null;
  let backoffMs = 2000;

  async function refreshServer() {
    serverState = await getLongPollServer();
    backoffMs = 2000;
    console.log('[vk] Long Poll server получен');
  }

  async function loop() {
    try {
      await ensureLongPollSettings();
      console.log('[vk] Long Poll settings: message_new включён');
    } catch (err) {
      console.warn(
        '[vk] setLongPollSettings:',
        err.message,
        '— включите Long Poll вручную в настройках сообщества, если нужно',
      );
    }

    while (!stopped) {
      try {
        if (!serverState) await refreshServer();

        const url =
          `${serverState.server}?act=a_check&key=${encodeURIComponent(serverState.key)}` +
          `&ts=${encodeURIComponent(serverState.ts)}&wait=25`;

        const res = await fetch(url, { method: 'GET' });
        const data = await res.json();

        if (data.failed) {
          if (data.failed === 1 && data.ts) {
            serverState.ts = data.ts;
            continue;
          }
          serverState = null;
          continue;
        }

        serverState.ts = data.ts;
        const updates = Array.isArray(data.updates) ? data.updates : [];

        for (const event of updates) {
          if (event?.type !== 'message_new') continue;
          const msg = event.object?.message || event.object;
          if (!msg) continue;

          if (msg.out === 1) continue;
          if (msg.from_id < 0) continue;

          const text = (msg.text || '').trim();
          if (!text) continue;

          try {
            await onMessage({
              peerId: msg.peer_id,
              fromId: msg.from_id,
              text,
              messageId: msg.id,
              raw: msg,
            });
          } catch (err) {
            console.error('[vk] обработчик сообщения:', err.message);
            try {
              await sendMessage(
                msg.peer_id,
                'Извините, произошла техническая ошибка. Попробуйте чуть позже или напишите «менеджер».',
              );
            } catch {
              /* ignore */
            }
          }
        }
      } catch (err) {
        const msg = err.message || '';
        console.error('[vk] Long Poll ошибка:', msg);
        if (/Access denied/i.test(msg)) {
          console.error(
            '[vk] Access denied: проверьте VK_GROUP_ID (реальный id сообщества, не 123456789) ' +
              'и ключ сообщества с правами «Сообщения» + «Управление». Диагностика: node scripts/diagnose-vk-longpoll.mjs',
          );
          backoffMs = Math.min(backoffMs * 2, 60000);
        } else {
          backoffMs = Math.min(backoffMs * 1.5, 30000);
        }
        serverState = null;
        await sleep(backoffMs);
      }
    }
  }

  const promise = loop();
  return {
    stop() {
      stopped = true;
    },
    promise,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
