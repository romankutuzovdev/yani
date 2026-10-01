# Yani — AI Agent Platform

Платформа AI-агентов с визуальным персонажем, навыками, инструментами, задачами, памятью, админкой и embeddable widget. LLM: **DeepSeek**.

## Стек

- Next.js 15 (App Router) + TypeScript + Tailwind CSS
- PostgreSQL + Prisma
- Redis (зарезервирован для BullMQ scheduler — phase 2)
- DeepSeek API через `DeepSeekProvider`
- SSE для realtime статуса агента
- Docker Compose

## Быстрый старт

### 1. Зависимости

```bash
npm install
cp .env.example .env
```

Заполните `DEEPSEEK_API_KEY` в `.env`.

### 2. Инфраструктура

```bash
docker compose up -d postgres redis
```

Postgres проброшен на порт **5433** (`localhost:5433`), чтобы не конфликтовать с другими локальными Postgres.

### 3. База данных

```bash
npm run db:push
npm run db:seed
```

Админ по умолчанию:

- Email: `admin@yani.local`
- Password: `admin123456`

### 4. Dev-сервер

```bash
npm run dev
```

Откройте:

- Landing: http://localhost:3000
- Admin: http://localhost:3000/admin
- Login: http://localhost:3000/login

### Docker (приложение целиком)

```bash
docker compose up --build
```

## Структура

```
src/
  agent/          # AgentEngine
  llm/            # LLMProvider + DeepSeekProvider
  tools/          # Tool system + builtins
  memory/         # Short/long/task/user/agent memory
  characters/     # CharacterRenderer abstraction
  modules-ready via app/api + admin UI
  app/
    admin/        # Admin panel
    api/          # Internal + public v1 API
    uploads/      # Secure uploaded assets
public/widget.js  # Embeddable widget
prisma/           # Schema + seed
```

## Создание агента

1. Войдите в `/admin`
2. Agents → Create
3. Откройте агента → загрузите изображения состояний (Idle/Thinking/Working/…)
4. Заполните System Prompt Builder (role, personality, rules…)
5. Назначьте Skills и Tools
6. Save → Chat

## Skills

Admin → Skills: CRUD, enable/disable, tools list, system prompt.

## Tools (MVP)

- `web_search`
- `http_request`
- `calculator`
- `datetime`
- `memory_search`

Новые tools регистрируются в `src/tools`.

## Tasks

Admin → Tasks: создайте задачу с instruction и запустите. На странице задачи — execution timeline (без скрытого chain-of-thought).

TODO: cron/BullMQ autonomous scheduler (поле `cronExpression` уже есть в БД).

## Widget

```html
<script
  src="http://localhost:3000/widget.js"
  data-agent-id="AGENT_ID"
  data-api-key="sk_agent_xxx">
</script>
```

`data-api-key` опционален для публичного чата (есть IP rate limit).

## Public API

### Chat

```bash
curl -X POST http://localhost:3000/api/v1/agents/AGENT_ID/chat \
  -H "Authorization: Bearer sk_agent_xxx" \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello","sessionId":"demo"}'
```

### Agent card

```bash
curl http://localhost:3000/api/v1/agents/AGENT_ID
```

### Status

```bash
curl http://localhost:3000/api/v1/agents/AGENT_ID/status
```

### Create task

```bash
curl -X POST http://localhost:3000/api/v1/agents/AGENT_ID/tasks \
  -H "Authorization: Bearer sk_agent_xxx" \
  -H "Content-Type: application/json" \
  -d '{"title":"Research","instruction":"Find 3 facts about DeepSeek","runImmediately":true}'
```

### Task status

```bash
curl http://localhost:3000/api/v1/tasks/TASK_ID \
  -H "Authorization: Bearer sk_agent_xxx"
```

## Environment

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection |
| `REDIS_URL` | Redis (phase 2 scheduler) |
| `JWT_SECRET` | Session signing secret |
| `DEEPSEEK_API_KEY` | DeepSeek API key (server only) |
| `DEEPSEEK_MODEL` | Default `deepseek-chat` |
| `DEEPSEEK_BASE_URL` | Default `https://api.deepseek.com` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Seed admin |
| `UPLOAD_DIR` | Local uploads directory |
| `MAX_UPLOAD_BYTES` | Upload size limit |

Никогда не отправляйте `DEEPSEEK_API_KEY` на frontend.

## Тесты

```bash
npm test
```

Покрытие MVP: DeepSeek provider, tools, utils, character renderer.

## Phase 2 (TODO)

- Redis + BullMQ cron scheduler
- Vector memory (pgvector / Qdrant / Pinecone)
- More tools (email, CRM, Slack…)
- Accurate cost analytics
- Agent-to-agent handoff
- Lottie / Live2D / 3D character renderers
- Multi-user RBAC beyond Admin/User/API Client

## Архитектура Agent Engine

```
Task → Understand → Plan → Select skills/tools → Execute → Observe → Reason → Finish → Save
```

Лимиты: max iterations, timeout, token limit, tool call limit, cancellation, error handling.
