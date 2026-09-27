import config from '../server/config.js';
import { sendMessage, vkCall } from '../server/vk.js';

function redact(n) {
  const s = String(n);
  if (s.length <= 4) return '****';
  return `${s.slice(0, 2)}…${s.slice(-2)}`;
}

async function main() {
  console.log('managers:', config.vk.managerIds.map(redact).join(', ') || '(none)');
  console.log('groupId set:', Boolean(config.vk.groupId));
  console.log('token set:', Boolean(config.vk.token));

  try {
    const me = await vkCall('groups.getById', { group_id: config.vk.groupId });
    const g = Array.isArray(me) ? me[0] : me?.groups?.[0] || me;
    console.log('group ok:', g?.name || g?.id || 'ok');
  } catch (err) {
    console.log('groups.getById FAIL:', err.code, err.message);
  }

  if (!config.vk.managerIds.length) {
    console.log('No VK_MANAGER_IDS — nothing to send');
    return;
  }

  for (const id of config.vk.managerIds) {
    try {
      const r = await sendMessage(id, 'Тест уведомления ТеплоДом: если видите это — VK_MANAGER_IDS работает.');
      console.log('send to', redact(id), 'OK', r);
    } catch (err) {
      console.log('send to', redact(id), 'FAIL code=', err.code, 'msg=', err.message);
      if (err.vk) console.log('vk detail:', JSON.stringify({ error_code: err.vk.error_code, error_msg: err.vk.error_msg, captcha: Boolean(err.vk.captcha_sid) }));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
