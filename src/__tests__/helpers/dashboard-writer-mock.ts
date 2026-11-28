/** Shared supabase `from` fragment for dashboard_writers lookups in route tests. */

export function mockDashboardWritersFrom(
  writerByCategory: Record<string, string | null>,
) {
  return {
    select: () => ({
      eq: (_col: string, category: string) => ({
        maybeSingle: async () => {
          const key = String(category).trim().toLowerCase();
          const agentId = writerByCategory[key];
          if (agentId === undefined || agentId === null) {
            return { data: null, error: null };
          }
          return {
            data: { writer_agent_id: agentId },
            error: null,
          };
        },
      }),
    }),
  };
}
