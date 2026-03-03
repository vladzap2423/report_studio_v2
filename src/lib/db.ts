import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "scripts", "data.db");

export const db = new Database(dbPath, { readonly: false, verbose: console.log });
