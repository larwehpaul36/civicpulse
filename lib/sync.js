// The real syncer: the queue plus the live Supabase client.
import * as queue from './offlineQueue.js';
import { createSyncer } from './syncQueue.js';
import { supabase, ensureUser } from './supabase.js';

export { queue };
export const syncer = createSyncer({ supabase, ensureUser, queue });
