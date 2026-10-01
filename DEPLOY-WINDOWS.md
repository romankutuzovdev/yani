# Yani on Windows Server — port 8080
# Server: http://91.149.133.54:8080

## What you need on the server

1. Git
2. Node.js 22 LTS — https://nodejs.org/
3. PostgreSQL (pick one):
   - **Option A:** Docker Desktop + `docker compose up -d postgres`
   - **Option B:** PostgreSQL for Windows — https://www.enterprisedb.com/downloads/postgres-postgresql-downloads  
     Port **5432**, remember the `postgres` user password.
4. Open firewall port **8080**

Redis is **not required**.

## Clone

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
PORT=8080
NEXT_PUBLIC_APP_URL=http://91.149.133.54:8080
DEEPSEEK_API_KEY=your_key
JWT_SECRET=long-random-secret
DATABASE_URL=postgresql://yani:yani@localhost:5432/yani?schema=public
```

(If you use Docker postgres, port is **5433**, not 5432.)

## Firewall

```powershell
New-NetFirewallRule -DisplayName "Yani 8080" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow
```

## Install PostgreSQL without Docker (admin PowerShell)

```powershell
winget install --id PostgreSQL.PostgreSQL.16 -e --accept-package-agreements
# reboot / reopen PowerShell, then:
$env:PGPASSWORD = "YOUR_POSTGRES_PASSWORD"
```

## Setup + start

```powershell
cd C:\apps\yani
git pull
$env:PGPASSWORD = "YOUR_POSTGRES_PASSWORD"   # only for local Postgres
powershell -ExecutionPolicy Bypass -File .\scripts\windows\setup.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\windows\start.ps1
```

Open:

- http://91.149.133.54:8080/chat
- http://91.149.133.54:8080/login  
  `admin@yani.local` / `admin123456`

## Update later

```powershell
cd C:\apps\yani
powershell -ExecutionPolicy Bypass -File .\scripts\windows\update.ps1
# then restart start.ps1
```
