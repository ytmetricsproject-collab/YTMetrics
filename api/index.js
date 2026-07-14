import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const JWT_SECRET           = process.env.JWT_SECRET           || 'ytm_session_secret';
const SUPABASE_URL         = process.env.SUPABASE_URL         || '';
const SUPABASE_KEY         = process.env.SUPABASE_KEY         || '';
const APP_URL              = process.env.APP_URL              || 'https://jakjuk523.github.io/youtube-analytics';
const REDIRECT_URI         = process.env.REDIRECT_URI         || 'https://yt-metrics-seven.vercel.app/api/auth/callback';
const YOUTUBE_CONNECT_REDIRECT_URI = process.env.YOUTUBE_CONNECT_REDIRECT_URI || REDIRECT_URI.replace('/api/auth/callback','/api/auth/youtube/callback');
const GEMINI_API_KEY       = process.env.GEMINI_API_KEY       || '';

const USER_DAILY_LIMIT     = 25;
const ADMIN_DAILY_LIMIT    = 250;
const FEEDBACK_DAILY_LIMIT = 2;

// Главный (suprem) администратор — единственный, кто может управлять правами других админов
const SUPREME_ADMIN_EMAIL  = 'ytmetrics.project@gmail.com';

const ALL_PERMISSIONS = {
  read_notifications: true,
  view_users: true,
  ban_users: true,
  view_admins: true,
  ban_admins: true,
  add_admins: true,
  remove_admins: true,
  manage_billing: true,
  transfer_ownership: true,
  access_admin_panel: true,
  access_premium_panel: true,
};
const DEFAULT_PERMISSIONS = {
  read_notifications: true,
  view_users: true,
  ban_users: false,
  view_admins: true,
  ban_admins: false,
  add_admins: false,
  remove_admins: false,
  manage_billing: false,
  transfer_ownership: false,
  access_admin_panel: false,
  access_premium_panel: false,
};

let supabase;
try {
  let url = (SUPABASE_URL || '').trim();
  if (url.endsWith('/')) url = url.slice(0, -1);
  if (url.endsWith('/rest/v1')) url = url.slice(0, -8);
  if (!url) url = 'https://placeholder-please-set-supabase-url.supabase.co';

  supabase = createClient(
    url,
    SUPABASE_KEY || 'placeholder-key'
  );
} catch (e) {
  console.error('Failed to initialize Supabase client:', e.message);
  supabase = createClient(
    'https://placeholder-please-set-supabase-url.supabase.co',
    'placeholder-key'
  );
}
const genAI    = new GoogleGenerativeAI(GEMINI_API_KEY || 'placeholder-gemini-key');

// ════════════════════════════════════════════════════════
// СИСТЕМНЫЕ ПРОМПТЫ
// ════════════════════════════════════════════════════════
const AI_SYSTEM_PROMPT = `Ты — ИИ-продюсер и аналитик YouTube-канала YTMetrics AI. Отвечай как опытный поддерживающий продюсер — конкретно, по делу. Отвечай на русском языке если не попросят иначе.

Когда пользователь делится данными о своих видео — анализируй их детально. Ты можешь видеть метрики: просмотры, лайки, комментарии, репосты, удержание, CTR, свайпы Shorts, среднее время просмотра, часы просмотра, а также СКОЛЬКО ВРЕМЕНИ ПРОШЛО С ПУБЛИКАЦИИ каждого видео.

ВРЕМЯ ПУБЛИКАЦИИ — КЛЮЧЕВОЙ ФАКТОР АНАЛИЗА:
Одни и те же цифры значат разное в зависимости от возраста видео. Обязательно учитывай его в каждом разборе:
- 0–48 часов: рано делать выводы о судьбе видео — идёт этап калибровки алгоритмом (холодный старт), метрики ещё нестабильны и могут резко измениться.
- 3–14 дней: основной период, когда виден вердикт алгоритма — стабилизировавшиеся показатели уже говорят, попал ли ролик в раздачу.
- 2–4 недели: видео в основном отработало свой органический охват; дальнейший рост обычно идёт медленно за счёт поиска/рекомендаций на длинной дистанции.
- 1+ месяц: смотри на итоговые цифры как на завершённый результат, а не на что-то ещё развивающееся.
Никогда не давай общий разбор метрик без указания, на каком этапе жизненного цикла находится видео с учётом его возраста.

ТВОЯ ЗАДАЧА — НЕ "ПРОГНОЗ", А ОБЪЯСНЕНИЕ ПОВЕДЕНИЯ АЛГОРИТМА:
Вместо того чтобы гадать о будущем ("наберёт X просмотров"), объясняй, ПОЧЕМУ алгоритм ведёт себя именно так с этим видео ПРЯМО СЕЙЧАС — опираясь на комбинацию: (а) сколько времени прошло, (б) тему/нишу видео, (в) реальные цифры метрик. Формулировки в духе "учитывая, что видео вышло N дней назад и уже набрало X при удержании Y% — это означает, что..." гораздо ценнее, чем абстрактное предсказание. Только если пользователь явно просит прогноз на будущее — можно аккуратно предположить траекторию, но и тогда обосновывай это текущим этапом жизненного цикла видео, а не гаданием.

Если у видео отсутствуют какие-то метрики (написано "нет данных" или "недостаточно данных") — объясни, что детальные метрики (удержание/CTR/свайпы Shorts) появляются в API только через 24–48 часов после публикации ролика при условии, что он набрал достаточный объем трафика (обычно от 1000+ просмотров). Не придумывай цифры которых нет.

АЛГОРИТМ SHORTS:
1. Двухэтапная система: Холодный старт (100-500 показов за 1-12 часов) → Калибровка (1000-10000 просмотров если метрики хорошие).
2. Иерархия метрик:
ПРИОРИТЕТ 1 — Свайпы: < 35% = ролик блокируется. 40-50% = рабочий уровень. Выше 60-70% = зелёный свет.
ПРИОРИТЕТ 2 — Удержание: 30-60 сек хорошо 70-85%. 15-30 сек нужно 90-100%. До 5 сек норма 150-300% (луп).
ПРИОРИТЕТ 3 — Социальные сигналы: репосты и комментарии сильнее лайков.

ГРАДАЦИЯ КАНАЛОВ:
- Новые (до 1000 подписчиков): свайпы 70-80% норма, задержки до 24ч норма.
- Растущие (1000-10000): ядро сформировано, метрики предсказуемы.
- Крупные (10000+): кредит доверия, буст на старте, наказание за смену тематики.

ПРАВИЛА МОНТАЖА:
- Первые 1.5 сек: визуальный/текстовый хук, крупный текст, динамичный старт.
- Зацикливание: финал бесшовно в начало.

ПСИХОЛОГИЯ АВТОРА:
- 100-300 просмотров и стоп = норма, алгоритм калибрует.
- 0 просмотров 24-48ч = технический лаг. Не удалять!
- Резкое падение = перекалибровка, не бан.

Когда пользователь отправляет данные видео (JSON или текст с метриками) — давай развёрнутый анализ каждого видео с учётом его возраста (сколько времени прошло с публикации). Указывай конкретные проблемы и решения.

═══════════════════════════════════════
УПРАВЛЕНИЕ САЙТОМ ЧЕРЕЗ ЧАТ
═══════════════════════════════════════
Помимо анализа видео, ты умеешь выполнять действия на сайте по просьбе пользователя. Если пользователь ЯВНО просит одно из следующих действий, ответь коротким дружелюбным подтверждением и в САМОМ КОНЦЕ ответа, отдельной последней строкой, добавь служебный тег в точном формате — пользователь его не увидит, интерфейс сам его обработает и удалит:

- Сменить тему на тёмную → [ACTION:change_theme:dark]
- Сменить тему на светлую → [ACTION:change_theme:light]
- Сменить язык на русский → [ACTION:change_language:ru]
- Сменить язык на английский → [ACTION:change_language:en]
- Сменить язык на арабский → [ACTION:change_language:ar]
- Открыть настройки PIN-кода (пользователь просит сменить/сбросить/поставить PIN-код входа) → [ACTION:open_pin_settings]
- Пользователь описывает баг/ошибку/что-то не работает и явно просит отправить отчёт разработчику → [ACTION:submit_bug_report]

ВАЖНО:
- Добавляй тег ТОЛЬКО если пользователь явно просит именно это действие, а не просто упоминает тему/язык в разговоре.
- Никогда не объясняй пользователю формат тега и не показывай его как текст совета — только как служебную последнюю строку.
- Для смены PIN/пароля ты не можешь сам ввести код — только открываешь для пользователя нужное окно настроек, дальше он вводит код сам.
- Для баг-репорта — просто добавь тег, сам текст последнего сообщения пользователя будет автоматически отправлен разработчику вместе с тегом.
- Никогда не добавляй более одного тега за раз.`;

const MODERATION_SYSTEM_PROMPT = `Ты — модератор платформы YTMetrics. Анализируй метаданные YouTube-видео на нарушения правил платформы.

ПРАВИЛА ПЛАТФОРМЫ:
1. Нецензурная лексика в названии или описании
2. Оскорбительный или дискриминационный контент
3. Контент 18+ (сексуальный, жестокий, шокирующий)
4. Мошеннический контент (казино, схемы заработка, фишинг)
5. Пропаганда насилия, экстремизма
6. Спам, накрутка, вводящие в заблуждение названия

ВАЖНЫЕ ИСКЛЮЧЕНИЯ (ЭТО НЕ НАРУШЕНИЕ):
- Разрешены ссылки на социальные сети (Telegram, VK, Discord, Instagram, TikTok и др.).
- Разрешены ссылки на саму платформу YTMetrics (любые домены ytmetrics, github.io, vercel.app).
- Наличие ссылок в описании — стандартная практика для YouTube-видео. Флагуй как спам только мошеннические, вредоносные ссылки или сервисы накрутки.

Отвечай ТОЛЬКО в JSON:
{
  "violation": true/false,
  "severity": "low"/"medium"/"high"/"none",
  "reason": "описание или null",
  "category": "profanity"/"discrimination"/"adult"/"fraud"/"violence"/"spam"/"none"
}`;

// ════════════════════════════════════════════════════════
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ════════════════════════════════════════════════════════
function buildCookieHeader(token) { return 'ytm_session='+token+'; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=31536000'; }
function buildClearCookie() { return 'ytm_session=deleted; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0'; }
function signSession(payload) { return jwt.sign(payload, JWT_SECRET, { expiresIn:'365d' }); }

// ── Email + пароль: хэширование через встроенный в Node scrypt (без внешних npm-пакетов) ──
function hashPassword(password){
  const salt=crypto.randomBytes(16).toString('hex');
  const hash=crypto.scryptSync(password, salt, 64).toString('hex');
  return salt+':'+hash;
}
function verifyPassword(password, stored){
  if(!stored||!stored.includes(':'))return false;
  const [salt, hash]=stored.split(':');
  const check=crypto.scryptSync(password, salt, 64).toString('hex');
  try{ return crypto.timingSafeEqual(Buffer.from(hash,'hex'), Buffer.from(check,'hex')); }catch(e){ return false; }
}
// Домены, запрещённые для регистрации по email — это Google/Apple, вход через которые
// в России теперь не должен использоваться для аутентификации (закон №199-ФЗ, июль 2026)
const BLOCKED_EMAIL_DOMAINS=['gmail.com','googlemail.com','icloud.com','me.com','mac.com'];
function isBlockedEmailDomain(email){
  const domain=(email||'').split('@')[1]?.toLowerCase()||'';
  return BLOCKED_EMAIL_DOMAINS.includes(domain);
}
function extractToken(req) {
  const raw=req.headers.cookie||'';
  const match=raw.match(/ytm_session=([^;]+)/);
  if(match)return match[1];
  const auth=req.headers.authorization||'';
  if(auth.startsWith('Bearer '))return auth.slice(7);
  return null;
}
async function gFetch(url, accessToken) {
  const res=await fetch(url,{ headers:{ Authorization:'Bearer '+accessToken } });
  if(!res.ok){ const text=await res.text(); throw new Error('Google API '+res.status+': '+text); }
  return res.json();
}
async function refreshAccessToken(refreshToken) {
  const res=await fetch('https://oauth2.googleapis.com/token',{
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({ client_id:GOOGLE_CLIENT_ID, client_secret:GOOGLE_CLIENT_SECRET, refresh_token:refreshToken, grant_type:'refresh_token' }),
  });
  const data=await res.json();
  if(!res.ok||data.error)throw new Error(data.error_description||'Token refresh failed');
  return data.access_token;
}
async function getValidAccessToken(payload) {
  if(payload.access_token){
    try{
      const check=await fetch('https://www.googleapis.com/oauth2/v1/tokeninfo?access_token='+payload.access_token);
      const info=await check.json();
      if(check.ok&&info.expires_in&&parseInt(info.expires_in)>300)return payload.access_token;
    }catch(e){}
  }
  if(payload.refresh_token)return refreshAccessToken(payload.refresh_token);
  throw new Error('No tokens available');
}
function parseDurationToSeconds(duration) {
  if(!duration)return 0;
  const m=duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if(!m)return 0;
  return (parseInt(m[1]||0,10)*3600)+(parseInt(m[2]||0,10)*60)+parseInt(m[3]||0,10);
}
function getDateDaysAgo(days){ const d=new Date(); d.setDate(d.getDate()-days); return d.toISOString().split('T')[0]; }
function getTodayString(){ return new Date().toISOString().split('T')[0]; }
function videoAgeLabel(publishedAt){
  if(!publishedAt)return 'дата публикации неизвестна';
  const diffMs=Date.now()-new Date(publishedAt).getTime();
  if(isNaN(diffMs))return 'дата публикации неизвестна';
  const hours=diffMs/3600000;
  if(hours<1)return 'опубликовано менее часа назад';
  if(hours<24)return `опубликовано ${Math.round(hours)} ч назад`;
  const days=Math.round(hours/24);
  if(days===1)return 'опубликовано 1 день назад';
  if(days<7)return `опубликовано ${days} дн. назад`;
  if(days<30)return `опубликовано ${Math.round(days/7)} нед. назад`;
  if(days<365)return `опубликовано ${Math.round(days/30)} мес. назад`;
  return `опубликовано ${Math.round(days/365)} г. назад`;
}
function safeInt(val){ return parseInt(val||0,10); }
function safeFloat(val){ return parseFloat(val||0); }

function calcVideoScore({ views, likes, comments, shares, retentionPct, ctrPct, isShort, swipedRatio, retentionShort }) {
  const v=Math.max(views||0,1), l=likes||0, c=comments||0, s=shares||0;
  if(isShort){
    const viewedPct=swipedRatio!=null?Math.max(0,100-swipedRatio):50;
    const retNorm=retentionShort!=null?Math.min(retentionShort/200,1):0.25;
    const hasSwipe=swipedRatio!=null?1:0.5;
    return Math.min(Math.round(
      retNorm*30*hasSwipe+Math.min((viewedPct/85)*30,30)*hasSwipe+
      Math.min((l/v)*100/3*20,20)+Math.min((c/v)*100/0.5*10,10)+Math.min((s/v)*100/0.5*10,10)
    ),100);
  }
  return Math.min(Math.round(
    Math.min((l/v)*100/3*25,25)+Math.min((c/v)*100/0.5*15,15)+Math.min((s/v)*100/0.5*15,15)+
    Math.min(((retentionPct||0)/70)*25,25)+Math.min(((ctrPct||0)/8)*20,20)
  ),100);
}

async function upsertUserSafe(googleId, email, displayName, extraData={}) {
  try{
    const record={ id:googleId, email, name:displayName||'' };
    if(extraData.google_avatar)record.google_avatar=extraData.google_avatar;
    if(extraData.youtube_channel_name)record.youtube_channel_name=extraData.youtube_channel_name;
    if(extraData.youtube_channel_avatar)record.youtube_channel_avatar=extraData.youtube_channel_avatar;
    if(extraData.subscriber_count!=null)record.subscriber_count=extraData.subscriber_count;
    if(extraData.channel_description)record.channel_description=extraData.channel_description;
    if(extraData.channel_id)record.channel_id=extraData.channel_id;
    if(extraData.channel_url)record.channel_url=extraData.channel_url;
    const { error }=await supabase.from('users').upsert(record,{ onConflict:'id' });
    if(error)console.error('Supabase upsert error:',error.message);
  }catch(e){ console.error('Supabase upsert exception:',e.message); }
}

async function fetchChannels(accessToken) {
  try{
    const data=await gFetch('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true&maxResults=50',accessToken);
    return (data.items||[]).map(item=>{
      const sn=item.snippet||{},st=item.statistics||{},th=sn.thumbnails||{};
      return {
        channel_id:item.id,
        channel_name:sn.title||'YouTube канал',
        channel_url:'https://www.youtube.com/channel/'+item.id,
        avatar_url:(th.high&&th.high.url)||(th.medium&&th.medium.url)||(th.default&&th.default.url)||null,
        subscribers:safeInt(st.subscriberCount),
        video_count:safeInt(st.videoCount),
        view_count:safeInt(st.viewCount),
        channel_description:sn.description||'',
      };
    });
  }catch(e){ console.warn('fetchChannels warning:',e.message); return []; }
}

// ════════════════════════════════════════════════════════
// АДМИНЫ И ПРАВА
// ════════════════════════════════════════════════════════
async function getAdmins() {
  try{
    const { data, error }=await supabase.from('admins').select('*').order('created_at',{ ascending:true });
    if(error){ console.error('getAdmins error:',error.message); return []; }
    return data||[];
  }catch(e){ return []; }
}
async function isAdminEmail(email) {
  if(email===SUPREME_ADMIN_EMAIL)return true;
  const admins=await getAdmins();
  return admins.some(a=>a.email===email);
}
async function isPrimaryAdmin(email) {
  // Verховный админ всегда считается primary, даже если в БД иначе
  if(email===SUPREME_ADMIN_EMAIL)return true;
  const admins=await getAdmins();
  return admins.find(a=>a.email===email)?.is_primary===true;
}
async function getAdminRecord(email) {
  return (await getAdmins()).find(a=>a.email===email)||null;
}
async function getAdminPermissions(email) {
  if(email===SUPREME_ADMIN_EMAIL)return { ...ALL_PERMISSIONS };
  const rec=await getAdminRecord(email);
  if(!rec)return null;
  if(rec.is_primary)return { ...ALL_PERMISSIONS };
  return { ...DEFAULT_PERMISSIONS, ...(rec.permissions||{}) };
}
async function hasPermission(email, permKey) {
  if(email===SUPREME_ADMIN_EMAIL)return true;
  const perms=await getAdminPermissions(email);
  if(!perms)return false;
  return !!perms[permKey];
}
function isSupremeAdmin(email){ return email===SUPREME_ADMIN_EMAIL; }

async function isUserBannedOrWarned(email) {
  try {
    const { data:userData }=await supabase.from('users').select('banned, banned_reason').eq('email',email).single();
    if(userData?.banned){
      if(userData.banned_reason && userData.banned_reason.startsWith('WARNING:')){
        return { banned: true, warned: true, reason: userData.banned_reason.replace('WARNING:', '').trim() };
      }
      return { banned: true, warned: false };
    }
  } catch(e) {}
  return { banned: false };
}

// ════════════════════════════════════════════════════════
// AI ЛИМИТЫ
// ════════════════════════════════════════════════════════
async function getUserUsageToday(email) {
  const today=getTodayString();
  try{
    const { data }=await supabase.from('ai_usage').select('count').eq('email',email).eq('usage_date',today).single();
    return data?.count||0;
  }catch(e){ return 0; }
}
async function incrementUserUsage(email) {
  const today=getTodayString();
  try{
    const current=await getUserUsageToday(email);
    await supabase.from('ai_usage').upsert({ email, usage_date:today, count:current+1 },{ onConflict:'email,usage_date' });
    return current+1;
  }catch(e){ return 0; }
}
async function getGlobalUsageToday() {
  const today=getTodayString();
  try{
    const { data }=await supabase.from('ai_usage_global').select('count').eq('usage_date',today).single();
    return data?.count||0;
  }catch(e){ return 0; }
}
async function incrementGlobalUsage() {
  const today=getTodayString();
  try{
    const current=await getGlobalUsageToday();
    await supabase.from('ai_usage_global').upsert({ usage_date:today, count:current+1 },{ onConflict:'usage_date' });
    return current+1;
  }catch(e){ return 0; }
}

// ════════════════════════════════════════════════════════
// УВЕДОМЛЕНИЯ
// ════════════════════════════════════════════════════════
async function createAdminNotification(type, title, body, relatedId=null) {
  try{
    const { error }=await supabase.from('admin_notifications').insert({ type, title, body, related_id:relatedId, read_by:[] });
    if(error)console.error('createAdminNotification error:',error.message);
  }catch(e){ console.error('createAdminNotification exception:',e.message); }
}

// ════════════════════════════════════════════════════════
// БОТ-МОДЕРАТОР
// ════════════════════════════════════════════════════════
async function moderateVideoContent(video, channelName, userEmail, userId) {
  try{
    const model=genAI.getGenerativeModel({ model:'gemini-2.5-flash', systemInstruction:MODERATION_SYSTEM_PROMPT });
    const prompt=`Канал: "${channelName}"\nНазвание: "${video.title}"\nОписание: "${(video.description||'').slice(0,500)}"`;
    const result=await model.generateContent(prompt);
    const text=result.response.text().trim();
    const jsonMatch=text.match(/\{[\s\S]*\}/);
    if(!jsonMatch)return;
    const verdict=JSON.parse(jsonMatch[0]);
    if(verdict.violation&&(verdict.severity==='medium'||verdict.severity==='high')){
      const severityLabel=verdict.severity==='high'?'🔴 Критическое':'🟡 Среднее';
      const categoryMap={profanity:'Нецензурная лексика',discrimination:'Дискриминация',adult:'Контент 18+',fraud:'Мошенничество',violence:'Пропаганда насилия',spam:'Спам/Накрутка'};
      await createAdminNotification(
        'content_violation',
        `${severityLabel} нарушение правил`,
        `Пользователь: ${userEmail}\nКанал: ${channelName}\nВидео: "${video.title}"\nСсылка: https://www.youtube.com/watch?v=${video.id}\nНарушение: ${categoryMap[verdict.category]||verdict.category}\nПодробности: ${verdict.reason}`,
        userId
      );
      await sendUserMessage(userId,'violation_warning',
        `⚠️ Предупреждение о нарушении правил`,
        `Видео «${video.title}» нарушает правила площадки (${categoryMap[verdict.category]||verdict.category}). ${verdict.reason||''}`
      );
    }
  }catch(e){ console.warn('Moderation bot (non-fatal):',e.message); }
}

// Личное системное сообщение пользователю (раздел «Сообщения»)
async function sendUserMessage(userId, type, title, body) {
  try{
    await supabase.from('user_messages').insert({ user_id:userId, type, title, body, created_at:new Date().toISOString(), read:false });
  }catch(e){ console.warn('sendUserMessage (non-fatal):',e.message); }
}

// ════════════════════════════════════════════════════════
// EXPRESS
// ════════════════════════════════════════════════════════
const app = express();
app.use(express.json({ limit:'10mb' }));
app.use(cors({
  origin:['https://ytmetricsproject-collab.github.io','https://jakjuk523.github.io','https://nightsightr.github.io','http://localhost:3000','http://127.0.0.1:5500'],
  credentials:true, methods:['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders:['Content-Type','Authorization'],
}));

async function requireAuth(req, res) {
  const token=extractToken(req);
  if(!token){ res.status(401).json({ error:'No session' }); return null; }
  try{ return jwt.verify(token, JWT_SECRET); }
  catch(e){ res.status(401).json({ error:'Invalid session' }); return null; }
}
async function requireAdmin(req, res) {
  const payload=await requireAuth(req,res);
  if(!payload)return null;
  const isAdmin=await isAdminEmail(payload.email||'');
  if(!isAdmin){ res.status(403).json({ error:'Forbidden' }); return null; }
  return payload;
}
async function requirePermission(req, res, permKey) {
  const payload=await requireAdmin(req,res);
  if(!payload)return null;
  const ok=await hasPermission(payload.email, permKey);
  if(!ok){ res.status(403).json({ error:'Insufficient permissions', required:permKey }); return null; }
  return payload;
}
async function requireSupreme(req, res) {
  const payload=await requireAdmin(req,res);
  if(!payload)return null;
  if(!isSupremeAdmin(payload.email)){ res.status(403).json({ error:'Only the supreme admin can do this' }); return null; }
  return payload;
}

// ════════════════════════════════════════════════════════
// AI ROUTES
// ════════════════════════════════════════════════════════
app.get('/api/ai/limits', async (req,res)=>{
  const payload=await requireAuth(req,res); if(!payload)return;
  const email=payload.email||'';
  const banStatus = await isUserBannedOrWarned(email);
  if(banStatus.banned){
    if(banStatus.warned) return res.status(403).json({ error:'WARNED', reason: banStatus.reason });
    return res.status(403).json({ error:'BANNED' });
  }
  const isAdmin=await isAdminEmail(email);
  if(isAdmin){
    const globalUsed=await getGlobalUsageToday();
    return res.json({ role:'admin', totalRequestsLeft:Math.max(0,ADMIN_DAILY_LIMIT-globalUsed), totalLimit:ADMIN_DAILY_LIMIT, globalUsed });
  }
  const userUsed=await getUserUsageToday(email);
  return res.json({ role:'user', userRequestsLeft:Math.max(0,USER_DAILY_LIMIT-userUsed), userLimit:USER_DAILY_LIMIT, userUsed });
});

app.post('/api/ai', async (req,res)=>{
  const payload=await requireAuth(req,res); if(!payload)return;
  const email=payload.email||'';
  const banStatus = await isUserBannedOrWarned(email);
  if(banStatus.banned){
    if(banStatus.warned) return res.status(403).json({ error:'WARNED', reason: banStatus.reason });
    return res.status(403).json({ error:'BANNED' });
  }
  const isAdmin=await isAdminEmail(email);
  if(!isAdmin){
    const userUsed=await getUserUsageToday(email);
    if(userUsed>=USER_DAILY_LIMIT)return res.status(429).json({ error:'LIMIT_REACHED', message:`Дневной лимит ${USER_DAILY_LIMIT} запросов исчерпан.`, userRequestsLeft:0, userLimit:USER_DAILY_LIMIT, role:'user' });
  }else{
    const globalUsed=await getGlobalUsageToday();
    if(globalUsed>=ADMIN_DAILY_LIMIT)return res.status(429).json({ error:'GLOBAL_LIMIT_REACHED', message:'Глобальный лимит API исчерпан.', totalRequestsLeft:0, totalLimit:ADMIN_DAILY_LIMIT, role:'admin' });
  }
  const { system, messages, videos, channelInfo }=req.body;
  if(!messages||!Array.isArray(messages))return res.status(400).json({ error:'messages required' });
  try{
    let systemInstruction = system || AI_SYSTEM_PROMPT;
    if(videos && Array.isArray(videos) && videos.length > 0){
      let videoContext = `\n\n=== КОНТЕКСТ КАНАЛА И ВИДЕО ПОЛЬЗОВАТЕЛЯ ===\n`;
      videoContext += `Канал: ${channelInfo?.name || 'Неизвестно'}\n`;
      videoContext += `Подписчики: ${channelInfo?.subscribers || 0}\n\n`;
      videoContext += `Последние видео пользователя (от новых к старым, где индекс 1 — это самое последнее видео):\n`;
      videos.forEach((v, idx) => {
        const isShort = v.type === 'short';
        const ret = isShort
          ? (v.swipedRatio != null ? v.swipedRatio + '% swipe away' : 'нет данных')
          : (v.retention != null ? v.retention + '%' : 'нет данных');
        const ctr = isShort ? '—' : (v.ctr != null ? v.ctr + '%' : 'нет данных');
        videoContext += `${idx + 1}. "${v.title}" [${isShort ? 'Shorts' : 'Обычное видео'}] — ${videoAgeLabel(v.publishedAt||v.published_at)}\n`;
        videoContext += `   Просмотры: ${v.views} | Лайки: ${v.likes} | Комментарии: ${v.comments} | Репосты: ${v.shares}\n`;
        videoContext += `   Удержание: ${ret} | CTR: ${ctr} | Средняя длительность: ${v.avgDurationSec ? Math.round(v.avgDurationSec) + ' сек' : 'нет данных'} | Часы просмотра: ${v.watchHours || 'нет данных'}\n\n`;
      });
      systemInstruction += videoContext;
    }
    const model=genAI.getGenerativeModel({ model:'gemini-2.5-flash', systemInstruction });
    const history=[];
    const lastMessage=messages[messages.length-1];
    for(let i=0;i<messages.length-1;i++){
      const msg=messages[i];
      history.push({ role:msg.role==='assistant'?'model':'user', parts:[{ text:typeof msg.content==='string'?msg.content:JSON.stringify(msg.content) }] });
    }
    const chat=model.startChat({ history });
    const result=await chat.sendMessage(typeof lastMessage.content==='string'?lastMessage.content:JSON.stringify(lastMessage.content));
    const text=result.response.text();
    if(isAdmin){
      const newGlobal=await incrementGlobalUsage();
      return res.json({ text, role:'admin', totalRequestsLeft:Math.max(0,ADMIN_DAILY_LIMIT-newGlobal), totalLimit:ADMIN_DAILY_LIMIT });
    }
    const newUser=await incrementUserUsage(email);
    return res.json({ text, role:'user', userRequestsLeft:Math.max(0,USER_DAILY_LIMIT-newUser), userLimit:USER_DAILY_LIMIT });
  }catch(e){
    console.error('Gemini API error:',e.message);
    return res.status(502).json({ error:'AI_ERROR', message:e.message });
  }
});

// ════════════════════════════════════════════════════════
// АНАЛИЗ ВИДЕО ЧЕРЕЗ GEMINI (детальный разбор для чата)
// ════════════════════════════════════════════════════════
app.post('/api/ai/analyze-videos', async (req,res)=>{
  const payload=await requireAuth(req,res); if(!payload)return;
  const email=payload.email||'';
  const banStatus = await isUserBannedOrWarned(email);
  if(banStatus.banned){
    if(banStatus.warned) return res.status(403).json({ error:'WARNED', reason: banStatus.reason });
    return res.status(403).json({ error:'BANNED' });
  }
  const isAdmin=await isAdminEmail(email);
  if(!isAdmin){
    const userUsed=await getUserUsageToday(email);
    if(userUsed>=USER_DAILY_LIMIT)return res.status(429).json({ error:'LIMIT_REACHED', message:`Дневной лимит ${USER_DAILY_LIMIT} запросов исчерпан.` });
  }else{
    const globalUsed=await getGlobalUsageToday();
    if(globalUsed>=ADMIN_DAILY_LIMIT)return res.status(429).json({ error:'GLOBAL_LIMIT_REACHED', message:'Глобальный лимит API исчерпан.' });
  }
  const { videos, channelInfo, lang }=req.body;
  if(!videos||!Array.isArray(videos)||!videos.length)return res.status(400).json({ error:'videos array required' });

  try{
    const langName=lang==='en'?'English':'Russian';
    const videoLines=videos.slice(0,20).map((v,i)=>{
      const isShort=v.type==='short';
      const ret=isShort
        ? (v.retentionShort!=null?v.retentionShort+'%':'no data — likely low traffic')
        : (v.retention!=null?v.retention+'%':'no data — likely low traffic');
      const ctr=isShort
        ? (v.swipedRatio!=null?v.swipedRatio+'% swiped away':'no data')
        : (v.ctr!=null?v.ctr+'%':'no data');
      return `${i+1}. "${v.title}" [${isShort?'Shorts':'Long-form'}] — published ${v.publishedAt||v.published_at ? videoAgeLabel(v.publishedAt||v.published_at) : 'date unknown'}\n   Views: ${v.views} | Likes: ${v.likes} | Comments: ${v.comments} | Shares: ${v.shares}\n   Retention: ${ret} | CTR/Swipe: ${ctr} | Avg duration: ${v.avgDurationSec?Math.round(v.avgDurationSec)+'s':'no data'} | Watch hours(30d): ${v.watchHours||'no data'}`;
    }).join('\n\n');

    const prompt=`Channel: ${channelInfo?.name||'Unknown'}\nSubscribers: ${channelInfo?.subscribers||0}\n\nVideos data:\n\n${videoLines}\n\nFor each video: explain HOW THE YOUTUBE ALGORITHM IS CURRENTLY TREATING IT — grounded in three things together: (1) how much time has passed since publishing, (2) the topic/niche, (3) the actual metrics. Don't just predict a future number — explain what the current stage of the video's lifecycle means for these specific results (e.g. still in calibration window vs. already past its main distribution window). Then give concrete suggestions to improve. If some metrics show "no data", explain this is common for new channels or videos with low traffic (YouTube Analytics requires a minimum view threshold over 30 days for detailed retention/CTR/Shorts metrics) — do not invent numbers. Be specific, use emoji, organize per-video. Answer in ${langName}.`;

    const model=genAI.getGenerativeModel({ model:'gemini-2.5-flash', systemInstruction:AI_SYSTEM_PROMPT });
    const result=await model.generateContent(prompt);
    const text=result.response.text();

    if(isAdmin){ await incrementGlobalUsage(); } else { await incrementUserUsage(email); }
    return res.json({ text });
  }catch(e){
    console.error('analyze-videos error:',e.message);
    return res.status(502).json({ error:'AI_ERROR', message:e.message });
  }
});

// ════════════════════════════════════════════════════════
// ПОИСК КОНКУРЕНТОВ — Gemini строит поисковый запрос, YouTube ищет,
// Gemini объясняет релевантность каждого результата
// ════════════════════════════════════════════════════════
app.post('/api/competitors/search', async (req,res)=>{
  const payload=await requireAuth(req,res); if(!payload)return;
  const email=payload.email||'';
  const banStatus = await isUserBannedOrWarned(email);
  if(banStatus.banned){
    if(banStatus.warned) return res.status(403).json({ error:'WARNED', reason: banStatus.reason });
    return res.status(403).json({ error:'BANNED' });
  }
  const isAdmin=await isAdminEmail(email);
  if(!isAdmin){
    const userUsed=await getUserUsageToday(email);
    if(userUsed>=USER_DAILY_LIMIT)return res.status(429).json({ error:'LIMIT_REACHED', message:`Дневной лимит ${USER_DAILY_LIMIT} запросов исчерпан.` });
  }else{
    const globalUsed=await getGlobalUsageToday();
    if(globalUsed>=ADMIN_DAILY_LIMIT)return res.status(429).json({ error:'GLOBAL_LIMIT_REACHED', message:'Глобальный лимит API исчерпан.' });
  }
  const { query, lang }=req.body;
  if(!query||!query.trim())return res.status(400).json({ error:'query required' });

  try{
    const accessToken=await getValidAccessToken(payload);
    const model=genAI.getGenerativeModel({ model:'gemini-2.5-flash' });

    // Шаг 1 — Gemini превращает описание ниши в ШИРОКИЙ поисковый запрос по ключевым словам
    const planPrompt=`Ты — помощник поиска конкурентов на YouTube. Пользователь описал свою нишу/тему СВОИМИ словами — это НЕ готовый поисковый запрос, а просто описание того, что ищем.

Твоя задача — понять СМЫСЛ описания и составить запрос из ключевых слов и синонимов темы, который найдёт МАКСИМАЛЬНО РЕЛЕВАНТНЫЙ круг видео на YouTube — а не только видео с точным текстовым совпадением фразы пользователя. Думай как SEO-специалист: используй общеупотребимые в этой нише термины, а не дословный пересказ описания пользователя.

Правила:
- НЕ копируй формулировку пользователя дословно — переформулируй в ключевые слова темы.
- Если пользователь просит "новых"/"свежих" авторов — recentOnly=true, order="date". Если "популярных"/"крупных" — order="viewCount". По умолчанию order="relevance".

Описание пользователя: "${query.trim()}"

Ответь СТРОГО в формате JSON (без markdown, без пояснений):
{"intent":"краткое описание что ищем","query":"широкий поисковый запрос из ключевых слов темы (2-5 слов)","order":"relevance или date или viewCount","recentOnly":true или false}`;

    const planResult=await model.generateContent(planPrompt);
    let planText=(planResult.response.text()||'').trim().replace(/^```json\s*/i,'').replace(/^```\s*/,'').replace(/```\s*$/,'').trim();
    let plan;
    try{ plan=JSON.parse(planText); }catch(e){ plan={ intent:query.trim(), query:query.trim(), order:'relevance', recentOnly:false }; }
    if(!plan.query)plan.query=query.trim();

    // Шаг 2 — реальный поиск по YouTube Data API
    let searchUrl=`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=15&q=${encodeURIComponent(plan.query)}&order=${encodeURIComponent(plan.order||'relevance')}`;
    if(plan.recentOnly){
      const since=new Date(); since.setDate(since.getDate()-30);
      searchUrl+=`&publishedAfter=${since.toISOString()}`;
    }
    const searchData=await gFetch(searchUrl, accessToken);
    const items=(searchData.items||[]).filter(it=>it.id&&it.id.videoId);
    if(!items.length){
      if(isAdmin){ await incrementGlobalUsage(); } else { await incrementUserUsage(email); }
      return res.json({ plan, results:[] });
    }

    // Статистика по найденным видео (просмотры, лайки, комментарии, длительность) — одним батч-запросом
    const videoIds=items.map(it=>it.id.videoId).join(',');
    let statsMap={};
    try{
      const statsData=await gFetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails&id=${videoIds}`, accessToken);
      (statsData.items||[]).forEach(v=>{
        statsMap[v.id]={
          views: v.statistics?.viewCount ? parseInt(v.statistics.viewCount,10) : null,
          likes: v.statistics?.likeCount ? parseInt(v.statistics.likeCount,10) : null,
          comments: v.statistics?.commentCount ? parseInt(v.statistics.commentCount,10) : null,
          durationSec: parseDurationToSeconds(v.contentDetails?.duration),
        };
      });
    }catch(e){ console.warn('competitor stats fetch failed (non-fatal):', e.message); }

    // Подписчики каналов — тоже батч-запросом
    const channelIds=[...new Set(items.map(it=>it.snippet.channelId))].join(',');
    let channelMap={};
    try{
      const chData=await gFetch(`https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${channelIds}`, accessToken);
      (chData.items||[]).forEach(c=>{ channelMap[c.id]={ subscribers: c.statistics?.subscriberCount ? parseInt(c.statistics.subscriberCount,10) : null }; });
    }catch(e){ console.warn('competitor channel stats fetch failed (non-fatal):', e.message); }

    const compact=items.map((it,i)=>({
      index:i, title:it.snippet.title, channel:it.snippet.channelTitle,
      description:(it.snippet.description||'').slice(0,200),
      publishedAt:it.snippet.publishedAt,
      views:statsMap[it.id.videoId]?.views??null,
    }));

    // Шаг 3 — Gemini объясняет релевантность каждого результата
    const langName=lang==='en'?'English':(lang==='ar'?'Arabic':'Russian');
    const rankPrompt=`Ниша/тема пользователя: "${query.trim()}"
Распознанное намерение: "${plan.intent||query.trim()}"

Ниже список найденных на YouTube видео-конкурентов в формате JSON:
${JSON.stringify(compact)}

Оцени каждое видео по релевантности как конкурента (от 0 до 1) и дай короткое объяснение (до 10 слов) почему это релевантный конкурент или чем полезен для анализа. Учитывай тему, а не только совпадение слов.

Ответь СТРОГО в формате JSON (без markdown): {"ranking":[{"index":0,"relevance":0.9,"reason":"..."},...]}. Язык объяснений: ${langName}.`;

    let ranking=[];
    try{
      const rankResult=await model.generateContent(rankPrompt);
      let rankText=(rankResult.response.text()||'').trim().replace(/^```json\s*/i,'').replace(/^```\s*/,'').replace(/```\s*$/,'').trim();
      const parsed=JSON.parse(rankText);
      ranking=parsed.ranking||[];
    }catch(e){ console.warn('competitor ranking failed (non-fatal):', e.message); }
    const byIndex=new Map(ranking.map(r=>[r.index,r]));

    const results=items.map((it,i)=>{
      const rank=byIndex.get(i);
      const vid=it.id.videoId, chId=it.snippet.channelId;
      const durationSec=statsMap[vid]?.durationSec ?? null;
      return {
        video_id:vid, title:it.snippet.title, description:it.snippet.description||'',
        thumbnail: it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url || null,
        channel_name: it.snippet.channelTitle, channel_id: chId,
        channel_url: `https://www.youtube.com/channel/${chId}`,
        video_url: `https://www.youtube.com/watch?v=${vid}`,
        published_at: it.snippet.publishedAt,
        views: statsMap[vid]?.views ?? null,
        likes: statsMap[vid]?.likes ?? null,
        comments: statsMap[vid]?.comments ?? null,
        duration_sec: durationSec,
        type: (durationSec!=null && durationSec>0 && durationSec<=60) ? 'short' : 'long',
        subscribers: channelMap[chId]?.subscribers ?? null,
        relevance: rank?.relevance ?? 0.5,
        reason: rank?.reason ?? '',
      };
    }).sort((a,b)=>(b.relevance??0)-(a.relevance??0));

    if(isAdmin){ await incrementGlobalUsage(); } else { await incrementUserUsage(email); }
    return res.json({ plan, results });
  }catch(e){
    console.error('competitors search error:',e.message);
    return res.status(502).json({ error:'AI_ERROR', message:e.message });
  }
});

// ════════════════════════════════════════════════════════
// СЦЕНАРИИ — анкета (ссылки на соцсети + заметки) и генерация 3 вариантов
// ════════════════════════════════════════════════════════
app.get('/api/scripts/profile', async (req,res)=>{
  const payload=await requireAuth(req,res); if(!payload)return;
  const email=payload.email||'';
  const banStatus = await isUserBannedOrWarned(email);
  if(banStatus.banned){
    if(banStatus.warned) return res.status(403).json({ error:'WARNED', reason: banStatus.reason });
    return res.status(403).json({ error:'BANNED' });
  }
  try{
    const userId=payload.sub||email;
    const { data, error }=await supabase.from('script_profiles').select('*').eq('user_id',userId).maybeSingle();
    if(error){ console.error('scripts profile fetch error:',error.message); return res.status(500).json({ error:'Database error' }); }
    return res.json({ profile: data || null });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

app.post('/api/scripts/profile', async (req,res)=>{
  const payload=await requireAuth(req,res); if(!payload)return;
  const email=payload.email||'';
  const banStatus = await isUserBannedOrWarned(email);
  if(banStatus.banned){
    if(banStatus.warned) return res.status(403).json({ error:'WARNED', reason: banStatus.reason });
    return res.status(403).json({ error:'BANNED' });
  }
  const { social_links, likes_text, dislikes_text }=req.body;
  if(social_links!=null && typeof social_links!=='object')return res.status(400).json({ error:'social_links must be an object' });
  if(likes_text!=null && String(likes_text).length>3000)return res.status(400).json({ error:'likes_text too long' });
  if(dislikes_text!=null && String(dislikes_text).length>3000)return res.status(400).json({ error:'dislikes_text too long' });
  try{
    const userId=payload.sub||email;
    const row={
      user_id:userId, user_email:email,
      social_links: social_links||{},
      likes_text: (likes_text||'').trim(),
      dislikes_text: (dislikes_text||'').trim(),
      updated_at: new Date().toISOString(),
    };
    const { data, error }=await supabase.from('script_profiles').upsert(row,{ onConflict:'user_id' }).select().single();
    if(error){ console.error('scripts profile save error:',error.message); return res.status(500).json({ error:'Database error' }); }
    return res.json({ profile:data });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

app.post('/api/scripts/generate', async (req,res)=>{
  const payload=await requireAuth(req,res); if(!payload)return;
  const email=payload.email||'';
  const banStatus = await isUserBannedOrWarned(email);
  if(banStatus.banned){
    if(banStatus.warned) return res.status(403).json({ error:'WARNED', reason: banStatus.reason });
    return res.status(403).json({ error:'BANNED' });
  }
  const isAdmin=await isAdminEmail(email);
  if(!isAdmin){
    const userUsed=await getUserUsageToday(email);
    if(userUsed>=USER_DAILY_LIMIT)return res.status(429).json({ error:'LIMIT_REACHED', message:`Дневной лимит ${USER_DAILY_LIMIT} запросов исчерпан.` });
  }else{
    const globalUsed=await getGlobalUsageToday();
    if(globalUsed>=ADMIN_DAILY_LIMIT)return res.status(429).json({ error:'GLOBAL_LIMIT_REACHED', message:'Глобальный лимит API исчерпан.' });
  }
  const { social_links, likes_text, dislikes_text, videos, channelInfo, lang }=req.body;
  if((!likes_text||!likes_text.trim()) && (!dislikes_text||!dislikes_text.trim())){
    return res.status(400).json({ error:'likes_text or dislikes_text required' });
  }
  try{
    const langName=lang==='en'?'English':(lang==='ar'?'Arabic':'Russian');
    const links=social_links||{};
    const linksLines=Object.entries(links).filter(([,v])=>v&&String(v).trim()).map(([k,v])=>`- ${k}: ${v}`).join('\n')||'(ссылки не указаны)';

    let ytContext='';
    if(videos && Array.isArray(videos) && videos.length>0){
      ytContext=`\n\nРеальные данные последних видео с YouTube-канала "${channelInfo?.name||'—'}" (подписчиков: ${channelInfo?.subscribers||0}):\n`;
      videos.slice(0,15).forEach((v,i)=>{
        const isShort=v.type==='short';
        const ret=isShort?(v.swipedRatio!=null?v.swipedRatio+'% свайпнули':'нет данных'):(v.retention!=null?v.retention+'% удержание':'нет данных');
        ytContext+=`${i+1}. "${v.title}" [${isShort?'Shorts':'Long-form'}] — ${videoAgeLabel(v.publishedAt)}, ${v.views} просмотров, ${ret}\n`;
      });
    }

    const prompt=`Ты — продюсер и сценарист YouTube-контента. Пользователь ведёт следующие соцсети (ссылки даны только для понимания ниши/тематики, реальную статистику по ним ты не видишь):
${linksLines}
${ytContext}

Что пользователю нравится делать / что хорошо получается:
${(likes_text||'(не указано)').trim()}

Что пользователю не нравится делать / что получается хуже:
${(dislikes_text||'(не указано)').trim()}

Задача: на основе этой информации предложи РОВНО 3 разных варианта сценария для следующего видео. Каждый вариант должен учитывать сильные стороны автора и по возможности избегать того, что ему не нравится или не даётся.

Ответь СТРОГО в формате JSON-массива (без markdown, без пояснений вне JSON) из 3 объектов вида:
{"title":"название видео","format":"Shorts или Long-form","hook":"первые 3-5 секунд / крючок","structure":["пункт 1 структуры","пункт 2","..."],"cta":"призыв к действию в конце","why":"почему это подходит именно этому автору, 1-2 предложения"}

Язык ответа: ${langName}.`;

    const model=genAI.getGenerativeModel({ model:'gemini-2.5-flash' });
    const result=await model.generateContent(prompt);
    let text=result.response.text()||'';
    text=text.trim().replace(/^```json\s*/i,'').replace(/^```\s*/,'').replace(/```\s*$/,'').trim();
    let scripts=null;
    try{
      const start=text.indexOf('['), end=text.lastIndexOf(']');
      scripts=JSON.parse(start!==-1&&end!==-1?text.slice(start,end+1):text);
    }catch(e){
      console.error('scripts JSON parse failed:',e.message);
    }

    if(isAdmin){ await incrementGlobalUsage(); } else { await incrementUserUsage(email); }
    if(Array.isArray(scripts) && scripts.length){
      return res.json({ scripts });
    }
    return res.json({ scripts:null, raw:text });
  }catch(e){
    console.error('scripts generate error:',e.message);
    return res.status(502).json({ error:'AI_ERROR', message:e.message });
  }
});

// ════════════════════════════════════════════════════════
// ADMIN ROUTES — ПОЛЬЗОВАТЕЛИ
// ════════════════════════════════════════════════════════
app.get('/api/admin/users', async (req,res)=>{
  const payload=await requirePermission(req,res,'view_users'); if(!payload)return;
  try{
    const { data, error }=await supabase
      .from('users')
      .select('id,email,name,google_avatar,youtube_channel_name,youtube_channel_avatar,subscriber_count,channel_description,channel_id,channel_url,created_at,banned,banned_at,banned_reason')
      .order('created_at',{ ascending:false });
    if(error){
      console.error('admin/users DB error:', JSON.stringify(error));
      return res.status(500).json({ error:'Database error', details:error.message });
    }
    return res.json({ users:data||[] });
  }catch(e){
    console.error('admin/users exception:', e.message);
    return res.status(500).json({ error:'Server error' });
  }
});

app.post('/api/admin/ban', async (req,res)=>{
  const payload=await requirePermission(req,res,'ban_users'); if(!payload)return;
  const { userId, reason }=req.body;
  if(!userId)return res.status(400).json({ error:'userId required' });
  try{
    const { data:targetUser }=await supabase.from('users').select('email,name').eq('id',userId).single();
    if(targetUser){
      if(await isAdminEmail(targetUser.email))return res.status(400).json({ error:'Cannot ban admin' });
      if(targetUser.email===payload.email)return res.status(400).json({ error:'Cannot ban yourself' });
    }
    const { error }=await supabase.from('users').update({ banned:true, banned_at:new Date().toISOString(), banned_reason:reason||null }).eq('id',userId);
    if(error)return res.status(500).json({ error:'Database error' });
    await createAdminNotification('user_banned','🚫 Пользователь заблокирован',`${payload.email} заблокировал ${targetUser?.name||targetUser?.email||userId}${reason?'\nПричина: '+reason:''}`,userId);
    return res.json({ ok:true });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

app.post('/api/admin/unban', async (req,res)=>{
  const payload=await requirePermission(req,res,'ban_users'); if(!payload)return;
  const { userId }=req.body;
  if(!userId)return res.status(400).json({ error:'userId required' });
  try{
    const { error }=await supabase.from('users').update({ banned:false, banned_at:null, banned_reason:null }).eq('id',userId);
    if(error)return res.status(500).json({ error:'Database error' });
    return res.json({ ok:true });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

app.delete('/api/admin/users/:id', async (req,res)=>{
  const payload=await requirePermission(req,res,'ban_users'); if(!payload)return;
  const userId=req.params.id;
  try{
    const { data:targetUser }=await supabase.from('users').select('email,name').eq('id',userId).single();
    if(!targetUser)return res.status(404).json({ error:'User not found' });
    if(targetUser.email===payload.email)return res.status(400).json({ error:'Cannot delete yourself' });
    if(await isAdminEmail(targetUser.email))return res.status(400).json({ error:'Cannot delete admin. Remove admin rights first.' });
    const email=targetUser.email;
    await supabase.from('ai_usage').delete().eq('email',email);
    await supabase.from('feedback').delete().eq('user_email',email);
    await supabase.from('appeals').delete().eq('user_id',userId);
    await supabase.from('news_reactions').delete().eq('user_email',email);
    await supabase.from('news_comments').delete().eq('user_email',email);
    const { error }=await supabase.from('users').delete().eq('id',userId);
    if(error)return res.status(500).json({ error:'Database error' });
    await createAdminNotification('user_deleted','🗑️ Пользователь удалён',`${payload.email} удалил аккаунт ${targetUser.name||email} (${email})`);
    return res.json({ ok:true });
  }catch(e){ console.error('Delete user error:',e.message); return res.status(500).json({ error:'Server error' }); }
});

// ════════════════════════════════════════════════════════
// ADMIN ROUTES — АДМИНЫ И ПРАВА
// ════════════════════════════════════════════════════════

// GET /api/admin/me-permissions — текущие права залогиненного админа (для UI)
app.get('/api/admin/me-permissions', async (req,res)=>{
  const payload=await requireAdmin(req,res); if(!payload)return;
  const perms=await getAdminPermissions(payload.email);
  return res.json({
    permissions: perms||DEFAULT_PERMISSIONS,
    isSupreme: isSupremeAdmin(payload.email),
    isPrimary: await isPrimaryAdmin(payload.email),
  });
});

app.get('/api/admin/admins', async (req,res)=>{
  const payload=await requirePermission(req,res,'view_admins'); if(!payload)return;
  try{
    const admins=await getAdmins();
    const emails=admins.map(a=>a.email);
    let usersMap={};
    if(emails.length){
      const { data:usersData }=await supabase.from('users').select('email,name,google_avatar,youtube_channel_name').in('email',emails);
      (usersData||[]).forEach(u=>{ usersMap[u.email]=u; });
    }
    const result=admins.map(a=>({
      ...a,
      name:usersMap[a.email]?.name||a.email,
      google_avatar:usersMap[a.email]?.google_avatar||null,
      youtube_channel_name:usersMap[a.email]?.youtube_channel_name||null,
      permissions: a.email===SUPREME_ADMIN_EMAIL ? ALL_PERMISSIONS : { ...DEFAULT_PERMISSIONS, ...(a.permissions||{}) },
      is_supreme: a.email===SUPREME_ADMIN_EMAIL,
    }));
    return res.json({
      admins:result,
      currentEmail:payload.email,
      isPrimary:await isPrimaryAdmin(payload.email),
      isSupreme:isSupremeAdmin(payload.email),
      supremeEmail: SUPREME_ADMIN_EMAIL,
    });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

// POST /api/admin/make-admin — ТОЛЬКО supreme admin
app.post('/api/admin/make-admin', async (req,res)=>{
  const payload=await requireSupreme(req,res); if(!payload)return;
  const { userId, permissions }=req.body;
  if(!userId)return res.status(400).json({ error:'userId required' });
  try{
    const { data:targetUser, error:userErr }=await supabase.from('users').select('id,email,banned').eq('id',userId).single();
    if(userErr||!targetUser)return res.status(404).json({ error:'User not found' });
    if(targetUser.banned)return res.status(400).json({ error:'Cannot make banned user an admin' });
    if(await isAdminEmail(targetUser.email))return res.status(400).json({ error:'User is already an admin' });
    // Права можно задать сразу при назначении (если не переданы — берутся по умолчанию,
    // их всегда можно изменить позже через "🔐 Права")
    let finalPerms={...DEFAULT_PERMISSIONS};
    if(permissions && typeof permissions==='object'){
      Object.keys(DEFAULT_PERMISSIONS).forEach(k=>{ finalPerms[k]=!!permissions[k]; });
    }
    const { error }=await supabase.from('admins').insert({
      user_id:targetUser.id, email:targetUser.email, is_primary:false,
      added_by:payload.email, permissions:finalPerms,
    });
    if(error)return res.status(500).json({ error:'Database error' });
    await createAdminNotification('new_admin','⭐ Новый администратор',`${payload.email} назначил ${targetUser.email} администратором`);
    return res.json({ ok:true, permissions:finalPerms });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

// POST /api/admin/remove-admin — ТОЛЬКО supreme admin
app.post('/api/admin/remove-admin', async (req,res)=>{
  const payload=await requireSupreme(req,res); if(!payload)return;
  const { email }=req.body;
  if(!email)return res.status(400).json({ error:'email required' });
  if(email===payload.email)return res.status(400).json({ error:'Cannot remove yourself' });
  if(email===SUPREME_ADMIN_EMAIL)return res.status(400).json({ error:'Cannot remove the supreme admin' });
  try{
    const { error }=await supabase.from('admins').delete().eq('email',email);
    if(error)return res.status(500).json({ error:'Database error' });
    return res.json({ ok:true });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

// POST /api/admin/ban-admin — ТОЛЬКО supreme admin (блокирует учётку самого админа)
app.post('/api/admin/ban-admin', async (req,res)=>{
  const payload=await requireSupreme(req,res); if(!payload)return;
  const { userId, email }=req.body;
  if(!userId||!email)return res.status(400).json({ error:'userId and email required' });
  if(email===payload.email)return res.status(400).json({ error:'Cannot ban yourself' });
  if(email===SUPREME_ADMIN_EMAIL)return res.status(400).json({ error:'Cannot ban the supreme admin' });
  try{
    const { error }=await supabase.from('users').update({ banned:true, banned_at:new Date().toISOString(), banned_reason:'Banned by supreme admin' }).eq('id',userId);
    if(error)return res.status(500).json({ error:'Database error' });
    await createAdminNotification('user_banned','🚫 Администратор заблокирован',`${payload.email} заблокировал админа ${email}`);
    return res.json({ ok:true });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

// POST /api/admin/set-permissions — ТОЛЬКО supreme admin: задать конкретные права админу
app.post('/api/admin/set-permissions', async (req,res)=>{
  const payload=await requireSupreme(req,res); if(!payload)return;
  const { email, permissions }=req.body;
  if(!email||!permissions||typeof permissions!=='object')return res.status(400).json({ error:'email and permissions required' });
  if(email===SUPREME_ADMIN_EMAIL)return res.status(400).json({ error:'Cannot modify supreme admin permissions' });
  try{
    const rec=await getAdminRecord(email);
    if(!rec)return res.status(404).json({ error:'Admin not found' });
    // Фильтруем только известные ключи прав
    const cleanPerms={};
    Object.keys(DEFAULT_PERMISSIONS).forEach(k=>{ cleanPerms[k]=!!permissions[k]; });
    const { error }=await supabase.from('admins').update({ permissions:cleanPerms }).eq('email',email);
    if(error)return res.status(500).json({ error:'Database error' });
    return res.json({ ok:true, permissions:cleanPerms });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

// POST /api/admin/grant-all-permissions — "Передать все права" — ТОЛЬКО supreme admin
app.post('/api/admin/grant-all-permissions', async (req,res)=>{
  const payload=await requireSupreme(req,res); if(!payload)return;
  const { email }=req.body;
  if(!email)return res.status(400).json({ error:'email required' });
  if(email===SUPREME_ADMIN_EMAIL)return res.status(400).json({ error:'Supreme admin already has all permissions' });
  try{
    const rec=await getAdminRecord(email);
    if(!rec)return res.status(404).json({ error:'Admin not found' });
    const { error }=await supabase.from('admins').update({ permissions:ALL_PERMISSIONS }).eq('email',email);
    if(error)return res.status(500).json({ error:'Database error' });
    await createAdminNotification('new_admin','⭐ Полные права выданы',`${payload.email} выдал ВСЕ права администратору ${email}`);
    return res.json({ ok:true, permissions:ALL_PERMISSIONS });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

// ════════════════════════════════════════════════════════
// ОПЛАТА — CRYPTOCLOUD
// ════════════════════════════════════════════════════════
const CRYPTOCLOUD_API_KEY = process.env.CRYPTOCLOUD_API_KEY || '';
const CRYPTOCLOUD_SHOP_ID = process.env.CRYPTOCLOUD_SHOP_ID || '';
const CRYPTOCLOUD_SECRET  = process.env.CRYPTOCLOUD_SECRET  || '';

// Создать счёт в CryptoCloud. purpose/reference_id — что именно оплачивается (см. таблицу payments).
async function createCryptoCloudInvoice({ amountUsd, orderId, email }) {
  if(!CRYPTOCLOUD_API_KEY||!CRYPTOCLOUD_SHOP_ID)throw new Error('CRYPTOCLOUD_NOT_CONFIGURED');
  const res=await fetch('https://api.cryptocloud.plus/v2/invoice/create',{
    method:'POST',
    headers:{ 'Authorization':'Token '+CRYPTOCLOUD_API_KEY, 'Content-Type':'application/json' },
    body:JSON.stringify({ amount:amountUsd, shop_id:CRYPTOCLOUD_SHOP_ID, currency:'USD', order_id:orderId, email:email||undefined }),
  });
  const data=await res.json();
  if(!res.ok||data.status!=='success')throw new Error('CryptoCloud invoice error: '+JSON.stringify(data));
  return data.result; // { uuid, pay_url, ... }
}

// Проверка postback-уведомления. CryptoCloud присылает JWT-токен (HS256), подписанный секретом проекта.
function verifyCryptoCloudPostback(token) {
  if(!CRYPTOCLOUD_SECRET)throw new Error('CRYPTOCLOUD_NOT_CONFIGURED');
  return jwt.verify(token, CRYPTOCLOUD_SECRET, { algorithms:['HS256'] });
}

// Реальный баланс кошелька (уже за вычетом всех выводов) — чтобы счётчик на сайте
// не копил "виртуальные" деньги, которые владелец уже вывел себе.
async function getCryptoCloudBalance() {
  if(!CRYPTOCLOUD_API_KEY)return { configured:false, total_usd:0, currencies:[] };
  const res=await fetch('https://api.cryptocloud.plus/v2/merchant/wallet/balance/all',{
    method:'POST', headers:{ 'Authorization':'Token '+CRYPTOCLOUD_API_KEY },
  });
  const data=await res.json();
  if(!res.ok||data.status!=='success')throw new Error('CryptoCloud balance error: '+JSON.stringify(data));
  const list=data.result||[];
  const total=list.reduce((sum,c)=>sum+(parseFloat(c.available_balance_usd||c.balance_usd||0)),0);
  return { configured:true, total_usd:Math.round(total*100)/100, currencies:list };
}

// Создать запись платежа + счёт в CryptoCloud. purpose: 'subscription' | 'ad'
async function initiatePayment({ userId, email, purpose, referenceId, amountUsd }) {
  const orderId=purpose+'_'+(referenceId||userId)+'_'+Date.now();
  const invoice=await createCryptoCloudInvoice({ amountUsd, orderId, email });
  const record={
    user_id:userId, user_email:email, purpose, reference_id:referenceId||null,
    amount_usd:amountUsd, status:'pending', invoice_uuid:invoice.uuid, pay_url:invoice.pay_url,
    created_at:new Date().toISOString(),
  };
  const { data, error }=await supabase.from('payments').insert(record).select().single();
  if(error)throw new Error('DB error creating payment: '+error.message);
  return { payment:data, pay_url:invoice.pay_url };
}

// ════════════════════════════════════════════════════════
// ПРЕМИУМ / МОНЕТИЗАЦИЯ
// ════════════════════════════════════════════════════════
// Список вкладок сайта, которые можно закрыть премиумом. Ключи совпадают
// с data-tab в index.html. Вкладка "news" сюда намеренно НЕ входит — там
// как раз показывается реклама, раздел всегда открыт всем.
const PREMIUM_LOCKABLE_SECTIONS = [
  { key:'forecast',    label:'Прогноз ролика' },
  { key:'calc',        label:'Калькулятор метрик' },
  { key:'ai',          label:'Чат с ИИ' },
  { key:'scripts',     label:'Сценарии' },
  { key:'competitors', label:'Конкуренты' },
];
const DEFAULT_PREMIUM_SETTINGS = {
  enabled:false,
  premium_sections:[],
  price_month:'',
  price_6months:'',
  price_year:'',
  excluded_emails:[],
};

async function getPremiumSettings() {
  try{
    const { data, error }=await supabase.from('premium_settings').select('*').eq('id',1).single();
    if(error||!data)return { ...DEFAULT_PREMIUM_SETTINGS };
    return {
      enabled: !!data.enabled,
      premium_sections: Array.isArray(data.premium_sections)?data.premium_sections:[],
      price_month: data.price_month||'',
      price_6months: data.price_6months||'',
      price_year: data.price_year||'',
      excluded_emails: Array.isArray(data.excluded_emails)?data.excluded_emails:[],
    };
  }catch(e){ return { ...DEFAULT_PREMIUM_SETTINGS }; }
}

// Доступ к разделу «Премиум»: главный (supreme) админ ИЛИ админ с правом access_premium_panel
async function requirePremiumAccess(req,res) {
  const payload=await requireAdmin(req,res); if(!payload)return null;
  const ok=await hasPermission(payload.email,'access_premium_panel');
  if(!ok){ res.status(403).json({ error:'Insufficient permissions', required:'access_premium_panel' }); return null; }
  return payload;
}

// GET /api/premium/config — полная конфигурация.
app.get('/api/premium/config', async (req,res)=>{
  const payload=await requirePremiumAccess(req,res); if(!payload)return;
  try{
    const settings=await getPremiumSettings();
    return res.json({ settings, lockable_sections:PREMIUM_LOCKABLE_SECTIONS });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

// POST /api/premium/config — сохранить конфигурацию.
app.post('/api/premium/config', async (req,res)=>{
  const payload=await requirePremiumAccess(req,res); if(!payload)return;
  const { enabled, premium_sections, price_month, price_6months, price_year, excluded_emails }=req.body||{};
  try{
    const allowedKeys=PREMIUM_LOCKABLE_SECTIONS.map(s=>s.key);
    const cleanSections=Array.isArray(premium_sections)?premium_sections.filter(k=>allowedKeys.includes(k)):[];
    // Главного админа исключить из списка "отключить премиум для" нельзя — он и так не ограничен
    const cleanExcluded=Array.isArray(excluded_emails)?excluded_emails.filter(e=>typeof e==='string'&&e!==SUPREME_ADMIN_EMAIL).slice(0,1000):[];
    const clean=s=>typeof s==='string'?s.slice(0,120):'';
    const record={
      id:1,
      enabled:!!enabled,
      premium_sections:cleanSections,
      price_month:clean(price_month),
      price_6months:clean(price_6months),
      price_year:clean(price_year),
      excluded_emails:cleanExcluded,
      updated_at:new Date().toISOString(),
      updated_by:payload.email,
    };
    const { error }=await supabase.from('premium_settings').upsert(record,{ onConflict:'id' });
    if(error)return res.status(500).json({ error:'Database error', details:error.message });
    const { id,updated_at,updated_by, ...settings }=record;
    return res.json({ ok:true, settings });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

// GET /api/premium/status — облегчённая версия для ЛЮБОГО залогиненного пользователя.
app.get('/api/premium/status', async (req,res)=>{
  const payload=await requireAuth(req,res); if(!payload)return;
  try{
    const settings=await getPremiumSettings();
    const isExcluded=settings.excluded_emails.includes(payload.email);
    const isAdmin=await isAdminEmail(payload.email);
    return res.json({
      enabled:settings.enabled,
      premium_sections: settings.enabled?settings.premium_sections:[],
      price_month:settings.price_month,
      price_6months:settings.price_6months,
      price_year:settings.price_year,
      exempt: isAdmin||isExcluded,
    });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

// GET /api/premium/wallet-balance — реальный остаток на кошельке CryptoCloud
// (за вычетом уже выведенных средств). Доступно supreme-админу и админам с manage_billing.
app.get('/api/premium/wallet-balance', async (req,res)=>{
  const payload=await requireAdmin(req,res); if(!payload)return;
  const ok=await hasPermission(payload.email,'manage_billing');
  if(!ok)return res.status(403).json({ error:'Insufficient permissions', required:'manage_billing' });
  try{
    const balance=await getCryptoCloudBalance();
    return res.json(balance);
  }catch(e){ return res.status(200).json({ configured:true, total_usd:null, error:e.message }); }
});

// POST /api/payments/create-invoice — создать счёт на оплату подписки-премиум пользователем.
// Сумма берётся из текстового поля цены (админ пишет её сам) — парсим число из строки.
app.post('/api/payments/create-invoice', async (req,res)=>{
  const payload=await requireAuth(req,res); if(!payload)return;
  const { plan }=req.body||{}; // 'month' | '6months' | 'year'
  if(!['month','6months','year'].includes(plan))return res.status(400).json({ error:'Invalid plan' });
  try{
    const settings=await getPremiumSettings();
    if(!settings.enabled)return res.status(400).json({ error:'Premium is disabled' });
    const priceField={ month:'price_month', '6months':'price_6months', year:'price_year' }[plan];
    const amount=parseFloat(String(settings[priceField]).replace(/[^\d.]/g,''));
    if(!amount||amount<=0)return res.status(400).json({ error:'Price is not set for this plan' });
    const { pay_url }=await initiatePayment({ userId:payload.sub, email:payload.email, purpose:'subscription', referenceId:plan, amountUsd:amount });
    return res.json({ ok:true, pay_url });
  }catch(e){
    if(e.message==='CRYPTOCLOUD_NOT_CONFIGURED')return res.status(503).json({ error:'Payment provider is not configured yet' });
    return res.status(500).json({ error:'Server error', details:e.message });
  }
});

// POST /api/payments/postback — сюда CryptoCloud шлёт уведомление об успешной оплате
app.post('/api/payments/postback', async (req,res)=>{
  try{
    const { status, invoice_id, token }=req.body||{};
    if(status!=='success'&&status!=='paid')return res.status(200).json({ ok:true }); // игнорируем неуспешные статусы
    if(token){ try{ verifyCryptoCloudPostback(token); }catch(e){ return res.status(403).json({ error:'Invalid signature' }); } }
    const { data:payment, error }=await supabase.from('payments').select('*').eq('invoice_uuid',invoice_id).single();
    if(error||!payment)return res.status(404).json({ error:'Payment not found' });
    if(payment.status==='paid')return res.json({ ok:true }); // уже обработано, защита от повторных postback

    await supabase.from('payments').update({ status:'paid', paid_at:new Date().toISOString() }).eq('id',payment.id);

    if(payment.purpose==='subscription'){
      const days={ month:30, '6months':182, year:365 }[payment.reference_id]||30;
      const periodEnd=new Date(Date.now()+days*86400000).toISOString();
      await supabase.from('subscriptions').upsert({
        user_id:payment.user_id, user_email:payment.user_email, status:'active',
        current_period_end:periodEnd, last_invoice_uuid:invoice_id, updated_at:new Date().toISOString(),
      },{ onConflict:'user_id' });
    }
    if(payment.purpose==='ad'){
      await supabase.from('ads').update({ status:'active', published_at:new Date().toISOString() }).eq('id',payment.reference_id);
    }
    return res.json({ ok:true });
  }catch(e){ return res.status(500).json({ error:'Server error', details:e.message }); }
});

// ════════════════════════════════════════════════════════
// РЕКЛАМА
// ════════════════════════════════════════════════════════
const DEFAULT_AD_SETTINGS = { enabled:false, price_text:'', cooldown_type:'week', cooldown_custom_days:30 };

const AD_MODERATION_SYSTEM_PROMPT = `Ты — модератор рекламных объявлений платформы YTMetrics. Тебе присылают: текст объявления и данные YouTube-канала, который рекламируют (название, описание, иногда — статистика). Проверь на нарушения правил площадки.

ПРАВИЛА ПЛОЩАДКИ:
1. Нецензурная лексика
2. Оскорбительный, дискриминационный контент
3. Контент 18+ (сексуальный, шокирующий, жестокий)
4. Мошенничество (казино, финансовые пирамиды, фишинг, "быстрый заработок")
5. Экстремизм, пропаganda насилия
6. Явно вводящий в заблуждение текст объявления (кликбейт с ложными обещаниями)

Отвечай ТОЛЬКО в JSON:
{"violation": true/false, "severity": "low"/"medium"/"high"/"none", "reason": "описание или null", "category": "profanity"/"discrimination"/"adult"/"fraud"/"violence"/"misleading"/"none"}`;

const AD_IMAGE_MODERATION_PROMPT = `Ты — модератор изображений рекламных объявлений. Проверь картинку на: контент 18+, шокирующий/жестокий контент, экстремистскую символику, явно мошеннический визуал (поддельные "казино выигрыши" и т.п.). Отвечай ТОЛЬКО в JSON: {"violation": true/false, "severity":"low"/"medium"/"high"/"none", "reason": "описание или null"}`;

async function getAdSettings() {
  try{
    const { data, error }=await supabase.from('ad_settings').select('*').eq('id',1).single();
    if(error||!data)return { ...DEFAULT_AD_SETTINGS };
    return {
      enabled: !!data.enabled,
      price_text: data.price_text||'',
      cooldown_type: data.cooldown_type||'week',
      cooldown_custom_days: data.cooldown_custom_days||30,
    };
  }catch(e){ return { ...DEFAULT_AD_SETTINGS }; }
}
function cooldownDays(settings){
  if(settings.cooldown_type==='month')return 30;
  if(settings.cooldown_type==='custom')return settings.cooldown_custom_days||30;
  return 7; // week
}

// Достаём channel_id из произвольной ссылки на YouTube-канал (/channel/UC.., /@handle, /c/Name, /user/Name)
async function resolveChannelFromUrl(url, accessToken){
  const cleaned=(url||'').trim();
  let m=cleaned.match(/youtube\.com\/channel\/([\w-]+)/);
  if(m)return gFetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${m[1]}`,accessToken);
  m=cleaned.match(/youtube\.com\/@([\w.-]+)/);
  if(m)return gFetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forHandle=@${m[1]}`,accessToken);
  m=cleaned.match(/youtube\.com\/(?:c|user)\/([\w.-]+)/);
  if(m)return gFetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forUsername=${m[1]}`,accessToken);
  throw new Error('Не удалось распознать ссылку на канал');
}

// GET /api/ads/settings — доступно любому залогиненному (чтобы показать цену/статус)
app.get('/api/ads/settings', async (req,res)=>{
  const payload=await requireAuth(req,res); if(!payload)return;
  try{ return res.json(await getAdSettings()); }
  catch(e){ return res.status(500).json({ error:'Server error' }); }
});

// GET/POST /api/ads/admin-config — управление настройками рекламы (та же зона доступа, что и премиум)
app.get('/api/ads/admin-config', async (req,res)=>{
  const payload=await requirePremiumAccess(req,res); if(!payload)return;
  try{ return res.json({ settings:await getAdSettings() }); }
  catch(e){ return res.status(500).json({ error:'Server error' }); }
});
app.post('/api/ads/admin-config', async (req,res)=>{
  const payload=await requirePremiumAccess(req,res); if(!payload)return;
  const { enabled, price_text, cooldown_type, cooldown_custom_days }=req.body||{};
  try{
    const record={
      id:1, enabled:!!enabled,
      price_text: typeof price_text==='string'?price_text.slice(0,120):'',
      cooldown_type: ['week','month','custom'].includes(cooldown_type)?cooldown_type:'week',
      cooldown_custom_days: Math.max(1,Math.min(365,parseInt(cooldown_custom_days)||30)),
      updated_at:new Date().toISOString(), updated_by:payload.email,
    };
    const { error }=await supabase.from('ad_settings').upsert(record,{ onConflict:'id' });
    if(error)return res.status(500).json({ error:'Database error', details:error.message });
    const { id,updated_at,updated_by, ...settings }=record;
    return res.json({ ok:true, settings });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

// GET /api/ads/my — список объявлений текущего пользователя + статистика
app.get('/api/ads/my', async (req,res)=>{
  const payload=await requireAuth(req,res); if(!payload)return;
  try{
    const { data, error }=await supabase.from('ads').select('*').eq('user_id',payload.sub).order('created_at',{ ascending:false });
    if(error)return res.status(500).json({ error:'Database error' });
    const ads=(data||[]).map(a=>({
      id:a.id, ad_text:a.ad_text, has_photo:!!a.photo_data, youtube_channel_url:a.youtube_channel_url,
      status:a.status, rejection_reason:a.rejection_reason, views:a.views, clicks:a.clicks,
      created_at:a.created_at, published_at:a.published_at,
      days_live: a.published_at? Math.floor((Date.now()-new Date(a.published_at).getTime())/86400000) : null,
    }));
    return res.json({ ads });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

// POST /api/ads/create — создать объявление: модерация канала + текста + фото, затем — оплата
app.post('/api/ads/create', async (req,res)=>{
  const payload=await requireAuth(req,res); if(!payload)return;
  const { ad_text, photo_base64, youtube_channel_url }=req.body||{};
  if(!ad_text||!ad_text.trim())return res.status(400).json({ error:'Текст объявления обязателен' });
  if(!youtube_channel_url||!youtube_channel_url.trim())return res.status(400).json({ error:'Ссылка на канал обязательна' });
  try{
    const adSettings=await getAdSettings();
    if(!adSettings.enabled)return res.status(400).json({ error:'Реклама сейчас отключена на сайте' });

    // Проверка кулдауна
    const { data:lastAds }=await supabase.from('ads').select('created_at').eq('user_id',payload.sub).order('created_at',{ ascending:false }).limit(1);
    if(lastAds&&lastAds.length){
      const daysSince=(Date.now()-new Date(lastAds[0].created_at).getTime())/86400000;
      const needDays=cooldownDays(adSettings);
      if(daysSince<needDays)return res.status(429).json({ error:'Слишком рано для новой рекламы', retry_in_days:Math.ceil(needDays-daysSince) });
    }

    // Модерация канала
    let channelInfo;
    try{
      const accessToken=await getValidAccessToken(payload);
      channelInfo=await resolveChannelFromUrl(youtube_channel_url, accessToken);
    }catch(e){ return res.status(400).json({ error:'Не удалось проверить канал: '+e.message }); }
    const ch=(channelInfo.items||[])[0];
    if(!ch)return res.status(400).json({ error:'Канал не найден по указанной ссылке' });

    let rejection=null;
    try{
      const model=genAI.getGenerativeModel({ model:'gemini-2.5-flash', systemInstruction:AD_MODERATION_SYSTEM_PROMPT });
      const prompt=`Текст объявления: "${ad_text}"\nКанал: "${ch.snippet.title}"\nОписание канала: "${(ch.snippet.description||'').slice(0,500)}"`;
      const result=await model.generateContent(prompt);
      const jsonMatch=result.response.text().trim().match(/\{[\s\S]*\}/);
      if(jsonMatch){
        const verdict=JSON.parse(jsonMatch[0]);
        if(verdict.violation&&(verdict.severity==='medium'||verdict.severity==='high'))rejection=verdict.reason||'Нарушение правил площадки';
      }
    }catch(e){ console.warn('Ad text moderation (non-fatal):',e.message); }

    if(!rejection&&photo_base64){
      try{
        const model=genAI.getGenerativeModel({ model:'gemini-2.5-flash', systemInstruction:AD_IMAGE_MODERATION_PROMPT });
        const match=photo_base64.match(/^data:(image\/\w+);base64,(.+)$/);
        if(match){
          const result=await model.generateContent([{ inlineData:{ mimeType:match[1], data:match[2] } },'Проверь это изображение.']);
          const jsonMatch=result.response.text().trim().match(/\{[\s\S]*\}/);
          if(jsonMatch){
            const verdict=JSON.parse(jsonMatch[0]);
            if(verdict.violation&&(verdict.severity==='medium'||verdict.severity==='high'))rejection=verdict.reason||'Изображение нарушает правила площадки';
          }
        }
      }catch(e){ console.warn('Ad photo moderation (non-fatal):',e.message); }
    }

    const record={
      user_id:payload.sub, user_email:payload.email, ad_text:ad_text.trim().slice(0,500),
      photo_data: photo_base64? String(photo_base64).slice(0,7_000_000) : null,
      youtube_channel_url:youtube_channel_url.trim(),
      status: rejection?'rejected':'awaiting_payment',
      rejection_reason: rejection,
      created_at:new Date().toISOString(),
    };
    const { data:inserted, error:insErr }=await supabase.from('ads').insert(record).select().single();
    if(insErr)return res.status(500).json({ error:'Database error', details:insErr.message });

    if(rejection){
      await sendUserMessage(payload.sub,'violation_warning','⚠️ Реклама отклонена модератором',`Ваша реклама не прошла проверку: ${rejection}`);
      return res.json({ ok:true, status:'rejected', reason:rejection });
    }

    // Прошло модерацию — создаём счёт на оплату
    const amount=parseFloat(String(adSettings.price_text).replace(/[^\d.]/g,''));
    if(!amount||amount<=0)return res.json({ ok:true, status:'awaiting_payment', ad_id:inserted.id, pay_url:null, note:'Цена рекламы не задана администратором' });
    try{
      const { pay_url }=await initiatePayment({ userId:payload.sub, email:payload.email, purpose:'ad', referenceId:inserted.id, amountUsd:amount });
      return res.json({ ok:true, status:'awaiting_payment', ad_id:inserted.id, pay_url });
    }catch(e){
      return res.json({ ok:true, status:'awaiting_payment', ad_id:inserted.id, pay_url:null, note:'Платёжная система ещё не настроена' });
    }
  }catch(e){ return res.status(500).json({ error:'Server error', details:e.message }); }
});

// POST /api/ads/:id/view — засчитать просмотр объявления (вызывается лентой Новостей)
app.post('/api/ads/:id/view', async (req,res)=>{
  try{
    await supabase.rpc('increment_ad_counter',{ ad_id:req.params.id, field:'views' }).catch(async()=>{
      const { data }=await supabase.from('ads').select('views').eq('id',req.params.id).single();
      if(data)await supabase.from('ads').update({ views:(data.views||0)+1 }).eq('id',req.params.id);
    });
    return res.json({ ok:true });
  }catch(e){ return res.status(200).json({ ok:false }); }
});
// POST /api/ads/:id/click — засчитать переход по ссылке
app.post('/api/ads/:id/click', async (req,res)=>{
  try{
    const { data }=await supabase.from('ads').select('clicks').eq('id',req.params.id).single();
    if(data)await supabase.from('ads').update({ clicks:(data.clicks||0)+1 }).eq('id',req.params.id);
    return res.json({ ok:true });
  }catch(e){ return res.status(200).json({ ok:false }); }
});
// GET /api/ads/active — активные объявления для показа в ленте Новостей
app.get('/api/ads/active', async (req,res)=>{
  const payload=await requireAuth(req,res); if(!payload)return;
  try{
    const { data, error }=await supabase.from('ads').select('id,ad_text,photo_data,youtube_channel_url,published_at').eq('status','active').order('published_at',{ ascending:false }).limit(20);
    if(error)return res.status(500).json({ error:'Database error' });
    return res.json({ ads:data||[] });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

// ════════════════════════════════════════════════════════
// СООБЩЕНИЯ (личные системные уведомления пользователю)
// ════════════════════════════════════════════════════════
// GET /api/messages/my — все сообщения текущего пользователя
app.get('/api/messages/my', async (req,res)=>{
  const payload=await requireAuth(req,res); if(!payload)return;
  try{
    const { data, error }=await supabase.from('user_messages').select('*').eq('user_id',payload.sub).order('created_at',{ ascending:false }).limit(100);
    if(error)return res.status(500).json({ error:'Database error' });
    return res.json({ messages:data||[] });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});
// GET /api/messages/unread-count
app.get('/api/messages/unread-count', async (req,res)=>{
  const payload=await requireAuth(req,res); if(!payload)return;
  try{
    const { count, error }=await supabase.from('user_messages').select('id',{ count:'exact', head:true }).eq('user_id',payload.sub).eq('read',false);
    if(error)return res.status(500).json({ error:'Database error' });
    return res.json({ count:count||0 });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});
// POST /api/messages/:id/read
app.post('/api/messages/:id/read', async (req,res)=>{
  const payload=await requireAuth(req,res); if(!payload)return;
  try{
    await supabase.from('user_messages').update({ read:true }).eq('id',req.params.id).eq('user_id',payload.sub);
    return res.json({ ok:true });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});
// POST /api/messages/read-all
app.post('/api/messages/read-all', async (req,res)=>{
  const payload=await requireAuth(req,res); if(!payload)return;
  try{
    await supabase.from('user_messages').update({ read:true }).eq('user_id',payload.sub).eq('read',false);
    return res.json({ ok:true });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

// POST /api/admin/updates/broadcast — админ рассылает уведомление об обновлении всем пользователям
app.post('/api/admin/updates/broadcast', async (req,res)=>{
  const payload=await requireAdmin(req,res); if(!payload)return;
  const { title, body }=req.body||{};
  if(!title||!title.trim())return res.status(400).json({ error:'Заголовок обновления обязателен' });
  try{
    const { data:users, error }=await supabase.from('users').select('id');
    if(error)return res.status(500).json({ error:'Database error' });
    const rows=(users||[]).map(u=>({ user_id:u.id, type:'update', title:title.trim().slice(0,200), body:(body||'').trim().slice(0,2000), created_at:new Date().toISOString(), read:false }));
    if(rows.length){
      const { error:insErr }=await supabase.from('user_messages').insert(rows);
      if(insErr)return res.status(500).json({ error:'Database error', details:insErr.message });
    }
    return res.json({ ok:true, sent_to:rows.length });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

// ════════════════════════════════════════════════════════
// АПЕЛЛЯЦИИ
// ════════════════════════════════════════════════════════
app.post('/api/admin/appeals', async (req,res)=>{
  const { userId, email, comment }=req.body;
  if(!userId||!email||!comment)return res.status(400).json({ error:'userId, email and comment required' });
  if(comment.length>1000)return res.status(400).json({ error:'Comment too long' });
  try{
    const { data:userData }=await supabase.from('users').select('banned,name').eq('id',userId).single();
    if(!userData?.banned)return res.status(400).json({ error:'User is not banned' });
    const dayAgo=new Date(Date.now()-86400000).toISOString();
    const { data:existing }=await supabase.from('appeals').select('id').eq('user_id',userId).gte('created_at',dayAgo).single();
    if(existing)return res.status(429).json({ error:'Appeal already submitted today' });
    const { data:inserted, error }=await supabase.from('appeals').insert({ user_id:userId, email, comment }).select().single();
    if(error)return res.status(500).json({ error:'Database error' });
    await createAdminNotification('appeal','📩 Новая апелляция на разбан',`От: ${userData?.name||email} (${email})\nСообщение: "${comment.slice(0,300)}"`,inserted.id);
    return res.json({ ok:true });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

app.get('/api/admin/appeals', async (req,res)=>{
  const payload=await requirePermission(req,res,'view_users'); if(!payload)return;
  try{
    const { data, error }=await supabase.from('appeals').select('*').order('created_at',{ ascending:false });
    if(error)return res.status(500).json({ error:'Database error' });
    return res.json({ appeals:data||[] });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

// ════════════════════════════════════════════════════════
// УВЕДОМЛЕНИЯ Admin
// ════════════════════════════════════════════════════════
app.get('/api/admin/notifications', async (req,res)=>{
  const payload=await requirePermission(req,res,'read_notifications'); if(!payload)return;
  try{
    const { data, error }=await supabase.from('admin_notifications').select('*').order('created_at',{ ascending:false }).limit(100);
    if(error)return res.status(500).json({ error:'Database error' });
    const email=payload.email;
    return res.json({ notifications:(data||[]).map(n=>({ ...n, is_read:(n.read_by||[]).includes(email) })) });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

app.get('/api/admin/notifications/unread-count', async (req,res)=>{
  const payload=await requireAdmin(req,res); if(!payload)return;
  const canRead=await hasPermission(payload.email,'read_notifications');
  if(!canRead)return res.json({ unread:0 });
  try{
    const { data }=await supabase.from('admin_notifications').select('id,read_by').order('created_at',{ ascending:false }).limit(100);
    const unread=(data||[]).filter(n=>!(n.read_by||[]).includes(payload.email)).length;
    return res.json({ unread });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

app.post('/api/admin/notifications/read', async (req,res)=>{
  const payload=await requirePermission(req,res,'read_notifications'); if(!payload)return;
  const { notificationId }=req.body;
  if(!notificationId)return res.status(400).json({ error:'notificationId required' });
  try{
    const { data:notif }=await supabase.from('admin_notifications').select('read_by').eq('id',notificationId).single();
    const readBy=notif?.read_by||[];
    if(!readBy.includes(payload.email)){
      readBy.push(payload.email);
      await supabase.from('admin_notifications').update({ read_by:readBy }).eq('id',notificationId);
    }
    return res.json({ ok:true });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

app.post('/api/admin/notifications/read-all', async (req,res)=>{
  const payload=await requirePermission(req,res,'read_notifications'); if(!payload)return;
  try{
    const { data }=await supabase.from('admin_notifications').select('id,read_by');
    const email=payload.email;
    await Promise.all((data||[]).filter(n=>!(n.read_by||[]).includes(email)).map(n=>
      supabase.from('admin_notifications').update({ read_by:[...(n.read_by||[]),email] }).eq('id',n.id)
    ));
    return res.json({ ok:true });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

app.delete('/api/admin/notifications/:id', async (req,res)=>{
  const payload=await requirePermission(req,res,'read_notifications'); if(!payload)return;
  try{
    await supabase.from('admin_notifications').delete().eq('id',req.params.id);
    return res.json({ ok:true });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

// ════════════════════════════════════════════════════════
// ОТЗЫВЫ
// ════════════════════════════════════════════════════════
app.post('/api/feedback', async (req,res)=>{
  const payload=await requireAuth(req,res); if(!payload)return;
  const email=payload.email||'';
  const banStatus = await isUserBannedOrWarned(email);
  if(banStatus.banned){
    if(banStatus.warned) return res.status(403).json({ error:'WARNED', reason: banStatus.reason });
    return res.status(403).json({ error:'BANNED' });
  }
  const { rating, text }=req.body;
  if(!rating||typeof rating!=='number'||rating<1||rating>5)return res.status(400).json({ error:'rating required (1–5)' });
  if(!text||typeof text!=='string'||!text.trim())return res.status(400).json({ error:'text required' });
  if(text.trim().length>2000)return res.status(400).json({ error:'Text too long' });
  try{
    const dayAgo=new Date(Date.now()-86400000).toISOString();
    const { data:recent }=await supabase.from('feedback').select('id').eq('user_email',email).gte('created_at',dayAgo);
    if((recent||[]).length>=FEEDBACK_DAILY_LIMIT)return res.status(429).json({ error:'LIMIT_REACHED', message:`Лимит ${FEEDBACK_DAILY_LIMIT} отзыва за 24 часа.` });
    let userName=payload.name||email;
    try{ const { data:u }=await supabase.from('users').select('name').eq('email',email).single(); if(u?.name)userName=u.name; }catch(e){}
    const { data:inserted, error }=await supabase.from('feedback').insert({ user_id:payload.sub||email, user_email:email, user_name:userName, rating, text:text.trim() }).select().single();
    if(error)return res.status(500).json({ error:'Database error' });
    const stars='★'.repeat(rating)+'☆'.repeat(5-rating);
    await createAdminNotification('feedback',`💬 Новый отзыв ${stars}`,`От: ${userName} (${email})\n"${text.trim().slice(0,300)}"`,inserted.id);
    return res.json({ ok:true });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

app.get('/api/admin/feedback', async (req,res)=>{
  const payload=await requirePermission(req,res,'view_users'); if(!payload)return;
  try{
    const { data, error }=await supabase.from('feedback').select('*').order('created_at',{ ascending:false }).limit(200);
    if(error)return res.status(500).json({ error:'Database error' });
    return res.json({ feedback:data||[] });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

app.delete('/api/admin/feedback/:id', async (req,res)=>{
  const payload=await requirePermission(req,res,'ban_users'); if(!payload)return;
  try{ await supabase.from('feedback').delete().eq('id',req.params.id); return res.json({ ok:true }); }
  catch(e){ return res.status(500).json({ error:'Server error' }); }
});

app.post('/api/reports', async (req,res)=>{
  const { email, category, comment }=req.body;
  if(!email||typeof email!=='string'||!email.trim())return res.status(400).json({ error:'email required' });
  if(!category||typeof category!=='string'||!category.trim())return res.status(400).json({ error:'category required' });
  if(!comment||typeof comment!=='string'||!comment.trim())return res.status(400).json({ error:'comment required' });
  if(comment.trim().length>2000)return res.status(400).json({ error:'Comment too long' });
  
  try{
    const dayAgo=new Date(Date.now()-86400000).toISOString();
    const { data:recent, error:countErr }=await supabase
      .from('admin_notifications')
      .select('id')
      .eq('type','support_report')
      .like('body',`От: ${email.trim()}%`)
      .gte('created_at',dayAgo);
    
    if(!countErr && (recent||[]).length>=5) {
      return res.status(429).json({ error:'LIMIT_REACHED', message:'Вы отправили слишком много жалоб. Пожалуйста, подождите 24 часа.' });
    }

    const title = `🐛 Жалоба: ${category.trim()}`;
    const body = `От: ${email.trim()}\n\nОписание:\n${comment.trim()}`;
    await createAdminNotification('support_report', title, body);
    return res.json({ ok:true });
  }catch(e){
    console.error('Reports endpoint error:',e);
    return res.status(500).json({ error:'Server error' });
  }
});

// ════════════════════════════════════════════════════════
// НОВОСТИ
// ════════════════════════════════════════════════════════
app.get('/api/news', async (req,res)=>{
  const payload=await requireAuth(req,res); if(!payload)return;
  try{
    const { data:posts, error }=await supabase.from('news_posts').select('*').order('created_at',{ ascending:false }).limit(50);
    if(error)return res.status(500).json({ error:'Database error' });
    const postIds=(posts||[]).map(p=>p.id);
    let reactionsMap={}, commentsMap={};
    if(postIds.length){
      const { data:reactions }=await supabase.from('news_reactions').select('*').in('post_id',postIds);
      (reactions||[]).forEach(r=>{
        if(!reactionsMap[r.post_id])reactionsMap[r.post_id]={ likes:0, dislikes:0, userReaction:null };
        if(r.reaction==='like')reactionsMap[r.post_id].likes++;
        else reactionsMap[r.post_id].dislikes++;
        if(r.user_email===payload.email)reactionsMap[r.post_id].userReaction=r.reaction;
      });
      const { data:comments }=await supabase.from('news_comments').select('*').in('post_id',postIds).order('created_at',{ ascending:true });
      (comments||[]).forEach(c=>{ if(!commentsMap[c.post_id])commentsMap[c.post_id]=[]; commentsMap[c.post_id].push(c); });
    }
    const isAdmin=await isAdminEmail(payload.email);
    return res.json({ posts:(posts||[]).map(p=>({ ...p, likes:reactionsMap[p.id]?.likes||0, dislikes:reactionsMap[p.id]?.dislikes||0, userReaction:reactionsMap[p.id]?.userReaction||null, comments:commentsMap[p.id]||[], canEdit:isAdmin })), isAdmin });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

app.post('/api/news', async (req,res)=>{
  const payload=await requireAdmin(req,res); if(!payload)return;
  const { title, content, media_url, media_type }=req.body;
  if(!title||!content)return res.status(400).json({ error:'title and content required' });
  if(media_url&&media_url.length>4000000)return res.status(400).json({ error:'Media too large' });
  try{
    const { data:userData }=await supabase.from('users').select('name').eq('email',payload.email).single();
    const { data, error }=await supabase.from('news_posts').insert({ author_email:payload.email, author_name:userData?.name||payload.email, title, content, media_url:media_url||null, media_type:media_type||null }).select().single();
    if(error)return res.status(500).json({ error:'Database error' });
    return res.json({ ok:true, post:data });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

app.put('/api/news/:id', async (req,res)=>{
  const payload=await requireAdmin(req,res); if(!payload)return;
  const { title, content, media_url, media_type }=req.body;
  if(!title||!content)return res.status(400).json({ error:'title and content required' });
  try{
    const updateData={ title, content, updated_at:new Date().toISOString() };
    if(media_url!==undefined)updateData.media_url=media_url||null;
    if(media_type!==undefined)updateData.media_type=media_type||null;
    const { data, error }=await supabase.from('news_posts').update(updateData).eq('id',req.params.id).select().single();
    if(error)return res.status(500).json({ error:'Database error' });
    if(!data)return res.status(404).json({ error:'Post not found' });
    return res.json({ ok:true, post:data });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

app.delete('/api/news/:id', async (req,res)=>{
  const payload=await requireAdmin(req,res); if(!payload)return;
  try{
    await supabase.from('news_reactions').delete().eq('post_id',req.params.id);
    await supabase.from('news_comments').delete().eq('post_id',req.params.id);
    await supabase.from('news_posts').delete().eq('id',req.params.id);
    return res.json({ ok:true });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

app.post('/api/news/:id/react', async (req,res)=>{
  const payload=await requireAuth(req,res); if(!payload)return;
  const { reaction }=req.body;
  if(!['like','dislike'].includes(reaction))return res.status(400).json({ error:'invalid reaction' });
  try{
    const { data:existing }=await supabase.from('news_reactions').select('*').eq('post_id',req.params.id).eq('user_email',payload.email).single();
    if(existing){
      if(existing.reaction===reaction){ await supabase.from('news_reactions').delete().eq('post_id',req.params.id).eq('user_email',payload.email); return res.json({ ok:true, action:'removed' }); }
      await supabase.from('news_reactions').update({ reaction }).eq('post_id',req.params.id).eq('user_email',payload.email);
      return res.json({ ok:true, action:'changed' });
    }
    await supabase.from('news_reactions').insert({ post_id:req.params.id, user_email:payload.email, reaction });
    return res.json({ ok:true, action:'added' });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

app.post('/api/news/:id/comment', async (req,res)=>{
  const payload=await requireAuth(req,res); if(!payload)return;
  const { content }=req.body;
  if(!content||!content.trim())return res.status(400).json({ error:'content required' });
  if(content.length>500)return res.status(400).json({ error:'Comment too long' });
  try{
    const { data:userData }=await supabase.from('users').select('name').eq('email',payload.email).single();
    const { data, error }=await supabase.from('news_comments').insert({ post_id:req.params.id, user_email:payload.email, user_name:userData?.name||payload.email, content:content.trim() }).select().single();
    if(error)return res.status(500).json({ error:'Database error' });
    return res.json({ ok:true, comment:data });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

app.delete('/api/news/comments/:commentId', async (req,res)=>{
  const payload=await requireAuth(req,res); if(!payload)return;
  try{
    const { data:comment }=await supabase.from('news_comments').select('user_email').eq('id',req.params.commentId).single();
    if(!comment)return res.status(404).json({ error:'Comment not found' });
    const isAdmin=await isAdminEmail(payload.email);
    if(comment.user_email!==payload.email&&!isAdmin)return res.status(403).json({ error:'Forbidden' });
    await supabase.from('news_comments').delete().eq('id',req.params.commentId);
    return res.json({ ok:true });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

// ════════════════════════════════════════════════════════
// AUTH ROUTES
// ════════════════════════════════════════════════════════
const YOUTUBE_SCOPES=[
  'openid','email','profile',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
].join(' ');

const UNISENDER_GO_API_KEY = process.env.UNISENDER_GO_API_KEY || '';
const EMAIL_FROM           = process.env.EMAIL_FROM           || '';
const EMAIL_FROM_NAME      = process.env.EMAIL_FROM_NAME      || 'YTMetrics';
const YANDEX_CAPTCHA_SERVER_KEY = process.env.YANDEX_CAPTCHA_SERVER_KEY || '';
const YANDEX_CAPTCHA_CLIENT_KEY = process.env.YANDEX_CAPTCHA_CLIENT_KEY || '';

// Проверка капчи Yandex SmartCaptcha (server-side валидация токена, полученного от виджета на фронте)
async function verifyCaptcha(token, userIp) {
  if(!YANDEX_CAPTCHA_SERVER_KEY)return { ok:false, reason:'CAPTCHA_NOT_CONFIGURED' };
  if(!token)return { ok:false, reason:'NO_TOKEN' };
  try{
    const params=new URLSearchParams({ secret:YANDEX_CAPTCHA_SERVER_KEY, token, ip:userIp||'' });
    const res=await fetch('https://smartcaptcha.yandexcloud.net/validate?'+params.toString());
    const data=await res.json();
    return { ok:data.status==='ok', reason:data.message||data.status };
  }catch(e){ return { ok:false, reason:'CAPTCHA_ERROR' }; }
}

// Отправка письма через Unisender Go (транзакционные письма — подтверждение почты)
async function sendEmail({ to, subject, html }) {
  if(!UNISENDER_GO_API_KEY||!EMAIL_FROM)throw new Error('EMAIL_NOT_CONFIGURED');
  const res=await fetch('https://go1.unisender.ru/ru/transactional/api/v1/email/send.json',{
    method:'POST', headers:{ 'Content-Type':'application/json', 'X-API-KEY':UNISENDER_GO_API_KEY },
    body:JSON.stringify({ message:{
      recipients:[{ email:to }],
      body:{ html },
      subject, from_email:EMAIL_FROM, from_name:EMAIL_FROM_NAME,
    } }),
  });
  const data=await res.json();
  if(!res.ok||data.status==='error')throw new Error('Email send error: '+JSON.stringify(data));
  return data;
}

// ════════════════════════════════════════════════════════
// ВХОД ПО EMAIL + ПАРОЛЬ
// (не Google/Apple — согласно 199-ФЗ такие сервисы нельзя использовать для входа в РФ)
// Регистрация: email → пароль → повтор пароля → капча → письмо-подтверждение
// ════════════════════════════════════════════════════════
app.post('/api/auth/email/register', async (req,res)=>{
  const { email, password, password_confirm, captcha_token }=req.body||{};
  if(!email||!password||!password_confirm)return res.status(400).json({ error:'Заполните все поля' });
  const cleanEmail=String(email).trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail))return res.status(400).json({ error:'Некорректный email' });
  if(isBlockedEmailDomain(cleanEmail))return res.status(400).json({ error:'Регистрация через Gmail/iCloud не поддерживается. Используйте другую почту.' });
  if(String(password).length<8)return res.status(400).json({ error:'Пароль должен быть не короче 8 символов' });
  if(password!==password_confirm)return res.status(400).json({ error:'Пароли не совпадают' });

  const captcha=await verifyCaptcha(captcha_token, req.headers['x-forwarded-for']||req.socket.remoteAddress);
  if(!captcha.ok)return res.status(400).json({ error:'Проверка «Я не робот» не пройдена, попробуйте ещё раз' });

  try{
    const { data:existing }=await supabase.from('users').select('id').eq('email',cleanEmail).single();
    if(existing)return res.status(409).json({ error:'Пользователь с такой почтой уже зарегистрирован' });

    const userId=crypto.randomUUID();
    const passwordHash=hashPassword(String(password));
    const displayName=cleanEmail.split('@')[0].slice(0,100);
    const { error }=await supabase.from('users').insert({
      id:userId, email:cleanEmail, name:displayName,
      auth_provider:'email', password_hash:passwordHash, email_verified:false,
      created_at:new Date().toISOString(),
    });
    if(error)return res.status(500).json({ error:'Database error', details:error.message });

    // Токен подтверждения почты (24 часа)
    const verifyToken=crypto.randomBytes(32).toString('hex');
    await supabase.from('email_verifications').insert({
      user_id:userId, token:verifyToken,
      expires_at:new Date(Date.now()+24*3600*1000).toISOString(),
    });
    const verifyUrl=`${REDIRECT_URI.replace('/api/auth/callback','')}/api/auth/email/verify?token=${verifyToken}`;
    try{
      await sendEmail({
        to:cleanEmail, subject:'Подтвердите почту — YTMetrics',
        html:`<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:#111">Добро пожаловать в YTMetrics!</h2>
          <p>Подтвердите почту, перейдя по ссылке ниже:</p>
          <p><a href="${verifyUrl}" style="display:inline-block;padding:12px 24px;background:#e2ff33;color:#111;text-decoration:none;border-radius:8px;font-weight:700">Подтвердить почту</a></p>
          <p style="color:#888;font-size:12px">Ссылка действует 24 часа. Если вы не регистрировались на YTMetrics — просто проигнорируйте это письмо.</p>
        </div>`,
      });
    }catch(emailErr){ console.warn('Email send failed (non-fatal):',emailErr.message); }

    await createAdminNotification('new_user','👤 Новый пользователь',`Email: ${cleanEmail}\nСпособ входа: Email\nПочта подтверждена: нет`,userId);

    return res.json({ ok:true, message:'Регистрация прошла успешно! Проверьте почту и перейдите по ссылке для подтверждения.' });
  }catch(e){ return res.status(500).json({ error:'Server error', details:e.message }); }
});

// GET /api/auth/email/verify?token=... — подтверждение почты по ссылке из письма
app.get('/api/auth/email/verify', async (req,res)=>{
  const token=req.query.token;
  const appBase=APP_URL.endsWith('/')?APP_URL.slice(0,-1):APP_URL;
  if(!token){ res.writeHead(302,{ Location:appBase+'/?verify=missing_token' }); return res.end(); }
  try{
    const { data:record }=await supabase.from('email_verifications').select('*').eq('token',token).single();
    if(!record||record.verified_at){ res.writeHead(302,{ Location:appBase+'/?verify=invalid' }); return res.end(); }
    if(new Date(record.expires_at)<new Date()){ res.writeHead(302,{ Location:appBase+'/?verify=expired' }); return res.end(); }
    await supabase.from('email_verifications').update({ verified_at:new Date().toISOString() }).eq('token',token);
    await supabase.from('users').update({ email_verified:true }).eq('id',record.user_id);
    res.writeHead(302,{ Location:appBase+'/?verify=success' });
    res.end();
  }catch(e){ res.writeHead(302,{ Location:appBase+'/?verify=error' }); res.end(); }
});

app.post('/api/auth/email/login', async (req,res)=>{
  const { email, password }=req.body||{};
  if(!email||!password)return res.status(400).json({ error:'Email и пароль обязательны' });
  const cleanEmail=String(email).trim().toLowerCase();
  try{
    const { data:user, error }=await supabase.from('users').select('*').eq('email',cleanEmail).eq('auth_provider','email').single();
    if(error||!user)return res.status(401).json({ error:'Неверная почта или пароль' });
    if(!verifyPassword(String(password), user.password_hash||''))return res.status(401).json({ error:'Неверная почта или пароль' });
    if(user.banned)return res.status(403).json({ error:'BANNED' });
    if(!user.email_verified)return res.status(403).json({ error:'EMAIL_NOT_VERIFIED', message:'Подтвердите почту — мы отправили письмо со ссылкой при регистрации' });

    // Если раньше уже подключали YouTube-канал — токены сохранены в этих же полях users
    const jwtPayload={
      sub:user.id, email:user.email, name:user.name, auth_provider:'email',
      channel_id:user.channel_id||null, channel_name:user.youtube_channel_name||null,
      channel_url:user.channel_url||null, avatar_url:user.youtube_channel_avatar||null,
      subscribers:user.subscriber_count||0, channels:[],
      access_token:user.youtube_access_token||undefined, refresh_token:user.youtube_refresh_token||undefined,
    };
    const sessionToken=signSession(jwtPayload);
    res.setHeader('Set-Cookie', buildCookieHeader(sessionToken));
    return res.json({ ok:true, token:sessionToken, ...jwtPayload, access_token:undefined, refresh_token:undefined });
  }catch(e){ return res.status(500).json({ error:'Server error', details:e.message }); }
});

// GET /api/config/public — публичные (не секретные) ключи, нужные фронту (капча client key)
app.get('/api/config/public', (req,res)=>{
  res.json({ captcha_client_key:YANDEX_CAPTCHA_CLIENT_KEY||null });
});


// ════════════════════════════════════════════════════════
// ПОДКЛЮЧЕНИЕ YOUTUBE-КАНАЛА (данные, НЕ вход) — доступно любому уже вошедшему пользователю
// ════════════════════════════════════════════════════════
app.get('/api/auth/youtube/connect', async (req,res)=>{
  const payload=await requireAuth(req,res); if(!payload)return;
  const state=jwt.sign({ uid:payload.sub, origin:req.query.origin||'' }, JWT_SECRET, { expiresIn:'10m' });
  const params=new URLSearchParams({ client_id:GOOGLE_CLIENT_ID, redirect_uri:YOUTUBE_CONNECT_REDIRECT_URI, response_type:'code', scope:YOUTUBE_SCOPES, access_type:'offline', prompt:'consent', include_granted_scopes:'true', state });
  res.writeHead(302,{ Location:'https://accounts.google.com/o/oauth2/v2/auth?'+params.toString() });
  res.end();
});

app.get('/api/auth/youtube/callback', async (req,res)=>{
  const { code, error, state }=req.query;
  let redirectTarget=APP_URL;
  let uid=null, origin='';
  try{ const decoded=jwt.verify(state, JWT_SECRET); uid=decoded.uid; origin=decoded.origin||''; }catch(e){}
  if(origin&&(origin.startsWith('http://')||origin.startsWith('https://')))redirectTarget=origin;
  if(redirectTarget.endsWith('/'))redirectTarget=redirectTarget.slice(0,-1);
  if(error||!code||!uid){ res.writeHead(302,{ Location:redirectTarget+'/?error=oauth_denied' }); return res.end(); }
  try{
    const tokenRes=await fetch('https://oauth2.googleapis.com/token',{ method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({ code, client_id:GOOGLE_CLIENT_ID, client_secret:GOOGLE_CLIENT_SECRET, redirect_uri:YOUTUBE_CONNECT_REDIRECT_URI, grant_type:'authorization_code' }) });
    const tokens=await tokenRes.json();
    if(!tokenRes.ok||tokens.error){ res.writeHead(302,{ Location:redirectTarget+'/?error=token_exchange' }); return res.end(); }
    const { access_token, refresh_token=null }=tokens;
    const channels=await fetchChannels(access_token);
    const primary=channels[0]||null;

    const { data:userRow }=await supabase.from('users').select('*').eq('id',uid).single();
    if(!userRow){ res.writeHead(302,{ Location:redirectTarget+'/?error=user_not_found' }); return res.end(); }

    await supabase.from('users').update({
      youtube_channel_name:primary?.channel_name||null,
      youtube_channel_avatar:primary?.avatar_url||null,
      subscriber_count:primary?.subscribers||0,
      channel_description:primary?.channel_description||null,
      channel_id:primary?.channel_id||null,
      channel_url:primary?.channel_url||null,
      youtube_access_token:access_token,
      youtube_refresh_token: refresh_token||userRow.youtube_refresh_token||null, // Google не всегда присылает новый refresh_token повторно
    }).eq('id',uid);

    const jwtPayload={
      sub:uid, email:userRow.email, name:userRow.name, auth_provider:userRow.auth_provider||'email',
      channel_id:primary?.channel_id||null, channel_name:primary?.channel_name||null, channel_url:primary?.channel_url||null,
      avatar_url:primary?.avatar_url||null, subscribers:primary?.subscribers||0, channels,
      access_token, refresh_token: refresh_token||userRow.youtube_refresh_token||null,
    };
    const sessionToken=signSession(jwtPayload);
    res.writeHead(302,{ 'Set-Cookie':buildCookieHeader(sessionToken), Location:redirectTarget+'/?token='+encodeURIComponent(sessionToken)+'&youtube_connected=1' });
    res.end();
  }catch(e){ console.error('YouTube connect callback error:',e); res.writeHead(302,{ Location:redirectTarget+'/?error=server' }); res.end(); }
});

app.get('/api/auth/google', (req,res)=>{
  const origin = req.query.origin || '';
  const params=new URLSearchParams({ client_id:GOOGLE_CLIENT_ID, redirect_uri:REDIRECT_URI, response_type:'code', scope:YOUTUBE_SCOPES, access_type:'offline', prompt:'consent', include_granted_scopes:'true', state:origin });
  res.writeHead(302,{ Location:'https://accounts.google.com/o/oauth2/v2/auth?'+params.toString() });
  res.end();
});

app.get('/api/auth/callback', async (req,res)=>{
  const { code, error, state }=req.query;
  let redirectTarget = APP_URL;
  if (state && (state.startsWith('http://') || state.startsWith('https://') || state.startsWith('ytmetrics://'))) {
    redirectTarget = state;
  } else if (!process.env.APP_URL && req.headers.host) {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    redirectTarget = `${proto}://${req.headers.host}`;
  }
  if (redirectTarget.endsWith('/')) {
    redirectTarget = redirectTarget.slice(0, -1);
  }
  if(error||!code){ res.writeHead(302,{ Location:redirectTarget+'/?error=oauth_denied' }); return res.end(); }
  try{
    const tokenRes=await fetch('https://oauth2.googleapis.com/token',{ method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({ code, client_id:GOOGLE_CLIENT_ID, client_secret:GOOGLE_CLIENT_SECRET, redirect_uri:REDIRECT_URI, grant_type:'authorization_code' }) });
    const tokens=await tokenRes.json();
    if(!tokenRes.ok||tokens.error){ res.writeHead(302,{ Location:redirectTarget+'/?error=token_exchange' }); return res.end(); }
    const { access_token, refresh_token=null }=tokens;
    let googleProfile;
    try{ googleProfile=await gFetch('https://www.googleapis.com/oauth2/v3/userinfo', access_token); }
    catch(e){ res.writeHead(302,{ Location:redirectTarget+'/?error=userinfo' }); return res.end(); }
    const googleId=googleProfile.sub, email=googleProfile.email, googleName=googleProfile.name||googleProfile.email;
    let isNewUser=false;
    try{
      const { data:existingUser }=await supabase.from('users').select('banned,id').eq('id',googleId).single();
      if(existingUser?.banned){ res.writeHead(302,{ Location:redirectTarget+'/?error=banned&uid='+encodeURIComponent(googleId)+'&uemail='+encodeURIComponent(email) }); return res.end(); }
      if(!existingUser)isNewUser=true;
    }catch(e){ isNewUser=true; }
    const channels=await fetchChannels(access_token);
    const primary=channels[0]||null;
    await upsertUserSafe(googleId, email, googleName, {
      google_avatar:googleProfile.picture||null,
      youtube_channel_name:primary?.channel_name||null,
      youtube_channel_avatar:primary?.avatar_url||null,
      subscriber_count:primary?.subscribers||0,
      channel_description:primary?.channel_description||null,
      channel_id:primary?.channel_id||null,
      channel_url:primary?.channel_url||null,
    });
    // Если это первый вход suprem-админа и его ещё нет в таблице admins — создаём
    if(email===SUPREME_ADMIN_EMAIL){
      const existingAdmin=await getAdminRecord(email);
      if(!existingAdmin){
        await supabase.from('admins').insert({ user_id:googleId, email, is_primary:true, added_by:'system', permissions:ALL_PERMISSIONS });
      }
    }
    if(isNewUser){
      await createAdminNotification('new_user','👤 Новый пользователь',`Имя: ${googleName}\nEmail: ${email}${primary?.channel_name?'\nКанал: '+primary.channel_name:''}${primary?.subscribers?'\nПодписчики: '+primary.subscribers:''}`,googleId);
    }
    const jwtPayload={ sub:googleId, email, name:googleName, google_picture:googleProfile.picture||null, channel_id:primary?.channel_id||null, channel_name:primary?.channel_name||null, channel_url:primary?.channel_url||null, avatar_url:primary?.avatar_url||googleProfile.picture||null, subscribers:primary?.subscribers||0, channels, access_token, refresh_token };
    const sessionToken=signSession(jwtPayload);
    res.writeHead(302,{ 'Set-Cookie':buildCookieHeader(sessionToken), Location:redirectTarget+'/?token='+encodeURIComponent(sessionToken) });
    res.end();
  }catch(e){ console.error('Callback fatal error:',e); res.writeHead(302,{ Location:redirectTarget+'/?error=server' }); res.end(); }
});

app.get('/api/auth/me', async (req,res)=>{
  const token=extractToken(req);
  if(!token)return res.status(401).json({ error:'No session' });
  let payload;
  try{ payload=jwt.verify(token, JWT_SECRET); }
  catch(e){
    try{
      const expired=jwt.decode(token);
      if(!expired?.refresh_token)return res.status(401).json({ error:'Session expired' });
      const newAccessToken=await refreshAccessToken(expired.refresh_token);
      const channels=await fetchChannels(newAccessToken);
      const newPayload={ ...expired, access_token:newAccessToken, channels, iat:undefined, exp:undefined };
      const newToken=signSession(newPayload);
      res.setHeader('Set-Cookie', buildCookieHeader(newToken));
      const { access_token:_a, refresh_token:_r, ...safe }=newPayload;
      return res.json({ ...safe, fresh_token:newToken });
    }catch(refreshErr){ res.setHeader('Set-Cookie', buildClearCookie()); return res.status(401).json({ error:'Session expired' }); }
  }
  try{
    const { data:userData }=await supabase.from('users').select('banned, banned_reason').eq('id',payload.sub).single();
    if(userData?.banned){
      if(userData.banned_reason && userData.banned_reason.startsWith('WARNING:')){
        const warningReason = userData.banned_reason.replace('WARNING:', '').trim();
        return res.status(403).json({ error:'WARNED', reason: warningReason });
      }
      res.setHeader('Set-Cookie', buildClearCookie());
      return res.status(403).json({ error:'BANNED' });
    }
  }catch(e){}
  let isAdmin=false, isPrimary=false, isSupreme=false;
  try{
    isAdmin=await isAdminEmail(payload.email||'');
    if(isAdmin){ isPrimary=await isPrimaryAdmin(payload.email||''); isSupreme=isSupremeAdmin(payload.email||''); }
  }catch(e){}
  try{
    let freshAccessToken=payload.access_token, tokenRefreshed=false;
    if(payload.refresh_token){
      const check=await fetch('https://www.googleapis.com/oauth2/v1/tokeninfo?access_token='+(payload.access_token||''));
      const info=await check.json();
      if(!check.ok||parseInt(info.expires_in||'0')<300){ freshAccessToken=await refreshAccessToken(payload.refresh_token); tokenRefreshed=true; }
    }
    if(tokenRefreshed){
      const channels=await fetchChannels(freshAccessToken);
      const newPayload={ ...payload, access_token:freshAccessToken, channels, iat:undefined, exp:undefined };
      const newToken=signSession(newPayload);
      res.setHeader('Set-Cookie', buildCookieHeader(newToken));
      const { access_token:_a, refresh_token:_r, ...safe }=newPayload;
      return res.json({ ...safe, fresh_token:newToken, is_admin:isAdmin, is_primary_admin:isPrimary, is_supreme_admin:isSupreme });
    }
  }catch(e){}
  res.setHeader('Set-Cookie', buildCookieHeader(token));
  const { access_token:_a, refresh_token:_r, ...safe }=payload;
  return res.json({ ...safe, is_admin:isAdmin, is_primary_admin:isPrimary, is_supreme_admin:isSupreme });
});

app.post('/api/auth/logout', (req,res)=>{
  res.setHeader('Set-Cookie', buildClearCookie());
  res.json({ ok:true });
});

app.post('/api/auth/clear-warning', async (req,res)=>{
  const token=extractToken(req);
  if(!token)return res.status(401).json({ error:'No session' });
  let payload;
  try{ payload=jwt.verify(token, JWT_SECRET); }
  catch(e){ return res.status(401).json({ error:'Invalid session' }); }
  try{
    const { error }=await supabase.from('users').update({ banned:false, banned_at:null, banned_reason:null }).eq('id',payload.sub);
    if(error)return res.status(500).json({ error:'Database error' });
    return res.json({ ok:true });
  }catch(e){ return res.status(500).json({ error:'Server error' }); }
});

// ════════════════════════════════════════════════════════
// YOUTUBE ROUTES
// ════════════════════════════════════════════════════════
app.get('/api/youtube/channels', async (req,res)=>{
  const payload=await requireAuth(req,res); if(!payload)return;
  try{ res.json({ channels:await fetchChannels(await getValidAccessToken(payload)) }); }
  catch(e){ res.status(502).json({ error:e.message }); }
});

app.get('/api/youtube/videos', async (req,res)=>{
  const payload=await requireAuth(req,res); if(!payload)return;
  const channelId=req.query.channel_id||payload.channel_id;
  const maxResults=safeInt(req.query.max_results)||20;
  if(!channelId)return res.status(400).json({ error:'channel_id required' });

  try{
    const accessToken=await getValidAccessToken(payload);

    const searchData=await gFetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${encodeURIComponent(channelId)}&maxResults=${maxResults}&order=date&type=video`,
      accessToken
    );
    const videoIds=(searchData.items||[]).map(i=>i.id?.videoId).filter(Boolean);
    if(!videoIds.length)return res.json({ videos:[], subscriber_count:0, channel_total_views:0, channel_watch_hours:0 });

    const statsData=await gFetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoIds.join(',')}`,
      accessToken
    );

    let subscriberCount=payload.subscribers||0;
    let channelTotalViews=0;
    try{
      const chData=await gFetch(`https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${encodeURIComponent(channelId)}`,accessToken);
      const chStats=(chData.items||[])[0]?.statistics||{};
      subscriberCount=safeInt(chStats.subscriberCount)||subscriberCount;
      channelTotalViews=safeInt(chStats.viewCount)||0;
    }catch(e){}

    const endDate=getTodayString(), startDate=getDateDaysAgo(30);

    let analyticsMap={};
    let channelWatchMinutes=0;
    try{
      const channelReport=await gFetch(
        `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel%3D%3D${encodeURIComponent(channelId)}&startDate=${startDate}&endDate=${endDate}&metrics=estimatedMinutesWatched`,
        accessToken
      );
      if(channelReport&&channelReport.rows&&channelReport.rows[0]){
        channelWatchMinutes=safeFloat(channelReport.rows[0][0]);
      }
    }catch(e){ console.warn('Channel total watch minutes API (non-fatal):',e.message); }

    let analyticsFailed=false;
    try{
      // "Top videos" отчёт: удержание, время просмотра, репосты, подписчики.
      // ВАЖНО: сюда нельзя добавлять impressionClickThroughRate — это метрика
      // из ДРУГОГО типа отчёта (impressions), и Google отклоняет весь запрос
      // целиком при смешении несовместимых метрик. Плюс явно фильтруем по
      // ID нужных видео — иначе при большом канале свежие ролики могли не
      // попасть в "топ-50 по просмотрам за 30 дней" и остаться без данных.
      const analyticsData=await gFetch(
        `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel%3D%3D${encodeURIComponent(channelId)}&startDate=${startDate}&endDate=${endDate}&metrics=views,likes,comments,shares,averageViewPercentage,averageViewDuration,estimatedMinutesWatched,subscribersGained&dimensions=video&filters=video%3D%3D${videoIds.join('%2C')}&maxResults=${videoIds.length}`,
        accessToken
      );
      const headers=(analyticsData.columnHeaders||[]).map(h=>h.name);
      const gi=n=>headers.indexOf(n);
      for(const row of (analyticsData.rows||[])){
        const vid=row[gi('video')]; if(!vid)continue;
        const mins=gi('estimatedMinutesWatched')>=0?safeFloat(row[gi('estimatedMinutesWatched')]):0;
        analyticsMap[vid]={
          retentionPct: gi('averageViewPercentage')>=0&&row[gi('averageViewPercentage')]!=null ? parseFloat(safeFloat(row[gi('averageViewPercentage')]).toFixed(1)) : null,
          shares:       gi('shares')>=0 ? safeInt(row[gi('shares')]) : 0,
          avgDurSec:    gi('averageViewDuration')>=0&&row[gi('averageViewDuration')]!=null ? parseFloat(safeFloat(row[gi('averageViewDuration')]).toFixed(1)) : null,
          watchMinutes: mins,
          subscribersGained: gi('subscribersGained')>=0 ? safeInt(row[gi('subscribersGained')]) : 0,
        };
      }
      if(!(analyticsData.rows||[]).length)analyticsFailed=true;
    }catch(e){ console.warn('Analytics API (non-fatal):',e.message); analyticsFailed=true; }

    // CTR — отдельный запрос (отдельный тип отчёта "impressions" в API).
    try{
      const ctrData=await gFetch(
        `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel%3D%3D${encodeURIComponent(channelId)}&startDate=${startDate}&endDate=${endDate}&metrics=impressions,impressionClickThroughRate&dimensions=video&filters=video%3D%3D${videoIds.join('%2C')}&maxResults=${videoIds.length}`,
        accessToken
      );
      const cH=(ctrData.columnHeaders||[]).map(h=>h.name);
      const gi=n=>cH.indexOf(n);
      for(const row of (ctrData.rows||[])){
        const vid=row[gi('video')]; if(!vid)continue;
        const ctrPct=gi('impressionClickThroughRate')>=0&&row[gi('impressionClickThroughRate')]!=null ? parseFloat((safeFloat(row[gi('impressionClickThroughRate')])*100).toFixed(2)) : null;
        if(!analyticsMap[vid])analyticsMap[vid]={};
        analyticsMap[vid].ctrPct=ctrPct;
      }
    }catch(e){ console.warn('CTR API (non-fatal, impressions data may not be ready yet):',e.message); }

    // Для Shorts официального "% свайпов" в публичном API нет — используем
    // то же реальное среднее удержание (averageViewPercentage), которое уже
    // получили выше, и производим из него оценку "досмотрели / пролистнули".
    const shortCandidates=(statsData.items||[]).filter(item=>{ const dur=parseDurationToSeconds((item.contentDetails||{}).duration); return dur>0&&dur<=60; }).map(i=>i.id);
    let swipeMap={};
    for(const vid of shortCandidates){
      const a=analyticsMap[vid];
      if(a&&a.retentionPct!=null){
        const viewedPct=Math.min(100,a.retentionPct);
        swipeMap[vid]={
          viewedRatio:parseFloat(viewedPct.toFixed(1)),
          swipedRatio:parseFloat(Math.max(0,100-viewedPct).toFixed(1)),
          avgDurSec:a.avgDurSec,
          rewatched:a.retentionPct>=100, // зрители пересматривают ролик целиком и больше — свайп-отток статистически ~0%
        };
      }
    }

    const channelName=payload.channel_name||channelId;
    const userEmail=payload.email;
    const userId=payload.sub;

    const videos=(statsData.items||[]).map(item=>{
      const sn=item.snippet||{},st=item.statistics||{},cd=item.contentDetails||{},th=sn.thumbnails||{};
      const durationSec=parseDurationToSeconds(cd.duration);
      const isShort=durationSec>0&&durationSec<=60;
      const views=safeInt(st.viewCount),likes=safeInt(st.likeCount),comments=safeInt(st.commentCount);
      const analytics=analyticsMap[item.id]||{};
      const swipe=swipeMap[item.id]||{};
      const shares=analytics.shares||0;
      const watchMinutes=analytics.watchMinutes||0;

      let retentionShort=null;
      if(isShort){
        const avgDur=swipe.avgDurSec!=null?swipe.avgDurSec:analytics.avgDurSec;
        if(avgDur!=null&&durationSec>0) retentionShort=parseFloat(((avgDur/durationSec)*100).toFixed(1));
        else if(analytics.retentionPct!=null) retentionShort=analytics.retentionPct;
      }

      moderateVideoContent({ id:item.id, title:sn.title||'', description:sn.description||'' }, channelName, userEmail, userId).catch(()=>{});

      // Причина отсутствия данных (для понятных подсказок на фронте)
      let noDataReason=null;
      if(isShort){
        if(retentionShort==null||swipe.swipedRatio==null){
          noDataReason = views < 100 ? 'low_views' : 'insufficient_traffic';
        }
      }else{
        if(analytics.retentionPct==null||analytics.ctrPct==null){
          noDataReason = views < 100 ? 'low_views' : 'insufficient_traffic';
        }
      }

      return {
        id: item.id,
        type: isShort?'short':'long',
        title: sn.title||'Без названия',
        thumbnail: (th.medium&&th.medium.url)||(th.default&&th.default.url)||null,
        published_at: sn.publishedAt||null,
        duration_sec: durationSec,
        views, likes, comments, shares,
        retention_pct:   !isShort&&analytics.retentionPct!=null ? analytics.retentionPct : null,
        ctr_pct:         !isShort&&analytics.ctrPct!=null ? analytics.ctrPct : null,
        retention_short: isShort ? retentionShort : null,
        swiped_ratio:    isShort ? (swipe.swipedRatio??null) : null,
        viewed_ratio:    isShort ? (swipe.viewedRatio??null) : null,
        rewatched:       isShort ? !!swipe.rewatched : false,
        avg_duration_sec: analytics.avgDurSec!=null ? analytics.avgDurSec : (swipe.avgDurSec!=null?swipe.avgDurSec:null),
        watch_hours: watchMinutes>0 ? parseFloat((watchMinutes/60).toFixed(1)) : null,
        subscribers_gained: analytics.subscribersGained||0,
        no_data_reason: noDataReason,
        video_url: 'https://www.youtube.com/watch?v='+item.id,
        channel_url: payload.channel_url||('https://www.youtube.com/channel/'+channelId),
        score: calcVideoScore({ views,likes,comments,shares,retentionPct:analytics.retentionPct||null,ctrPct:analytics.ctrPct||null,isShort,swipedRatio:swipe.swipedRatio??null,retentionShort }),
      };
    });

    res.json({
      videos,
      subscriber_count: subscriberCount,
      channel_total_views: channelTotalViews,
      channel_watch_hours: parseFloat((channelWatchMinutes/60).toFixed(1)),
      analytics_limited: analyticsFailed, // подсказка фронту, что данные могут быть скудными
    });
  }catch(e){
    console.error('Videos error:',e.message);
    res.status(502).json({ error:e.message });
  }
});

// GET /api/youtube/playlists — список плейлистов канала (для категории "Плейлисты" в Статистике/Прогнозе)
app.get('/api/youtube/playlists', async (req,res)=>{
  const payload=await requireAuth(req,res); if(!payload)return;
  const channelId=req.query.channel_id||payload.channel_id;
  if(!channelId)return res.status(400).json({ error:'channel_id required' });
  try{
    const accessToken=await getValidAccessToken(payload);
    const data=await gFetch(`https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&channelId=${encodeURIComponent(channelId)}&maxResults=50`,accessToken);
    const playlists=(data.items||[]).map(p=>{
      const th=(p.snippet&&p.snippet.thumbnails)||{};
      return {
        id:p.id,
        title:(p.snippet&&p.snippet.title)||'Без названия',
        thumbnail:(th.medium&&th.medium.url)||(th.default&&th.default.url)||null,
        item_count:(p.contentDetails&&p.contentDetails.itemCount)||0,
        published_at:(p.snippet&&p.snippet.publishedAt)||null,
      };
    });
    return res.json({ playlists });
  }catch(e){ return res.status(502).json({ error:e.message }); }
});

// GET /api/youtube/playlists/:playlistId/videos — видео внутри плейлиста с полной аналитикой.
// Формат ответа идентичен /api/youtube/videos, чтобы фронт мог использовать ту же normalizeVideo().
app.get('/api/youtube/playlists/:playlistId/videos', async (req,res)=>{
  const payload=await requireAuth(req,res); if(!payload)return;
  const channelId=req.query.channel_id||payload.channel_id;
  const playlistId=req.params.playlistId;
  if(!channelId)return res.status(400).json({ error:'channel_id required' });
  try{
    const accessToken=await getValidAccessToken(payload);

    const itemsData=await gFetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${encodeURIComponent(playlistId)}&maxResults=50`,accessToken);
    const videoIds=(itemsData.items||[]).map(i=>i.contentDetails&&i.contentDetails.videoId).filter(Boolean);
    if(!videoIds.length)return res.json({ videos:[], summary:{ total_views:0, total_watch_hours:0, video_count:0 } });

    const statsData=await gFetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoIds.join(',')}`,accessToken);
    const endDate=getTodayString(), startDate=getDateDaysAgo(30);

    let analyticsMap={};
    try{
      const analyticsData=await gFetch(
        `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel%3D%3D${encodeURIComponent(channelId)}&startDate=${startDate}&endDate=${endDate}&metrics=views,likes,comments,shares,averageViewPercentage,averageViewDuration,estimatedMinutesWatched,subscribersGained&dimensions=video&filters=video%3D%3D${videoIds.join('%2C')}&maxResults=${videoIds.length}`,
        accessToken
      );
      const headers=(analyticsData.columnHeaders||[]).map(h=>h.name); const gi=n=>headers.indexOf(n);
      for(const row of (analyticsData.rows||[])){
        const vid=row[gi('video')]; if(!vid)continue;
        const mins=gi('estimatedMinutesWatched')>=0?safeFloat(row[gi('estimatedMinutesWatched')]):0;
        analyticsMap[vid]={
          retentionPct: gi('averageViewPercentage')>=0&&row[gi('averageViewPercentage')]!=null ? parseFloat(safeFloat(row[gi('averageViewPercentage')]).toFixed(1)) : null,
          shares: gi('shares')>=0 ? safeInt(row[gi('shares')]) : 0,
          avgDurSec: gi('averageViewDuration')>=0&&row[gi('averageViewDuration')]!=null ? parseFloat(safeFloat(row[gi('averageViewDuration')]).toFixed(1)) : null,
          watchMinutes: mins,
          subscribersGained: gi('subscribersGained')>=0 ? safeInt(row[gi('subscribersGained')]) : 0,
        };
      }
    }catch(e){ console.warn('Playlist analytics (non-fatal):',e.message); }

    try{
      const ctrData=await gFetch(
        `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel%3D%3D${encodeURIComponent(channelId)}&startDate=${startDate}&endDate=${endDate}&metrics=impressions,impressionClickThroughRate&dimensions=video&filters=video%3D%3D${videoIds.join('%2C')}&maxResults=${videoIds.length}`,
        accessToken
      );
      const cH=(ctrData.columnHeaders||[]).map(h=>h.name); const gi=n=>cH.indexOf(n);
      for(const row of (ctrData.rows||[])){
        const vid=row[gi('video')]; if(!vid)continue;
        const ctrPct=gi('impressionClickThroughRate')>=0&&row[gi('impressionClickThroughRate')]!=null ? parseFloat((safeFloat(row[gi('impressionClickThroughRate')])*100).toFixed(2)) : null;
        if(!analyticsMap[vid])analyticsMap[vid]={};
        analyticsMap[vid].ctrPct=ctrPct;
      }
    }catch(e){}

    const shortCandidates=(statsData.items||[]).filter(item=>{ const dur=parseDurationToSeconds((item.contentDetails||{}).duration); return dur>0&&dur<=60; }).map(i=>i.id);
    let swipeMap={};
    for(const vid of shortCandidates){
      const a=analyticsMap[vid];
      if(a&&a.retentionPct!=null){
        const viewedPct=Math.min(100,a.retentionPct);
        swipeMap[vid]={ viewedRatio:parseFloat(viewedPct.toFixed(1)), swipedRatio:parseFloat(Math.max(0,100-viewedPct).toFixed(1)), avgDurSec:a.avgDurSec, rewatched:a.retentionPct>=100 };
      }
    }

    const videos=(statsData.items||[]).map(item=>{
      const sn=item.snippet||{},st=item.statistics||{},cd=item.contentDetails||{},th=sn.thumbnails||{};
      const durationSec=parseDurationToSeconds(cd.duration);
      const isShort=durationSec>0&&durationSec<=60;
      const views=safeInt(st.viewCount),likes=safeInt(st.likeCount),comments=safeInt(st.commentCount);
      const analytics=analyticsMap[item.id]||{};
      const swipe=swipeMap[item.id]||{};
      const shares=analytics.shares||0;
      const watchMinutes=analytics.watchMinutes||0;
      let retentionShort=null;
      if(isShort){
        const avgDur=swipe.avgDurSec!=null?swipe.avgDurSec:analytics.avgDurSec;
        if(avgDur!=null&&durationSec>0) retentionShort=parseFloat(((avgDur/durationSec)*100).toFixed(1));
        else if(analytics.retentionPct!=null) retentionShort=analytics.retentionPct;
      }
      return {
        id:item.id, type:isShort?'short':'long', title:sn.title||'Без названия',
        thumbnail:(th.medium&&th.medium.url)||(th.default&&th.default.url)||null,
        published_at:sn.publishedAt||null, duration_sec:durationSec,
        views, likes, comments, shares,
        retention_pct: !isShort&&analytics.retentionPct!=null?analytics.retentionPct:null,
        ctr_pct: !isShort&&analytics.ctrPct!=null?analytics.ctrPct:null,
        retention_short: isShort?retentionShort:null,
        swiped_ratio: isShort?(swipe.swipedRatio??null):null,
        viewed_ratio: isShort?(swipe.viewedRatio??null):null,
        rewatched: isShort?!!swipe.rewatched:false,
        avg_duration_sec: analytics.avgDurSec!=null?analytics.avgDurSec:(swipe.avgDurSec!=null?swipe.avgDurSec:null),
        watch_hours: watchMinutes>0?parseFloat((watchMinutes/60).toFixed(1)):null,
        subscribers_gained: analytics.subscribersGained||0,
        no_data_reason: null,
        video_url:'https://www.youtube.com/watch?v='+item.id,
        channel_url: payload.channel_url||('https://www.youtube.com/channel/'+channelId),
        score: calcVideoScore({ views,likes,comments,shares,retentionPct:analytics.retentionPct||null,ctrPct:analytics.ctrPct||null,isShort,swipedRatio:swipe.swipedRatio??null,retentionShort }),
      };
    });

    const totalViews=videos.reduce((s,v)=>s+v.views,0);
    const totalWatchHours=videos.reduce((s,v)=>s+(v.watch_hours||0),0);
    res.json({ videos, summary:{ total_views:totalViews, total_watch_hours:parseFloat(totalWatchHours.toFixed(1)), video_count:videos.length } });
  }catch(e){ res.status(502).json({ error:e.message }); }
});

app.get('/api/youtube/channel-analytics', async (req,res)=>{
  const payload=await requireAuth(req,res); if(!payload)return;
  const channelId=req.query.channel_id||payload.channel_id;
  if(!channelId)return res.status(400).json({ error:'channel_id required' });
  try{
    const accessToken=await getValidAccessToken(payload),endDate=getTodayString(),startDate=getDateDaysAgo(30);
    const data=await gFetch(`https://youtubeanalytics.googleapis.com/v2/reports?ids=channel%3D%3D${encodeURIComponent(channelId)}&startDate=${startDate}&endDate=${endDate}&metrics=views,likes,comments,shares,subscribersGained,subscribersLost,estimatedMinutesWatched,impressions,impressionClickThroughRate&dimensions=day&sort=day`,accessToken);
    const headers=(data.columnHeaders||[]).map(h=>h.name),rows=data.rows||[],gi=name=>headers.indexOf(name);
    const daily_views=rows.map(r=>({date:r[gi('day')]||'',views:safeInt(r[gi('views')])}));
    const totalMinutes=rows.reduce((s,r)=>s+safeFloat(r[gi('estimatedMinutesWatched')]),0);
    res.json({
      channel_id:channelId,date_range:{start:startDate,end:endDate},
      total_views:daily_views.reduce((s,d)=>s+d.views,0),
      subscribers_gained:rows.reduce((s,r)=>s+safeInt(r[gi('subscribersGained')]),0),
      subscribers_lost:rows.reduce((s,r)=>s+safeInt(r[gi('subscribersLost')]),0),
      net_subscribers:rows.reduce((s,r)=>s+safeInt(r[gi('subscribersGained')])-safeInt(r[gi('subscribersLost')]),0),
      total_shares:rows.reduce((s,r)=>s+safeInt(r[gi('shares')]),0),
      avg_ctr_pct:(rows.length>0&&gi('impressionClickThroughRate')>=0)?parseFloat((rows.reduce((s,r)=>s+safeFloat(r[gi('impressionClickThroughRate')]),0)/rows.length*100).toFixed(2)):0,
      watch_hours: parseFloat((totalMinutes/60).toFixed(1)),
      daily_views,
    });
  }catch(e){ res.status(502).json({ error:'youtube_api_error',message:e.message }); }
});

app.get('/api/health', (req,res)=>{
  res.json({ ok:true, ts:new Date().toISOString(), version:'10.0.0', ai:'gemini-2.5-flash', limits:{ user:USER_DAILY_LIMIT, admin:ADMIN_DAILY_LIMIT, feedback:FEEDBACK_DAILY_LIMIT } });
});

export default app;