/** Shared supabase `from` fragment for dashboard_writers lookups in route tests. */

/**
 * @param writerByCategory map of category → agent id or list of agent ids.
 *   null / missing → no writers (assert → 403).
 */
export function mockDashboardWritersFrom(
  writerByCategory: Record<string, string | string[] | null>,
) {
  return {
    select: () => ({
      eq: (_col: string, category: string) => ({
        eq: (_col2: string, agentId: string) => ({
          maybeSingle: async () => {
            const key = String(category).trim().toLowerCase();
            const writers = writerByCategory[key];
            if (writers === undefined || writers === null) {
              return { data: null, error: null };
            }
            const list = Array.isArray(writers) ? writers : [writers];
            if (!list.includes(agentId)) {
              return { data: null, error: null };
            }
            return {
              data: { agent_id: agentId, category: key },
              error: null,
            };
          },
        }),
      }),
    }),
  };
}

/** Inline dual-eq writer mock that allows a fixed set of agent ids for any category. */
export function mockWritersAllowing(...agentIds: string[]) {
  return {
    select: () => ({
      eq: () => ({
        eq: (_col: string, agentId: string) => ({
          maybeSingle: async () => {
            if (!agentIds.includes(agentId)) {
              return { data: null, error: null };
            }
            return { data: { agent_id: agentId }, error: null };
          },
        }),
      }),
    }),
  };
}
