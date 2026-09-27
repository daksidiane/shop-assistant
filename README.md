# ТеплоДом — ИИ-чат-бот (сайт + VK Long Poll)

Встраиваемый виджет для сайта и тот же ИИ-бот в сообщениях сообщества ВКонтакте через **Bots Long Poll API**. Модель: `qwen/qwen3.8-flash` через **ProxyAPI**. База знаний и системный промпт — из файлов этой папки.

**Уведомления админу:** при передаче менеджеру (HANDOFF) бот шлёт короткий пинг в ЛС ВК — «на сайте ждут ответа». Диалог с сайта в ВК **не** зеркалируется.

## Куда добавить ключи

1. Скопируйте файл окружения:
   ```bash
   copy .env.example .env
   ```
2. Откройте **`.env`** в корне проекта и заполните:

| Переменная | Что это | Где взять |
|---|---|---|
| `PROXYAPI_KEY` | Ключ ProxyAPI (`sk-...`) | Кабинет ProxyAPI → Ключи API |
| `PROXYAPI_MODEL` | Модель (по умолчанию `qwen/qwen3.8-flash`) | Каталог ProxyAPI |
| `VK_GROUP_TOKEN` | Ключ доступа сообщества | VK → сообщество → Управление → Работа с API → Ключи доступа (права **messages**, **manage**) |
| `VK_GROUP_ID` | ID сообщества (только цифры) | `vk.com/clubXXXXXXXX` → `XXXXXXXX` |
| `VK_MANAGER_IDS` | User ID админов через запятую | Кому слать пинг «ждут ответа» |
| `ADMIN_PANEL_URL` | (опционально) | Ссылка в тексте уведомления |

**Не коммитьте `.env`.** Он уже в `.gitignore`. Ключи не кладите в `public/` и не вставляйте в чат.

### Как работает пинг админу

1. Клиент на сайте (или в ЛС сообщества) доходит до HANDOFF.
2. Бэкенд сохраняет снимок в `data/handoffs/`.
3. Сообщество пишет админу в ЛС короткий текст: сессия + «зайдите в админку».
4. Админ отвечает клиенту **на сайте**, не в этом ЛС ВК.

Чтобы ЛС доходило: админ из `VK_MANAGER_IDS` хотя бы раз должен написать сообществу (или разрешить сообщения от сообщества).

Проверка: `node scripts/test-vk-notify.mjs`

### Где история переписки локально

- `data/dialogs/*.json` — все чаты сайта/ВК
- `data/handoffs/*.json` — снимки при передаче менеджеру
- `data/notifications/latest.txt` — последнее уведомление

Список (в development): http://localhost:3000/api/dialogs

## Быстрый старт (локально)

```bash
npm install
copy .env.example .env
# заполните .env
npm start
```

Откройте http://localhost:3000 — демо-сайт с виджетом.

Проверка VK: в сообществе включите **Long Poll API** и типы событий **Входящее сообщение**. Напишите сообществу в ЛС — бот ответит тем же пайплайном (RAG + ProxyAPI).

## Встройка на любой сайт

```html
<link rel="stylesheet" href="https://ВАШ-БЭКЕНД/widget.css" />
<script
  src="https://ВАШ-БЭКЕНД/widget.js"
  defer
  data-api="https://ВАШ-БЭКЕНД"
  data-title="Алексей · поддержка"
  data-subtitle="ТеплоДом"
  data-key=""
></script>
```

`data-api` — URL Node-сервера (не статики Netlify). Если виджет и API на одном origin, `data-api` можно оставить пустым.

## Netlify (только фронт)

Папка `public/` подходит для статического хостинга:

1. Задеплойте `public/` на Netlify.
2. Бэкенд (`npm start`) поднимите на любом Node-хостинге (Render, Railway, VPS) — Long Poll работает только пока процесс запущен.
3. В Netlify-версии `index.html` у скрипта укажите `data-api="https://ваш-backend.example.com"`.
4. В `.env` бэкенда добавьте Netlify-origin в `CORS_ORIGINS`.

Файл `netlify.toml` в корне настроен на публикацию `public/`.

## Архитектура

- `POST /api/chat` — сообщения с сайта (виджет)
- VK Bots Long Poll — входящие сообщения сообщества
- Общий движок: `system_prompt.md` + RAG по JSON-базе + ProxyAPI
- Маркер `[HANDOFF: reason=...]` → короткий пинг админам в VK (`VK_MANAGER_IDS`)

## Безопасность

- Секреты только в `.env`, не в репозитории и не на фронте
- Helmet, CORS whitelist, rate limit, лимит размера JSON и текста
- XSS: виджет выводит текст через `textContent` / escape
- Опциональный `WIDGET_API_KEY` (`X-Widget-Key`)
- В логах токены маскируются
- С фронта не принимаются произвольные персональные данные

## Структура

```
04/
  .env.example          ← шаблон ключей
  system_prompt.md      ← системный промпт
  Qwen_json_*.json      ← база знаний
  server/               ← Node API + Long Poll
  public/               ← демо-сайт + виджет
```
