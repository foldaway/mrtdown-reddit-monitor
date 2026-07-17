import type { WorkerEntrypoint } from 'cloudflare:workers';

export default {
  async fetch() {
    return new Response(null, { status: 204 });
  },
} satisfies WorkerEntrypoint<Env>;
