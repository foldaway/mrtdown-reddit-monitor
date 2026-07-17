export default {
  async fetch() {
    return new Response(null, { status: 204 });
  },
} satisfies ExportedHandler<Env>;
