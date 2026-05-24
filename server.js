import { createServer } from "node:http";
import { existsSync, promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appDataDir = process.env.APP_DATA_DIR ? path.resolve(__dirname, process.env.APP_DATA_DIR) : path.join(__dirname, "data");
const dataDir = appDataDir;
const dbPath = path.join(dataDir, "db.json");
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 5175);
const MONEY_CHANGE_LIMIT = 1_000_000_000_000;
const ECONOMY_VALUE_LIMIT = MONEY_CHANGE_LIMIT;
let lastMoneyLogCreatedMs = 0;

function nextMoneyLogCreatedMs() {
  const now = Date.now();
  lastMoneyLogCreatedMs = Math.max(now, lastMoneyLogCreatedMs + 1);
  return lastMoneyLogCreatedMs;
}

loadEnvFile();
const storageMode = String(process.env.STORAGE_MODE || process.env.TT_STORAGE_MODE || "mysql").toLowerCase() === "file" ? "file" : "mysql";

const deepseekConfig = {
  apiKey: process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_KEY || "",
  baseUrl: (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, ""),
  model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash"
};
const defaultAiConfig = {
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash"
};

const mysqlConfig = {
  host: process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "",
  database: process.env.MYSQL_DATABASE || "time_travel_app",
  waitForConnections: true,
  connectionLimit: 10,
  charset: "utf8mb4"
};

const mysql = storageMode === "mysql" ? (await import("mysql2/promise")).default : null;
const pool = storageMode === "mysql" ? mysql.createPool(mysqlConfig) : null;

if (deepseekConfig.apiKey.includes("请在这里") || deepseekConfig.apiKey.includes("your-deepseek")) {
  deepseekConfig.apiKey = "";
}

const defaultUser = {
  id: "demo-user",
  username: "traveler",
  password: "demo123",
  role: "user",
  currentYear: 755,
  currentMonth: 1,
  currentDay: 1,
  identity: "唐朝长安城普通庶民",
  money: 500,
  debt: 0,
  moneyUnit: "文",
  roleProfile: {},
  dailyExpense: 0,
  jobIncome: 0,
  businessIncome: 0,
  noMoneyDays: 0,
  survivalStatus: "alive",
  wealth: 50,
  health: 80,
  prestige: 10,
  knowledge: 20,
  relationship: 30,
  aiConfig: {
    apiKey: "",
    baseUrl: defaultAiConfig.baseUrl,
    model: defaultAiConfig.model
  },
  journeyStarted: false,
  currentJourneyId: "",
  status: "active",
  createdAt: new Date().toISOString(),
  lastActive: new Date().toISOString()
};

function pickAttributes(user) {
  return {
    money: user.money,
    debt: user.debt || 0,
    moneyUnit: user.moneyUnit,
    wealth: user.wealth,
    health: user.health,
    prestige: user.prestige,
    knowledge: user.knowledge,
    relationship: user.relationship,
    dailyExpense: user.dailyExpense || 0,
    jobIncome: user.jobIncome || 0,
    businessIncome: user.businessIncome || 0,
    noMoneyDays: user.noMoneyDays || 0,
    survivalStatus: user.survivalStatus || "alive",
    currentDay: user.currentDay || 1,
    roleProfile: user.roleProfile || {}
  };
}

const attributeDefinitions = {
  wealth: "财富：可支配资源、谋生余地、资产与债务压力，不等同于现金；现金必须看 money。",
  health: "健康：体力、疾病、伤势、饥饿和长期生存能力。",
  prestige: "声望：在当地社会、官府、行会或熟人圈里的名誉与可信度。",
  knowledge: "学识：识字、技艺、经验、历史常识和解决问题的能力。",
  relationship: "人际：亲友、同乡、雇主、同伴、靠山与社会互助网络。",
  debt: "负债：借款、欠账、赊欠和利息压力。借钱必须增加 debt，不能只增加现金。"
};

function userAttributeState(user) {
  return {
    money: Number(user.money || 0),
    debt: Number(user.debt || 0),
    net_worth: Number(user.money || 0) - Number(user.debt || 0),
    money_unit: user.moneyUnit || "文",
    wealth: Number(user.wealth || 0),
    health: Number(user.health || 0),
    prestige: Number(user.prestige || 0),
    knowledge: Number(user.knowledge || 0),
    relationship: Number(user.relationship || 0),
    daily_expense: Number(user.dailyExpense || 0),
    job_income: Number(user.jobIncome || 0),
    business_income: Number(user.businessIncome || 0),
    no_money_days: Number(user.noMoneyDays || 0),
    survival_status: user.survivalStatus || "alive",
    current_day: Number(user.currentDay || 1),
    role_profile: user.roleProfile || {}
  };
}

function initialDb() {
  const demoUser = {
    ...defaultUser,
    password: undefined,
    passwordHash: hashPassword("demo123"),
    currentJourneyId: "demo-journey"
  };
  return {
    users: [demoUser],
    journeys: [
      {
        id: "demo-journey",
        userId: "demo-user",
        title: "待开启的第一段旅程",
        summary: "选择年月并填写角色信息后，这里会保存这一段人生的回忆。",
        startYear: demoUser.currentYear,
        startMonth: demoUser.currentMonth,
        startDay: demoUser.currentDay,
        currentYear: demoUser.currentYear,
        currentMonth: demoUser.currentMonth,
        currentDay: demoUser.currentDay,
        status: "active",
        snapshot: journeySnapshotFromUser(demoUser),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ],
    chatHistory: [
      {
        id: crypto.randomUUID(),
        userId: "demo-user",
        journeyId: "demo-journey",
        role: "assistant",
        content: "命运之书已翻开。请选择目标年月，开始一段由模型生成并受真实历史约束的第二人生。",
        timeLabel: timelineLabel(demoUser),
        attributeSnapshot: pickAttributes(demoUser),
        createdAt: new Date().toISOString()
      }
    ],
    tasks: [],
    attributeLogs: [],
    moneyLogs: [],
    characters: [],
    sessions: [],
    admins: [{ id: "admin", username: "admin", password: "admin123" }],
    novels: []
  };
}

async function ensureDb() {
  await pool.query(`CREATE TABLE IF NOT EXISTS tt_users (
    id VARCHAR(64) PRIMARY KEY,
    username VARCHAR(80) NOT NULL UNIQUE,
    password_hash VARCHAR(128) NULL,
    password_legacy VARCHAR(255) NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'user',
    current_year INT NOT NULL,
    current_month INT NOT NULL,
    current_day INT NOT NULL DEFAULT 1,
    identity_text VARCHAR(255) NOT NULL,
    journey_started TINYINT(1) NOT NULL DEFAULT 0,
    current_journey_id VARCHAR(64) NULL,
    money BIGINT NOT NULL DEFAULT 0,
    debt BIGINT NOT NULL DEFAULT 0,
    money_unit VARCHAR(32) NOT NULL DEFAULT '文',
    role_profile JSON NULL,
    daily_expense BIGINT NOT NULL DEFAULT 0,
    job_income BIGINT NOT NULL DEFAULT 0,
    business_income BIGINT NOT NULL DEFAULT 0,
    no_money_days INT NOT NULL DEFAULT 0,
    survival_status VARCHAR(30) NOT NULL DEFAULT 'alive',
    wealth INT NOT NULL DEFAULT 50,
    health INT NOT NULL DEFAULT 80,
    prestige INT NOT NULL DEFAULT 10,
    knowledge INT NOT NULL DEFAULT 20,
    relationship_value INT NOT NULL DEFAULT 30,
    ai_config JSON NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL,
    last_active DATETIME NOT NULL
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await ensureColumn("tt_users", "role", "VARCHAR(20) NOT NULL DEFAULT 'user' AFTER password_legacy");
  await ensureColumn("tt_users", "current_day", "INT NOT NULL DEFAULT 1 AFTER current_month");
  await ensureColumn("tt_users", "journey_started", "TINYINT(1) NOT NULL DEFAULT 0 AFTER identity_text");
  await ensureColumn("tt_users", "current_journey_id", "VARCHAR(64) NULL AFTER journey_started");
  await ensureColumn("tt_users", "debt", "BIGINT NOT NULL DEFAULT 0 AFTER money");
  await ensureColumn("tt_users", "role_profile", "JSON NULL AFTER money_unit");
  await ensureColumn("tt_users", "daily_expense", "BIGINT NOT NULL DEFAULT 0 AFTER role_profile");
  await ensureColumn("tt_users", "job_income", "BIGINT NOT NULL DEFAULT 0 AFTER daily_expense");
  await ensureColumn("tt_users", "business_income", "BIGINT NOT NULL DEFAULT 0 AFTER job_income");
  await ensureColumn("tt_users", "no_money_days", "INT NOT NULL DEFAULT 0 AFTER business_income");
  await ensureColumn("tt_users", "survival_status", "VARCHAR(30) NOT NULL DEFAULT 'alive' AFTER no_money_days");
  await ensureColumn("tt_users", "ai_config", "JSON NULL AFTER relationship_value");

  await pool.query(`CREATE TABLE IF NOT EXISTS tt_journeys (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    title VARCHAR(160) NOT NULL,
    summary MEDIUMTEXT NULL,
    start_year INT NOT NULL,
    start_month INT NOT NULL,
    start_day INT NOT NULL DEFAULT 1,
    current_year INT NOT NULL,
    current_month INT NOT NULL,
    current_day INT NOT NULL DEFAULT 1,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    snapshot_json JSON NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    INDEX idx_journeys_user_updated (user_id, updated_at)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await ensureColumn("tt_journeys", "start_day", "INT NOT NULL DEFAULT 1 AFTER start_month");
  await ensureColumn("tt_journeys", "current_day", "INT NOT NULL DEFAULT 1 AFTER current_month");

  await pool.query(`CREATE TABLE IF NOT EXISTS tt_chat_history (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    journey_id VARCHAR(64) NULL,
    role VARCHAR(30) NOT NULL,
    content MEDIUMTEXT NOT NULL,
    task_id VARCHAR(64) NULL,
    time_label VARCHAR(80) NULL,
    attribute_snapshot JSON NULL,
    created_at DATETIME NOT NULL,
    INDEX idx_chat_user_created (user_id, created_at)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await ensureColumn("tt_chat_history", "journey_id", "VARCHAR(64) NULL AFTER user_id");
  await ensureIndex("tt_chat_history", "idx_chat_user_journey_created", "ADD INDEX idx_chat_user_journey_created (user_id, journey_id, created_at)");

  await pool.query(`CREATE TABLE IF NOT EXISTS tt_tasks (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    journey_id VARCHAR(64) NULL,
    title VARCHAR(255) NOT NULL,
    description MEDIUMTEXT NOT NULL,
    options JSON NOT NULL,
    status VARCHAR(30) NOT NULL,
    year INT NOT NULL,
    month INT NOT NULL,
    task_day INT NOT NULL DEFAULT 1,
    historical_context MEDIUMTEXT NULL,
    created_at DATETIME NOT NULL,
    INDEX idx_tasks_user_status (user_id, status)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await ensureColumn("tt_tasks", "journey_id", "VARCHAR(64) NULL AFTER user_id");
  await ensureColumn("tt_tasks", "task_day", "INT NOT NULL DEFAULT 1 AFTER month");
  await ensureIndex("tt_tasks", "idx_tasks_user_journey_status", "ADD INDEX idx_tasks_user_journey_status (user_id, journey_id, status)");

  await pool.query(`CREATE TABLE IF NOT EXISTS tt_attribute_logs (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    journey_id VARCHAR(64) NULL,
    change_json JSON NOT NULL,
    reason VARCHAR(255) NOT NULL,
    time_label VARCHAR(80) NULL,
    created_at DATETIME NOT NULL,
    INDEX idx_attr_user_created (user_id, created_at)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await ensureColumn("tt_attribute_logs", "journey_id", "VARCHAR(64) NULL AFTER user_id");
  await ensureIndex("tt_attribute_logs", "idx_attr_user_journey_created", "ADD INDEX idx_attr_user_journey_created (user_id, journey_id, created_at)");

  await pool.query(`CREATE TABLE IF NOT EXISTS tt_money_logs (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    journey_id VARCHAR(64) NULL,
    change_amount BIGINT NOT NULL,
    balance BIGINT NOT NULL,
    debt_change BIGINT NOT NULL DEFAULT 0,
    debt_balance BIGINT NOT NULL DEFAULT 0,
    income_amount BIGINT NOT NULL DEFAULT 0,
    expense_amount BIGINT NOT NULL DEFAULT 0,
    elapsed_days INT NOT NULL DEFAULT 0,
    is_initial TINYINT(1) NOT NULL DEFAULT 0,
    created_ms BIGINT NOT NULL DEFAULT 0,
    unit VARCHAR(32) NOT NULL,
    reason VARCHAR(255) NOT NULL,
    time_label VARCHAR(80) NULL,
    created_at DATETIME NOT NULL,
    INDEX idx_money_user_created (user_id, created_at)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await ensureColumn("tt_money_logs", "journey_id", "VARCHAR(64) NULL AFTER user_id");
  await ensureIndex("tt_money_logs", "idx_money_user_journey_created", "ADD INDEX idx_money_user_journey_created (user_id, journey_id, created_ms, created_at)");
  await ensureColumn("tt_money_logs", "debt_change", "BIGINT NOT NULL DEFAULT 0 AFTER balance");
  await ensureColumn("tt_money_logs", "debt_balance", "BIGINT NOT NULL DEFAULT 0 AFTER debt_change");
  await ensureColumn("tt_money_logs", "income_amount", "BIGINT NOT NULL DEFAULT 0 AFTER debt_balance");
  await ensureColumn("tt_money_logs", "expense_amount", "BIGINT NOT NULL DEFAULT 0 AFTER income_amount");
  await ensureColumn("tt_money_logs", "elapsed_days", "INT NOT NULL DEFAULT 0 AFTER expense_amount");
  await ensureColumn("tt_money_logs", "is_initial", "TINYINT(1) NOT NULL DEFAULT 0 AFTER elapsed_days");
  await ensureColumn("tt_money_logs", "created_ms", "BIGINT NOT NULL DEFAULT 0 AFTER is_initial");
  await pool.query("UPDATE tt_money_logs SET created_ms = UNIX_TIMESTAMP(created_at) * 1000 WHERE created_ms = 0");

  await pool.query(`CREATE TABLE IF NOT EXISTS tt_characters (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    journey_id VARCHAR(64) NULL,
    name VARCHAR(120) NOT NULL,
    identity_text VARCHAR(255) NULL,
    relationship_text VARCHAR(120) NULL,
    attitude VARCHAR(120) NULL,
    intimacy INT NOT NULL DEFAULT 0,
    notes MEDIUMTEXT NULL,
    last_interaction MEDIUMTEXT NULL,
    first_met_time VARCHAR(80) NULL,
    last_seen_time VARCHAR(80) NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY uniq_character_user_journey_name (user_id, journey_id, name),
    INDEX idx_characters_user_updated (user_id, updated_at)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await ensureColumn("tt_characters", "journey_id", "VARCHAR(64) NULL AFTER user_id");
  await dropIndexIfExists("tt_characters", "uniq_character_user_name");
  await ensureIndex("tt_characters", "uniq_character_user_journey_name", "ADD UNIQUE KEY uniq_character_user_journey_name (user_id, journey_id, name)");
  await ensureIndex("tt_characters", "idx_characters_user_journey_updated", "ADD INDEX idx_characters_user_journey_updated (user_id, journey_id, updated_at)");

  await pool.query(`CREATE TABLE IF NOT EXISTS tt_sessions (
    token VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    created_at DATETIME NOT NULL,
    INDEX idx_sessions_user (user_id)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

  await pool.query(`CREATE TABLE IF NOT EXISTS tt_novels (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    journey_id VARCHAR(64) NULL,
    title VARCHAR(255) NOT NULL,
    payload_json JSON NOT NULL,
    txt_content MEDIUMTEXT NOT NULL,
    created_at DATETIME NOT NULL,
    INDEX idx_novels_user_created (user_id, created_at)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await ensureColumn("tt_novels", "journey_id", "VARCHAR(64) NULL AFTER user_id");
  await ensureIndex("tt_novels", "idx_novels_user_journey_created", "ADD INDEX idx_novels_user_journey_created (user_id, journey_id, created_at)");

  const [rows] = await pool.query("SELECT COUNT(*) AS count FROM tt_users");
  if (Number(rows[0].count) === 0) {
    await seedInitialDb(initialDb());
  }
  await ensureAdminUser();
  await ensureJourneyMigration();
}

async function seedInitialDb(db) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const user of db.users || []) await upsertUser(conn, user);
    for (const journey of db.journeys || []) await upsertJourney(conn, journey);
    for (const message of db.chatHistory || []) await upsertMessage(conn, message);
    for (const task of db.tasks || []) await upsertTask(conn, task);
    for (const log of db.attributeLogs || []) await upsertAttributeLog(conn, log);
    for (const log of db.moneyLogs || []) await upsertMoneyLog(conn, log);
    for (const novel of db.novels || []) await upsertNovel(conn, novel);
    for (const session of db.sessions || []) await upsertSession(conn, session);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function ensureColumn(table, column, definition) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (Number(rows[0].count) === 0) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function ensureIndex(table, indexName, alterClause) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, indexName]
  );
  if (Number(rows[0].count) === 0) {
    await pool.query(`ALTER TABLE ${table} ${alterClause}`);
  }
}

async function dropIndexIfExists(table, indexName) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, indexName]
  );
  if (Number(rows[0].count) > 0) {
    await pool.query(`ALTER TABLE ${table} DROP INDEX ${indexName}`);
  }
}

async function ensureJourneyMigration() {
  const [users] = await pool.query("SELECT * FROM tt_users");
  for (const row of users) {
    let journeyId = row.current_journey_id;
    if (!journeyId) {
      const [existing] = await pool.query("SELECT id FROM tt_journeys WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1", [row.id]);
      journeyId = existing[0]?.id || crypto.randomUUID();
    }
    const [journeys] = await pool.query("SELECT id FROM tt_journeys WHERE id = ? LIMIT 1", [journeyId]);
    if (!journeys.length) {
      const user = rowToUser({ ...row, current_journey_id: journeyId });
      const now = new Date();
      const title = makeJourneyTitle(user, user.currentYear, user.currentMonth || 1, user.currentDay || 1);
      await pool.query(
        `INSERT INTO tt_journeys (id, user_id, title, summary, start_year, start_month, start_day, current_year, current_month, current_day, status, snapshot_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?)`,
        [
          journeyId,
          user.id,
          title,
          "系统自动保存的旧旅程。",
          user.currentYear,
          user.currentMonth || 1,
          user.currentDay || 1,
          user.currentYear,
          user.currentMonth || 1,
          user.currentDay || 1,
          "active",
          JSON.stringify(journeySnapshotFromUser(user)),
          row.created_at || now,
          row.last_active || now
        ]
      );
    }
    await pool.query("UPDATE tt_users SET current_journey_id = ? WHERE id = ?", [journeyId, row.id]);
    for (const table of ["tt_chat_history", "tt_tasks", "tt_attribute_logs", "tt_money_logs", "tt_characters", "tt_novels"]) {
      await pool.query(`UPDATE ${table} SET journey_id = ? WHERE user_id = ? AND journey_id IS NULL`, [journeyId, row.id]);
    }
  }
}

async function readDb() {
  if (storageMode === "file") {
    try {
      await fs.mkdir(dataDir, { recursive: true });
      const raw = await fs.readFile(dbPath, "utf8");
      const db = { ...initialDb(), ...JSON.parse(raw) };
      normalizeFileDb(db);
      return db;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const db = initialDb();
      normalizeFileDb(db);
      await writeDb(db);
      return db;
    }
  }
  await ensureDb();
  const [users] = await pool.query("SELECT * FROM tt_users");
  const [journeys] = await pool.query("SELECT * FROM tt_journeys ORDER BY updated_at ASC");
  const [messages] = await pool.query("SELECT * FROM tt_chat_history ORDER BY created_at ASC");
  const [tasks] = await pool.query("SELECT * FROM tt_tasks ORDER BY created_at ASC");
  const [attributeLogs] = await pool.query("SELECT * FROM tt_attribute_logs ORDER BY created_at ASC");
  const [moneyLogs] = await pool.query("SELECT * FROM tt_money_logs ORDER BY created_ms ASC, created_at ASC, id ASC");
  const [characters] = await pool.query("SELECT * FROM tt_characters ORDER BY updated_at ASC");
  const [sessions] = await pool.query("SELECT * FROM tt_sessions ORDER BY created_at ASC");
  const [novels] = await pool.query("SELECT * FROM tt_novels ORDER BY created_at ASC");
  const db = {
    users: users.map(rowToUser),
    journeys: journeys.map(rowToJourney),
    chatHistory: messages.map(rowToMessage),
    tasks: tasks.map(rowToTask),
    attributeLogs: attributeLogs.map(rowToAttributeLog),
    moneyLogs: moneyLogs.map(rowToMoneyLog),
    characters: characters.map(rowToCharacter),
    novels: novels.map(rowToNovel),
    sessions: sessions.map((row) => ({
      token: row.token,
      userId: row.user_id,
      createdAt: toIso(row.created_at)
    })),
    admins: [{ id: "admin", username: "admin", password: "admin123" }]
  };
  for (const user of db.users) currentJourneyId(db, user);
  return db;
}

async function writeDb(db) {
  if (storageMode === "file") {
    normalizeFileDb(db);
    syncJourneysWithUsers(db);
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(dbPath, `${JSON.stringify(db, null, 2)}\n`, "utf8");
    return;
  }
  await ensureDb();
  syncJourneysWithUsers(db);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM tt_sessions");
    await conn.query("DELETE FROM tt_novels");
    await conn.query("DELETE FROM tt_money_logs");
    await conn.query("DELETE FROM tt_attribute_logs");
    await conn.query("DELETE FROM tt_characters");
    await conn.query("DELETE FROM tt_tasks");
    await conn.query("DELETE FROM tt_chat_history");
    await conn.query("DELETE FROM tt_journeys");
    await conn.query("DELETE FROM tt_users");

    for (const user of db.users || []) await upsertUser(conn, user);
    for (const journey of db.journeys || []) await upsertJourney(conn, journey);
    for (const message of db.chatHistory || []) await upsertMessage(conn, message);
    for (const task of db.tasks || []) await upsertTask(conn, task);
    for (const log of db.attributeLogs || []) await upsertAttributeLog(conn, log);
    for (const log of db.moneyLogs || []) await upsertMoneyLog(conn, log);
    for (const character of db.characters || []) await upsertCharacter(conn, character);
    for (const novel of db.novels || []) await upsertNovel(conn, novel);
    for (const session of db.sessions || []) await upsertSession(conn, session);

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

function toMysqlDate(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function toIso(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString();
}

function parseJsonField(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeFileDb(db) {
  const base = initialDb();
  for (const key of ["users", "journeys", "chatHistory", "tasks", "attributeLogs", "moneyLogs", "characters", "sessions", "admins", "novels"]) {
    if (!Array.isArray(db[key])) db[key] = Array.isArray(base[key]) ? base[key] : [];
  }
  for (const user of db.users) normalizeFileUser(user);
  ensureFileAdminUser(db);
  db.journeys = db.journeys.map(normalizeFileJourney);
  db.tasks = db.tasks.map((task) => enrichTaskOptions({ ...task, day: task.day || task.taskDay || task.task_day || 1 }));
  db.moneyLogs = db.moneyLogs.map((log) => ({
    ...log,
    change: Number(log.change || 0),
    balance: Number(log.balance || 0),
    debtChange: Number(log.debtChange || 0),
    debtBalance: Number(log.debtBalance || 0),
    income: Number(log.income || 0),
    expense: Number(log.expense || 0),
    elapsedDays: Number(log.elapsedDays || 0),
    createdMs: Number(log.createdMs || new Date(log.createdAt || Date.now()).getTime() || 0)
  }));
  for (const user of db.users) currentJourneyId(db, user);
}

function normalizeFileUser(user) {
  Object.assign(user, {
    id: user.id || crypto.randomUUID(),
    username: String(user.username || "traveler"),
    role: user.role === "admin" ? "admin" : "user",
    currentYear: Number(user.currentYear || 755),
    currentMonth: Number(user.currentMonth || 1),
    currentDay: Number(user.currentDay || 1),
    identity: String(user.identity || "等待时空校准"),
    journeyStarted: Boolean(user.journeyStarted),
    currentJourneyId: user.currentJourneyId || "",
    money: Number(user.money || 0),
    debt: Number(user.debt || 0),
    moneyUnit: user.moneyUnit || "文",
    roleProfile: user.roleProfile && typeof user.roleProfile === "object" ? user.roleProfile : {},
    dailyExpense: Number(user.dailyExpense || 0),
    jobIncome: Number(user.jobIncome || 0),
    businessIncome: Number(user.businessIncome || 0),
    noMoneyDays: Number(user.noMoneyDays || 0),
    survivalStatus: user.survivalStatus || "alive",
    wealth: Number(user.wealth ?? 50),
    health: Number(user.health ?? 80),
    prestige: Number(user.prestige ?? 10),
    knowledge: Number(user.knowledge ?? 20),
    relationship: Number(user.relationship ?? 30),
    aiConfig: normalizeAiConfig(user.aiConfig || {}),
    status: user.status || "active",
    createdAt: user.createdAt || new Date().toISOString(),
    lastActive: user.lastActive || new Date().toISOString()
  });
  if (!user.passwordHash && user.password) user.passwordHash = hashPassword(user.password);
  return user;
}

function ensureFileAdminUser(db) {
  let admin = db.users.find((user) => user.username === "admin");
  if (!admin) {
    admin = {
      ...defaultUser,
      id: "admin-user",
      username: "admin",
      passwordHash: hashPassword("admin123"),
      password: undefined,
      role: "admin",
      identity: "系统管理员",
      money: 0,
      currentJourneyId: ""
    };
    db.users.push(admin);
  }
  admin.role = "admin";
  admin.status = "active";
  admin.passwordHash = admin.passwordHash || hashPassword("admin123");
  normalizeFileUser(admin);
}

function normalizeFileJourney(journey) {
  return {
    ...journey,
    id: journey.id || crypto.randomUUID(),
    userId: journey.userId || journey.user_id || "demo-user",
    title: journey.title || "未命名旅程",
    summary: journey.summary || "",
    startYear: Number(journey.startYear || journey.currentYear || 755),
    startMonth: Number(journey.startMonth || journey.currentMonth || 1),
    startDay: Number(journey.startDay || journey.currentDay || 1),
    currentYear: Number(journey.currentYear || journey.startYear || 755),
    currentMonth: Number(journey.currentMonth || journey.startMonth || 1),
    currentDay: Number(journey.currentDay || journey.startDay || 1),
    status: journey.status || "active",
    snapshot: journey.snapshot && typeof journey.snapshot === "object" ? journey.snapshot : {},
    createdAt: journey.createdAt || new Date().toISOString(),
    updatedAt: journey.updatedAt || new Date().toISOString()
  };
}

function normalizeAiConfig(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const apiKey = String(source.apiKey || source.api_key || "").trim();
  const baseUrl = String(source.baseUrl || source.base_url || defaultAiConfig.baseUrl).trim().replace(/\/$/, "") || defaultAiConfig.baseUrl;
  const model = String(source.model || defaultAiConfig.model).trim() || defaultAiConfig.model;
  return {
    apiKey,
    baseUrl,
    model
  };
}

function publicAiConfig(user) {
  const config = normalizeAiConfig(user?.aiConfig || {});
  const apiKey = config.apiKey;
  return {
    deepseekConfigured: Boolean(apiKey),
    model: config.model,
    baseUrl: config.baseUrl,
    apiKeyPreview: apiKey ? `${apiKey.slice(0, 3)}...${apiKey.slice(-4)}` : ""
  };
}

function requireAiConfig(user) {
  const config = normalizeAiConfig(user?.aiConfig || {});
  if (!config.apiKey) {
    const error = new Error("请先在当前账号里配置自己的 DeepSeek API Key。");
    error.statusCode = 400;
    throw error;
  }
  return config;
}

function journeySnapshotFromUser(user) {
  return {
    currentYear: user.currentYear,
    currentMonth: user.currentMonth || 1,
    currentDay: user.currentDay || 1,
    identity: user.identity,
    journeyStarted: Boolean(user.journeyStarted),
    money: Number(user.money || 0),
    debt: Number(user.debt || 0),
    moneyUnit: user.moneyUnit || "文",
    roleProfile: user.roleProfile || {},
    dailyExpense: Number(user.dailyExpense || 0),
    jobIncome: Number(user.jobIncome || 0),
    businessIncome: Number(user.businessIncome || 0),
    noMoneyDays: Number(user.noMoneyDays || 0),
    survivalStatus: user.survivalStatus || "alive",
    wealth: Number(user.wealth ?? 50),
    health: Number(user.health ?? 80),
    prestige: Number(user.prestige ?? 10),
    knowledge: Number(user.knowledge ?? 20),
    relationship: Number(user.relationship ?? 30),
    lastActive: user.lastActive || new Date().toISOString()
  };
}

function applyJourneySnapshot(user, snapshot = {}) {
  const safe = snapshot && typeof snapshot === "object" ? snapshot : {};
  Object.assign(user, {
    currentYear: Number(safe.currentYear ?? user.currentYear),
    currentMonth: Number(safe.currentMonth ?? user.currentMonth ?? 1),
    currentDay: Number(safe.currentDay ?? user.currentDay ?? 1),
    identity: String(safe.identity || user.identity || "等待时空校准"),
    journeyStarted: Boolean(safe.journeyStarted ?? user.journeyStarted),
    money: Number(safe.money ?? user.money ?? 0),
    debt: Number(safe.debt ?? user.debt ?? 0),
    moneyUnit: String(safe.moneyUnit || user.moneyUnit || "文"),
    roleProfile: safe.roleProfile && typeof safe.roleProfile === "object" ? safe.roleProfile : (user.roleProfile || {}),
    dailyExpense: Number(safe.dailyExpense ?? user.dailyExpense ?? 0),
    jobIncome: Number(safe.jobIncome ?? user.jobIncome ?? 0),
    businessIncome: Number(safe.businessIncome ?? user.businessIncome ?? 0),
    noMoneyDays: Number(safe.noMoneyDays ?? user.noMoneyDays ?? 0),
    survivalStatus: String(safe.survivalStatus || user.survivalStatus || "alive"),
    wealth: Number(safe.wealth ?? user.wealth ?? 50),
    health: Number(safe.health ?? user.health ?? 80),
    prestige: Number(safe.prestige ?? user.prestige ?? 10),
    knowledge: Number(safe.knowledge ?? user.knowledge ?? 20),
    relationship: Number(safe.relationship ?? user.relationship ?? 30),
    lastActive: safe.lastActive || new Date().toISOString()
  });
  return user;
}

function makeJourneyTitle(user, year = user.currentYear, month = user.currentMonth || 1, day = user.currentDay || 1) {
  const name = user.roleProfile?.name || user.username || "无名旅人";
  const identity = user.roleProfile?.identity || user.identity || "历史人生";
  return `${formatJourneyTime(year, month, day)} · ${name}的${String(identity).slice(0, 18)}`.slice(0, 120);
}

function formatJourneyTime(year, month = 1, day = 1) {
  return `${year < 0 ? `公元前${Math.abs(year)}` : year}年${month}月${day || 1}日`;
}

function getCurrentJourney(db, user) {
  if (!Array.isArray(db.journeys)) db.journeys = [];
  let journey = db.journeys.find((item) => item.id === user.currentJourneyId && item.userId === user.id);
  if (!journey) {
    journey = db.journeys
      .filter((item) => item.userId === user.id)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))[0];
  }
  if (!journey) {
    journey = createJourneyRecord(user, {
      title: makeJourneyTitle(user),
      summary: "系统自动创建的旅程。"
    });
    db.journeys.push(journey);
  }
  user.currentJourneyId = journey.id;
  return journey;
}

function currentJourneyId(db, user) {
  return getCurrentJourney(db, user).id;
}

function belongsToJourney(item, user, journeyId = user.currentJourneyId) {
  return item?.userId === user.id && (!journeyId || item.journeyId === journeyId);
}

function userJourneyItems(items, user, journeyId = user.currentJourneyId) {
  return (items || []).filter((item) => belongsToJourney(item, user, journeyId));
}

function createJourneyRecord(user, extra = {}) {
  const nowIso = new Date().toISOString();
  const startYear = Number(extra.startYear ?? user.currentYear);
  const startMonth = Number(extra.startMonth ?? user.currentMonth ?? 1);
  const startDay = Number(extra.startDay ?? user.currentDay ?? 1);
  return {
    id: extra.id || crypto.randomUUID(),
    userId: user.id,
    title: extra.title || makeJourneyTitle(user, startYear, startMonth, startDay),
    summary: extra.summary || "新的穿越历程已经开启。",
    startYear,
    startMonth,
    startDay,
    currentYear: Number(extra.currentYear ?? user.currentYear),
    currentMonth: Number(extra.currentMonth ?? user.currentMonth ?? 1),
    currentDay: Number(extra.currentDay ?? user.currentDay ?? 1),
    status: extra.status || "active",
    snapshot: extra.snapshot || journeySnapshotFromUser(user),
    createdAt: extra.createdAt || nowIso,
    updatedAt: extra.updatedAt || nowIso
  };
}

function syncJourneysWithUsers(db) {
  if (!Array.isArray(db.journeys)) db.journeys = [];
  for (const user of db.users || []) {
    const journey = getCurrentJourney(db, user);
    for (const items of [db.chatHistory, db.tasks, db.attributeLogs, db.moneyLogs, db.characters, db.novels]) {
      for (const item of items || []) {
        if (item.userId === user.id && !item.journeyId) item.journeyId = journey.id;
      }
    }
    journey.currentYear = user.currentYear;
    journey.currentMonth = user.currentMonth || 1;
    journey.currentDay = user.currentDay || 1;
    journey.snapshot = journeySnapshotFromUser(user);
    journey.updatedAt = user.lastActive || new Date().toISOString();
    if (!journey.title) journey.title = makeJourneyTitle(user, journey.startYear, journey.startMonth, journey.startDay || 1);
    if (!journey.summary) journey.summary = "这段旅程还在继续。";
  }
}

function summarizeJourney(db, user, journey) {
  const messages = userJourneyItems(db.chatHistory, user, journey.id);
  const firstUserMessage = messages.find((message) => message.role === "user");
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const moneyLogs = userJourneyItems(db.moneyLogs, user, journey.id);
  const characters = userJourneyItems(db.characters, user, journey.id);
  return {
    id: journey.id,
    title: journey.title || makeJourneyTitle(user, journey.startYear, journey.startMonth, journey.startDay || 1),
    summary: journey.summary || compactText(lastAssistant?.content || firstUserMessage?.content || "这段旅程还没有留下太多回忆。", 180),
    startYear: journey.startYear,
    startMonth: journey.startMonth,
    startDay: journey.startDay || 1,
    currentYear: journey.currentYear,
    currentMonth: journey.currentMonth,
    currentDay: journey.currentDay || 1,
    status: journey.status || "active",
    messageCount: messages.length,
    characterCount: characters.length,
    moneyLogCount: moneyLogs.length,
    isCurrent: journey.id === user.currentJourneyId,
    createdAt: journey.createdAt,
    updatedAt: journey.updatedAt
  };
}

function rowToUser(row) {
  return {
    id: row.id,
    username: row.username,
    password: row.password_legacy || undefined,
    passwordHash: row.password_hash || undefined,
    role: row.role || "user",
    currentYear: row.current_year,
    currentMonth: row.current_month,
    currentDay: row.current_day || 1,
    identity: row.identity_text,
    journeyStarted: Boolean(row.journey_started),
    currentJourneyId: row.current_journey_id || "",
    money: Number(row.money || 0),
    debt: Number(row.debt || 0),
    moneyUnit: row.money_unit || "文",
    roleProfile: parseJsonField(row.role_profile, {}),
    dailyExpense: Number(row.daily_expense || 0),
    jobIncome: Number(row.job_income || 0),
    businessIncome: Number(row.business_income || 0),
    noMoneyDays: Number(row.no_money_days || 0),
    survivalStatus: row.survival_status || "alive",
    wealth: row.wealth,
    health: row.health,
    prestige: row.prestige,
    knowledge: row.knowledge,
    relationship: row.relationship_value,
    aiConfig: normalizeAiConfig(parseJsonField(row.ai_config, {})),
    status: row.status,
    createdAt: toIso(row.created_at),
    lastActive: toIso(row.last_active)
  };
}

function rowToJourney(row) {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    summary: row.summary || "",
    startYear: row.start_year,
    startMonth: row.start_month,
    startDay: row.start_day || 1,
    currentYear: row.current_year,
    currentMonth: row.current_month,
    currentDay: row.current_day || 1,
    status: row.status || "active",
    snapshot: parseJsonField(row.snapshot_json, {}),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function rowToMessage(row) {
  return {
    id: row.id,
    userId: row.user_id,
    journeyId: row.journey_id || undefined,
    role: row.role,
    content: row.content,
    taskId: row.task_id || undefined,
    timeLabel: row.time_label || undefined,
    attributeSnapshot: parseJsonField(row.attribute_snapshot, {}),
    createdAt: toIso(row.created_at)
  };
}

function rowToTask(row) {
  const task = {
    id: row.id,
    userId: row.user_id,
    journeyId: row.journey_id || undefined,
    title: row.title,
    description: row.description,
    options: parseJsonField(row.options, []),
    status: row.status,
    year: row.year,
    month: row.month,
    day: row.task_day || row.day || 1,
    historicalContext: row.historical_context || "",
    createdAt: toIso(row.created_at)
  };
  return enrichTaskOptions(task);
}

function rowToAttributeLog(row) {
  return {
    id: row.id,
    userId: row.user_id,
    journeyId: row.journey_id || undefined,
    change: parseJsonField(row.change_json, {}),
    reason: row.reason,
    timeLabel: row.time_label || undefined,
    createdAt: toIso(row.created_at)
  };
}

function rowToMoneyLog(row) {
  return {
    id: row.id,
    userId: row.user_id,
    journeyId: row.journey_id || undefined,
    change: Number(row.change_amount || 0),
    balance: Number(row.balance || 0),
    debtChange: Number(row.debt_change || 0),
    debtBalance: Number(row.debt_balance || 0),
    income: Number(row.income_amount || 0),
    expense: Number(row.expense_amount || 0),
    elapsedDays: Number(row.elapsed_days || 0),
    isInitial: Boolean(row.is_initial),
    createdMs: Number(row.created_ms || new Date(row.created_at).getTime() || 0),
    unit: row.unit || "文",
    reason: row.reason,
    timeLabel: row.time_label || undefined,
    createdAt: toIso(row.created_at)
  };
}

function rowToCharacter(row) {
  return {
    id: row.id,
    userId: row.user_id,
    journeyId: row.journey_id || undefined,
    name: row.name,
    identity: row.identity_text || "",
    relationship: row.relationship_text || "",
    attitude: row.attitude || "",
    intimacy: Number(row.intimacy || 0),
    notes: row.notes || "",
    lastInteraction: row.last_interaction || "",
    firstMetTime: row.first_met_time || "",
    lastSeenTime: row.last_seen_time || "",
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function rowToNovel(row) {
  const payload = parseJsonField(row.payload_json, {});
  return {
    id: row.id,
    userId: row.user_id,
    journeyId: row.journey_id || undefined,
    title: row.title,
    payload,
    txtContent: row.txt_content || "",
    createdAt: toIso(row.created_at)
  };
}

async function upsertUser(conn, user) {
  await conn.query(
    `REPLACE INTO tt_users (id, username, password_hash, password_legacy, role, current_year, current_month, current_day, identity_text, journey_started, current_journey_id, money, debt, money_unit, role_profile, daily_expense, job_income, business_income, no_money_days, survival_status, wealth, health, prestige, knowledge, relationship_value, ai_config, status, created_at, last_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?)`,
    [
      user.id,
      user.username,
      user.passwordHash || null,
      user.password || null,
      user.role === "admin" ? "admin" : "user",
      user.currentYear,
      user.currentMonth || 1,
      user.currentDay || 1,
      user.identity,
      user.journeyStarted ? 1 : 0,
      user.currentJourneyId || null,
      Number(user.money || 0),
      Number(user.debt || 0),
      user.moneyUnit || "文",
      JSON.stringify(user.roleProfile || {}),
      Number(user.dailyExpense || 0),
      Number(user.jobIncome || 0),
      Number(user.businessIncome || 0),
      Number(user.noMoneyDays || 0),
      user.survivalStatus || "alive",
      user.wealth,
      user.health,
      user.prestige,
      user.knowledge,
      user.relationship,
      JSON.stringify(normalizeAiConfig(user.aiConfig || {})),
      user.status || "active",
      toMysqlDate(user.createdAt),
      toMysqlDate(user.lastActive)
    ]
  );
}

async function upsertJourney(conn, journey) {
  await conn.query(
    `REPLACE INTO tt_journeys (id, user_id, title, summary, start_year, start_month, start_day, current_year, current_month, current_day, status, snapshot_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?)`,
    [
      journey.id,
      journey.userId,
      journey.title || "未命名旅程",
      journey.summary || "",
      Number(journey.startYear || journey.currentYear || 755),
      Number(journey.startMonth || journey.currentMonth || 1),
      Number(journey.startDay || journey.currentDay || 1),
      Number(journey.currentYear || journey.startYear || 755),
      Number(journey.currentMonth || journey.startMonth || 1),
      Number(journey.currentDay || journey.startDay || 1),
      journey.status || "active",
      JSON.stringify(journey.snapshot || {}),
      toMysqlDate(journey.createdAt),
      toMysqlDate(journey.updatedAt)
    ]
  );
}

async function upsertMessage(conn, message) {
  await conn.query(
    `REPLACE INTO tt_chat_history (id, user_id, journey_id, role, content, task_id, time_label, attribute_snapshot, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?)`,
    [
      message.id,
      message.userId,
      message.journeyId || null,
      message.role,
      message.content,
      message.taskId || null,
      message.timeLabel || null,
      JSON.stringify(message.attributeSnapshot || {}),
      toMysqlDate(message.createdAt)
    ]
  );
}

async function upsertTask(conn, task) {
  await conn.query(
    `REPLACE INTO tt_tasks (id, user_id, journey_id, title, description, options, status, year, month, task_day, historical_context, created_at)
     VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?, ?, ?)`,
    [
      task.id,
      task.userId,
      task.journeyId || null,
      task.title,
      task.description,
      JSON.stringify(task.options || []),
      task.status,
      task.year,
      task.month || 1,
      task.day || 1,
      task.historicalContext || "",
      toMysqlDate(task.createdAt)
    ]
  );
}

async function upsertAttributeLog(conn, log) {
  await conn.query(
    `REPLACE INTO tt_attribute_logs (id, user_id, journey_id, change_json, reason, time_label, created_at)
     VALUES (?, ?, ?, CAST(? AS JSON), ?, ?, ?)`,
    [log.id, log.userId, log.journeyId || null, JSON.stringify(log.change || {}), log.reason, log.timeLabel || null, toMysqlDate(log.createdAt)]
  );
}

async function upsertMoneyLog(conn, log) {
  await conn.query(
    `REPLACE INTO tt_money_logs (id, user_id, journey_id, change_amount, balance, debt_change, debt_balance, income_amount, expense_amount, elapsed_days, is_initial, created_ms, unit, reason, time_label, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      log.id,
      log.userId,
      log.journeyId || null,
      Number(log.change || 0),
      Number(log.balance || 0),
      Number(log.debtChange || 0),
      Number(log.debtBalance || 0),
      Number(log.income || 0),
      Number(log.expense || 0),
      Number(log.elapsedDays || 0),
      log.isInitial ? 1 : 0,
      Number(log.createdMs || new Date(log.createdAt || Date.now()).getTime()),
      log.unit || "文",
      log.reason,
      log.timeLabel || null,
      toMysqlDate(log.createdAt)
    ]
  );
}

async function upsertCharacter(conn, character) {
  await conn.query(
    `REPLACE INTO tt_characters (id, user_id, journey_id, name, identity_text, relationship_text, attitude, intimacy, notes, last_interaction, first_met_time, last_seen_time, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      character.id,
      character.userId,
      character.journeyId || null,
      character.name,
      character.identity || null,
      character.relationship || null,
      character.attitude || null,
      Math.max(-100, Math.min(100, Math.trunc(Number(character.intimacy || 0)))),
      character.notes || null,
      character.lastInteraction || null,
      character.firstMetTime || null,
      character.lastSeenTime || null,
      toMysqlDate(character.createdAt),
      toMysqlDate(character.updatedAt)
    ]
  );
}

async function upsertSession(conn, session) {
  await conn.query(
    `REPLACE INTO tt_sessions (token, user_id, created_at) VALUES (?, ?, ?)`,
    [session.token, session.userId, toMysqlDate(session.createdAt)]
  );
}

function clamp(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function applyChanges(user, changes) {
  for (const key of ["wealth", "health", "prestige", "knowledge", "relationship"]) {
    if (Object.hasOwn(changes, key)) user[key] = clamp(user[key] + Number(changes[key]));
  }
}

function applyMoneyChange(db, user, amount, debtAmount = 0, reason, meta = {}) {
  const delta = Number(amount || 0);
  const debtDelta = Number(debtAmount || 0);
  if ((!Number.isFinite(delta) || delta === 0) && (!Number.isFinite(debtDelta) || debtDelta === 0)) return null;
  const normalized = Math.trunc(delta);
  const normalizedDebt = Math.trunc(Number.isFinite(debtDelta) ? debtDelta : 0);
  const before = Number(user.money || 0);
  const debtBefore = Number(user.debt || 0);
  const after = Math.max(0, before + normalized);
  const debtAfter = Math.max(0, debtBefore + normalizedDebt);
  const applied = after - before;
  const debtApplied = debtAfter - debtBefore;
  const requestedIncome = Math.max(0, Math.trunc(Number(meta.income ?? Math.max(applied, 0) ?? 0)));
  const requestedExpense = Math.max(0, Math.trunc(Number(meta.expense ?? Math.max(-applied, 0) ?? 0)));
  const elapsedDays = Math.max(0, Math.trunc(Number(meta.elapsedDays || 0)));
  const isSettlement = elapsedDays > 0 && String(reason || "").includes("生计");
  if (applied === 0 && debtApplied === 0 && !isSettlement) return null;
  user.money = after;
  user.debt = debtAfter;
  if (!Array.isArray(db.moneyLogs)) db.moneyLogs = [];
  const log = {
    id: crypto.randomUUID(),
    userId: user.id,
    journeyId: user.currentJourneyId || null,
    change: applied,
    balance: user.money,
    debtChange: debtApplied,
    debtBalance: user.debt,
    income: isSettlement ? requestedIncome : (applied > 0 ? Math.min(requestedIncome || applied, applied) : 0),
    expense: isSettlement ? requestedExpense : (applied < 0 ? Math.min(requestedExpense || -applied, -applied) : 0),
    elapsedDays,
    isInitial: Boolean(meta.isInitial),
    unit: user.moneyUnit || "文",
    reason,
    timeLabel: timelineLabel(user),
    createdAt: new Date().toISOString(),
    createdMs: nextMoneyLogCreatedMs()
  };
  db.moneyLogs.push(log);
  return log;
}

function normalizeTimelineDay(day = 1) {
  return Math.max(1, Math.min(30, Math.trunc(Number(day || 1))));
}

function timelineSerial(year, month = 1, day = 1) {
  return Number(year) * 360 + (Number(month || 1) - 1) * 30 + (normalizeTimelineDay(day) - 1);
}

function fromTimelineSerial(serial) {
  const value = Math.trunc(Number(serial || 0));
  const year = Math.floor(value / 360);
  const dayOfYear = ((value % 360) + 360) % 360;
  return {
    year,
    month: Math.floor(dayOfYear / 30) + 1,
    day: (dayOfYear % 30) + 1
  };
}

function addDays(year, month, day, delta) {
  return fromTimelineSerial(timelineSerial(year, month, day) + Math.trunc(Number(delta || 0)));
}

function monthsBetween(startYear, startMonth, endYear, endMonth) {
  return Math.max(0, (Number(endYear) - Number(startYear)) * 12 + (Number(endMonth || 1) - Number(startMonth || 1)));
}

function estimateDaysBetween(startYear, startMonth, startDay, endYear, endMonth, endDay = 1) {
  if (arguments.length === 4) {
    return monthsBetween(startYear, startMonth, startDay, endYear) * 30;
  }
  return Math.max(0, timelineSerial(endYear, endMonth, endDay) - timelineSerial(startYear, startMonth, startDay));
}

function advanceUserByDays(user, days) {
  const actualDays = normalizeDurationDays(days, 1);
  const currentMonth = user.currentMonth || 1;
  const currentDay = user.currentDay || 1;
  const advanced = addDays(user.currentYear, currentMonth, currentDay, actualDays);
  const target = clampToPresent(advanced.year, advanced.month, advanced.day);
  const elapsedDays = estimateDaysBetween(user.currentYear, currentMonth, currentDay, target.year, target.month, target.day);
  return {
    year: target.year,
    month: target.month,
    day: target.day,
    days: elapsedDays,
    extraDays: target.day,
    explicit: true
  };
}

async function ensureAdminUser() {
  const [rows] = await pool.query("SELECT id FROM tt_users WHERE username = ? LIMIT 1", ["admin"]);
  if (rows.length) {
    await pool.query("UPDATE tt_users SET role = 'admin', status = 'active' WHERE username = ?", ["admin"]);
    return;
  }
  const now = new Date();
  await pool.query(
    `INSERT INTO tt_users (id, username, password_hash, password_legacy, role, current_year, current_month, current_day, identity_text, journey_started, current_journey_id, money, debt, money_unit, role_profile, daily_expense, job_income, business_income, no_money_days, survival_status, wealth, health, prestige, knowledge, relationship_value, status, created_at, last_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "admin-user",
      "admin",
      hashPassword("admin123"),
      null,
      "admin",
      755,
      1,
      1,
      "系统管理员",
      0,
      null,
      0,
      0,
      "文",
      JSON.stringify({}),
      0,
      0,
      0,
      0,
      "alive",
      50,
      80,
      10,
      20,
      30,
      "active",
      now,
      now
    ]
  );
}

async function upsertNovel(conn, novel) {
  await conn.query(
    `REPLACE INTO tt_novels (id, user_id, journey_id, title, payload_json, txt_content, created_at)
     VALUES (?, ?, ?, ?, CAST(? AS JSON), ?, ?)`,
    [
      novel.id,
      novel.userId,
      novel.journeyId || null,
      novel.title || "未命名小说",
      JSON.stringify(novel.payload || {}),
      novel.txtContent || "",
      toMysqlDate(novel.createdAt)
    ]
  );
}

function parseChineseNumber(value) {
  const raw = String(value || "").trim();
  if (!raw) return NaN;
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  const normalized = raw.replace(/两/g, "二");
  if (!/^[零一二三四五六七八九十百千万亿]+$/.test(normalized)) return NaN;
  const digits = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units = { 十: 10, 百: 100, 千: 1000 };
  let total = 0;
  let section = 0;
  let number = 0;
  for (const char of normalized) {
    if (Object.hasOwn(digits, char)) {
      number = digits[char];
    } else if (Object.hasOwn(units, char)) {
      section += (number || 1) * units[char];
      number = 0;
    } else if (char === "万") {
      total += (section + number) * 10000;
      section = 0;
      number = 0;
    } else if (char === "亿") {
      total += (section + number) * 100000000;
      section = 0;
      number = 0;
    }
  }
  return total + section + number;
}

function parseMoneyAmount(value) {
  const raw = String(value || "").trim();
  if (!raw) return NaN;
  const match = raw.match(/^(\d+(?:\.\d+)?|[一二三四五六七八九十两零百千万亿]+)\s*(亿|万|千|百)?(?:元|块|人民币|现金|万元|亿元)?$/);
  if (!match) return NaN;
  const base = /^\d/.test(match[1]) ? Number(match[1]) : parseChineseNumber(match[1]);
  if (!Number.isFinite(base)) return NaN;
  const multiplier = { 亿: 100000000, 万: 10000, 千: 1000, 百: 100 }[match[2]] || 1;
  return Math.trunc(base * multiplier);
}

const moneyAmountToken = "(\\d+(?:\\.\\d+)?|[一二三四五六七八九十两零百千万亿]+)\\s*(亿|万|千|百)?\\s*(?:元|块|人民币)?";

function readAmountMatch(match, amountIndex = 1, unitIndex = amountIndex + 1) {
  if (!match) return NaN;
  return parseMoneyAmount(`${match[amountIndex] || ""}${match[unitIndex] || ""}`);
}

function isShareOrRatioContext(text, match) {
  const start = Math.max(0, Number(match?.index || 0) - 8);
  const end = Math.min(text.length, Number(match?.index || 0) + String(match?.[0] || "").length + 12);
  const windowText = text.slice(start, end);
  return /%|％|股份|股权|占股|持股|比例|估值|市值|注册资本|家店|门店|用户|人数|杯|单|订单|股份了|手里有.*股/.test(windowText);
}

function hasBusinessIncomeIntent(text) {
  return /(?:经营收入|经营月收入|经营月入|营业收入|月营收|营收|月营业额|营业额|月流水|流水|月利润|利润|盈利|净利润|净收入|收益|生意收入|店铺收入|门店收入|奶茶店|店|门店|连锁|品牌)/.test(text);
}

function hasJobIncomeIntent(text) {
  return /(?:月入|每月收入|月收入|工资|薪水|工钱|固定收入|生活费|家里给|家里打|资助|补贴)/.test(text) && !hasBusinessIncomeIntent(text);
}

function hasDailyExpenseIntent(text) {
  return /(?:日耗|每日|每天|一日|一天|日常消耗|生活费|开销|花销|消费|支出)/.test(text);
}

function hasCashBalanceIntent(text) {
  return /(?:初始现金|初始钱数|初始余额|现金余额|账户应该有|账户有|账户余额|身上有|手头有|手里有|现在有|我有|现金|钱数|余额)/.test(text);
}

function parseUserTimeAdvance(message, user) {
  const text = String(message || "");
  const currentMonth = user.currentMonth || 1;
  const currentDay = user.currentDay || 1;
  const monthNames = {
    正: 1, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
    冬: 11, 腊: 12
  };
  const amountPattern = "(\\d+|[一二三四五六七八九十两零百千万]+|半)";
  const durationSeries = `${amountPattern}\\s*(?:年|载|个月|月|旬|天|日)(?:\\s*(?:又|和|零)?\\s*${amountPattern}\\s*(?:年|载|个月|月|旬|天|日))*`;
  const bareDuration = new RegExp(`^\\s*${durationSeries}\\s*$`).test(text);
  if (!bareDuration && !/(过了|过去|经过|又经过|等了|熬了|耗了|花费|用了|用掉|用时|经营了|运营了|持续了|稳定经营|开了|扩张了|推进|跳过|之后|以后|后|到了|现在是|时间应该|时间推进|到|跳到|时间)/.test(text)) return null;
  const absolute = text.match(/(?:到|到了|跳到|现在是|现在时间|时间应该推进到|时间推进到)?\s*(公元前)?\s*(\d{1,4}|[一二三四五六七八九十两零百千万]+)\s*年(?:\s*(正|冬|腊|\d{1,2}|[一二三四五六七八九十两百千万]+)\s*(?:月|月份)?)?(?:\s*(\d{1,2}|[一二三四五六七八九十两百千万]+)\s*(?:日|号))?/);
  if (absolute) {
    const yearValue = parseChineseNumber(absolute[2]);
    const year = absolute[1] ? -yearValue : yearValue;
    const rawMonth = absolute[3];
    const rawDay = absolute[4];
    const month = rawMonth ? (monthNames[rawMonth] || parseChineseNumber(rawMonth)) : currentMonth;
    const day = rawDay ? parseChineseNumber(rawDay) : currentDay;
    if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
      const target = clampToPresent(year, Math.max(1, Math.min(12, Math.trunc(month))), normalizeTimelineDay(day));
      if (compareTimeline(target.year, target.month, target.day, user.currentYear, currentMonth, currentDay) >= 0) {
        return { ...target, days: estimateDaysBetween(user.currentYear, currentMonth, currentDay, target.year, target.month, target.day), explicit: true };
      }
    }
  }

  const unitDays = (unit) => {
    if (unit === "年" || unit === "载") return 360;
    if (unit === "月" || unit === "个月") return 30;
    if (unit === "旬") return 10;
    return 1;
  };
  const readAmount = (value) => {
    if (value === "半") return 0.5;
    return parseChineseNumber(value);
  };
  const readDurationDays = (durationText) => {
    let totalDays = 0;
    const pattern = new RegExp(`${amountPattern}\\s*(年|载|个月|月|旬|天|日)`, "g");
    for (const match of durationText.matchAll(pattern)) {
      const amount = readAmount(match[1]);
      if (Number.isFinite(amount) && amount > 0) totalDays += amount * unitDays(match[2]);
    }
    return totalDays;
  };

  let days = 0;
  if (bareDuration) days += readDurationDays(text);
  const prefixMatch = text.match(new RegExp(`(?:过了|过去了|过去|经过|又经过|等了|熬了|耗了|花费了|花费|用了|用掉|用时|经营了|运营了|持续经营了|持续了|稳定经营了|开了|扩张了|推进|跳过)\\s*(${durationSeries})`));
  if (prefixMatch) days += readDurationDays(prefixMatch[1]);
  const verbDurationMatch = text.match(new RegExp(`(?:经营|运营|持续经营|稳定经营|扩张|开店|谈恋爱|学习|学|推广|开发|优化)\\s*(?:了)?\\s*(${durationSeries})`));
  if (verbDurationMatch) days += readDurationDays(verbDurationMatch[1]);
  const suffixPattern = new RegExp(`(${durationSeries})\\s*(?:后|之后|以后)`, "g");
  for (const match of text.matchAll(suffixPattern)) {
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 8);
    if (/^(?:挣|赚|收入|工资|薪水|工钱|月钱|拿|拿到)/.test(after)) continue;
    days += readDurationDays(match[1]);
  }
  const xunOnlyMatch = text.match(/(?:过了|过去了|过去|经过)\s*旬/);
  if (xunOnlyMatch) days += 10;
  if (days <= 0 && /(?:半年|半载)/.test(text)) days += 180;
  if (days <= 0 && /(?:一年|1年)/.test(text)) days += 360;
  if (!Number.isFinite(days) || days <= 0) return null;
  const advanced = addDays(user.currentYear, currentMonth, currentDay, days);
  const target = clampToPresent(advanced.year, advanced.month, advanced.day);
  return {
    year: target.year,
    month: target.month,
    day: target.day,
    days: estimateDaysBetween(user.currentYear, currentMonth, currentDay, target.year, target.month, target.day),
    extraDays: target.day,
    explicit: true
  };
}

function eraMoneyProfile(year) {
  if (year < 1368) return { unit: "文", dailyExpense: 12, jobIncome: 450, businessIncome: 0 };
  if (year < 1912) return { unit: "文", dailyExpense: 18, jobIncome: 650, businessIncome: 0 };
  if (year < 1949) return { unit: "元", dailyExpense: 1, jobIncome: 35, businessIncome: 0 };
  return { unit: "元", dailyExpense: 45, jobIncome: 4500, businessIncome: 0 };
}

function sanitizeRoleProfile(raw = {}) {
  const text = (value, max = 120) => String(value || "").trim().slice(0, max);
  return {
    name: text(raw.name, 40),
    age: text(raw.age, 20),
    gender: text(raw.gender, 20),
    origin: text(raw.origin, 80),
    identity: text(raw.identity || raw.role, 120),
    family: text(raw.family, 160),
    job: text(raw.job, 120),
    business: text(raw.business, 160),
    skills: text(raw.skills, 160),
    goal: text(raw.goal, 200)
  };
}

function buildIdentityFromProfile(profile, fallbackYear) {
  const parts = [profile.name, profile.age, profile.gender, profile.origin, profile.identity || profile.job]
    .filter(Boolean);
  return parts.length ? parts.join("，").slice(0, 180) : normalizeIdentity("", fallbackYear);
}

function hasWork(profile = {}) {
  const text = `${profile.job || ""} ${profile.identity || ""}`.trim();
  return Boolean(text && !/无业|失业|乞|流民|逃荒|待定|没有|暂无/i.test(text));
}

function hasBusiness(profile = {}) {
  const text = `${profile.business || ""}`.trim();
  return Boolean(text && !/无|没有|暂无|待定/i.test(text));
}

function normalizeEconomyNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return Math.trunc(Number(fallback || 0));
  return Math.trunc(number);
}

function economyFromOpening(opening, year, profile) {
  const era = eraMoneyProfile(year);
  return {
    moneyUnit: String(opening.moneyUnit || era.unit).slice(0, 12),
    dailyExpense: normalizeEconomyNumber(opening.dailyExpense, era.dailyExpense),
    jobIncome: normalizeEconomyNumber(opening.jobIncome, hasWork(profile) ? era.jobIncome : 0),
    businessIncome: normalizeEconomyNumber(opening.businessIncome, hasBusiness(profile) ? era.businessIncome : 0)
  };
}

function applyLivingSettlement(db, user, days, reason = "日常生计结算") {
  const actualDays = Math.max(0, Math.trunc(Number(days || 0)));
  if (!actualDays) return { days: 0, income: 0, expense: 0, net: 0, warning: "" };

  const dailyExpense = Math.max(0, Math.trunc(Number(user.dailyExpense || 0)));
  const monthlyIncome = Math.max(0, Number(user.jobIncome || 0) + Number(user.businessIncome || 0));
  const expense = dailyExpense * actualDays;
  const income = Math.max(0, Math.trunc(monthlyIncome * (actualDays / 30)));
  const net = income - expense;
  const moneyBefore = Number(user.money || 0);
  if (net !== 0) {
    applyMoneyChange(db, user, net, 0, `${reason}：${actualDays} 天`, {
      income,
      expense,
      elapsedDays: actualDays
    });
  }

  const dailyShortfall = Math.max(0, dailyExpense - monthlyIncome / 30);
  let shortageDays = 0;
  if (dailyShortfall > 0) {
    const coveredDays = moneyBefore > 0 ? Math.floor(moneyBefore / dailyShortfall) : 0;
    shortageDays = Math.max(0, actualDays - coveredDays);
  }
  if (shortageDays > 0) {
    user.noMoneyDays = Math.max(0, Number(user.noMoneyDays || 0)) + shortageDays;
  } else if (user.money > 0 || net >= 0) {
    user.noMoneyDays = 0;
  }

  let warning = "";
  if (user.noMoneyDays >= 30 && user.noMoneyDays < 60) {
    const before = user.health;
    user.health = clamp(Number(user.health || 0) - 8);
    warning = `你已经 ${user.noMoneyDays} 天没有足够现金维持口粮，健康从 ${before} 降到 ${user.health}。`;
  } else if (user.noMoneyDays >= 60) {
    const before = user.health;
    user.health = clamp(Number(user.health || 0) - 20);
    warning = `你已经 ${user.noMoneyDays} 天断粮缺钱，健康从 ${before} 降到 ${user.health}。`;
    if (user.health <= 0 || user.noMoneyDays >= 90) {
      user.survivalStatus = "dead";
      warning += " 长期饥饿已经导致死亡，本段人生结束。";
    }
  } else if (user.money <= 0) {
    warning = "现金已经耗尽，请尽快找工、借贷、变卖资产或降低开销。";
  }

  return { days: actualDays, income, expense, net, warning };
}

function normalizeEconomyUpdate(raw = {}) {
  if (!raw || typeof raw !== "object") return {};
  const update = {};
  const map = [
    ["dailyExpense", ["daily_expense", "dailyExpense", "day_expense", "expense_per_day"]],
    ["jobIncome", ["job_income", "jobIncome", "salary", "wage", "monthly_wage"]],
    ["businessIncome", ["business_income", "businessIncome", "business", "operating_income"]]
  ];
  for (const [target, keys] of map) {
    for (const key of keys) {
      if (raw[key] == null || raw[key] === "") continue;
      const value = parseMoneyAmount(raw[key]);
      if (Number.isFinite(value) && value >= 0) {
        update[target] = Math.min(ECONOMY_VALUE_LIMIT, Math.trunc(value));
        break;
      }
    }
  }
  return update;
}

function parseEconomyUpdateFromMessage(message) {
  const text = String(message || "");
  const update = {};
  const readNear = (patterns) => {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const value = readAmountMatch(match);
        if (Number.isFinite(value) && value >= 0) return Math.min(ECONOMY_VALUE_LIMIT, Math.trunc(value));
      }
    }
    return undefined;
  };
  const dailyExpense = readNear([
    new RegExp(`(?:日耗|每日(?:生活费|花费|开销|消耗|支出)|一天(?:生活费|花费|开销|消耗|支出)|每天(?:生活费|花费|开销|消耗|支出))\\D{0,12}${moneyAmountToken}`),
    new RegExp(`${moneyAmountToken}\\D{0,8}(?:每[日天]|一天)\\D{0,8}(?:生活费|花费|开销|消耗|支出)`)
  ]);
  const jobIncome = readNear([
    new RegExp(`(?:月入|月收入|每月收入|工资|薪水|工钱|固定收入|工作收入|生活费|资助|补贴)\\D{0,12}${moneyAmountToken}`),
    new RegExp(`${moneyAmountToken}\\D{0,8}(?:每月|一月|月)\\D{0,8}(?:工资|薪水|工钱|固定收入|工作收入|生活费|资助|补贴)`)
  ]);
  const businessIncome = readNear([
    new RegExp(`(?:经营收入|经营月收入|经营月入|营业收入|月营收|营收|月营业额|营业额|月流水|流水|月利润|利润|盈利|净利润|净收入|收益|生意收入|店铺收入|门店收入|奶茶店)\\D{0,16}${moneyAmountToken}`),
    new RegExp(`${moneyAmountToken}\\D{0,12}(?:每月|一月|月|个月)\\D{0,12}(?:经营收入|营业收入|营收|营业额|流水|利润|盈利|净利润|净收入|收益|店铺收入|门店收入)`),
    new RegExp(`(?:每月|一月|月|个月)\\D{0,12}(?:经营收入|营业收入|营收|营业额|流水|利润|盈利|净利润|净收入|收益)\\D{0,16}${moneyAmountToken}`)
  ]);
  if (dailyExpense !== undefined) update.dailyExpense = dailyExpense;
  if (jobIncome !== undefined) update.jobIncome = jobIncome;
  if (businessIncome !== undefined) update.businessIncome = businessIncome;
  return update;
}

function parseStrongEconomyUpdateFromMessage(message) {
  const text = String(message || "").replace(/[，,。；;：:]/g, " ");
  const update = {};
  const valuePattern = "(\\d+(?:\\.\\d+)?|[一二三四五六七八九十两零百千万亿]+)\\s*(亿|万|千|百)?";
  const gap = "[^0-9一二三四五六七八九十两零百千万亿]{0,12}";
  const shortGap = "[^0-9一二三四五六七八九十两零百千万亿]{0,10}";
  const read = (patterns) => {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      const value = parseMoneyAmount(`${match[1]}${match[2] || ""}`);
      if (Number.isFinite(value) && value >= 0) return Math.min(ECONOMY_VALUE_LIMIT, Math.trunc(value));
    }
    return undefined;
  };
  const dailyExpense = read([
    new RegExp(`(?:日耗|每日(?:生活费|花费|开销|消耗)|一天(?:生活费|花费|开销|消耗)|每天(?:生活费|花费|开销|消耗))(?:改成|改为|调整为|设为|设置为|算作|按|是|为|=)?${shortGap}${valuePattern}\\s*(?:文|贯|两|元|角|法币)?`),
    new RegExp(`${valuePattern}\\s*(?:文|贯|两|元|角|法币)?\\D{0,8}(?:每[日天]|一天)\\D{0,8}(?:生活费|花费|开销|消耗)`)
  ]);
  const businessText = /(?:经营|生意|买卖|铺子|店铺|营收|净收入|利润)/.test(text);
  const jobPatterns = [
    new RegExp(`(?:月收入|月入|每月收入|每个月收入|一个月收入|月工资|工资|薪水|工钱|月钱|固定收入|工作收入)(?:改成|改为|调整为|设为|设置为|算作|按|是|为|=)?${gap}${valuePattern}\\s*(?:文|贯|两|元|角|法币)?`),
    new RegExp(`${valuePattern}\\s*(?:文|贯|两|元|角|法币)?\\D{0,10}(?:每月|每个月|一个月|月)\\D{0,10}(?:收入|工资|薪水|工钱|月钱|固定收入|工作收入)`)
  ];
  if (!businessText) {
    jobPatterns.push(new RegExp(`(?:每月挣|每个月挣|一个月挣|每月赚|每个月赚|一个月赚)(?:改成|改为|调整为|设为|设置为|算作|按|是|为|=)?${gap}${valuePattern}\\s*(?:文|贯|两|元|角|法币)?`));
    jobPatterns.push(new RegExp(`${valuePattern}\\s*(?:文|贯|两|元|角|法币)?\\D{0,10}(?:每月|每个月|一个月|月)\\D{0,10}(?:挣|赚)`));
    jobPatterns.push(new RegExp(`(?:收入)(?:改成|改为|调整为|设为|设置为|算作|按|是|为|=)${shortGap}${valuePattern}\\s*(?:文|贯|两|元|角|法币)?`));
  }
  const jobIncome = read(jobPatterns);
  const businessIncome = read([
    new RegExp(`(?:经营收入|经营月收入|经营月入|生意收入|买卖收入|铺子收入|店铺收入|营收|净收入|利润)(?:改成|改为|调整为|设为|设置为|算作|按|是|为|=)?${shortGap}${valuePattern}\\s*(?:文|贯|两|元|角|法币)?`),
    new RegExp(`(?:经营|生意|买卖|铺子|店铺)${shortGap}(?:每月|每个月|一个月|月)?${shortGap}(?:收入|赚|挣|盈利|利润|净赚)?(?:改成|改为|调整为|设为|设置为|算作|按|是|为|=)?${shortGap}${valuePattern}\\s*(?:文|贯|两|元|角|法币)?`),
    new RegExp(`${valuePattern}\\s*(?:文|贯|两|元|角|法币)?\\D{0,10}(?:每月|每个月|一个月|月)\\D{0,10}(?:经营收入|生意收入|买卖收入|铺子收入|店铺收入|营收|利润)`)
  ]);
  if (dailyExpense !== undefined) update.dailyExpense = dailyExpense;
  if (jobIncome !== undefined) update.jobIncome = jobIncome;
  if (businessIncome !== undefined) update.businessIncome = businessIncome;
  return update;
}

function parseLocalEconomyUpdateFromMessage(message) {
  const text = String(message || "").replace(/[，,。；;：:]/g, " ");
  const update = {
    ...parseEconomyUpdateFromMessage(text),
    ...parseStrongEconomyUpdateFromMessage(text)
  };
  const amount = moneyAmountToken;
  const read = (patterns, target) => {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match || isShareOrRatioContext(text, match)) continue;
      const value = readAmountMatch(match);
      if (!Number.isFinite(value) || value < 0) continue;
      update[target] = Math.min(ECONOMY_VALUE_LIMIT, Math.trunc(value));
      return;
    }
  };
  read([
    new RegExp(`(?:日耗|每日|每天|一[日天]|日常消耗|日常开销|每天开销|生活每天|生活费每天)\\D{0,18}${amount}`),
    new RegExp(`${amount}\\D{0,10}(?:一天|每日|每天|每[日天])\\D{0,10}(?:生活费|开销|花费|消耗|支出)?`)
  ], "dailyExpense");
  read([
    new RegExp(`(?:家里(?:给|打|汇)|每月(?:家里)?(?:给|打|汇)|生活费|资助|补贴|工资|薪水|固定收入|工作收入|月入|月收入)\\D{0,20}${amount}`),
    new RegExp(`${amount}\\D{0,12}(?:每月|一个月|一月|月)\\D{0,12}(?:生活费|工资|薪水|固定收入|工作收入|资助|补贴)`)
  ], "jobIncome");
  read([
    new RegExp(`(?:经营收入|经营月收入|经营月入|营业收入|月营收|营收|月营业额|营业额|月流水|流水|月利润|利润|盈利|净利润|净收入|收益|生意收入|店铺收入|门店收入|奶茶店(?:铺)?(?:一月|每月|月)?(?:盈利|利润|营收|收入)?)\\D{0,20}${amount}`),
    new RegExp(`${amount}\\D{0,14}(?:每月|一个月|一月|月)\\D{0,14}(?:经营收入|营业收入|营收|营业额|流水|利润|盈利|净利润|净收入|收益|店铺收入|门店收入)`),
    new RegExp(`(?:每月|一个月|一月|月)\\D{0,14}(?:经营收入|营业收入|营收|营业额|流水|利润|盈利|净利润|净收入|收益)\\D{0,20}${amount}`),
    new RegExp(`(?:奶茶店|店铺|门店|连锁店|品牌)\\D{0,18}(?:一月|每月|月|一个月)?\\D{0,12}(?:盈利|利润|营收|收入|赚|挣)\\D{0,20}${amount}`)
  ], "businessIncome");
  return update;
}

function shouldTrustModelEconomyUpdate(message) {
  const text = String(message || "");
  return hasDailyExpenseIntent(text) || hasJobIncomeIntent(text) || hasBusinessIncomeIntent(text);
}

function applyEconomyUpdate(user, update = {}) {
  const normalized = normalizeEconomyUpdate(update);
  const changes = [];
  for (const [key, label] of [
    ["dailyExpense", "日耗"],
    ["jobIncome", "月入"],
    ["businessIncome", "经营收入"]
  ]) {
    if (!Object.hasOwn(normalized, key)) continue;
    const before = Number(user[key] || 0);
    const after = normalized[key];
    if (before === after) continue;
    user[key] = after;
    changes.push(`${label} ${before} -> ${after}${user.moneyUnit || ""}`);
  }
  if (changes.length && user.money > 0) user.noMoneyDays = 0;
  return changes;
}

function normalizeStateUpdate(raw = {}) {
  if (!raw || typeof raw !== "object") return {};
  const update = {};
  const cashSource = raw.cash ?? raw.money ?? raw.current_money ?? raw.cash_balance ?? raw.initial_money;
  if (cashSource != null && cashSource !== "") {
    const cash = parseMoneyAmount(cashSource);
    if (Number.isFinite(cash) && cash >= 0) update.cash = Math.min(MONEY_CHANGE_LIMIT, Math.trunc(cash));
  }
  const currentSituation = String(raw.current_situation ?? raw.currentSituation ?? raw.situation ?? "").trim();
  if (currentSituation) update.currentSituation = currentSituation.slice(0, 1200);
  const initialSituation = String(raw.initial_situation ?? raw.initialSituation ?? "").trim();
  if (initialSituation) update.initialSituation = initialSituation.slice(0, 1200);
  return update;
}

function hasExplicitCashCalibration(message) {
  const text = String(message || "");
  if (/%|％|股份|股权|占股|持股|比例/.test(text) && !/(现金|账户|余额|钱数)/.test(text)) return false;
  return /(?:初始现金|初始钱数|初始余额|现金余额|账户应该有|账户有|账户余额|身上有|手头有|手里有|现在有|我有|现金|钱数|余额|校准|改成|改为|不对|应该有)/.test(text);
}

function parseStateUpdateFromMessage(message) {
  const text = String(message || "").trim();
  const update = {};
  const amountToken = moneyAmountToken;
  const cashPatterns = [
    new RegExp(`(?:初始现金|初始钱数|初始余额|现金余额|账户应该有|账户有|账户余额|身上有|手头有|手里有|现在有|我有|现金|钱数|余额)\\D{0,16}${amountToken}`),
    new RegExp(`${amountToken}\\s*(?:文|贯|两|元|角|法币)?\\D{0,10}(?:现金|钱|余额|账户|身上|手头|手里)`)
  ];
  for (const pattern of cashPatterns) {
    const match = text.match(pattern);
    if (!match) continue;
    if (isShareOrRatioContext(text, match)) continue;
    const cash = readAmountMatch(match);
    if (Number.isFinite(cash) && cash >= 0) {
      update.cash = Math.min(MONEY_CHANGE_LIMIT, Math.trunc(cash));
      break;
    }
  }

  const looksLikeSituation = /(?:当下情况|当前情况|初始情况|开局情况|现在情况|我现在|目前|住在|家里|欠了|带着|身边|处境|刚到)/.test(text);
  if (looksLikeSituation && text.length >= 6) {
    update.currentSituation = text.slice(0, 1200);
    if (/初始情况|开局情况|刚到|我现在|目前/.test(text)) update.initialSituation = text.slice(0, 1200);
  }
  return update;
}

function applyStateUpdate(db, user, update = {}) {
  const normalized = normalizeStateUpdate(update);
  const changes = [];
  if (Object.hasOwn(normalized, "cash")) {
    const before = Number(user.money || 0);
    const after = normalized.cash;
    if (before !== after) {
      applyMoneyChange(db, user, after - before, 0, "现金余额校准", { income: 0, expense: 0 });
      changes.push(`现金 ${before} -> ${after}${user.moneyUnit || ""}`);
    }
  }
  if (!user.roleProfile || typeof user.roleProfile !== "object") user.roleProfile = {};
  if (normalized.initialSituation && !user.journeyStarted) {
    user.roleProfile.initialSituation = normalized.initialSituation;
    changes.push("初始情况已记录");
  } else if (normalized.currentSituation && !user.roleProfile.initialSituation && !user.journeyStarted) {
    user.roleProfile.initialSituation = normalized.currentSituation;
    changes.push("初始情况已记录");
  }
  if (normalized.currentSituation) {
    user.roleProfile.currentSituation = normalized.currentSituation;
    changes.push("当下情况已记录");
  }
  return changes;
}

function parseLocalMoneyChangeFromMessage(message) {
  const text = String(message || "").replace(/[，,。；;：:]/g, " ");
  const amount = moneyAmountToken;
  const patterns = [
    { type: "expense", reason: "投入/投资支出", re: new RegExp(`(?:投入|投资|拿出|出资|追加投资|花费|花了|支付|付了|购买|置办|租用|报名|开销|支出)\\D{0,18}${amount}`) },
    { type: "expense", reason: "投入/投资支出", re: new RegExp(`${amount}\\D{0,12}(?:投入|投资|出资|花费|支付|购买|置办|租用|报名|开销|支出)`) },
    { type: "income", reason: "到账/收款收入", re: new RegExp(`(?:收款|获得现金|实际到手|到手|收到|到账|赚了|挣了)\\D{0,18}${amount}`) },
    { type: "income", reason: "到账/收款收入", re: new RegExp(`${amount}\\D{0,12}(?:收款|到账|实际到手|到手|收入)`) }
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern.re);
    if (!match || isShareOrRatioContext(text, match)) continue;
    if (/(?:\d+|[一二三四五六七八九十两半]+)\s*(?:年|个月|月|天|日|旬)\D{0,8}(?:和|加上|以及|并且)?\D{0,8}(?:\d|[一二三四五六七八九十两零百千万亿])/.test(match[0])) continue;
    if (hasBusinessIncomeIntent(text) && /(?:每月|一月|月营收|月收入|月利润|盈利|营收)/.test(text)) continue;
    const value = readAmountMatch(match);
    if (!Number.isFinite(value) || value <= 0) continue;
    const signed = pattern.type === "expense" ? -value : value;
    return {
      amount: normalizeMoneyChange(signed),
      income: pattern.type === "income" ? value : 0,
      expense: pattern.type === "expense" ? value : 0,
      reason: pattern.reason
    };
  }
  return null;
}

function normalizeCharacterUpdate(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.name || "").trim().slice(0, 80);
  if (!name) return null;
  return {
    name,
    identity: String(raw.identity || raw.role || "").trim().slice(0, 160),
    relationship: String(raw.relationship || "").trim().slice(0, 80),
    attitude: String(raw.attitude || "").trim().slice(0, 80),
    intimacyDelta: Math.max(-20, Math.min(20, Math.trunc(Number(raw.intimacy_delta || raw.intimacyDelta || 0)))),
    notes: String(raw.notes || "").trim().slice(0, 600),
    lastInteraction: String(raw.last_interaction || raw.lastInteraction || "").trim().slice(0, 600)
  };
}

function normalizeCharacterUpdates(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).map(normalizeCharacterUpdate).filter(Boolean);
}

function applyCharacterUpdates(db, user, updates) {
  if (!Array.isArray(db.characters)) db.characters = [];
  const changed = [];
  const journeyId = user.currentJourneyId || null;
  for (const update of updates || []) {
    const existing = db.characters.find((item) => item.userId === user.id && item.name === update.name && (!item.journeyId || item.journeyId === journeyId));
    const nowIso = new Date().toISOString();
    const target = existing || {
      id: crypto.randomUUID(),
      userId: user.id,
      journeyId,
      name: update.name,
      intimacy: 0,
      firstMetTime: timelineLabel(user),
      createdAt: nowIso
    };
    target.identity = update.identity || target.identity || "";
    target.relationship = update.relationship || target.relationship || "相识";
    target.attitude = update.attitude || target.attitude || "";
    target.intimacy = Math.max(-100, Math.min(100, Number(target.intimacy || 0) + update.intimacyDelta));
    target.notes = update.notes || target.notes || "";
    target.lastInteraction = update.lastInteraction || target.lastInteraction || "";
    target.lastSeenTime = timelineLabel(user);
    target.updatedAt = nowIso;
    if (!existing) db.characters.push(target);
    changed.push(target);
  }
  return changed;
}

function makeTask(user, baseTask) {
  return {
    id: crypto.randomUUID(),
    userId: user.id,
    journeyId: user.currentJourneyId || null,
    title: baseTask.title,
    description: baseTask.description,
    options: baseTask.options,
    status: "pending",
    year: user.currentYear,
    month: user.currentMonth || 1,
    day: user.currentDay || 1,
    historicalContext: baseTask.historicalContext,
    createdAt: new Date().toISOString()
  };
}

function addMonths(year, month, delta) {
  const total = year * 12 + (month - 1) + delta;
  return {
    year: Math.floor(total / 12),
    month: (total % 12 + 12) % 12 + 1
  };
}

function compareYearMonth(aYear, aMonth, bYear, bMonth) {
  return aYear === bYear ? aMonth - bMonth : aYear - bYear;
}

function compareTimeline(aYear, aMonth, aDay, bYear, bMonth, bDay) {
  return timelineSerial(aYear, aMonth, aDay) - timelineSerial(bYear, bMonth, bDay);
}

function currentChinaTimeLimit() {
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric"
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day)
  };
}

function clampToPresent(year, month, day = 1) {
  const limit = currentChinaTimeLimit();
  if (compareTimeline(year, month, day, limit.year, limit.month, limit.day) > 0) {
    return { year: limit.year, month: limit.month, day: normalizeTimelineDay(limit.day) };
  }
  return { year, month, day: normalizeTimelineDay(day) };
}

function timelineLabel(user) {
  return `${user.currentYear} 年 ${user.currentMonth || 1} 月 ${user.currentDay || 1} 日`;
}

function publicUser(user) {
  const { password, passwordHash, aiConfig, ...safe } = user;
  safe.role = safe.role === "admin" ? "admin" : "user";
  safe.aiConfig = publicAiConfig(user);
  return safe;
}

function requireUser(db, req) {
  const userId = req.headers["x-user-id"] || "demo-user";
  const session = db.sessions?.find((item) => item.token === userId);
  if (session) return db.users.find((user) => user.id === session.userId) || db.users[0];
  return db.users.find((user) => user.id === userId) || db.users[0];
}

function isAdmin(user) {
  return user?.role === "admin" || user?.username === "admin";
}

function currentRequestUser(db, req) {
  return requireUser(db, req);
}

function requireAdmin(db, req) {
  const user = currentRequestUser(db, req);
  if (!isAdmin(user)) {
    const error = new Error("只有管理员账户才能执行该操作");
    error.statusCode = 403;
    throw error;
  }
  return user;
}

function chatTurnCount(db, user, journeyId = user.currentJourneyId) {
  return userJourneyItems(db.chatHistory, user, journeyId).filter((message) => message.role === "user").length;
}

function isCashCalibrationLog(log) {
  const reason = String(log.reason || "");
  return /现金余额校准|cash balance calibration|cash calibration|balance calibration/.test(reason);
}

function moneyStatsForUser(db, user) {
  const logs = userJourneyItems(db.moneyLogs, user, user.currentJourneyId);
  const initialLog = logs.find((log) => log.isInitial) || logs[0];
  const initialFunds = Number(initialLog?.balance ?? 0);
  const income = logs.reduce((sum, log) => {
    if (log.isInitial) return sum;
    if (isCashCalibrationLog(log)) return sum + Math.max(0, Number(log.income || 0));
    const fallback = Math.max(Number(log.change || 0), 0);
    const recorded = Number(log.income || 0);
    return sum + Math.max(0, recorded || fallback);
  }, 0);
  const expense = logs.reduce((sum, log) => {
    if (log.isInitial) return sum;
    if (isCashCalibrationLog(log)) return sum + Math.max(0, Number(log.expense || 0));
    const fallback = Math.max(-Number(log.change || 0), 0);
    const recorded = Number(log.expense || 0);
    return sum + Math.max(0, recorded || fallback);
  }, 0);
  const days = Math.max(1, logs.reduce((sum, log) => sum + Math.max(0, Number(log.elapsedDays || 0)), 0));
  const turns = Math.max(1, chatTurnCount(db, user, user.currentJourneyId));
  const earningRate = (initialFunds + income - expense) / turns / days;
  return {
    initialFunds,
    income,
    expense,
    days,
    turns,
    earningRate: Number.isFinite(earningRate) ? earningRate : 0,
    unit: user.moneyUnit || initialLog?.unit || "文"
  };
}

function decorateUser(db, user) {
  getCurrentJourney(db, user);
  return {
    ...publicUser(user),
    moneyStats: moneyStatsForUser(db, user)
  };
}

function novelToText(novel) {
  const n = novel || {};
  const bodyText = Array.isArray(n.chapters) && n.chapters.length
    ? n.chapters.map((item, index) => `第${item.chapter || index + 1}章 ${item.title || ""}\n${item.body || item.summary || ""}`).join("\n\n")
    : "";
  const characters = Array.isArray(n.characters) && n.characters.length
    ? n.characters.map((item) => `- ${item.name || "人物"}：${item.role || ""}；${item.relationship || ""}`).join("\n")
    : "暂无人物表。";
  const spine = Array.isArray(n.historicalSpine) && n.historicalSpine.length
    ? n.historicalSpine.map((item) => `- ${item}`).join("\n")
    : "暂无历史走势。";
  const outline = Array.isArray(n.volumeOutline) && n.volumeOutline.length
    ? n.volumeOutline.map((item) => `第${item.chapter || ""}章 ${item.title || ""}\n${item.summary || ""}`).join("\n\n")
    : "暂无章节大纲。";
  return [
    `《${n.title || "未命名时空小说"}》`,
    n.tagline || "",
    "",
    `【类型】${n.genre || "历史穿越"}`,
    "",
    "【故事简介】",
    n.premise || "暂无简介。",
    "",
    n.prologue ? `【序章】\n${n.prologue}` : "",
    "",
    "【主角】",
    `${n.protagonist?.name || "无名旅人"}：${n.protagonist?.identity || ""}`,
    n.protagonist?.arc || "",
    "",
    "【历史走势】",
    spine,
    "",
    "【人物表】",
    characters,
    "",
    "【章节大纲】",
    outline,
    "",
    bodyText ? "【正文节选】" : "",
    bodyText,
    bodyText ? "" : "",
    "【第一章开篇】",
    n.openingChapter || "暂无正文。",
    "",
    n.epilogue ? `【尾声】\n${n.epilogue}` : "",
    "",
    "【史实说明】",
    n.historicalNote || "暂无说明。"
  ].join("\n");
}

function safeDownloadName(value) {
  return String(value || "novel").replace(/[\\/:*?"<>|\r\n]+/g, "_").slice(0, 80) || "novel";
}

function compactText(value, max = 600) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(`time-travel:${password}`).digest("hex");
}

function verifyPassword(user, password) {
  if (user.passwordHash) return user.passwordHash === hashPassword(password);
  return user.password === password;
}

function createSession(db, user) {
  if (!Array.isArray(db.sessions)) db.sessions = [];
  const token = crypto.randomUUID();
  db.sessions.push({
    token,
    userId: user.id,
    createdAt: new Date().toISOString()
  });
  return token;
}

function loadEnvFile() {
  const configFiles = ["配置.env", ".env"].map((name) => path.join(__dirname, name)).filter((file) => existsSync(file));
  for (const envPath of configFiles) {
    const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index === -1) continue;
      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!value || value.includes("请在这里") || value.includes("your-deepseek")) continue;
      if (!process.env[key] || process.env[key].includes("请在这里") || process.env[key].includes("your-deepseek")) {
        process.env[key] = value;
      }
    }
  }
}

function modelMessages(db, user, message, pendingTask, selectedOption) {
  const journeyId = currentJourneyId(db, user);
  const recent = db.chatHistory
    .filter((item) => belongsToJourney(item, user, journeyId) && ["user", "assistant"].includes(item.role))
    .slice(-10)
    .map((item) => ({
      role: item.role,
      content: compactText(item.content, 700),
      time: item.timeLabel || item.createdAt,
      saved_attribute_snapshot: item.attributeSnapshot || null
    }));
  const recentTasks = db.tasks
    .filter((task) => belongsToJourney(task, user, journeyId))
    .slice(-8)
    .map((task) => ({
      title: task.title,
      status: task.status,
      time: `${task.year} 年 ${task.month || 1} 月 ${task.day || 1} 日`,
      historical_context: compactText(task.historicalContext, 300),
      options: task.options
    }));
  const recentAttributeLogs = db.attributeLogs
    .filter((log) => belongsToJourney(log, user, journeyId))
    .slice(-12)
    .map((log) => ({
      time: log.timeLabel || log.createdAt,
      reason: log.reason,
      change: log.change
    }));
  const recentMoneyLogs = (db.moneyLogs || [])
    .filter((log) => belongsToJourney(log, user, journeyId))
    .slice(-12)
    .map((log) => ({
      time: log.timeLabel || log.createdAt,
      reason: log.reason,
      change: log.change,
      balance: log.balance,
      debt_change: log.debtChange || 0,
      debt_balance: log.debtBalance || 0,
      unit: log.unit
    }));
  const knownCharacters = (db.characters || [])
    .filter((character) => belongsToJourney(character, user, journeyId))
    .slice(-30)
    .map((character) => ({
      name: character.name,
      identity: character.identity,
      relationship: character.relationship,
      attitude: character.attitude,
      intimacy: character.intimacy,
      notes: compactText(character.notes, 240),
      last_interaction: compactText(character.lastInteraction, 240),
      last_seen_time: character.lastSeenTime
    }));

  return [
    {
      role: "system",
      content: [
        "你是“命运之书”，为一款重生穿越体验 APP 生成剧情回复和任务。",
        "所有判断必须以 user_saved_state 里的数据库保存值为准。不得自行重置、刷新、奖励或惩罚钱数和属性。",
        "属性变化只能通过本轮剧情合理增减，返回 attribute_changes；现金变化通过 money_change 表示；负债变化通过 debt_change 表示。系统会在数据库里按这些变化写入余额、负债和日志。",
        "系统会在模型回复后按经过天数自动扣除 daily_expense，并按 job_income、business_income 自动结算收入；不要把吃饭住宿等日常消耗重复写入 money_change。money_change 只表示本轮剧情额外收入、损失、交易或借贷带来的现金变化。",
        "如果玩家明确用对话校准日耗、工资/月入、经营收入，比如“日耗改成8文”“月入300文”“铺子每月赚50文”，必须在 economy_update 里返回对应字段。该更新是系统参数校准，不是剧情收入，不要同时写入 money_change。",
        "当玩家是在校准日耗、月入、经营收入或现金余额时，回复正文只确认已记录即可，不要自行推导新的余额、净收入或未来结算；系统会在回复末尾追加真实保存结果和生计结算。",
        "如果玩家明确校准现金余额或描述开局/当下情况，比如“我身上有120文”“初始现金改成300文”“我现在住在东市边，欠了邻居一斗米”，必须在 state_update 里返回 cash 和/或 current_situation、initial_situation。现金余额校准不是剧情收入，不要同时写入 money_change。",
        "五项属性含义固定：财富=资源和谋生余地，不等于现金；健康=体力疾病伤势；声望=社会信誉；学识=知识技艺经验；人际=关系网络。负债 debt 单独表示欠款和赊欠。",
        "如果剧情是借钱、赊账、借粮折价、典当后仍欠账，money_change 通常为正，debt_change 必须为正。还钱或抵债时 money_change 通常为负，debt_change 必须为负。",
        "剧情中出现有姓名或稳定称呼的人物时，必须通过 character_updates 返回人物关系更新；已有 known_characters 中的人物要沿用原关系，不得随意改名或遗忘。",
        "如果玩家已在保存数据中有任务、对话、属性日志、资金流水，必须承认这些历史记录，不得覆盖或编造与保存记录冲突的前史。",
        "必须严格遵循用户当前年份能合理出现的真实历史背景、制度、物品和语言氛围，不得出现蒸汽机、现代金融、现代医学等时代错位内容。",
        "剧情必须按照真实历史进程推进。历史大事发生的先后顺序、月份背景、制度变化和技术条件都不能违背史实。",
        "时间线可以覆盖全部真实历史，允许古代、近现代和当代，但绝不能生成超过当前真实日期的未来情节。",
        "时间线完全由玩家决定。玩家没有明确说“过了多久”或“到了哪年哪月”，且没有选择带耗时的当前任务选项时，剧情只能发生在当前年月，next_time 必须等于 user_saved_state 当前年月。不要为了剧情自行推进月份或年份。",
        "只有玩家明确说过了几天、几旬、几个月、几年，或到了某年某月，或选择当前任务选项时，系统才会推进时间并结算日常消耗。",
        "允许用户改变个人命运，但不能改写已经发生的宏观历史大势。",
        "钱数必须用真实数值变化表达：money_change 是本轮现金实际增减，debt_change 是本轮负债实际增减。不要只用财富值代替钱或负债。",
        "回复正文里提到现金、月入、日耗、负债时必须引用 user_saved_state 或本轮明确校准值，不能和系统保存值冲突。",
        "如果 survival_status 不是 alive，必须回复本段人生已结束，不能继续派发普通任务。如果 no_money_days 较高或现金耗尽，回复中必须明确提醒缺钱、饥饿和求生风险，并给出符合时代的求生选择。",
        "只返回一个合法 JSON 对象，不要 Markdown，不要代码块，不要解释。",
        "JSON 格式：",
        '{"reply":"给玩家看的中文回复","next_time":{"year":755,"month":2},"money_change":0,"debt_change":0,"economy_update":{"daily_expense":null,"job_income":null,"business_income":null},"state_update":{"cash":null,"current_situation":null,"initial_situation":null},"attribute_changes":{"wealth":0,"health":0,"prestige":0,"knowledge":0,"relationship":0},"character_updates":[{"name":"人物姓名","identity":"身份","relationship":"与玩家关系","attitude":"态度","intimacy_delta":0,"notes":"人物备注","last_interaction":"最近互动"}],"complete_current_task":false,"task":null}',
        "next_time 必须包含 year 和 month，month 为 1 到 12，不能早于当前输入时间，也不能超过当前真实年月。",
        "attribute_changes 的五个键必须齐全，整数范围 -10 到 10。",
        "如果需要派发新任务，task 必须为：{\"title\":\"标题\",\"description\":\"任务描述\",\"historical_context\":\"历史背景\",\"options\":[{\"text\":\"选项\",\"duration_days\":7,\"effect\":{\"money\":0,\"debt\":0,\"wealth\":0,\"health\":0,\"prestige\":0,\"knowledge\":0,\"relationship\":0}}]}。options 给 2 到 3 个，duration_days 要按行动内容合理估算。"
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({
        user_saved_state: {
          year: user.currentYear,
          month: user.currentMonth || 1,
          day: user.currentDay || 1,
          current_time_label: timelineLabel(user),
          identity: user.identity,
          attributes: userAttributeState(user),
          attribute_definitions: attributeDefinitions,
          economy: {
            daily_expense: Number(user.dailyExpense || 0),
            job_income_per_month: Number(user.jobIncome || 0),
            business_income_per_month: Number(user.businessIncome || 0),
            no_money_days: Number(user.noMoneyDays || 0),
            survival_status: user.survivalStatus || "alive"
          },
          role_profile: user.roleProfile || {},
          journey_started: Boolean(user.journeyStarted)
        },
        true_present_limit: currentChinaTimeLimit(),
        pending_task: pendingTask || null,
        selected_option: selectedOption || null,
        saved_tasks: recentTasks,
        saved_attribute_logs: recentAttributeLogs,
        saved_money_logs: recentMoneyLogs,
        known_characters: knownCharacters,
        recent_conversation: recent,
        player_message: message
      })
    }
  ];
}

function parseModelJson(content) {
  const raw = String(content || "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("模型没有返回 JSON。");
    return JSON.parse(match[0]);
  }
}

function normalizeChanges(changes = {}) {
  if (!changes || typeof changes !== "object") changes = {};
  const normalized = {};
  for (const key of ["wealth", "health", "prestige", "knowledge", "relationship"]) {
    const value = Number(changes[key] || 0);
    normalized[key] = Math.max(-10, Math.min(10, Number.isFinite(value) ? Math.trunc(value) : 0));
  }
  return normalized;
}

function normalizeDurationDays(value, fallback = 1) {
  if (typeof value === "number") {
    return Math.max(1, Math.min(1080, Math.trunc(Number.isFinite(value) ? value : fallback)));
  }
  const text = String(value || "").trim();
  if (!text) return normalizeDurationDays(fallback, 1);
  if (/半\s*(日|天)/.test(text)) return 1;
  let total = 0;
  const pattern = /(\d+(?:\.\d+)?|[一二三四五六七八九十两零百千万]+)\s*(年|载|个月|月|旬|日|天)/g;
  for (const match of text.matchAll(pattern)) {
    const amount = /^\d/.test(match[1]) ? Number(match[1]) : parseChineseNumber(match[1]);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const unit = match[2];
    if (unit === "年" || unit === "载") total += amount * 360;
    else if (unit === "月" || unit === "个月") total += amount * 30;
    else if (unit === "旬") total += amount * 10;
    else total += amount;
  }
  return normalizeDurationDays(total || fallback, 1);
}

function durationLabel(days) {
  const value = normalizeDurationDays(days, 1);
  if (value < 10) return `${value}天`;
  if (value % 360 === 0) return `${value / 360}年`;
  if (value >= 360) return `${Math.round(value / 30)}个月`;
  if (value % 30 === 0) return `${value / 30}个月`;
  if (value >= 30) return `${Math.floor(value / 30)}个月${value % 30 ? `${value % 30}天` : ""}`;
  if (value % 10 === 0) return `${value / 10}旬`;
  return `${value}天`;
}

function estimateTaskOptionDurationDays(option, task = {}) {
  const explicitSource = option?.duration_days ?? option?.durationDays ?? option?.timeCostDays ?? option?.days ?? option?.duration;
  if (explicitSource != null && explicitSource !== "") return normalizeDurationDays(explicitSource, 1);
  const text = [option?.text, task.title, task.description, task.historicalContext]
    .filter(Boolean)
    .join(" ");
  if (/拜师|习艺|学艺|读书|训练|练兵|养伤|疗伤|研发|编书|考试|备考/.test(text)) return 60;
  if (/开店|置业|修房|建房|造船|开荒|种田|扩张|经营|铺子|作坊|商队|长期|屯田/.test(text)) return 45;
  if (/赶路|远行|进京|赴任|运货|押送|护送|迁徙|逃荒|出海|跨州|千里/.test(text)) return 30;
  if (/调查|打探|周旋|谈判|筹钱|借钱|典当|招募|寻找|采购|采买|拜访|求见|投奔|求职/.test(text)) return 7;
  if (/打架|逃跑|报官|送信|传话|观察|询问|打听|见面|赴约|交易|卖出|买入|休息/.test(text)) return 1;
  return 3;
}

function enrichTaskOptions(task) {
  if (!task || !Array.isArray(task.options)) return task;
  task.options = task.options.slice(0, 3).map((option) => {
    const durationDays = estimateTaskOptionDurationDays(option, task);
    return {
      ...option,
      text: String(option?.text || "继续行动").slice(0, 80),
      durationDays,
      durationLabel: option?.durationLabel || durationLabel(durationDays),
      effect: {
        money: normalizeMoneyChange(option?.effect?.money),
        debt: normalizeDebtChange(option?.effect?.debt),
        ...normalizeChanges(option?.effect)
      }
    };
  });
  return task;
}

function normalizeTask(user, task) {
  if (!task || typeof task !== "object") return null;
  const options = Array.isArray(task.options) ? task.options.slice(0, 3) : [];
  if (!task.title || !task.description || options.length < 2) return null;
  return enrichTaskOptions(makeTask(user, {
    title: String(task.title).slice(0, 80),
    description: String(task.description).slice(0, 500),
    historicalContext: String(task.historical_context || task.historicalContext || "").slice(0, 500),
    options
  }));
}

function normalizeMoneyChange(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.max(-MONEY_CHANGE_LIMIT, Math.min(MONEY_CHANGE_LIMIT, Math.trunc(amount)));
}

function normalizeDebtChange(value) {
  return normalizeMoneyChange(value);
}

function normalizeIdentity(value, year) {
  const fallback = year >= 1912 ? "近现代普通市民" : "历史时代普通庶民";
  return String(value || fallback).slice(0, 80);
}

function normalizeOpening(parsed, year, month, profile = {}) {
  const tempUser = {
    id: "demo-user",
    currentYear: year,
    currentMonth: month,
    currentDay: 1
  };
  const task = normalizeTask(tempUser, parsed.task);
  const era = eraMoneyProfile(year);
  if (!task) throw new Error("模型开局没有生成有效任务。");
  return {
    identity: profile.identity ? buildIdentityFromProfile(profile, year) : normalizeIdentity(parsed.identity, year),
    money: Math.max(0, Math.trunc(Number(parsed.money || era.dailyExpense * 30))),
    moneyUnit: String(parsed.money_unit || parsed.moneyUnit || era.unit).slice(0, 12),
    dailyExpense: normalizeEconomyNumber(parsed.daily_expense || parsed.dailyExpense, era.dailyExpense),
    jobIncome: normalizeEconomyNumber(parsed.job_income || parsed.jobIncome, hasWork(profile) ? era.jobIncome : 0),
    businessIncome: normalizeEconomyNumber(parsed.business_income || parsed.businessIncome, hasBusiness(profile) ? era.businessIncome : 0),
    scene: String(parsed.scene || "").slice(0, 2000),
    openingMessage: String(parsed.opening_message || parsed.reply || parsed.scene || "").slice(0, 2000),
    task
  };
}

function normalizeNextTime(user, nextTime) {
  const currentMonth = user.currentMonth || 1;
  const currentDay = user.currentDay || 1;
  if (!nextTime || typeof nextTime !== "object") return addDays(user.currentYear, currentMonth, currentDay, 30);
  const year = Number(nextTime.year);
  const month = Number(nextTime.month);
  const day = Number(nextTime.day || currentDay);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return addDays(user.currentYear, currentMonth, currentDay, 30);
  let normalized = {
    year: Math.trunc(year),
    month: Math.max(1, Math.min(12, Math.trunc(month))),
    day: normalizeTimelineDay(day)
  };
  if (compareTimeline(normalized.year, normalized.month, normalized.day, user.currentYear, currentMonth, currentDay) < 0) {
    normalized = { year: user.currentYear, month: currentMonth, day: currentDay };
  }
  const maxAllowed = addDays(user.currentYear, currentMonth, currentDay, 90);
  if (compareTimeline(normalized.year, normalized.month, normalized.day, maxAllowed.year, maxAllowed.month, maxAllowed.day) > 0) {
    normalized = maxAllowed;
  }
  normalized = clampToPresent(normalized.year, normalized.month, normalized.day);
  return normalized;
}

async function callDeepSeekJson(user, messages, maxTokens = 1200) {
  const aiConfig = requireAiConfig(user);

  const response = await fetch(`${aiConfig.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${aiConfig.apiKey}`
    },
    body: JSON.stringify({
      model: aiConfig.model,
      messages,
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      temperature: 0.8,
      max_tokens: maxTokens
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`DeepSeek 请求失败：HTTP ${response.status} ${detail.slice(0, 240)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek 返回为空。");
  return parseModelJson(content);
}

async function testDeepSeekConfig(config) {
  const aiConfig = normalizeAiConfig(config);
  if (!aiConfig.apiKey) {
    throw new Error("请填写 DeepSeek API Key。");
  }
  const response = await fetch(`${aiConfig.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${aiConfig.apiKey}`
    },
    body: JSON.stringify({
      model: aiConfig.model,
      messages: [
        { role: "system", content: "只返回 JSON。" },
        { role: "user", content: "返回 {\"ok\":true}" }
      ],
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      temperature: 0,
      max_tokens: 40
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`DeepSeek 测试失败：HTTP ${response.status} ${detail.slice(0, 160)}`);
  }
  return true;
}

async function generateDeepSeekOpening(user, year, month, profile = {}) {
  const era = eraMoneyProfile(year);
  const parsed = await callDeepSeekJson(user, [
    {
      role: "system",
      content: [
        "你是“命运之书”，为重生穿越体验 APP 生成新人生开局。",
        "必须严格依据输入年月的真实历史进程、制度、地理、服饰、技术、社会阶层与重大事件背景。",
        "必须为角色设定符合时代和身份的初始钱数 money 与 money_unit。money_unit 要按年代动态选择：秦汉到唐宋可用文/贯，明清可用文/两，民国可用元/角/法币，当代可用元。数值要便于后续精确记账。",
        "开局角色信息由用户输入，必须尊重 player_profile。可以按时代修正不合理细节，但不能替用户随机换身份。",
        "必须返回 daily_expense、job_income、business_income：daily_expense 是该时代普通生活每日现金消耗；job_income 是固定工作月收入；business_income 是经营月净收入。没有工作或经营时对应收入为 0。",
        "不得生成超过当前真实日期之后的未来情节。",
        "只返回合法 JSON，不要 Markdown。",
        "JSON 格式：",
        '{"identity":"角色身份","money":500,"money_unit":"文","daily_expense":12,"job_income":450,"business_income":0,"scene":"开局环境描写","opening_message":"给玩家的开局文字","task":{"title":"任务标题","description":"任务描述","historical_context":"历史背景","options":[{"text":"选项","effect":{"money":0,"wealth":0,"health":0,"prestige":0,"knowledge":0,"relationship":0}}]}}'
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({
        start_time: { year, month },
        player_profile: profile,
        era_economy_reference: era,
        true_present_limit: currentChinaTimeLimit()
      })
    }
  ]);
  return normalizeOpening(parsed, year, month, profile);
}

async function generateDeepSeekTurn(db, user, message, pendingTask, selectedOption) {
  const parsed = await callDeepSeekJson(user, modelMessages(db, user, message, pendingTask, selectedOption));
  return {
    reply: String(parsed.reply || "命运之书暂时沉默。").slice(0, 2000),
    changes: normalizeChanges(parsed.attribute_changes),
    moneyChange: normalizeMoneyChange(parsed.money_change),
    debtChange: normalizeDebtChange(parsed.debt_change),
    economyUpdate: normalizeEconomyUpdate(parsed.economy_update),
    stateUpdate: normalizeStateUpdate(parsed.state_update),
    characterUpdates: normalizeCharacterUpdates(parsed.character_updates),
    nextTime: normalizeNextTime(user, parsed.next_time),
    completeCurrentTask: Boolean(parsed.complete_current_task),
    nextTask: normalizeTask(user, parsed.task)
  };
}

async function generateDeepSeekHistorySummary(db, user) {
  const journeyId = currentJourneyId(db, user);
  const messages = db.chatHistory
    .filter((message) => belongsToJourney(message, user, journeyId))
    .slice(-30)
    .map((message) => ({
      role: message.role,
      content: compactText(message.content, 650),
      time: message.timeLabel || message.createdAt
    }));
  const tasks = db.tasks
    .filter((task) => belongsToJourney(task, user, journeyId))
    .slice(-12)
    .map((task) => ({
      title: task.title,
      status: task.status,
      time: `${task.year} 年 ${task.month || 1} 月 ${task.day || 1} 日`,
      context: compactText(task.historicalContext, 300)
    }));
  const logs = db.attributeLogs
    .filter((log) => belongsToJourney(log, user, journeyId))
    .slice(-18);
  const moneyLogs = (db.moneyLogs || [])
    .filter((log) => belongsToJourney(log, user, journeyId))
    .slice(-24);

  const parsed = await callDeepSeekJson(user, [
    {
      role: "system",
      content: [
        "你是历史人生档案官。请基于对话、任务和属性变化，为玩家生成历史记录。",
        "只能总结当前玩家这一条旅程。必须严格按年月顺序梳理，发现跳跃也要说明为时间跳跃，不得把不同用户或无关数据混入。",
        "必须尊重真实历史进程，不夸大用户对宏观历史的影响。",
        "只返回合法 JSON，不要 Markdown。",
        "JSON 格式：",
        '{"summary":"生平纪要","timeline":[{"time":"年月","event":"事件"}],"historical_check":"史实一致性说明","next_threads":["后续线索"]}'
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({
        player: {
          username: user.username,
          current_time: timelineLabel(user),
          identity: user.identity,
          money: `${user.money || 0}${user.moneyUnit || "文"}`,
          attributes: pickAttributes(user)
        },
        messages,
        tasks,
        attribute_logs: logs,
        money_logs: moneyLogs,
        true_present_limit: currentChinaTimeLimit()
      })
    }
  ], 1600);

  return {
    summary: String(parsed.summary || "暂无纪要。").slice(0, 2000),
    timeline: Array.isArray(parsed.timeline) ? parsed.timeline.slice(0, 12) : [],
    historicalCheck: String(parsed.historical_check || "").slice(0, 1000),
    nextThreads: Array.isArray(parsed.next_threads) ? parsed.next_threads.slice(0, 6).map(String) : []
  };
}

async function generateDeepSeekNovel(db, user) {
  const history = await generateDeepSeekHistorySummary(db, user);
  const journeyId = currentJourneyId(db, user);
  const messages = db.chatHistory
    .filter((message) => belongsToJourney(message, user, journeyId))
    .slice(-40)
    .map((message) => ({
      role: message.role,
      content: compactText(message.content, 800),
      time: message.timeLabel || message.createdAt
    }));
  const tasks = db.tasks
    .filter((task) => belongsToJourney(task, user, journeyId))
    .slice(-18)
    .map((task) => ({
      title: task.title,
      description: task.description,
      status: task.status,
      time: `${task.year} 年 ${task.month || 1} 月 ${task.day || 1} 日`,
      context: compactText(task.historicalContext, 360),
      options: task.options
    }));
  const logs = db.attributeLogs
    .filter((log) => belongsToJourney(log, user, journeyId))
    .slice(-24);
  const moneyLogs = (db.moneyLogs || [])
    .filter((log) => belongsToJourney(log, user, journeyId))
    .slice(-30);

  const parsed = await callDeepSeekJson(user, [
    {
      role: "system",
      content: [
        "你是历史小说策划与主笔。请根据玩家的历史数据、人物身份、选择轨迹、属性变化和历史走势，总结并设计一本小说。",
        "只能使用当前玩家这一条旅程的数据。小说时间线必须按年月因果推进，历史节点不能乱序，不能把不同旅程混写为同一人生，除非明确写成时空重置或回忆。",
        "必须以真实历史进程为骨架，人物只能影响个人命运和局部关系，不能夸大为改写宏观历史。",
        "小说要有文采，但不要堆砌辞藻；用具体场景、动作、物价、债务、收入、人物关系和时代气息支撑情绪。",
        "正文要完整覆盖这一段旅程的起点、转折、财务变化、关系变化、历史压力和阶段性结局；字数饱满但不冗余，不要流水账，不要空泛总结。",
        "钱数、负债、日耗、月入、经营收入必须按保存数据与资金流水书写，不能随机添钱、漏债或把经营收入写错。",
        "输出 3 到 6 个正文章节，每章 body 约 500 到 900 字；若旅程较短，可以少写但要有完整起承转合。",
        "只返回合法 JSON，不要 Markdown。",
        "JSON 格式：",
        '{"title":"书名","tagline":"一句话卖点","genre":"类型","premise":"故事简介","prologue":"序章，120到260字","protagonist":{"name":"主角名","identity":"身份","arc":"人物弧光"},"historical_spine":["历史走势节点"],"characters":[{"name":"人物","role":"作用","relationship":"与主角关系"}],"volume_outline":[{"chapter":1,"title":"章节名","summary":"章节梗概"}],"chapters":[{"chapter":1,"title":"章节名","body":"正文"}],"opening_chapter":"第一章正文开篇，约800到1200字","epilogue":"尾声，120到300字","historical_note":"史实处理说明"}'
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({
        player: {
          username: user.username,
          current_time: timelineLabel(user),
          identity: user.identity,
          money: `${user.money || 0}${user.moneyUnit || "文"}`,
          attributes: pickAttributes(user)
        },
        history,
        messages,
        tasks,
        attribute_logs: logs,
        money_logs: moneyLogs,
        true_present_limit: currentChinaTimeLimit()
      })
    }
  ], 3000);

  return {
    title: String(parsed.title || "未命名时空小说").slice(0, 80),
    tagline: String(parsed.tagline || "").slice(0, 200),
    genre: String(parsed.genre || "历史穿越").slice(0, 80),
    premise: String(parsed.premise || "").slice(0, 1200),
    prologue: String(parsed.prologue || "").slice(0, 2000),
    protagonist: parsed.protagonist && typeof parsed.protagonist === "object"
      ? {
          name: String(parsed.protagonist.name || user.username || "无名旅人").slice(0, 40),
          identity: String(parsed.protagonist.identity || user.identity).slice(0, 120),
          arc: String(parsed.protagonist.arc || "").slice(0, 800)
        }
      : { name: user.username || "无名旅人", identity: user.identity, arc: "" },
    historicalSpine: Array.isArray(parsed.historical_spine) ? parsed.historical_spine.slice(0, 10).map(String) : [],
    characters: Array.isArray(parsed.characters) ? parsed.characters.slice(0, 10) : [],
    volumeOutline: Array.isArray(parsed.volume_outline) ? parsed.volume_outline.slice(0, 20) : [],
    chapters: Array.isArray(parsed.chapters)
      ? parsed.chapters.slice(0, 8).map((item, index) => ({
          chapter: Number(item.chapter || index + 1),
          title: String(item.title || `第${index + 1}章`).slice(0, 80),
          body: String(item.body || item.text || "").slice(0, 6000)
        }))
      : [],
    openingChapter: String(parsed.opening_chapter || "").slice(0, 6000),
    epilogue: String(parsed.epilogue || "").slice(0, 2000),
    historicalNote: String(parsed.historical_note || "").slice(0, 1200)
  };
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendTextDownload(res, filename, content) {
  const body = String(content || "");
  const encoded = encodeURIComponent(filename);
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Disposition": `attachment; filename*=UTF-8''${encoded}`,
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("请求内容过大"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("JSON 格式不正确"));
      }
    });
    req.on("error", reject);
  });
}

async function sendStatic(req, res, pathname) {
  const safePath = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const candidate = path.join(publicDir, safePath === "/" ? "index.html" : safePath);
  const resolved = path.resolve(candidate);
  const publicRoot = path.resolve(publicDir);
  if (!resolved.startsWith(publicRoot)) {
    sendJson(res, 403, { error: "访问被拒绝" });
    return;
  }

  try {
    const stat = await fs.stat(resolved);
    const file = stat.isDirectory() ? path.join(resolved, "index.html") : resolved;
    const ext = path.extname(file).toLowerCase();
    const type = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml"
    }[ext] || "application/octet-stream";
    const content = await fs.readFile(file);
    res.writeHead(200, { "Content-Type": type, "Content-Length": content.length });
    res.end(content);
  } catch {
    const index = await fs.readFile(path.join(publicDir, "index.html"));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": index.length });
    res.end(index);
  }
}

async function handleApi(req, res, pathname, searchParams) {
  if (req.method === "GET" && pathname === "/api/health") {
    return sendJson(res, 200, { ok: true, app: "time-travel-app" });
  }

  const db = await readDb();
  const body = req.method === "POST" ? await readBody(req) : {};

  if (req.method === "GET" && pathname === "/api/config/status") {
    const user = requireUser(db, req);
    return sendJson(res, 200, {
      ...publicAiConfig(user),
      presentLimit: currentChinaTimeLimit()
    });
  }

  if (req.method === "GET" && pathname === "/api/user/deepseek-config") {
    const user = requireUser(db, req);
    return sendJson(res, 200, {
      config: {
        ...publicAiConfig(user),
        model: normalizeAiConfig(user.aiConfig).model,
        baseUrl: normalizeAiConfig(user.aiConfig).baseUrl
      }
    });
  }

  if (req.method === "POST" && pathname === "/api/user/deepseek-config") {
    const user = requireUser(db, req);
    const current = normalizeAiConfig(user.aiConfig || {});
    const apiKeyInput = String(body.apiKey || "").trim();
    user.aiConfig = normalizeAiConfig({
      apiKey: apiKeyInput || current.apiKey,
      baseUrl: body.baseUrl || current.baseUrl,
      model: body.model || current.model
    });
    if (body.clearApiKey) user.aiConfig.apiKey = "";
    user.lastActive = new Date().toISOString();
    await writeDb(db);
    return sendJson(res, 200, { config: publicAiConfig(user), user: decorateUser(db, user) });
  }

  if (req.method === "POST" && pathname === "/api/user/deepseek-config/test") {
    const user = requireUser(db, req);
    const current = normalizeAiConfig(user.aiConfig || {});
    const testConfig = normalizeAiConfig({
      apiKey: String(body.apiKey || "").trim() || current.apiKey,
      baseUrl: body.baseUrl || current.baseUrl,
      model: body.model || current.model
    });
    try {
      await testDeepSeekConfig(testConfig);
      return sendJson(res, 200, { ok: true, message: "DeepSeek 连接测试通过。" });
    } catch (error) {
      return sendJson(res, 502, { error: error.message });
    }
  }

  if (req.method === "POST" && pathname === "/api/auth/register") {
    const username = String(body.username || "").trim();
    const password = String(body.password || "").trim();
    if (!username || !password) return sendJson(res, 400, { error: "请输入昵称和密码" });
    if (db.users.some((user) => user.username === username)) return sendJson(res, 409, { error: "昵称已存在" });

    const user = {
      ...defaultUser,
      id: crypto.randomUUID(),
      username,
      passwordHash: hashPassword(password),
      identity: "等待时空校准",
      currentJourneyId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString()
    };
    const journey = createJourneyRecord(user, {
      id: user.currentJourneyId,
      title: "待开启的第一段旅程",
      summary: "选择年月并填写角色信息后，这里会保存这一段人生的回忆。"
    });
    db.users.push(user);
    if (!Array.isArray(db.journeys)) db.journeys = [];
    db.journeys.push(journey);
    db.chatHistory.push({
      id: crypto.randomUUID(),
      userId: user.id,
      journeyId: journey.id,
      role: "assistant",
      content: "注册成功。请选择目标年月，开始你的第一段旅程。",
      timeLabel: timelineLabel(user),
      attributeSnapshot: pickAttributes(user),
      createdAt: new Date().toISOString()
    });
    const token = createSession(db, user);
    await writeDb(db);
      return sendJson(res, 200, { token, user: decorateUser(db, user) });
  }

  if (req.method === "POST" && pathname === "/api/auth/login") {
    const user = db.users.find((item) => item.username === body.username && verifyPassword(item, body.password));
    if (!user) return sendJson(res, 401, { error: "账号或密码不正确" });
    if (user.status === "banned") return sendJson(res, 403, { error: "账号已被封禁" });
    user.lastActive = new Date().toISOString();
    currentJourneyId(db, user);
    const token = createSession(db, user);
    await writeDb(db);
    return sendJson(res, 200, { token, user: decorateUser(db, user) });
  }

  if (req.method === "GET" && pathname === "/api/user/profile") {
    const user = requireUser(db, req);
    return sendJson(res, 200, { user: decorateUser(db, user) });
  }

  if (req.method === "GET" && pathname === "/api/game/state") {
    const user = requireUser(db, req);
    const journeyId = currentJourneyId(db, user);
    return sendJson(res, 200, {
      user: decorateUser(db, user),
      journey: summarizeJourney(db, user, getCurrentJourney(db, user)),
      messages: userJourneyItems(db.chatHistory, user, journeyId).slice(-30),
      tasks: userJourneyItems(db.tasks, user, journeyId).filter((task) => task.status === "pending"),
      characters: userJourneyItems(db.characters, user, journeyId)
    });
  }

  if (req.method === "GET" && pathname === "/api/game/journeys") {
    const user = requireUser(db, req);
    const activeJourneyId = currentJourneyId(db, user);
    const journeys = (db.journeys || [])
      .filter((journey) => journey.userId === user.id)
      .map((journey) => summarizeJourney(db, user, journey))
      .sort((a, b) => {
        if (a.id === activeJourneyId && b.id !== activeJourneyId) return -1;
        if (b.id === activeJourneyId && a.id !== activeJourneyId) return 1;
        return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
      });
    return sendJson(res, 200, { journeys });
  }

  const journeySwitchMatch = pathname.match(/^\/api\/game\/journeys\/([^/]+)\/switch$/);
  if (req.method === "POST" && journeySwitchMatch) {
    const user = requireUser(db, req);
    const journey = (db.journeys || []).find((item) => item.id === journeySwitchMatch[1] && item.userId === user.id);
    if (!journey) return sendJson(res, 404, { error: "回忆不存在" });
    const nowIso = new Date().toISOString();
    user.currentJourneyId = journey.id;
    applyJourneySnapshot(user, journey.snapshot || {});
    user.currentJourneyId = journey.id;
    user.lastActive = nowIso;
    journey.updatedAt = nowIso;
    await writeDb(db);
    const journeyId = currentJourneyId(db, user);
    return sendJson(res, 200, {
      user: decorateUser(db, user),
      journey: summarizeJourney(db, user, journey),
      messages: userJourneyItems(db.chatHistory, user, journeyId).slice(-30),
      tasks: userJourneyItems(db.tasks, user, journeyId).filter((task) => task.status === "pending"),
      characters: userJourneyItems(db.characters, user, journeyId)
    });
  }

  if (req.method === "GET" && pathname === "/api/game/history") {
    const user = requireUser(db, req);
    try {
      return sendJson(res, 200, { history: await generateDeepSeekHistorySummary(db, user) });
    } catch (error) {
      return sendJson(res, 502, { error: error.message });
    }
  }

  if (req.method === "GET" && pathname === "/api/game/novels") {
    const user = requireUser(db, req);
    const journeyId = currentJourneyId(db, user);
    const novels = (db.novels || [])
      .filter((novel) => belongsToJourney(novel, user, journeyId))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((novel) => ({
        id: novel.id,
        journeyId: novel.journeyId || journeyId,
        title: novel.title,
        createdAt: novel.createdAt,
        premise: novel.payload?.premise || "",
        genre: novel.payload?.genre || "历史穿越"
      }));
    return sendJson(res, 200, { novels });
  }

  if (req.method === "POST" && pathname === "/api/game/novel") {
    const user = requireUser(db, req);
    const journeyId = currentJourneyId(db, user);
    try {
      const novel = await generateDeepSeekNovel(db, user);
      const record = {
        id: crypto.randomUUID(),
        userId: user.id,
        journeyId,
        title: novel.title,
        payload: novel,
        txtContent: novelToText(novel),
        createdAt: new Date().toISOString()
      };
      if (!Array.isArray(db.novels)) db.novels = [];
      db.novels.push(record);
      await writeDb(db);
      return sendJson(res, 200, {
        novel,
        record: {
          id: record.id,
          title: record.title,
          createdAt: record.createdAt,
          downloadUrl: `/api/game/novels/${record.id}/download`
        }
      });
    } catch (error) {
      return sendJson(res, 502, { error: error.message });
    }
  }

  const novelDetailMatch = pathname.match(/^\/api\/game\/novels\/([^/]+)$/);
  if (req.method === "GET" && novelDetailMatch) {
    const user = requireUser(db, req);
    const record = (db.novels || []).find((novel) => novel.id === novelDetailMatch[1] && novel.userId === user.id);
    if (!record) return sendJson(res, 404, { error: "小说不存在" });
    return sendJson(res, 200, {
      novel: record.payload,
      record: {
        id: record.id,
        title: record.title,
        createdAt: record.createdAt,
        downloadUrl: `/api/game/novels/${record.id}/download`
      }
    });
  }

  const novelDownloadMatch = pathname.match(/^\/api\/game\/novels\/([^/]+)\/download$/);
  if (req.method === "GET" && novelDownloadMatch) {
    const user = requireUser(db, req);
    const record = (db.novels || []).find((novel) => novel.id === novelDownloadMatch[1] && novel.userId === user.id);
    if (!record) return sendJson(res, 404, { error: "小说不存在" });
    return sendTextDownload(res, `${safeDownloadName(record.title)}.txt`, record.txtContent || novelToText(record.payload));
  }

  const novelDeleteMatch = pathname.match(/^\/api\/game\/novels\/([^/]+)$/);
  if (req.method === "DELETE" && novelDeleteMatch) {
    const user = requireUser(db, req);
    const before = (db.novels || []).length;
    db.novels = (db.novels || []).filter((novel) => !(novel.id === novelDeleteMatch[1] && novel.userId === user.id));
    if (db.novels.length === before) return sendJson(res, 404, { error: "小说不存在" });
    await writeDb(db);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "POST" && pathname === "/api/game/reset") {
    const user = requireUser(db, req);
    const year = Number(body.year || 755);
    const month = Number(body.month || 1);
    const roleProfile = sanitizeRoleProfile(body.roleProfile || body.profile || {});
    const present = currentChinaTimeLimit();
    if (!Number.isFinite(year) || !Number.isFinite(month) || year < -1000 || month < 1 || month > 12) {
      return sendJson(res, 400, { error: "请选择有效的年月" });
    }
    if (compareTimeline(year, month, 1, present.year, present.month, present.day) > 0) {
      return sendJson(res, 400, { error: `不能超过当前真实时间：${present.year} 年 ${present.month} 月 ${present.day} 日` });
    }

    let opening;
    try {
      opening = await generateDeepSeekOpening(user, year, Math.trunc(month), roleProfile);
    } catch (error) {
      return sendJson(res, 502, { error: error.message });
    }

    const journeyId = crypto.randomUUID();
    Object.assign(user, {
      currentYear: year,
      currentMonth: Math.trunc(month),
      currentDay: 1,
      identity: opening.identity,
      journeyStarted: true,
      currentJourneyId: journeyId,
      money: opening.money,
      debt: 0,
      moneyUnit: opening.moneyUnit,
      roleProfile,
      dailyExpense: opening.dailyExpense,
      jobIncome: opening.jobIncome,
      businessIncome: opening.businessIncome,
      noMoneyDays: 0,
      survivalStatus: "alive",
      wealth: 50,
      health: 80,
      prestige: 10,
      knowledge: 20,
      relationship: 30,
      lastActive: new Date().toISOString()
    });
    const journey = createJourneyRecord(user, {
      id: journeyId,
      title: makeJourneyTitle(user, year, Math.trunc(month), 1),
      summary: `${formatJourneyTime(year, Math.trunc(month), 1)} 开启的新时空。`
    });
    if (!Array.isArray(db.journeys)) db.journeys = [];
    db.journeys.push(journey);
    const task = opening.task;
    task.userId = user.id;
    task.journeyId = journeyId;
    task.year = user.currentYear;
    task.month = user.currentMonth;
    task.day = user.currentDay;
    db.tasks.push(task);
    db.moneyLogs.push({
      id: crypto.randomUUID(),
      userId: user.id,
      journeyId,
      change: 0,
      balance: user.money,
      debtChange: 0,
      debtBalance: user.debt,
      income: 0,
      expense: 0,
      elapsedDays: 0,
      isInitial: true,
      unit: user.moneyUnit || "文",
      reason: "重置时空初始资金",
      timeLabel: timelineLabel(user),
      createdAt: new Date().toISOString()
    });
    const resetMessage = {
      id: crypto.randomUUID(),
      userId: user.id,
      journeyId,
      role: "assistant",
      content: `${timelineLabel(user)}，${opening.openingMessage || opening.scene}\n\n你也可以先用一句话补充当下情况，例如：我身上有120文，住在东市边，欠了邻居一斗米。系统会记住这些初始信息。\n\n时空已重置。命运之书递来新的第一道选择：“${task.title}”。${task.description}`,
      taskId: task.id,
      timeLabel: timelineLabel(user),
      attributeSnapshot: pickAttributes(user),
      createdAt: new Date().toISOString()
    };
    db.chatHistory.push(resetMessage);
    await writeDb(db);
    return sendJson(res, 200, {
      user: decorateUser(db, user),
      journey: summarizeJourney(db, user, journey),
      message: resetMessage,
      task,
      characters: []
    });
  }

  if (req.method === "POST" && pathname === "/api/game/start") {
    const user = requireUser(db, req);
    const year = Number(body.year);
    const month = Number(body.month || 1);
    const roleProfile = sanitizeRoleProfile(body.roleProfile || body.profile || {});
    const present = currentChinaTimeLimit();
    if (!Number.isFinite(year) || !Number.isFinite(month) || year < -1000 || month < 1 || month > 12) {
      return sendJson(res, 400, { error: "请选择有效的年月" });
    }
    if (compareTimeline(year, month, 1, present.year, present.month, present.day) > 0) {
      return sendJson(res, 400, { error: `不能超过当前真实时间：${present.year} 年 ${present.month} 月 ${present.day} 日` });
    }

    let opening;
    try {
      opening = await generateDeepSeekOpening(user, year, Math.trunc(month), roleProfile);
    } catch (error) {
      return sendJson(res, 502, { error: error.message });
    }

    const isFreshJourney = !user.journeyStarted;
    const journeyId = currentJourneyId(db, user);
    const nextUserState = {
      currentYear: year,
      currentMonth: Math.trunc(month),
      currentDay: 1,
      identity: isFreshJourney ? opening.identity : user.identity,
      money: isFreshJourney ? opening.money : user.money,
      debt: isFreshJourney ? 0 : user.debt,
      moneyUnit: isFreshJourney ? opening.moneyUnit : user.moneyUnit,
      roleProfile: isFreshJourney ? roleProfile : (Object.keys(roleProfile).some((key) => roleProfile[key]) ? roleProfile : user.roleProfile),
      dailyExpense: isFreshJourney ? opening.dailyExpense : user.dailyExpense,
      jobIncome: isFreshJourney ? opening.jobIncome : user.jobIncome,
      businessIncome: isFreshJourney ? opening.businessIncome : user.businessIncome,
      noMoneyDays: isFreshJourney ? 0 : user.noMoneyDays,
      survivalStatus: isFreshJourney ? "alive" : user.survivalStatus,
      wealth: isFreshJourney ? 50 : user.wealth,
      health: isFreshJourney ? 80 : user.health,
      prestige: isFreshJourney ? 10 : user.prestige,
      knowledge: isFreshJourney ? 20 : user.knowledge,
      relationship: isFreshJourney ? 30 : user.relationship,
      journeyStarted: true,
      lastActive: new Date().toISOString()
    };
    Object.assign(user, nextUserState);
    const journey = getCurrentJourney(db, user);
    if (isFreshJourney) {
      journey.title = makeJourneyTitle(user, year, Math.trunc(month), 1);
      journey.summary = `${formatJourneyTime(year, Math.trunc(month), 1)} 开启的第一段旅程。`;
      journey.startYear = year;
      journey.startMonth = Math.trunc(month);
      journey.startDay = 1;
    }
    if (isFreshJourney) {
      db.moneyLogs.push({
        id: crypto.randomUUID(),
        userId: user.id,
        journeyId,
        change: 0,
        balance: user.money,
        debtChange: 0,
        debtBalance: user.debt,
        income: 0,
        expense: 0,
        elapsedDays: 0,
        isInitial: true,
        unit: user.moneyUnit || "文",
        reason: "新旅程初始资金",
        timeLabel: timelineLabel(user),
        createdAt: new Date().toISOString()
      });
    }

    db.tasks = db.tasks.filter((task) => !belongsToJourney(task, user, journeyId) || task.status !== "pending");
    const task = opening.task;
    task.userId = user.id;
    task.journeyId = journeyId;
    task.year = user.currentYear;
    task.month = user.currentMonth;
    task.day = user.currentDay;
    db.tasks.push(task);

    const welcome = {
      id: crypto.randomUUID(),
      userId: user.id,
      journeyId,
      role: "assistant",
      content: `${timelineLabel(user)}，${opening.openingMessage || opening.scene}\n\n你可以先简单说明当下情况，例如：我身上有120文，住在东市边，欠了邻居一斗米。系统会记住这些初始信息，再按它继续推演。\n\n命运之书递来第一道选择：“${task.title}”。${task.description}`,
      taskId: task.id,
      timeLabel: timelineLabel(user),
      attributeSnapshot: pickAttributes(user),
      createdAt: new Date().toISOString()
    };
    db.chatHistory.push(welcome);
    await writeDb(db);
    return sendJson(res, 200, {
      user: decorateUser(db, user),
      journey: summarizeJourney(db, user, journey),
      message: welcome,
      task,
      characters: userJourneyItems(db.characters, user, journeyId)
    });
  }

  if (req.method === "POST" && pathname === "/api/game/chat") {
    const user = requireUser(db, req);
    const journeyId = currentJourneyId(db, user);
    const message = String(body.message || "").trim();
    if (!message) return sendJson(res, 400, { error: "请输入要说的话" });
    if (user.status === "banned") return sendJson(res, 403, { error: "账号已被封禁，不能继续对话" });
    if (user.survivalStatus === "dead") return sendJson(res, 403, { error: "本段人生已结束，请重置时空后继续。" });

    const pendingTask = db.tasks.find((task) => belongsToJourney(task, user, journeyId) && task.status === "pending");
    const userMessage = {
      id: crypto.randomUUID(),
      userId: user.id,
      journeyId,
      role: "user",
      content: message,
      timeLabel: timelineLabel(user),
      attributeSnapshot: pickAttributes(user),
      createdAt: new Date().toISOString()
    };
    db.chatHistory.push(userMessage);

    const selectedOption = pendingTask?.options.find((option) => message.includes(option.text));
    const selectedDurationDays = selectedOption
      ? estimateTaskOptionDurationDays(selectedOption, pendingTask)
      : 0;
    const selectedTimeAdvance = selectedOption
      ? advanceUserByDays(user, selectedDurationDays)
      : null;
    let modelTurn;
    try {
      modelTurn = await generateDeepSeekTurn(db, user, message, pendingTask, selectedOption);
    } catch (error) {
      db.chatHistory.pop();
      await writeDb(db);
      return sendJson(res, 502, { error: error.message });
    }

    const { reply } = modelTurn;
    const selectedChanges = selectedOption ? normalizeChanges(selectedOption.effect) : null;
    const changes = selectedChanges && Object.values(selectedChanges).some((value) => value !== 0)
      ? selectedChanges
      : modelTurn.changes;
    const beforeAttributes = userAttributeState(user);
    applyChanges(user, changes);
    const selectedMoney = selectedOption ? normalizeMoneyChange(selectedOption.effect?.money) : 0;
    const modelMoney = normalizeMoneyChange(modelTurn.moneyChange);
    const localMoney = parseLocalMoneyChangeFromMessage(message);
    const moneyChange = selectedMoney || localMoney?.amount || modelMoney;
    const selectedDebt = selectedOption ? normalizeDebtChange(selectedOption.effect?.debt) : 0;
    const modelDebt = normalizeDebtChange(modelTurn.debtChange);
    const debtChange = selectedDebt || modelDebt;
    const userTimeAdvance = selectedTimeAdvance || parseUserTimeAdvance(message, user);
    const localEconomyUpdate = parseLocalEconomyUpdateFromMessage(message);
    const modelEconomyUpdate = shouldTrustModelEconomyUpdate(message) ? modelTurn.economyUpdate : {};
    const economyChanges = applyEconomyUpdate(user, { ...modelEconomyUpdate, ...localEconomyUpdate });
    const localStateUpdate = parseStateUpdateFromMessage(message);
    const modelStateUpdate = hasExplicitCashCalibration(message)
      ? modelTurn.stateUpdate
      : { ...modelTurn.stateUpdate, cash: undefined };
    const stateChanges = applyStateUpdate(db, user, { ...modelStateUpdate, ...localStateUpdate });
    if (stateChanges.length) {
      db.attributeLogs.push({
        id: crypto.randomUUID(),
        userId: user.id,
        journeyId,
        change: { before: beforeAttributes, delta: { state: stateChanges }, after: userAttributeState(user) },
        reason: "初始情况校准",
        timeLabel: timelineLabel(user),
        createdAt: new Date().toISOString()
      });
    }
    if (economyChanges.length) {
      db.attributeLogs.push({
        id: crypto.randomUUID(),
        userId: user.id,
        journeyId,
        change: { before: beforeAttributes, delta: { economy: economyChanges }, after: userAttributeState(user) },
        reason: "生计参数校准",
        timeLabel: timelineLabel(user),
        createdAt: new Date().toISOString()
      });
    }
    const previousYear = user.currentYear;
    const previousMonth = user.currentMonth || 1;
    const previousDay = user.currentDay || 1;
    const nextTime = userTimeAdvance || { year: previousYear, month: previousMonth, day: previousDay, days: 0 };
    user.currentYear = nextTime.year;
    user.currentMonth = nextTime.month;
    user.currentDay = nextTime.day || previousDay;
    user.lastActive = new Date().toISOString();
    applyMoneyChange(
      db,
      user,
      moneyChange,
      debtChange,
      selectedOption ? `任务选择：${selectedOption.text}` : (localMoney?.reason || "自由行动"),
      localMoney ? { income: localMoney.income, expense: localMoney.expense } : {}
    );
    const livingSettlement = applyLivingSettlement(
      db,
      user,
      Number(nextTime.days || 0),
      "日常生计"
    );
    applyCharacterUpdates(db, user, modelTurn.characterUpdates);

    if (pendingTask && (selectedOption || modelTurn.completeCurrentTask)) {
      pendingTask.status = "completed";
      db.attributeLogs.push({
        id: crypto.randomUUID(),
        userId: user.id,
        journeyId,
        change: { before: beforeAttributes, delta: changes, after: userAttributeState(user) },
        reason: `完成任务：${pendingTask.title}`,
        timeLabel: timelineLabel(user),
        createdAt: new Date().toISOString()
      });
    } else if (Object.values(changes).some((value) => value !== 0)) {
      db.attributeLogs.push({
        id: crypto.randomUUID(),
        userId: user.id,
        journeyId,
        change: { before: beforeAttributes, delta: changes, after: userAttributeState(user) },
        reason: "自由行动",
        timeLabel: timelineLabel(user),
        createdAt: new Date().toISOString()
      });
    }

    const settlementNote = livingSettlement.days
      ? `\n\n【生计结算】经过 ${livingSettlement.days} 天，日常消耗 ${livingSettlement.expense}${user.moneyUnit || ""}，工作/经营收入 ${livingSettlement.income}${user.moneyUnit || ""}，净变化 ${livingSettlement.net >= 0 ? "+" : ""}${livingSettlement.net}${user.moneyUnit || ""}。`
      : "";
    const economyNote = economyChanges.length ? `\n\n【生计参数已更新】${economyChanges.join("；")}。之后时间推进会按新数值结算。` : "";
    const stateNote = stateChanges.length ? `\n\n【初始情况已更新】${stateChanges.join("；")}。之后剧情会按这些保存信息继续推演。` : "";
    const timeAdvanceReason = selectedOption
      ? `完成该任务耗时 ${durationLabel(userTimeAdvance?.days || selectedDurationDays)}`
      : `按你的描述推进了 ${userTimeAdvance?.days || 0} 天`;
    const timeNote = userTimeAdvance
      ? `\n\n【时间推进】${timeAdvanceReason}，当前时间为 ${timelineLabel(user)}。`
      : "\n\n【时间未推进】你没有明确说明过去多久，当前时间保持不变。";
    const survivalNote = livingSettlement.warning ? `\n\n【生计提醒】${livingSettlement.warning}` : "";
    const assistantMessage = {
      id: crypto.randomUUID(),
      userId: user.id,
      journeyId,
      role: "assistant",
      content: `${reply}${stateNote}${economyNote}${timeNote}${settlementNote}${survivalNote}`,
      taskId: pendingTask?.id,
      timeLabel: timelineLabel(user),
      attributeSnapshot: pickAttributes(user),
      createdAt: new Date().toISOString()
    };
    db.chatHistory.push(assistantMessage);

    const nextTask = modelTurn.nextTask;
    if (nextTask) {
      nextTask.journeyId = journeyId;
      db.tasks.push(nextTask);
    }

    const journey = getCurrentJourney(db, user);
    journey.summary = compactText(assistantMessage.content, 240);

    await writeDb(db);
    return sendJson(res, 200, {
      user: decorateUser(db, user),
      journey: summarizeJourney(db, user, journey),
      messages: [userMessage, assistantMessage],
      task: nextTask,
      characters: userJourneyItems(db.characters, user, journeyId)
    });
  }

  if (req.method === "GET" && pathname === "/api/admin/stats") {
    const activeUsers = db.users.filter((user) => user.status === "active").length;
    const bannedUsers = db.users.filter((user) => user.status === "banned").length;
    const yearCounts = db.users.reduce((acc, user) => {
      acc[user.currentYear] = (acc[user.currentYear] || 0) + 1;
      return acc;
    }, {});
    const popularYears = Object.entries(yearCounts)
      .map(([year, count]) => ({ year: Number(year), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return sendJson(res, 200, {
      activeUsers,
      bannedUsers,
      conversations: db.chatHistory.length,
      tasks: db.tasks.length,
      popularYears,
      topEarners: db.users
        .map((user) => decorateUser(db, user))
        .sort((a, b) => Number(b.moneyStats?.earningRate || 0) - Number(a.moneyStats?.earningRate || 0))
        .slice(0, 10)
    });
  }

  if (req.method === "GET" && pathname === "/api/admin/users") {
    const status = searchParams.get("status");
    const users = db.users
      .filter((user) => !status || status === "all" || user.status === status)
      .map((user) => decorateUser(db, user))
      .sort((a, b) => Number(b.moneyStats?.earningRate || 0) - Number(a.moneyStats?.earningRate || 0));
    return sendJson(res, 200, { users });
  }

  const detailMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (req.method === "GET" && detailMatch) {
    const user = db.users.find((item) => item.id === detailMatch[1]);
    if (!user) return sendJson(res, 404, { error: "用户不存在" });
    let modelHistory = null;
    let modelHistoryError = null;
    try {
      modelHistory = await generateDeepSeekHistorySummary(db, user);
    } catch (error) {
      modelHistoryError = error.message;
    }
    return sendJson(res, 200, {
      user: decorateUser(db, user),
      journeys: (db.journeys || []).filter((journey) => journey.userId === user.id).map((journey) => summarizeJourney(db, user, journey)),
      messages: userJourneyItems(db.chatHistory, user, user.currentJourneyId).slice(-80),
      logs: userJourneyItems(db.attributeLogs, user, user.currentJourneyId).slice(-80),
      moneyLogs: userJourneyItems(db.moneyLogs, user, user.currentJourneyId).slice(-80),
      characters: userJourneyItems(db.characters, user, user.currentJourneyId),
      tasks: userJourneyItems(db.tasks, user, user.currentJourneyId),
      modelHistory,
      modelHistoryError
    });
  }

  const statusMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/status$/);
  if (req.method === "POST" && statusMatch) {
    requireAdmin(db, req);
    const user = db.users.find((item) => item.id === statusMatch[1]);
    if (!user) return sendJson(res, 404, { error: "用户不存在" });
    if (isAdmin(user) && body.status === "banned") return sendJson(res, 400, { error: "不能禁用管理员账号" });
    user.status = body.status === "banned" ? "banned" : "active";
    await writeDb(db);
    return sendJson(res, 200, { user: decorateUser(db, user) });
  }

  return sendJson(res, 404, { error: "接口不存在" });
}

createServer(async (req, res) => {
  try {
    const currentUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (currentUrl.pathname.startsWith("/api/")) {
      await handleApi(req, res, currentUrl.pathname, currentUrl.searchParams);
      return;
    }
    await sendStatic(req, res, currentUrl.pathname);
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: error.message || "服务器错误" });
  }
}).listen(port, () => {
  console.log(`Time Travel app is running at http://localhost:${port}`);
});
