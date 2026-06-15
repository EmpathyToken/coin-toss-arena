import fs from "fs";
import pg from "pg";

const { Client } = pg;

const client = new Client({
  host: "db.lpvlpfmdqnhnfktzbghy.supabase.co",
  port: 5432,
  database: "postgres",
  user: "postgres",
  password: process.env.DB_PASS,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  const sql = fs.readFileSync("supabase/schema.sql", "utf8");
  await client.query(sql);
  console.log("✅ Supabase tables created successfully");
} catch (err) {
  console.error("❌ Failed:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
