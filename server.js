require('dotenv').config();
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const db      = require('./database');

const app            = express();
const PORT           = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_COOKIE   = 'carta_admin';

// ─── Ensure upload/export directories exist ───────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const EXPORTS_DIR = path.join(__dirname, 'exports');
[UPLOADS_DIR, EXPORTS_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ─── Multer (image uploads) ───────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits:     { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    /^image\/(jpeg|png|gif|webp)$/.test(file.mimetype) ? cb(null, true) : cb(null, false),
});

// ─── Express setup ────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ════════════════════════════════════════════════════════════════════════════════
// AUTH HELPERS
// ════════════════════════════════════════════════════════════════════════════════

function parseCookies(header) {
  const c = {};
  (header || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i < 0) return;
    const k = p.slice(0, i).trim();
    try { c[k] = decodeURIComponent(p.slice(i + 1).trim()); } catch { c[k] = p.slice(i + 1).trim(); }
  });
  return c;
}

function requireAdmin(req, res, next) {
  if (parseCookies(req.headers.cookie)[ADMIN_COOKIE] === ADMIN_PASSWORD) return next();
  res.redirect('/admin/login');
}

function setAdminCookie(res) {
  res.setHeader('Set-Cookie',
    `${ADMIN_COOKIE}=${encodeURIComponent(ADMIN_PASSWORD)}; HttpOnly; Path=/; Max-Age=86400; SameSite=Lax`);
}

function clearAdminCookie(res) {
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

// ─── Flash helpers (query-param based, zero deps) ────────────────────────────
function getFlash(req) {
  if (req.query.ok)  return { type: 'success', msg: String(req.query.ok).slice(0, 400) };
  if (req.query.err) return { type: 'error',   msg: String(req.query.err).slice(0, 400) };
  return null;
}

function redirectFlash(res, p, type, msg) {
  const key = type === 'success' ? 'ok' : 'err';
  res.redirect(`${p}?${key}=${encodeURIComponent(msg)}`);
}

// ════════════════════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ════════════════════════════════════════════════════════════════════════════════

app.get('/admin/login', (req, res) => res.render('admin-login', { error: null }));

app.post('/admin/login', (req, res) => {
  if ((req.body.password || '') === ADMIN_PASSWORD) {
    setAdminCookie(res);
    return res.redirect('/admin');
  }
  res.render('admin-login', { error: 'Contraseña incorrecta.' });
});

app.get('/admin/logout', (req, res) => {
  clearAdminCookie(res);
  res.redirect('/admin/login');
});

// ════════════════════════════════════════════════════════════════════════════════
// ADMIN: DASHBOARD
// ════════════════════════════════════════════════════════════════════════════════

app.get('/admin', requireAdmin, (req, res) => {
  const menus = db.prepare(`
    SELECT m.*,
      (SELECT COUNT(*) FROM categories WHERE menu_id = m.id) AS category_count,
      (SELECT COUNT(*) FROM dishes d JOIN categories c ON c.id = d.category_id WHERE c.menu_id = m.id) AS dish_count
    FROM menus m
    ORDER BY m.created_at DESC
  `).all();

  res.render('admin', { page: 'dashboard', menus, flash: getFlash(req) });
});

// ════════════════════════════════════════════════════════════════════════════════
// ADMIN: MENUS — CRUD
// ════════════════════════════════════════════════════════════════════════════════

app.post('/admin/menus', requireAdmin, (req, res) => {
  const { name, restaurant_name, description } = req.body;
  if (!name) return redirectFlash(res, '/admin', 'error', 'El nombre de la carta es obligatorio.');

  const r = db.prepare(`INSERT INTO menus (name, restaurant_name, description) VALUES (?, ?, ?)`)
    .run(name.trim(), trim(restaurant_name), trim(description));

  res.redirect(`/admin/menus/${r.lastInsertRowid}?ok=${encodeURIComponent('Carta creada')}`);
});

app.get('/admin/menus/:id', requireAdmin, (req, res) => {
  const menu = db.prepare(`SELECT * FROM menus WHERE id=?`).get(req.params.id);
  if (!menu) return res.redirect('/admin');

  const categories = db.prepare(
    `SELECT * FROM categories WHERE menu_id=? ORDER BY sort_order, id`
  ).all(req.params.id);

  const dishesByCategory = loadDishesByCategory(categories);

  res.render('admin', { page: 'menu', menu, categories, dishesByCategory, flash: getFlash(req) });
});

app.post('/admin/menus/:id/edit', requireAdmin, (req, res) => {
  const { name, restaurant_name, description, logo_url } = req.body;
  if (!name) return redirectFlash(res, `/admin/menus/${req.params.id}`, 'error', 'El nombre es obligatorio.');

  db.prepare(`UPDATE menus SET name=?, restaurant_name=?, description=?, logo_url=? WHERE id=?`)
    .run(name.trim(), trim(restaurant_name), trim(description), trim(logo_url), req.params.id);

  redirectFlash(res, `/admin/menus/${req.params.id}`, 'success', 'Carta actualizada');
});

app.post('/admin/menus/:id/delete', requireAdmin, (req, res) => {
  const menu = db.prepare(`SELECT * FROM menus WHERE id=?`).get(req.params.id);
  if (!menu) return res.redirect('/admin');

  deleteMenuImages(req.params.id);
  db.prepare(`DELETE FROM menus WHERE id=?`).run(req.params.id);

  redirectFlash(res, '/admin', 'success', `Carta "${menu.name}" eliminada`);
});

// ════════════════════════════════════════════════════════════════════════════════
// ADMIN: CATEGORIES — CRUD
// ════════════════════════════════════════════════════════════════════════════════

app.post('/admin/menus/:menuId/categories', requireAdmin, (req, res) => {
  const { name } = req.body;
  if (!name) return redirectFlash(res, `/admin/menus/${req.params.menuId}`, 'error', 'Nombre de categoría obligatorio.');

  db.prepare(`INSERT INTO categories (menu_id, name) VALUES (?, ?)`).run(req.params.menuId, name.trim());
  redirectFlash(res, `/admin/menus/${req.params.menuId}`, 'success', `Categoría "${name}" añadida`);
});

app.post('/admin/categories/:id/edit', requireAdmin, (req, res) => {
  const cat = db.prepare(`SELECT * FROM categories WHERE id=?`).get(req.params.id);
  if (!cat) return res.redirect('/admin');

  const { name } = req.body;
  if (!name) return redirectFlash(res, `/admin/menus/${cat.menu_id}`, 'error', 'Nombre obligatorio.');

  db.prepare(`UPDATE categories SET name=? WHERE id=?`).run(name.trim(), req.params.id);
  redirectFlash(res, `/admin/menus/${cat.menu_id}`, 'success', 'Categoría actualizada');
});

app.post('/admin/categories/:id/delete', requireAdmin, (req, res) => {
  const cat = db.prepare(`SELECT * FROM categories WHERE id=?`).get(req.params.id);
  if (!cat) return res.redirect('/admin');

  deleteCategoryImages(req.params.id);
  db.prepare(`DELETE FROM categories WHERE id=?`).run(req.params.id);

  redirectFlash(res, `/admin/menus/${cat.menu_id}`, 'success', 'Categoría eliminada');
});

// ════════════════════════════════════════════════════════════════════════════════
// ADMIN: DISHES — CRUD
// ════════════════════════════════════════════════════════════════════════════════

app.post('/admin/categories/:catId/dishes', requireAdmin, upload.single('image'), (req, res) => {
  const cat = db.prepare(`SELECT * FROM categories WHERE id=?`).get(req.params.catId);
  if (!cat) return res.redirect('/admin');

  const { name, description, price, allergens } = req.body;
  if (!name) return redirectFlash(res, `/admin/menus/${cat.menu_id}`, 'error', 'Nombre del plato obligatorio.');

  const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;

  db.prepare(
    `INSERT INTO dishes (category_id, name, description, price, image_url, allergens) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(cat.id, name.trim(), trim(description), numOrNull(price), imageUrl, trim(allergens));

  redirectFlash(res, `/admin/menus/${cat.menu_id}`, 'success', `Plato "${name}" añadido`);
});

app.post('/admin/dishes/:id/edit', requireAdmin, upload.single('image'), (req, res) => {
  const dish = db.prepare(
    `SELECT d.*, c.menu_id FROM dishes d JOIN categories c ON c.id=d.category_id WHERE d.id=?`
  ).get(req.params.id);
  if (!dish) return res.redirect('/admin');

  const { name, description, price, allergens } = req.body;
  if (!name) return redirectFlash(res, `/admin/menus/${dish.menu_id}`, 'error', 'Nombre del plato obligatorio.');

  let imageUrl = dish.image_url;
  if (req.file) {
    deleteFile(dish.image_url);
    imageUrl = `/uploads/${req.file.filename}`;
  }

  db.prepare(
    `UPDATE dishes SET name=?, description=?, price=?, image_url=?, allergens=? WHERE id=?`
  ).run(name.trim(), trim(description), numOrNull(price), imageUrl, trim(allergens), req.params.id);

  redirectFlash(res, `/admin/menus/${dish.menu_id}`, 'success', 'Plato actualizado');
});

app.post('/admin/dishes/:id/delete', requireAdmin, (req, res) => {
  const dish = db.prepare(
    `SELECT d.*, c.menu_id FROM dishes d JOIN categories c ON c.id=d.category_id WHERE d.id=?`
  ).get(req.params.id);
  if (!dish) return res.redirect('/admin');

  deleteFile(dish.image_url);
  db.prepare(`DELETE FROM dishes WHERE id=?`).run(req.params.id);

  redirectFlash(res, `/admin/menus/${dish.menu_id}`, 'success', 'Plato eliminado');
});

// ════════════════════════════════════════════════════════════════════════════════
// HTML EXPORT
// ════════════════════════════════════════════════════════════════════════════════

app.get('/admin/menus/:id/export', requireAdmin, (req, res) => {
  const menu = db.prepare(`SELECT * FROM menus WHERE id=?`).get(req.params.id);
  if (!menu) return res.redirect('/admin');

  const categories = db.prepare(
    `SELECT * FROM categories WHERE menu_id=? ORDER BY sort_order, id`
  ).all(req.params.id);

  const dishesByCategory = loadDishesByCategory(categories);
  const html             = buildExportHTML(menu, categories, dishesByCategory);
  const filename         = `carta-${menu.id}.html`;

  fs.writeFileSync(path.join(EXPORTS_DIR, filename), html, 'utf8');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(html);
});

// ════════════════════════════════════════════════════════════════════════════════
// PUBLIC MENU VIEW
// ════════════════════════════════════════════════════════════════════════════════

app.get('/menu/:id', (req, res) => {
  const menu = db.prepare(`SELECT * FROM menus WHERE id=?`).get(req.params.id);
  if (!menu) return res.status(404).send('Carta no encontrada.');

  const categories = db.prepare(
    `SELECT * FROM categories WHERE menu_id=? ORDER BY sort_order, id`
  ).all(req.params.id);

  const dishesByCategory = loadDishesByCategory(categories);

  res.render('menu', { menu, categories, dishesByCategory });
});

// ─── Root redirect ────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/admin'));

// ─── Multer error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).send('Imagen demasiado grande. Máximo 5 MB.');
  next(err);
});

app.listen(PORT, () => console.log(`Carta Interactiva → http://localhost:${PORT}`));

// ════════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ════════════════════════════════════════════════════════════════════════════════

function trim(val) { return (val || '').trim() || null; }
function numOrNull(val) { const n = parseFloat(val); return isNaN(n) ? null : n; }

function deleteFile(imageUrl) {
  if (!imageUrl) return;
  try {
    const f = path.join(UPLOADS_DIR, path.basename(imageUrl));
    if (fs.existsSync(f)) fs.unlinkSync(f);
  } catch {}
}

function deleteCategoryImages(catId) {
  db.prepare(`SELECT image_url FROM dishes WHERE category_id=? AND image_url IS NOT NULL`)
    .all(catId)
    .forEach(d => deleteFile(d.image_url));
}

function deleteMenuImages(menuId) {
  db.prepare(`SELECT id FROM categories WHERE menu_id=?`).all(menuId)
    .forEach(c => deleteCategoryImages(c.id));
}

function loadDishesByCategory(categories) {
  const map = {};
  if (!categories.length) return map;
  categories.forEach(c => { map[c.id] = []; });
  const ids    = categories.map(c => c.id);
  const dishes = db.prepare(
    `SELECT * FROM dishes WHERE category_id IN (${ids.map(() => '?').join(',')}) ORDER BY category_id, sort_order, id`
  ).all(...ids);
  dishes.forEach(d => { if (map[d.category_id]) map[d.category_id].push(d); });
  return map;
}

// ─── HTML export builder ──────────────────────────────────────────────────────

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function imgToBase64(imageUrl) {
  if (!imageUrl) return null;
  const f = path.join(UPLOADS_DIR, path.basename(imageUrl));
  if (!fs.existsSync(f)) return null;
  const ext = path.extname(f).slice(1).toLowerCase().replace('jpg', 'jpeg');
  return `data:image/${ext};base64,${fs.readFileSync(f).toString('base64')}`;
}

function buildExportHTML(menu, categories, dishesByCategory) {
  const logo = menu.logo_url
    ? `<img src="${esc(menu.logo_url)}" alt="${esc(menu.restaurant_name || menu.name)}" class="logo">`
    : '';

  const catsHtml = categories.map(cat => {
    const dishesHtml = (dishesByCategory[cat.id] || []).map(dish => {
      const src   = imgToBase64(dish.image_url);
      const img   = src ? `<img src="${src}" alt="${esc(dish.name)}" class="dimg">` : '';
      const price = dish.price != null ? `<span class="price">${Number(dish.price).toFixed(2)} €</span>` : '';
      const desc  = dish.description ? `<p class="desc">${esc(dish.description)}</p>` : '';
      const alg   = dish.allergens   ? `<p class="alg"><b>Alérgenos:</b> ${esc(dish.allergens)}</p>` : '';
      return `<div class="dish">${img}<div class="di"><div class="dh"><span class="dn">${esc(dish.name)}</span>${price}</div>${desc}${alg}</div></div>`;
    }).join('');

    return `
    <div class="cat">
      <button class="cth" onclick="tgl(this)">
        <span>${esc(cat.name)}</span>
        <svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="ctb">${dishesHtml || '<p class="empty">Sin platos</p>'}</div>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(menu.name)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,Arial,sans-serif;background:#f8f8f8;color:#333}
header{background:linear-gradient(135deg,#652d90,#2ea3f2);color:#fff;padding:28px 16px;text-align:center}
.logo{width:72px;height:72px;object-fit:contain;border-radius:10px;background:#fff;padding:8px;margin:0 auto 12px;display:block}
.rest{font-size:12px;opacity:.8;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px}
h1{font-size:1.9rem;font-weight:800;line-height:1.1;margin-bottom:6px}
.sub{font-size:13px;opacity:.8;max-width:480px;margin:0 auto}
main{max-width:680px;margin:0 auto;padding:16px 14px 48px}
.cat{background:#fff;border-radius:10px;margin-bottom:14px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.07)}
.cth{width:100%;display:flex;align-items:center;justify-content:space-between;padding:16px 18px;background:none;border:none;cursor:pointer;font-size:1rem;font-weight:700;color:#333;text-align:left;gap:8px}
.cth:hover{background:#fafafa}
.cth svg{width:18px;height:18px;stroke:#652d90;fill:none;stroke-width:2.5;flex-shrink:0;transition:transform .2s}
.cth.closed svg{transform:rotate(-90deg)}
.ctb{border-top:1px solid #eee;padding:14px;display:flex;flex-direction:column;gap:10px}
.ctb.hidden{display:none}
.dish{display:flex;gap:10px;background:#fafafa;border-radius:8px;border:1px solid #eee;overflow:hidden}
.dimg{width:85px;height:85px;object-fit:cover;flex-shrink:0}
.di{padding:10px;flex:1;min-width:0}
.dh{display:flex;justify-content:space-between;align-items:flex-start;gap:6px;margin-bottom:4px}
.dn{font-size:14px;font-weight:700}
.price{font-size:14px;font-weight:800;color:#652d90;white-space:nowrap;flex-shrink:0}
.desc{font-size:12px;color:#666;line-height:1.5;margin-bottom:3px}
.alg{font-size:11px;color:#888}
.alg b{color:#e65100}
.empty{color:#bbb;font-size:12px;text-align:center;padding:6px}
@media(max-width:440px){h1{font-size:1.5rem}.dimg{width:70px;height:70px}}
</style>
</head>
<body>
<header>
  ${logo}
  ${menu.restaurant_name ? `<p class="rest">${esc(menu.restaurant_name)}</p>` : ''}
  <h1>${esc(menu.name)}</h1>
  ${menu.description ? `<p class="sub">${esc(menu.description)}</p>` : ''}
</header>
<main>
  ${catsHtml || '<p style="text-align:center;color:#bbb;padding:40px 16px">Esta carta no tiene categorías.</p>'}
</main>
<script>
function tgl(btn){
  const b=btn.nextElementSibling;
  const open=!b.classList.contains('hidden');
  btn.classList.toggle('closed',open);
  b.classList.toggle('hidden',open);
}
</script>
</body>
</html>`;
}
