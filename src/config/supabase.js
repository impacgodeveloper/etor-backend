import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import ws from "ws";

dotenv.config();

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase credentials in .env file");
}

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    // Node 20 has no native WebSocket global (that only landed in Node 22),
    // and @supabase/realtime-js requires one to even construct the client
    // — even though this backend never uses realtime subscriptions. Without
    // this, createClient() throws synchronously at import time and crashes
    // the process before it can start listening.
    realtime: {
      transport: ws,
    },
  }
);

export default supabase;