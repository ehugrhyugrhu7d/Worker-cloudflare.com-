/**
 * Project: Cloudflare Workers Optimized User Page & Management System
 * File: worker9288373921.js
 * Version: 4.0.0 (Ultra High Image Quality, Neon Aesthetics & Low KV)
 */

const ADMIN_PATH = '/admin_kiyan_92';
const COOKIE_NAME = 'admin_session_v1';
const INDEX_KEY = 'users:index';
const USER_KEY_PREFIX = 'user:';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // 1. PUBLIC USER PAGE: /u/:uid
      if (path.startsWith('/u/')) {
        const uid = path.split('/')[2];
        return await handlePublicUserPage(uid, env);
      }

      // 2. ADMIN PANEL ROUTING
      if (path === ADMIN_PATH || path === `${ADMIN_PATH}/` || path.startsWith(`${ADMIN_PATH}/`)) {
        return await handleAdminRoutes(path, request, env);
      }

      // 3. 404 FOR ALL OTHER PATHS
      return renderNotFoundResponse();
    } catch (err) {
      return new Response(JSON.stringify({ error: "Internal Server Error", message: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }
  }
};

/* ==========================================================================
   ADMIN & API ROUTER
   ========================================================================== */
async function handleAdminRoutes(path, request, env) {
  const method = request.method;

  if (path === ADMIN_PATH || path === `${ADMIN_PATH}/`) {
    if (method === 'GET') {
      const isAuth = await verifyAuthToken(request, env);
      if (isAuth) {
        return renderAdminUI();
      }
      return renderLoginPage();
    }
  }

  if (path === `${ADMIN_PATH}/api/login` && method === 'POST') {
    return handleLogin(request, env);
  }

  if (path === `${ADMIN_PATH}/api/logout` && method === 'POST') {
    return handleLogout();
  }

  const isAuth = await verifyAuthToken(request, env);
  if (!isAuth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }

  if (path === `${ADMIN_PATH}/api/users` && method === 'GET') {
    return handleListUsers(env);
  }

  if (path === `${ADMIN_PATH}/api/users` && method === 'POST') {
    return handleCreateUser(request, env);
  }

  if (path.startsWith(`${ADMIN_PATH}/api/users/`)) {
    const uid = path.split('/').pop();
    if (!uid || uid.length !== 30) {
      return new Response(JSON.stringify({ error: "Invalid UID" }), { status: 400 });
    }

    if (method === 'GET') {
      return handleGetUser(uid, env);
    }
    if (method === 'PUT') {
      return handleUpdateUser(uid, request, env);
    }
    if (method === 'DELETE') {
      return handleDeleteUser(uid, env);
    }
  }

  return renderNotFoundResponse();
}

/* ==========================================================================
   PUBLIC PAGE & KV LOGIC
   ========================================================================== */
async function handlePublicUserPage(uid, env) {
  if (!uid || !/^[a-zA-Z0-9]{30}$/.test(uid)) {
    return renderNotFoundResponse();
  }

  const rawData = await env.DB.get(`${USER_KEY_PREFIX}${uid}`);
  if (!rawData) {
    return renderNotFoundResponse();
  }

  let user;
  try {
    user = JSON.parse(rawData);
  } catch (e) {
    return renderNotFoundResponse();
  }

  const now = Math.floor(Date.now() / 1000);
  if (user.expiresAt && user.expiresAt <= now) {
    return renderNotFoundResponse();
  }

  return new Response(renderUserHTML(user), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
      "Expires": "0"
    }
  });
}

/* ==========================================================================
   ADMIN API HANDLERS
   ========================================================================== */
async function handleLogin(request, env) {
  try {
    const { username, password } = await request.json();
    const adminUser = env.ADMIN_USER;
    const adminPass = env.ADMIN_PASS;

    if (!adminUser || !adminPass) {
      return new Response(JSON.stringify({ error: "تنظیمات احراز هویت سرور ناقص است." }), { status: 500 });
    }

    if (username === adminUser && password === adminPass) {
      const token = await createAuthToken(adminUser, adminPass);
      const headers = new Headers();
      headers.append("Content-Type", "application/json");
      headers.append("Set-Cookie", `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`);
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    return new Response(JSON.stringify({ error: "نام کاربری یا رمز عبور اشتباه است." }), { status: 401 });
  } catch (e) {
    return new Response(JSON.stringify({ error: "ورودی نامعتبر است." }), { status: 400 });
  }
}

function handleLogout() {
  const headers = new Headers();
  headers.append("Content-Type", "application/json");
  headers.append("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
  return new Response(JSON.stringify({ success: true }), { headers });
}

async function handleListUsers(env) {
  const index = await getIndex(env);
  const now = Math.floor(Date.now() / 1000);

  const updatedIndex = index.map(u => ({
    ...u,
    status: u.expiresAt <= now ? 'EXPIRED' : 'ACTIVE'
  }));

  return new Response(JSON.stringify(updatedIndex), {
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

async function handleCreateUser(request, env) {
  try {
    const body = await request.json();
    let { name, imageBase64, text, expiresValue, expiresUnit, customDate } = body;

    name = sanitizeInput(name, 100);
    text = sanitizeInput(text, 2000);

    if (!name) {
      return new Response(JSON.stringify({ error: "نام کاربر اجباری است." }), { status: 400 });
    }

    const expiresAt = calculateExpiration(expiresValue, expiresUnit, customDate);
    if (!expiresAt) {
      return new Response(JSON.stringify({ error: "زمان انقضا نامعتبر است." }), { status: 400 });
    }

    const uid = generateSecureUID(30);
    const createdAt = Math.floor(Date.now() / 1000);

    const userData = { uid, name, image: imageBase64 || '', text, createdAt, expiresAt };

    await env.DB.put(`${USER_KEY_PREFIX}${uid}`, JSON.stringify(userData));

    const index = await getIndex(env);
    index.unshift({
      uid,
      name,
      createdAt,
      expiresAt,
      hasImage: !!imageBase64,
      hasText: !!text
    });
    await saveIndex(env, index);

    return new Response(JSON.stringify({ success: true, user: { uid, name } }), { status: 201 });
  } catch (e) {
    return new Response(JSON.stringify({ error: "خطا در ساخت کاربر." }), { status: 500 });
  }
}

async function handleGetUser(uid, env) {
  const rawData = await env.DB.get(`${USER_KEY_PREFIX}${uid}`);
  if (!rawData) {
    return new Response(JSON.stringify({ error: "کاربر یافت نشد" }), { status: 404 });
  }
  return new Response(rawData, { headers: { "Content-Type": "application/json" } });
}

async function handleUpdateUser(uid, request, env) {
  try {
    const body = await request.json();
    let { name, imageBase64, text, expiresValue, expiresUnit, customDate, keepExistingImage } = body;

    const rawData = await env.DB.get(`${USER_KEY_PREFIX}${uid}`);
    if (!rawData) {
      return new Response(JSON.stringify({ error: "کاربر یافت نشد" }), { status: 404 });
    }

    const existingUser = JSON.parse(rawData);

    name = sanitizeInput(name, 100);
    text = sanitizeInput(text, 2000);

    if (!name) {
      return new Response(JSON.stringify({ error: "نام کاربر اجباری است." }), { status: 400 });
    }

    let finalImage = existingUser.image;
    if (!keepExistingImage) {
      finalImage = imageBase64 || '';
    }

    let expiresAt = existingUser.expiresAt;
    if (expiresValue || customDate) {
      const calcExp = calculateExpiration(expiresValue, expiresUnit, customDate);
      if (calcExp) expiresAt = calcExp;
    }

    const updatedUser = {
      ...existingUser,
      name,
      image: finalImage,
      text,
      expiresAt
    };

    await env.DB.put(`${USER_KEY_PREFIX}${uid}`, JSON.stringify(updatedUser));

    const index = await getIndex(env);
    const idx = index.findIndex(u => u.uid === uid);
    if (idx !== -1) {
      index[idx] = {
        ...index[idx],
        name,
        expiresAt,
        hasImage: !!finalImage,
        hasText: !!text
      };
      await saveIndex(env, index);
    }

    return new Response(JSON.stringify({ success: true, user: { uid, name } }));
  } catch (e) {
    return new Response(JSON.stringify({ error: "خطا در بروزرسانی کاربر" }), { status: 500 });
  }
}

async function handleDeleteUser(uid, env) {
  await env.DB.delete(`${USER_KEY_PREFIX}${uid}`);

  const index = await getIndex(env);
  const updatedIndex = index.filter(u => u.uid !== uid);
  await saveIndex(env, updatedIndex);

  return new Response(JSON.stringify({ success: true }));
}

/* ==========================================================================
   HELPERS & INDEX MANAGEMENT
   ========================================================================== */
async function getIndex(env) {
  const raw = await env.DB.get(INDEX_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveIndex(env, index) {
  await env.DB.put(INDEX_KEY, JSON.stringify(index));
}

function generateSecureUID(length = 30) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[array[i] % chars.length];
  }
  return result;
}

function sanitizeInput(str, maxLength = 1000) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLength);
}

function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function calculateExpiration(val, unit, customDate) {
  const now = Math.floor(Date.now() / 1000);

  if (unit === 'custom' && customDate) {
    const t = Math.floor(new Date(customDate).getTime() / 1000);
    return isNaN(t) || t <= now ? null : t;
  }

  const num = parseFloat(val);
  if (isNaN(num) || num <= 0) return null;

  let seconds = 0;
  switch (unit) {
    case 'minutes': seconds = num * 60; break;
    case 'hours':   seconds = num * 3600; break;
    case 'days':    seconds = num * 86400; break;
    default:        return null;
  }

  return now + Math.floor(seconds);
}

/* ==========================================================================
   AUTH TOKEN (HMAC-SHA256)
   ========================================================================== */
async function createAuthToken(user, pass) {
  const secretKey = `${user}:${pass}:cf_kiyan_secret_92`;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secretKey);
  
  const key = await crypto.subtle.importKey(
    "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );

  const expires = Math.floor(Date.now() / 1000) + (24 * 3600);
  const payload = `${user}:${expires}`;
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const hexSig = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');

  return btoa(`${payload}:${hexSig}`);
}

async function verifyAuthToken(request, env) {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return false;

  const cookies = Object.fromEntries(cookieHeader.split(';').map(c => {
    const [k, v] = c.trim().split('=');
    return [k, v];
  }));

  const token = cookies[COOKIE_NAME];
  if (!token) return false;

  try {
    const decoded = atob(token);
    const parts = decoded.split(':');
    if (parts.length !== 3) return false;

    const [user, expiresStr, hexSig] = parts;
    const expires = parseInt(expiresStr, 10);
    const now = Math.floor(Date.now() / 1000);

    if (expires <= now) return false;
    if (user !== env.ADMIN_USER) return false;

    const secretKey = `${env.ADMIN_USER}:${env.ADMIN_PASS}:cf_kiyan_secret_92`;
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secretKey);
    
    const key = await crypto.subtle.importKey(
      "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );

    const payload = `${user}:${expiresStr}`;
    const sigBytes = new Uint8Array(hexSig.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

    return await crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(payload));
  } catch (e) {
    return false;
  }
}

/* ==========================================================================
   UI RENDERING FUNCTIONS
   ========================================================================== */
function renderNotFoundResponse() {
  const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>یافت نشد</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      background-color: #030008;
      color: #ffffff;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .not-found-box { text-align: center; }
    h1 { font-size: 3rem; font-weight: 700; color: #a855f7; text-shadow: 0 0 20px rgba(168, 85, 247, 0.4); }
  </style>
</head>
<body>
  <div class="not-found-box">
    <h1>404 | یافت نشد</h1>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

function renderUserHTML(user) {
  const escapedName = escapeHTML(user.name);
  const escapedText = escapeHTML(user.text).replace(/\n/g, '<br>');
  const hasImage = !!user.image;

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapedName}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      background: #040209;
      color: #f1f5f9;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
      overflow-x: hidden;
      position: relative;
    }

    /* ANIMATED PURPLE & GREEN AURA BACKGROUND */
    .aura-bg {
      position: fixed;
      inset: 0;
      z-index: 0;
      pointer-events: none;
      overflow: hidden;
    }
    .aura-blob {
      position: absolute;
      border-radius: 50%;
      filter: blur(90px);
      opacity: 0.6;
      animation: floatAura 10s infinite alternate ease-in-out;
    }
    .aura-purple {
      width: 320px;
      height: 320px;
      background: radial-gradient(circle, #a855f7, #6b21a8);
      top: -10%;
      right: -10%;
    }
    .aura-green {
      width: 350px;
      height: 350px;
      background: radial-gradient(circle, #10b981, #047857);
      bottom: -10%;
      left: -10%;
      animation-delay: -5s;
    }

    @keyframes floatAura {
      0% { transform: translate(0, 0) scale(1); }
      50% { transform: translate(40px, 30px) scale(1.15); }
      100% { transform: translate(-30px, -40px) scale(0.95); }
    }

    /* CARD CONTAINER */
    .card {
      position: relative;
      z-index: 10;
      width: 100%;
      max-width: 450px;
      background: rgba(15, 12, 28, 0.65);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      border: 1px solid rgba(168, 85, 247, 0.25);
      border-radius: 28px;
      padding: 30px 24px;
      text-align: center;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6),
                  0 0 30px rgba(168, 85, 247, 0.15),
                  inset 0 0 15px rgba(255, 255, 255, 0.03);
      animation: cardAppear 0.8s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes cardAppear {
      from { opacity: 0; transform: translateY(25px) scale(0.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    /* AVATAR & IMAGE */
    .avatar-wrapper {
      position: relative;
      margin: 0 auto 20px auto;
      cursor: pointer;
      display: inline-block;
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.4s ease;
    }
    .avatar-wrapper:hover {
      transform: scale(1.03);
      box-shadow: 0 15px 35px rgba(168, 85, 247, 0.3);
    }
    .avatar-img {
      width: 100%;
      max-width: 380px;
      display: block;
      border-radius: 20px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      object-fit: cover;
    }

    /* NEON ARTISTIC SVG HEART */
    .heart-icon-wrapper {
      margin-bottom: 8px;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    .svg-neon-heart {
      width: 38px;
      height: 38px;
      filter: drop-shadow(0 0 10px #ec4899) drop-shadow(0 0 20px #a855f7);
      animation: pulseGlow 2.5s infinite ease-in-out;
    }

    @keyframes pulseGlow {
      0%, 100% { transform: scale(1); filter: drop-shadow(0 0 8px #ec4899) drop-shadow(0 0 18px #a855f7); }
      50% { transform: scale(1.12); filter: drop-shadow(0 0 14px #ec4899) drop-shadow(0 0 28px #10b981); }
    }

    /* USER NAME & CONTENT TEXT */
    .user-name {
      font-size: 1.65rem;
      font-weight: 800;
      color: #ffffff;
      margin-bottom: 16px;
      letter-spacing: -0.3px;
      text-shadow: 0 2px 10px rgba(0,0,0,0.5);
    }

    .user-text-container {
      position: relative;
      background: rgba(255, 255, 255, 0.04);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-right: 3px solid #10b981;
      border-left: 3px solid #a855f7;
      border-radius: 18px;
      padding: 18px;
      margin-top: 14px;
      text-align: right;
      box-shadow: inset 0 0 20px rgba(0,0,0,0.2);
    }

    .user-text {
      font-size: 0.98rem;
      line-height: 1.8;
      color: #e2e8f0;
      word-break: break-word;
    }

    /* FULLSCREEN MODAL */
    .image-modal {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(3, 1, 10, 0.95);
      backdrop-filter: blur(15px);
      -webkit-backdrop-filter: blur(15px);
      z-index: 1000;
      justify-content: center;
      align-items: center;
      flex-direction: column;
      padding: 20px;
      animation: fadeIn 0.3s ease;
    }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

    .image-modal img {
      max-width: 95%;
      max-height: 80vh;
      border-radius: 18px;
      box-shadow: 0 0 40px rgba(168, 85, 247, 0.3);
      border: 1px solid rgba(255,255,255,0.2);
    }

    .btn-modal {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 28px;
      border-radius: 12px;
      border: none;
      font-weight: 700;
      font-size: 0.95rem;
      cursor: pointer;
      text-decoration: none;
      margin-top: 18px;
      transition: all 0.3s ease;
    }
    .btn-download {
      background: linear-gradient(135deg, #10b981, #059669);
      color: #ffffff;
      box-shadow: 0 6px 20px rgba(16, 185, 129, 0.35);
    }
    .btn-download:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 25px rgba(16, 185, 129, 0.5);
    }
  </style>
</head>
<body>

  <!-- BACKGROUND AURAS -->
  <div class="aura-bg">
    <div class="aura-blob aura-purple"></div>
    <div class="aura-blob aura-green"></div>
  </div>

  <div class="card">
    ${hasImage ? `
      <div class="avatar-wrapper" onclick="openFullImage()">
        <img src="${user.image}" alt="${escapedName}" class="avatar-img">
      </div>
    ` : ''}

    <!-- ARTISTIC NEON HEART SVG -->
    <div class="heart-icon-wrapper">
      <svg class="svg-neon-heart" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="heartGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#ec4899" />
            <stop offset="50%" stop-color="#a855f7" />
            <stop offset="100%" stop-color="#10b981" />
          </linearGradient>
        </defs>
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="url(#heartGrad)"/>
      </svg>
    </div>

    <h1 class="user-name">${escapedName}</h1>

    ${escapedText ? `
      <div class="user-text-container">
        <div class="user-text">${escapedText}</div>
      </div>
    ` : ''}
  </div>

  ${hasImage ? `
    <div class="image-modal" id="imgModal" onclick="closeFullImage(event)">
      <img src="${user.image}" alt="${escapedName}">
      <div>
        <a href="${user.image}" download="${escapedName}.webp" class="btn-modal btn-download">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          دانلود تصویر باکیفیت
        </a>
      </div>
    </div>
  ` : ''}

  <script>
    function openFullImage() { document.getElementById('imgModal').style.display = 'flex'; }
    function closeFullImage(e) { if (!e || e.target.id === 'imgModal') document.getElementById('imgModal').style.display = 'none'; }
  </script>
</body>
</html>`;
}

function renderLoginPage() {
  const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ورود مدیر</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background: #040209; color: #fff; font-family: system-ui, sans-serif; min-height: 100vh; display: flex; justify-content: center; align-items: center; padding: 16px; }
    .login-box { width: 100%; max-width: 380px; background: rgba(15,23,42,0.8); backdrop-filter: blur(16px); border: 1px solid rgba(168,85,247,0.3); border-radius: 20px; padding: 32px 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
    input { width: 100%; padding: 12px 14px; margin-top: 6px; margin-bottom: 16px; border-radius: 10px; border: 1px solid #334155; background: #090d16; color: #fff; direction: ltr; font-size:1rem; }
    button { width: 100%; padding: 12px; border-radius: 10px; border: none; background: linear-gradient(135deg, #a855f7, #7c3aed); color: #fff; font-weight: bold; cursor: pointer; font-size:1rem; transition: transform 0.2s; }
    button:hover { transform: scale(1.02); }
  </style>
</head>
<body>
  <div class="login-box">
    <h2 style="color:#a855f7; text-align:center; margin-bottom:20px; font-weight:800;">ورود به مدیریت</h2>
    <form id="loginForm">
      <label style="font-size:0.9rem; color:#cbd5e1;">نام کاربری</label>
      <input type="text" id="username" required>
      <label style="font-size:0.9rem; color:#cbd5e1;">رمز عبور</label>
      <input type="password" id="password" required>
      <button type="submit">ورود به پنل</button>
    </form>
  </div>
  <script>
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await fetch('${ADMIN_PATH}/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: document.getElementById('username').value,
          password: document.getElementById('password').value
        })
      });
      if (res.ok) window.location.reload();
      else alert('اطلاعات ورود اشتباه است.');
    });
  </script>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function renderAdminUI() {
  const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>پنل مدیریت VIP</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background: #05030a; color: #e2e8f0; font-family: system-ui, sans-serif; padding: 20px; max-width: 1200px; margin: 0 auto; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 16px; }
    .btn { padding: 10px 16px; border-radius: 10px; border: none; cursor: pointer; font-weight: 600; font-size: 0.88rem; transition: all 0.2s; }
    .btn-primary { background: linear-gradient(135deg, #a855f7, #7c3aed); color: #fff; }
    .btn-danger { background: #ef4444; color: #fff; }
    .btn-secondary { background: #1e293b; color: #fff; border: 1px solid rgba(255,255,255,0.1); }
    .card { background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(12px); border: 1px solid rgba(168, 85, 247, 0.2); border-radius: 16px; padding: 20px; margin-bottom: 24px; }
    .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
    input, select, textarea { width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid #334155; background: #090d16; color: #fff; }
    textarea { grid-column: 1 / -1; }
    .responsive-table { width: 100%; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; text-align: right; font-size: 0.88rem; }
    th, td { padding: 12px; border-bottom: 1px solid #1e293b; }
    .badge { padding: 3px 10px; border-radius: 12px; font-weight: bold; font-size:0.75rem; }
    .badge-active { background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3); }
    .badge-expired { background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3); }
  </style>
</head>
<body>
  <header>
    <h1 style="color:#a855f7; font-size:1.4rem; font-weight:800;">پنل مدیریت VIP</h1>
    <button class="btn btn-danger" onclick="logout()">خروج</button>
  </header>

  <div class="card">
    <h3 id="formTitle" style="margin-bottom:14px; color:#10b981;">افزودن کاربر جدید</h3>
    <form id="userForm">
      <input type="hidden" id="editUid" value="">
      <div class="form-grid">
        <div>
          <label style="font-size:0.85rem; color:#94a3b8;">نام کاربر</label>
          <input type="text" id="name" required>
        </div>
        <div>
          <label style="font-size:0.85rem; color:#94a3b8;">تصویر (با بالاترین کیفیت Ultra HD)</label>
          <input type="file" id="imageInput" accept="image/*" onchange="compressAndPreviewImage()">
        </div>
        <div>
          <label style="font-size:0.85rem; color:#94a3b8;">مقدار انقضا</label>
          <input type="number" id="expiresValue" min="1" value="30">
        </div>
        <div>
          <label style="font-size:0.85rem; color:#94a3b8;">واحد انقضا</label>
          <select id="expiresUnit">
            <option value="minutes">دقیقه</option>
            <option value="hours">ساعت</option>
            <option value="days" selected>روز</option>
          </select>
        </div>
        <textarea id="text" rows="3" placeholder="متن اختصاصی (اختیاری)"></textarea>
      </div>
      <div style="margin-top:16px; display:flex; gap:10px;">
        <button type="submit" class="btn btn-primary" id="submitBtn">ثبت کاربر</button>
        <button type="button" class="btn btn-secondary" id="cancelBtn" style="display:none;" onclick="resetForm()">انصراف</button>
      </div>
    </form>
  </div>

  <div class="card">
    <div style="margin-bottom:14px; font-weight:bold; color:#a855f7;">تعداد کاربران: <span id="totalUsers">0</span></div>
    <div class="responsive-table">
      <table>
        <thead>
          <tr>
            <th>نام</th>
            <th>UID</th>
            <th>محتوا</th>
            <th>انقضا</th>
            <th>وضعیت</th>
            <th>عملیات</th>
          </tr>
        </thead>
        <tbody id="userTableBody"></tbody>
      </table>
    </div>
  </div>

  <script>
    let rawUsers = [];
    let compressedImageBase64 = '';
    let isEditingKeepImage = false;

    // HIGH QUALITY & HIGH PERFORMANCE IMAGE COMPRESSION (Max Dimension 1080px WebP)
    function compressAndPreviewImage() {
      const file = document.getElementById('imageInput').files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          const maxDim = 1080; // High clarity limit

          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          
          // Smooth Image Rendering
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, width, height);

          // WebP format gives pristine quality with minimum KV footprint
          compressedImageBase64 = canvas.toDataURL('image/webp', 0.88);
          isEditingKeepImage = false;
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    }

    async function logout() {
      await fetch('${ADMIN_PATH}/api/logout', { method: 'POST' });
      window.location.reload();
    }

    async function loadUsers() {
      const res = await fetch('${ADMIN_PATH}/api/users');
      if (res.status === 401) return window.location.reload();
      rawUsers = await res.json();
      document.getElementById('totalUsers').innerText = rawUsers.length;
      renderTable();
    }

    function renderTable() {
      const tbody = document.getElementById('userTableBody');
      tbody.innerHTML = '';

      if (rawUsers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#64748b;">هیچ کاربری ثبت نشده است.</td></tr>';
        return;
      }

      rawUsers.forEach(u => {
        const fullUrl = window.location.origin + '/u/' + u.uid;
        const expDate = new Date(u.expiresAt * 1000).toLocaleString('fa-IR');
        const isExpired = u.status === 'EXPIRED';

        const tr = document.createElement('tr');
        tr.innerHTML = \`
          <td style="font-weight:600; color:#fff;">\${escapeHtml(u.name)}</td>
          <td style="font-family:monospace; color:#94a3b8;">\${u.uid.substring(0,8)}...</td>
          <td>\${u.hasImage ? '🖼️ ' : ''}\${u.hasText ? '📝' : ''}</td>
          <td style="font-size:0.8rem; color:#cbd5e1;">\${expDate}</td>
          <td><span class="badge \${isExpired ? 'badge-expired' : 'badge-active'}">\${isExpired ? 'منقضی' : 'فعال'}</span></td>
          <td>
            <div style="display:flex; gap:6px;">
              <button class="btn btn-secondary" onclick="window.open('\${fullUrl}', '_blank')">بازکردن</button>
              <button class="btn btn-secondary" onclick="navigator.clipboard.writeText('\${fullUrl}')">کپی</button>
              <button class="btn btn-primary" onclick="editUser('\${u.uid}')">ویرایش</button>
              <button class="btn btn-danger" onclick="deleteUser('\${u.uid}')">حذف</button>
            </div>
          </td>
        \`;
        tbody.appendChild(tr);
      });
    }

    function escapeHtml(str) {
      return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    document.getElementById('userForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const editUid = document.getElementById('editUid').value;

      const payload = {
        name: document.getElementById('name').value,
        imageBase64: compressedImageBase64,
        keepExistingImage: isEditingKeepImage,
        text: document.getElementById('text').value,
        expiresValue: document.getElementById('expiresValue').value,
        expiresUnit: document.getElementById('expiresUnit').value
      };

      const url = editUid ? '${ADMIN_PATH}/api/users/' + editUid : '${ADMIN_PATH}/api/users';
      const method = editUid ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        resetForm();
        await loadUsers();
      } else {
        const data = await res.json();
        alert(data.error || 'خطا در ثبت کاربر');
      }
    });

    async function editUser(uid) {
      const res = await fetch('${ADMIN_PATH}/api/users/' + uid);
      if (!res.ok) return alert('خطا در دریافت اطلاعات');
      const user = await res.json();

      document.getElementById('editUid').value = user.uid;
      document.getElementById('name').value = user.name;
      document.getElementById('text').value = user.text || '';
      
      if (user.image) {
        compressedImageBase64 = user.image;
        isEditingKeepImage = true;
      } else {
        compressedImageBase64 = '';
        isEditingKeepImage = false;
      }

      document.getElementById('formTitle').innerText = 'ویرایش کاربر: ' + user.name;
      document.getElementById('submitBtn').innerText = 'بروزرسانی';
      document.getElementById('cancelBtn').style.display = 'inline-block';
    }

    function resetForm() {
      document.getElementById('editUid').value = '';
      document.getElementById('userForm').reset();
      compressedImageBase64 = '';
      isEditingKeepImage = false;
      document.getElementById('formTitle').innerText = 'افزودن کاربر جدید';
      document.getElementById('submitBtn').innerText = 'ثبت کاربر';
      document.getElementById('cancelBtn').style.display = 'none';
    }

    async function deleteUser(uid) {
      if (!confirm('آیا از حذف مطمئن هستید؟')) return;
      const res = await fetch('${ADMIN_PATH}/api/users/' + uid, { method: 'DELETE' });
      if (res.ok) await loadUsers();
    }

    loadUsers();
  </script>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
