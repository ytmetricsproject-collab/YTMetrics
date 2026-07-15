# YTMetrics — Готовый SaaS-бизнес под ключ (YouTube Аналитика & ИИ)

YTMetrics — это полностью готовый сервис авто-аналитики YouTube-каналов и генерации сценариев на базе искусственного интеллекта (Google Gemini API). Проект разработан как SaaS-продукт с возможностью монетизации через крипто-платежи.

## Основные возможности (Features)
1. **Аналитика каналов & Прогнозы:** Загрузка видео через YouTube Data API, расчёт удержания, вовлечённости (ER) и интеллектуальное прогнозирование показателей ролика.
2. **ИИ-ассистент (Gemini API):** Генератор сценариев с интерактивными шаблонами (Shorts-крючки, сторителлинг, обзоры) и умный чат с контекстом выбранного видео.
3. **Готовая монетизация (CryptoCloud):** Интеграция приёма платежей (USDT, BTC, ETH, TON и др.) с автоматическим начислением Premium-статуса по вебхуку.
4. **Админ-панель:** Полное управление пользователями (бан/разбан), назначение прав модераторам, просмотр доходов в реальном времени, отправка push-уведомлений и контроль лимитов ИИ.
5. **Mobile-Ready (PWA):** Приложение можно установить на экран телефона прямо из браузера.

---

## Быстрый запуск для покупателя (5 минут)

Проект работает на полностью бесплатных тарифах (хостинг Vercel + база Supabase), что гарантирует **0 руб/мес** затрат на обслуживание.

### Шаг 1: Настройка Базы Данных (Supabase)
1. Зарегистрируйтесь на [Supabase](https://supabase.com) и создайте новый проект.
2. Перейдите в раздел **SQL Editor** и вставьте содержимое файла `supabase_schema.sql` из корня проекта. Нажмите **Run**.
3. В разделе **Project Settings -> API** скопируйте `Project URL` и `anon public key` (service_role key для бэкенда).

### Шаг 2: Настройка Приёма Платежей (CryptoCloud)
1. Зарегистрируйте аккаунт на [CryptoCloud](https://cryptocloud.plus).
2. Создайте новый проект (Магазин). В настройках магазина укажите URL вашего бэкенда для вебхуков:  
   `https://<your-backend-domain>/api/payments/postback`
3. Скопируйте **API Key**, **Shop ID** и **Secret Key** (для подписи вебхуков).

### Шаг 3: Деплой Бэкенда на Vercel
1. Создайте проект на [Vercel](https://vercel.com) и импортируйте репозиторий с проектом.
2. Добавьте следующие переменные окружения (**Environment Variables**):

| Переменная | Описание | Пример значения |
|---|---|---|
| `SUPABASE_URL` | URL базы Supabase | `https://xxxx.supabase.co` |
| `SUPABASE_KEY` | Сервисный ключ (service_role) | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |
| `JWT_SECRET` | Случайная строка для шифрования сессий | `my_super_secret_jwt_key_12345` |
| `GEMINI_API_KEY` | API-ключ Google Gemini (бесплатный) | `AIzaSy...` |
| `GOOGLE_CLIENT_ID` | OAuth Client ID от Google Cloud | `xxxx.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | OAuth Client Secret от Google Cloud | `GOCSPX-xxxx` |
| `CRYPTOCLOUD_API_KEY` | API-ключ от CryptoCloud | `Token xxx` |
| `CRYPTOCLOUD_SHOP_ID` | ID магазина CryptoCloud | `shop_xxxx` |
| `CRYPTOCLOUD_SECRET` | Секретный ключ вебхуков (Secret Key) | `secret_xxxx` |

4. Нажмите кнопку **Deploy**.

### Шаг 4: Настройка Google OAuth
1. Перейдите в [Google Cloud Console](https://console.cloud.google.com).
2. В настройках экрана согласия OAuth (OAuth consent screen) добавьте домен вашего фронтенда.
3. В параметрах Credentials добавьте:
   * **Authorized JavaScript origins**: `https://<your-frontend-domain>`
   * **Authorized redirect URIs**: `https://<your-backend-domain>/api/auth/google/callback`

### Шаг 5: Деплой Фронтенда
Фронтенд является полностью статичным (SPA). Вы можете выложить его на **GitHub Pages**, **Netlify**, **Vercel** или любой хостинг. 
* Не забудьте указать домен вашего бэкенда на Vercel в конфигурационном файле фронтенда (переменная `BACKEND_URL`).

---

## Назначение Главного Администратора (Supreme Admin)
После импорта схемы базы данных в таблице `admins` создается запись с правами владельца. Чтобы войти в панель администратора:
1. Войдите в приложение через Google-аккаунт.
2. Скопируйте ваш email.
3. Откройте таблицу `admins` в Supabase и измените значение поля `email` в строке, где `is_primary = true`, на ваш email.
4. После обновления страницы вам сразу станет доступен раздел **Админ-панель** со всеми правами управления.
