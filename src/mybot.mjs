#!/usr/bin/env node
import dotenv from "dotenv";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: path.join(os.homedir(), ".mybot", ".env") });

const URL = "https://ivxgpjracfctkkdhlwgm.supabase.co";
const KEY = "sb_publishable_LZkkAwsx9q5KgIAeoZAO_A_U88rfFHL";
const EMAIL = process.env.MYBOT_EMAIL;
const PASS = process.env.MYBOT_PASSWORD;

const ROOT = path.join(os.homedir(), ".mybot", "files");
const INDEX_PATH = path.join(os.homedir(), ".mybot", "index.json");
const MAX_BYTES = 500_000;

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function loadIndex() {
  try {
    return JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
  } catch {
    return { files: {} };
  }
}

function saveIndex(idx) {
  ensureDir(path.dirname(INDEX_PATH));
  fs.writeFileSync(INDEX_PATH, JSON.stringify(idx, null, 2));
}

function safeRel(pth) {
  const cleaned = (pth ?? "").replaceAll("\\", "/").replace(/^\/+/, "");
  const parts = cleaned.split("/");
  if (!cleaned || parts.some((s) => s === "." || s === ".." || s.trim() === "")) {
    throw new Error(`Unsafe path: ${pth}`);
  }
  return cleaned;
}

function localFullPath(rel) {
  return path.join(ROOT, safeRel(rel));
}

function readLocal(rel) {
  const full = localFullPath(rel);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, "utf8");
}

function writeLocal(rel, content) {
  const full = localFullPath(rel);
  ensureDir(path.dirname(full));
  fs.writeFileSync(full, content, "utf8");
}

async function signIn(supabase) {
  const { error } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASS });
  if (error) throw error;
}

async function fetchRemoteUpdatedAt(supabase, rel) {
  const relSafe = safeRel(rel);
  const { data, error } = await supabase
    .from("files")
    .select("updated_at")
    .eq("path", relSafe)
    .limit(1);
  if (error) throw error;
  return data?.[0]?.updated_at ?? null;
}

async function fetchRemoteContent(supabase, rel) {
  const relSafe = safeRel(rel);
  const { data, error } = await supabase
    .from("files")
    .select("content, updated_at")
    .eq("path", relSafe)
    .limit(1);
  if (error) throw error;
  return { content: data?.[0]?.content ?? "", updated_at: data?.[0]?.updated_at ?? null };
}

async function getFile(rel) {
  const relSafe = safeRel(rel);
  if (!EMAIL || !PASS) throw new Error("Missing env vars in ~/.mybot/.env (MYBOT_EMAIL, MYBOT_PASSWORD)");
  ensureDir(ROOT);
  const idx = loadIndex();
  const supabase = createClient(URL, KEY);
  await signIn(supabase);

  const local = readLocal(relSafe);
  const cached = idx.files?.[relSafe];

  if (local === null) {
    console.error("MYBOT GET remote-refresh", relSafe);
    const { content, updated_at } = await fetchRemoteContent(supabase, relSafe);
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > MAX_BYTES) throw new Error(`File too large (${bytes} bytes)`);
    writeLocal(relSafe, content);
    idx.files[relSafe] = { updated_at, bytes };
    saveIndex(idx);
    return content;
  }

  const remoteUpdatedAt = await fetchRemoteUpdatedAt(supabase, relSafe);
  if (!remoteUpdatedAt) return local;

  if (cached?.updated_at === remoteUpdatedAt) {
    console.error("MYBOT GET local-hit", relSafe);
    return local;
  }

  console.error("MYBOT GET remote-refresh", relSafe);
  const { content, updated_at } = await fetchRemoteContent(supabase, relSafe);
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_BYTES) throw new Error(`File too large (${bytes} bytes)`);
  writeLocal(relSafe, content);
  idx.files[relSafe] = { updated_at, bytes };
  saveIndex(idx);
  return content;
}

async function putFile(rel, content) {
  const relSafe = safeRel(rel);
  if (!EMAIL || !PASS) throw new Error("Missing env vars in ~/.mybot/.env (MYBOT_EMAIL, MYBOT_PASSWORD)");

  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_BYTES) throw new Error(`File too large (${bytes} bytes)`);

  ensureDir(ROOT);
  const idx = loadIndex();
  const supabase = createClient(URL, KEY);
  await signIn(supabase);

  const { error } = await supabase
    .from("files")
    .upsert({ path: relSafe, content }, { onConflict: "path" });
  if (error) throw error;

  const updated_at = await fetchRemoteUpdatedAt(supabase, relSafe);

  writeLocal(relSafe, content);
  idx.files[relSafe] = { updated_at, bytes };
  saveIndex(idx);

  console.error("MYBOT PUT", relSafe, `bytes=${bytes}`, `updated_at=${updated_at}`);

  return { bytes, updated_at };
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  if (cmd === "get") {
    const rel = args[0];
    if (!rel) {
      console.log("Usage: mybot get <path>");
      process.exit(1);
    }
    const content = await getFile(rel);
    process.stdout.write(content);
    return;
  }

  if (cmd === "put") {
    const rel = args[0];
    if (!rel) {
      console.log("Usage: mybot put <path>");
      process.exit(1);
    }

    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const content = Buffer.concat(chunks).toString("utf8");

    const result = await putFile(rel, content);
    console.log(`PUT ok ${safeRel(rel)} bytes=${result.bytes} updated_at=${result.updated_at}`);
    return;
  }

  console.log("Usage: mybot get <path>");
  console.log("       mybot put <path>");
  process.exit(1);
}

main().catch((e) => {
  console.error("MYBOT:", e?.message ?? e);
  process.exit(1);
});
