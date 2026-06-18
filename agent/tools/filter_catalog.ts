import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { filterCatalog, normalizeProjectArea } from '../../src/lib/eve/data-tools';

export default defineTool({
  description: 'Filter portfolio projects by canonical area, status, work-in-progress flag, real-money flag, or ids.',
  inputSchema: z.object({
    area: z.string().optional(),
    statusKind: z.enum(['dry', 'live', 'wip', 'done']).optional(),
    wip: z.boolean().optional(),
    money: z.boolean().optional(),
    ids: z.array(z.string()).optional(),
    limit: z.number().int().min(1).max(12).optional(),
  }),
  execute(input) {
    const area = normalizeProjectArea(input.area);
    return filterCatalog({ ...input, area });
  },
  toModelOutput(output) {
    return {
      type: 'json',
      value: {
        projectIds: output.projects.map((project) => project.id),
        count: output.projects.length,
      },
    };
  },
});
