(function () {
  'use strict';

  const script = document.currentScript;
  const API_BASE = (script?.getAttribute('data-api') || '').replace(/\/$/, '') || '';
  const WIDGET_KEY = script?.getAttribute('data-key') || '';
  const TITLE = script?.getAttribute('data-title') || 'Алексей';
  const SUBTITLE = script?.getAttribute('data-subtitle') || 'специалист поддержки';
  const STORAGE_KEY = 'cmw_session_id';

  // Встроенный аватар — не зависит от пути к /avatar.svg
  const AVATAR_URL =
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#3d8a72"/><stop offset="100%" stop-color="#1e4a56"/></linearGradient></defs><circle cx="48" cy="48" r="48" fill="url(%23bg)"/><circle cx="48" cy="38" r="16" fill="#e8dcc8"/><path d="M20 82c4-16 14-24 28-24s24 8 28 24" fill="#e8dcc8"/><path d="M32 34c2-10 10-16 16-16s14 6 16 16c-4-3-10-5-16-5s-12 2-16 5z" fill="#2a3d44"/><circle cx="41" cy="38" r="2.2" fill="#1a2a30"/><circle cx="55" cy="38" r="2.2" fill="#1a2a30"/><path d="M42 46c2.5 3 9.5 3 12 0" fill="none" stroke="#1a2a30" stroke-width="1.8" stroke-linecap="round"/></svg>',
    );

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getSessionId() {
    try {
      return localStorage.getItem(STORAGE_KEY) || null;
    } catch {
      return null;
    }
  }

  function setSessionId(id) {
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* private mode */
    }
  }

  function clearSessionId() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  // Сброс залипших сессий (handoff выглядел как «новый чат» из‑за приветствия)
  try {
    if (localStorage.getItem('cmw_session_ver') !== '3') {
      clearSessionId();
      localStorage.setItem('cmw_session_ver', '3');
    }
  } catch {
    /* ignore */
  }

  function createUi() {
    const root = document.createElement('div');
    root.className = 'cmw-root';
    root.innerHTML = `
      <div class="cmw-panel" role="dialog" aria-label="Чат поддержки">
        <div class="cmw-header">
          <div class="cmw-header-main">
            <img class="cmw-header-avatar" src="${escapeHtml(AVATAR_URL)}" alt="" width="40" height="40" />
            <div>
              <h2>${escapeHtml(TITLE)}</h2>
              <p class="cmw-online">${escapeHtml(SUBTITLE)}</p>
            </div>
          </div>
          <button type="button" class="cmw-close" aria-label="Закрыть">×</button>
        </div>
        <div class="cmw-messages" data-messages></div>
        <form class="cmw-form" data-form>
          <input type="text" name="message" maxlength="2000" autocomplete="off"
            placeholder="Напишите вопрос…" required />
          <button type="submit">Отпр.</button>
        </form>
      </div>
      <button type="button" class="cmw-launcher" aria-label="Открыть чат">
        <img src="${escapeHtml(AVATAR_URL)}" alt="" width="58" height="58" />
      </button>
    `;
    document.body.appendChild(root);
    return root;
  }

  const root = createUi();
  const messagesEl = root.querySelector('[data-messages]');
  const form = root.querySelector('[data-form]');
  const input = form.querySelector('input');
  const submitBtn = form.querySelector('button');
  const launcher = root.querySelector('.cmw-launcher');
  const closeBtn = root.querySelector('.cmw-close');

  function open() {
    root.classList.add('is-open');
    input.focus();
  }
  function close() {
    root.classList.remove('is-open');
  }

  launcher.addEventListener('click', open);
  closeBtn.addEventListener('click', close);

  function addMessage(role, text) {
    const row = document.createElement('div');
    row.className = `cmw-row ${role}`;

    if (role === 'bot') {
      const img = document.createElement('img');
      img.className = 'cmw-msg-avatar';
      img.src = AVATAR_URL;
      img.alt = '';
      img.width = 28;
      img.height = 28;
      row.appendChild(img);
    }

    const bubble = document.createElement('div');
    bubble.className = 'cmw-msg';
    bubble.textContent = text;
    row.appendChild(bubble);

    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return row;
  }

  function showTyping() {
    const row = document.createElement('div');
    row.className = 'cmw-typing-row';
    row.setAttribute('data-typing', '1');
    row.innerHTML = `
      <img class="cmw-msg-avatar" src="${escapeHtml(AVATAR_URL)}" alt="" width="28" height="28" />
      <div class="cmw-typing" aria-label="Алексей печатает">
        <span></span><span></span><span></span>
      </div>
    `;
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return row;
  }

  if (getSessionId()) {
    addMessage('bot', 'С возвращением. Можете продолжить вопрос — я на связи.');
  } else {
    addMessage(
      'bot',
      'Здравствуйте! Оператор поддержки ТеплоДом. Подскажу по моделям, монтажу и доставке — или помогу оформить заказ. Чем могу помочь?',
    );
  }

  let busy = false;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;

    const text = input.value.trim();
    if (!text) return;

    addMessage('user', text);
    input.value = '';
    busy = true;
    submitBtn.disabled = true;
    const typing = showTyping();

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (WIDGET_KEY) headers['X-Widget-Key'] = WIDGET_KEY;

      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: text,
          sessionId: getSessionId(),
          pageUrl: location.href.slice(0, 500),
        }),
      });

      const data = await res.json().catch(() => ({}));
      typing.remove();

      if (!res.ok) {
        addMessage('system', data.error || 'Ошибка сервера. Проверьте .env и npm start.');
        return;
      }

      if (data.sessionId) setSessionId(data.sessionId);
      addMessage('bot', data.reply || '…');
      if (data.handoff) {
        const note =
          data.handoffReason === 'client_request_repeat'
            ? 'Менеджер уже уведомлён. Ответит здесь, как сможет.'
            : 'Подключаю менеджера. Он ответит здесь, как сможет.';
        addMessage('system', note);
      }
    } catch {
      typing.remove();
      addMessage(
        'system',
        'Нет связи с сервером. Запустите бэкенд (start.bat) или укажите data-api.',
      );
    } finally {
      busy = false;
      submitBtn.disabled = false;
      input.focus();
    }
  });

  window.ClimateChatWidget = { open, close };
})();
