# Docker Deployment

Этот проект можно запускать в Docker как отдельное приложение, используя уже существующий внешний PostgreSQL.

## Что важно заранее

- База данных уже должна быть доступна по сети с сервера, где будет запускаться контейнер.
- Приложение **не удаляет** существующие данные в базе.
- При старте приложение само создаёт только недостающие таблицы и индексы.
- Если пользователя с `SEED_ADMIN_USERNAME` ещё нет, он будет создан автоматически.

## 1. Подготовьте `.env`

Скопируйте пример:

```bash
cp docker/.env.app.example .env
```

Заполните минимум:

- `DATABASE_URL`
- `AUTH_SECRET`
- `SEED_ADMIN_NAME`
- `SEED_ADMIN_USERNAME`
- `SEED_ADMIN_PASSWORD`
- при необходимости `APP_PORT`

### Важно про `DATABASE_URL`

Если PostgreSQL работает **вне** контейнера, не используйте `localhost`, если база не находится внутри того же контейнера.

Пример:

```env
DATABASE_URL=postgresql://db_user:db_password@10.3.28.138:5432/reports
```

## 2. Подготовьте каталоги для данных

Compose-файл использует bind mount, поэтому рядом с проектом будут храниться:

- `deploy-data/storage`
- `deploy-data/reports`
- `deploy-data/report-runs`

Создайте их:

```bash
mkdir -p deploy-data/storage deploy-data/reports deploy-data/report-runs
```

При первом старте контейнер сам скопирует базовые отчёты из образа в `deploy-data/reports`, если папка пустая.

## 3. Соберите и запустите приложение

```bash
docker compose -f docker/docker-compose.app.yml up -d --build
```

## 4. Проверьте логи

```bash
docker compose -f docker/docker-compose.app.yml logs -f app
```

Нормальный сценарий:

- контейнер стартует
- приложение подключается к внешней БД
- недостающие таблицы создаются автоматически
- при необходимости создаётся начальный `god`-пользователь

## 5. Обновление приложения

После обновления кода:

```bash
docker compose -f docker/docker-compose.app.yml up -d --build
```

Ваши данные останутся на месте, потому что:

- `storage` хранится в `deploy-data/storage`
- загруженные отчёты хранятся в `deploy-data/reports`
- результаты запусков отчётов хранятся в `deploy-data/report-runs`

## 6. Остановка

```bash
docker compose -f docker/docker-compose.app.yml down
```

Это остановит контейнер, но не удалит данные в `deploy-data`.

## 7. Полезно знать

- Для backup/restore из админки внутри контейнера уже установлен `pg_dump` / `pg_restore`.
- PDF-подписание работает внутри контейнера через Python `.venv`.
- Для штампов в контейнер добавлены Linux-шрифты `DejaVu`, чтобы русский текст рендерился корректно.
