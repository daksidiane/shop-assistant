import config from '../server/config.js';

const VK_API = 'https://api.vk.com/method';

function mask(v) {
  const s = String(v || '');
  if (s.length < 8) return '(short)';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

async function call(method, params = {}) {
  const body = new URLSearchParams({
    access_token: config.vk.token,
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
  return data;
}

async function main() {
  console.log('=== VK Long Poll диагностика ===');
  console.log('token:', mask(config.vk.token), 'starts_vk1:', String(config.vk.token || '').startsWith('vk1.'));
  console.log('group_id raw:', config.vk.groupId);
  console.log('api version:', config.vk.apiVersion);

  if (!config.vk.token || !config.vk.groupId) {
    console.log('FAIL: нет VK_GROUP_TOKEN или VK_GROUP_ID в .env');
    return;
  }

  const gid = String(config.vk.groupId).replace(/^-/, '');

  const checks = [
    ['groups.getById', { group_id: gid }],
    ['groups.getLongPollSettings', { group_id: gid }],
    ['groups.getLongPollServer', { group_id: gid }],
    ['groups.setLongPollSettings', {
      group_id: gid,
      enabled: 1,
      api_version: config.vk.apiVersion,
      message_new: 1,
    }],
  ];

  for (const [method, params] of checks) {
    try {
      const data = await call(method, params);
      if (data.error) {
        console.log(
          `FAIL ${method}: code=${data.error.error_code} msg=${data.error.error_msg}`,
        );
      } else {
        const keys = data.response ? Object.keys(data.response) : [];
        console.log(`OK   ${method}`, keys.length ? `keys=${keys.join(',')}` : '');
      }
    } catch (err) {
      console.log(`FAIL ${method}: network ${err.message}`);
    }
  }

  console.log(`
Если Access denied (15):
1) Ключ должен быть КЛЮЧ СООБЩЕСТВА (не пользователя).
   Управление → Настройки → Работа с API → Ключи доступа → Создать ключ
   Права: Сообщения сообщества + Управление сообществом (и Long Poll / сообщения).
2) VK_GROUP_ID — числовой id БЕЗ минуса (как в адресе клуба / в API).
3) Включите Long Poll вручную:
   Управление → Работа с API → Long Poll API → Включено
   Типы событий: Входящее сообщение.
4) После смены ключа — новый токен в .env и перезапуск start.bat
`);
}

main();
