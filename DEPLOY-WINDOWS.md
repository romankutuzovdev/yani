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

## Update later

```powershell
cd C:\apps\yani
powershell -ExecutionPolicy Bypass -File .\scripts\windows\update.ps1
# Ctrl+C in start window, then start.ps1 again
```
