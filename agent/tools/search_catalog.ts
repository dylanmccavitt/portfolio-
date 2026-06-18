import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { searchCatalog } from '../../src/lib/eve/data-tools';

export default defineTool({
  description: 'Search Dylan McCavitt portfolio projects by visitor query.',
  inputSchema: z.object({
    query: z.string().min(1),
    limit: z.number().int().min(1).max(12).optional(),
  }),
  execute(input) {
    return searchCatalog(input);
  },
  toModelOutput(output) {
    return {
      type: 'json',
      value: {
        query: output.query,
        projectIds: output.projects.map((project) => project.id),
        count: output.projects.length,
      },
    };
  },
});
