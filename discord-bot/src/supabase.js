import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";

// service_role client — bypasses Row Level Security, which the bot
// needs because it reads/writes on behalf of users who aren't the ones
// making the request. Because of that, every command that shows one
// person's data to others must do its own privacy check (see
// privacy.js) — RLS won't do it for us here.
export const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
