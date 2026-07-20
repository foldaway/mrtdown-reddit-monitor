import { runScheduledDiscovery } from './runtime/scheduled-discovery.js';
export { RedditThreadWorkflow } from './runtime/reddit-thread-workflow.js';

export default {
  async fetch() {
    return new Response(null, { status: 204 });
  },
  async scheduled(_controller, env) {
    await runScheduledDiscovery(env);
  },
} satisfies ExportedHandler<Env>;
