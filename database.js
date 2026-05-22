require('dotenv').config();
const Database = require('better-sqlite3');
const path     = require('path');

const dbPath = process.env.DATABASE_PATH || './carta.db';
const db     = new Database(path.resolve(dbPath));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS menus (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,
    restaurant_name TEXT,
    description     TEXT,
    logo_url        TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    menu_id    INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_categories_menu ON categories(menu_id);

  CREATE TABLE IF NOT EXISTS dishes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    description TEXT,
    price       REAL,
    image_url   TEXT,
    allergens   TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_dishes_category ON dishes(category_id);
`);

module.exports = db;
