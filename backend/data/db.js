// Optional MongoDB persistence.
//
// When MONGODB_URI is set, store.js and users.js keep serving reads from memory
// (so their exported functions stay synchronous and the routes don't change),
// load their state from MongoDB on boot, and write every change back in the
// background. Without MONGODB_URI nothing here does anything: in-memory only.
import { MongoClient } from "mongodb";

let client = null;
let db = null;

const WRITE_DELAY_MS = 250;
const pending = new Map(); // key -> async (db) => void; latest write per key wins
let timer = null;
let chain = Promise.resolve(); // flushes run one after another, never overlapping

// Use the database named in the URI path, else MONGODB_DB, else "visionshield".
function dbNameFrom(uri) {
  const m = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/.exec(uri);
  return process.env.MONGODB_DB || (m && decodeURIComponent(m[1])) || "visionshield";
}

export async function connectDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.log("[db] MONGODB_URI not set — using in-memory storage");
    return null;
  }
  try {
    client = new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 10_000 });
    await client.connect();
    db = client.db(dbNameFrom(uri));
    await db.collection("users").createIndex({ email: 1 }, { unique: true });
    console.log(`[db] connected to MongoDB (${db.databaseName})`);
  } catch (e) {
    console.error(`[db] MongoDB connection failed — falling back to in-memory storage: ${e.message}`);
    await client?.close().catch(() => {});
    client = db = null;
  }
  return db;
}

export function getDb() {
  return db;
}

/** Queue a background write. Several calls with the same key before the flush collapse into one. */
export function persist(key, write) {
  if (!db) return;
  pending.set(key, write);
  if (!timer) timer = setTimeout(flush, WRITE_DELAY_MS);
}

function flush() {
  timer = null;
  const writes = [...pending.values()];
  pending.clear();
  chain = chain.then(() =>
    Promise.all(writes.map((w) => w(db).catch((e) => console.error("[db] write failed:", e.message))))
  );
  return chain;
}

/** Write anything still queued and disconnect (used on shutdown). */
export async function closeDb() {
  if (!db) return;
  if (timer) clearTimeout(timer);
  await flush();
  await client.close();
  client = db = null;
}
