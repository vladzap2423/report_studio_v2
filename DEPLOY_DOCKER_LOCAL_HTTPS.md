# Local Docker + HTTPS

Сценарий для локального сервиса внутри компании:

- PostgreSQL уже запущен отдельно и **не** находится в Docker
- приложение запускается в Docker
- доступ идёт по `HTTPS` на IP-адрес, например `https://10.3.28.138:3000`

## Что уже сделано в проекте

- app-контейнер собирается из [Dockerfile](c:\Progi\report_studio_v2\Dockerfile)
- данные приложения вынесены в persist-каталоги:
  - `deploy-data/storage`
  - `deploy-data/reports`
  - `deploy-data/report-runs`
- для HTTPS добавлен `nginx` proxy:
  - [docker/docker-compose.https.yml](c:\Progi\report_studio_v2\docker\docker-compose.https.yml)
- добавлен конфиг nginx:
  - [docker/nginx-https.conf](c:\Progi\report_studio_v2\docker\nginx-https.conf)
- добавлен генератор self-signed сертификата на IP:
  - [docker/generate-ip-cert.ps1](c:\Progi\report_studio_v2\docker\generate-ip-cert.ps1)

## 1. Сделайте dump базы

Dump уже создан:

- `dumps/manual__20260415_125041__reports.dump`

Если хотите сделать новый:

```powershell
$env:PGPASSWORD='your_password'
& 'C:\Program Files\PostgreSQL\17\bin\pg_dump.exe' `
  --format=custom `
  --no-owner `
  --no-privileges `
  --host localhost `
  --port 5432 `
  --username your_user `
  --dbname reports `
  --file dumps\manual__YYYYMMDD_HHMMSS__reports.dump
```

## 2. Оставьте `.env` как есть для локального запуска

Для HTTPS-compose отдельная правка `DATABASE_URL` не нужна.

В [docker/docker-compose.https.yml](c:\Progi\report_studio_v2\docker\docker-compose.https.yml) уже задано:

- `DATABASE_URL=""`
- `PG_HOST=host.docker.internal`

Это сделано специально, чтобы:

- локальная разработка на Windows могла по-прежнему использовать `DATABASE_URL=...@localhost`
- Docker-контейнер ходил в ту же базу через `host.docker.internal`

Остальные важные переменные:

```env
APP_PORT=3000
AUTH_SECRET=your_secret
SESSION_COOKIE_NAME=report_studio_session
SESSION_EXPIRES_DAYS=7
SEED_ADMIN_NAME=Администратор
SEED_ADMIN_USERNAME=admingp1
SEED_ADMIN_PASSWORD=ChangeMe123!
```

## 3. Создайте сертификат на IP

Для текущего IP:

```powershell
powershell -ExecutionPolicy Bypass -File docker\generate-ip-cert.ps1 -IpAddress 10.3.28.138
```

После этого появятся:

- `docker/certs/server.crt`
- `docker/certs/server.key`

## 4. Подготовьте папки данных

```powershell
New-Item -ItemType Directory -Force -Path deploy-data\storage | Out-Null
New-Item -ItemType Directory -Force -Path deploy-data\reports | Out-Null
New-Item -ItemType Directory -Force -Path deploy-data\report-runs | Out-Null
```

## 5. Запустите контейнеры

```powershell
docker compose -f docker\docker-compose.https.yml up -d --build
```

Что будет поднято:

- `report_studio_app`
- `report_studio_https`

## 6. Проверка

Логи приложения:

```powershell
docker compose -f docker\docker-compose.https.yml logs -f app
```

Логи proxy:

```powershell
docker compose -f docker\docker-compose.https.yml logs -f https_proxy
```

Открывать:

```text
https://10.3.28.138:3000
```

## 7. Важный момент по сертификату

Сертификат self-signed.

Это значит:

- браузеры будут ругаться, пока вы не добавите сертификат в доверенные
- Arduino должен либо:
  - доверять этому сертификату
  - либо использовать pinning сертификата / public key

## 8. Обновление приложения

Когда вы меняете страницы, API или логику:

```powershell
docker compose -f docker\docker-compose.https.yml up -d --build
```

Данные не потеряются, потому что они хранятся в `deploy-data`.

## 9. Остановка

```powershell
docker compose -f docker\docker-compose.https.yml down
```

Это остановит контейнеры, но не удалит:

- базу
- `deploy-data/storage`
- `deploy-data/reports`
- `deploy-data/report-runs`
