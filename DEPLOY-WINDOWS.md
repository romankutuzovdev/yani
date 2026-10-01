# Yani на Windows Server — порт 8080

Команды ниже копируй в PowerShell **на сервере** (RDP).

## Что установить заранее

1. [Git](https://git-scm.com/download/win)
2. [Node.js 22 LTS](https://nodejs.org/)
3. [Docker Desktop](https://www.docker.com/products/docker-desktop/) (и запустить его)
4. Открыть порт **8080** в Windows Firewall

## Первый раз

```powershell
# 1. Клон (подставь свой GitHub URL)
git clone https://github.com/YOUR_ORG/yani.git C:\apps\yani
cd C:\apps\yani

# 2. Настройка .env
copy .env.example .env
notepad .env
```

В `.env` минимум:

```env
PORT=8080
DATABASE_URL=postgresql://yani:yani@localhost:5433/yani?schema=public
REDIS_URL=redis://localhost:6379
JWT_SECRET=смени-на-длинный-секрет
DEEPSEEK_API_KEY=твой-ключ
DEEPSEEK_MODEL=deepseek-chat
NEXT_PUBLIC_APP_URL=http://IP_СЕРВЕРА:8080
ADMIN_EMAIL=admin@yani.local
ADMIN_PASSWORD=admin123456
```

Дальше:

```powershell
cd C:\apps\yani

# 3. Установка + БД + сборка
powershell -ExecutionPolicy Bypass -File .\scripts\windows\setup.ps1

# 4. Запуск на 8080 (окно не закрывай)
powershell -ExecutionPolicy Bypass -File .\scripts\windows\start.ps1
```

Открой:

- Чат: `http://IP_СЕРВЕРА:8080/chat`
- Админка: `http://IP_СЕРВЕРА:8080/login`  
  Логин: `admin@yani.local` / `admin123456`

## Обновление с GitHub

В **другом** окне PowerShell:

```powershell
cd C:\apps\yani
powershell -ExecutionPolicy Bypass -File .\scripts\windows\update.ps1
```

Потом в окне с приложением: `Ctrl+C` и снова:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\start.ps1
```

## Автообновление (по желанию)

Планировщик заданий → каждые 5 минут:

```text
powershell.exe -ExecutionPolicy Bypass -File C:\apps\yani\scripts\windows\update.ps1
```

После обновления всё равно нужен перезапуск `start.ps1` (или поставь PM2 — см. ниже).

## Чтобы крутилось в фоне (PM2)

```powershell
npm i -g pm2
cd C:\apps\yani
$env:PORT=8080
pm2 start npm --name yani -- start
pm2 save
```

Обновление тогда:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\update.ps1
pm2 restart yani
```

## Firewall (админ PowerShell)

```powershell
New-NetFirewallRule -DisplayName "Yani 8080" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow
```
