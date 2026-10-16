import bcrypt from "bcryptjs";
import { getDb } from "./db.js";

// User store. Reads are served from memory; when MONGODB_URI is set the list is
// loaded from the "users" collection on boot and new users are written there too.
// The function signatures below are what the rest of the app depends on,
// so you can change the internals without touching auth.js.
const users = []; // { id, email, passwordHash, name }
let nextId = 1;

/** Load users from MongoDB (no-op without MONGODB_URI). Call once on boot. */
export async function initUsers() {
  const db = getDb();
  if (!db) return;
  const docs = await db.collection("users").find({}).toArray();
  users.length = 0;
  for (const { _id, email, passwordHash, name } of docs) users.push({ id: _id, email, passwordHash, name });
  nextId = users.reduce((max, u) => Math.max(max, u.id), 0) + 1;
  console.log(`[db] loaded ${users.length} user(s)`);
}

export async function createUser({ email, password, name }) {
  email = String(email).trim().toLowerCase();
  const exists = users.find((u) => u.email === email);
  if (exists) return null;
  const passwordHash = await bcrypt.hash(password, 10);
  const user = { id: nextId++, email, passwordHash, name };
  users.push(user);

  const db = getDb();
  if (db) {
    try {
      await db.collection("users").insertOne({ _id: user.id, email, passwordHash, name });
    } catch (e) {
      users.splice(users.indexOf(user), 1);
      if (e.code === 11000) return null; // email already in the database
      throw e;
    }
  }
  return user;
}

export function findUserByEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  return users.find((u) => u.email === e);
}

// Without MongoDB, Render's free disk is ephemeral and users vanish on every restart/redeploy.
// Set ADMIN_EMAIL + ADMIN_PASSWORD (+ optional ADMIN_NAME) in Render env vars and
// this account is re-created automatically on every boot.
export async function seedAdmin() {
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return;
  const created = await createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: ADMIN_NAME || "Admin" });
  console.log(created ? `[auth] seeded admin account ${ADMIN_EMAIL}` : "[auth] admin account already exists");
}

export function findUserById(id) {
  return users.find((u) => u.id === id);
}
