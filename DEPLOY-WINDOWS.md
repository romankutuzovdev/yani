# Yani on Windows Server — port 8080 (SQLite, no Docker/Postgres)

Server: **http://91.149.133.54:8080**

## Need on the server

1. Git
2. Node.js 22+ LTS — https://nodejs.org/
3. Open firewall port **8080**

PostgreSQL and Docker are **not required**.

## Deploy

```powershell
mkdir C:\apps -Force
cd C:\apps
git clone https://github.com/romankutuzovdev/yani.git
cd C:\apps\yani
copy .env.example .env
notepad .env
```

Set in `.env`:

```env
DATABASE_URL="file:./data/yani.db"
PORT=8080
NEXT_PUBLIC_APP_URL=http://91.149.133.54:8080
DEEPSEEK_API_KEY=your_key
JWT_SECRET=long-random-secret
```

```powershell
New-NetFirewallRule -DisplayName "Yani 8080" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow

cd C:\apps\yani
git pull
powershell -ExecutionPolicy Bypass -File .\scripts\windows\setup.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\windows\start.ps1
```

Open:

- http://91.149.133.54:8080/chat
- http://91.149.133.54:8080/login — `admin@yani.local` / `admin123456`

## Auto-deploy after git push (recommended)

После **одного** раза настройки каждый `git push origin main` сам обновит сервер (pull → build → restart).

### 1. Токен runner на GitHub

1. Открой https://github.com/romankutuzovdev/yani/settings/actions/runners/new  
2. OS: **Windows**, Architecture: **x64**  
3. Скопируй **token** (живёт ~1 час)

### 2. На Windows-сервере (один раз)

```powershell
cd C:\apps\yani
git pull
powershell -ExecutionPolicy Bypass -File .\scripts\windows\setup-autodeploy.ps1 -Token PASTE_TOKEN_HERE
```

Скрипт поставит GitHub Actions runner в `C:\apps\actions-runner` и запустит его как Windows-службу.

Проверка: GitHub → **Settings → Actions → Runners** — статус **Idle**.

### 3. Дальше

С ноутбука:

```bash
git push origin main
```

На GitHub → **Actions** появится workflow **Deploy to Windows server**.  
После зелёной галочки сайт: http://91.149.133.54:8080/chat

Ручной деплой (если нужно):

```powershell
cd C:\apps\yani
powershell -ExecutionPolicy Bypass -File .\scripts\windows\deploy.ps1
```

Логи процесса: `C:\apps\yani\data\logs\`

## Update later (без автодеплоя)

Сначала остановите приложение (**Ctrl+C** в окне `start.ps1`), иначе Windows залочит `query_engine-windows.dll.node` и Prisma упадёт с `EPERM`.

```powershell
cd C:\apps\yani
powershell -ExecutionPolicy Bypass -File .\scripts\windows\update.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\windows\start.ps1
```

`update.ps1` сам попытается освободить порт **8080**. Если `EPERM` всё равно есть — закройте все окна Node/Next и повторите.
