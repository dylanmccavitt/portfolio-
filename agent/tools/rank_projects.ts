import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { rankProjects } from '../../src/lib/eve/data-tools';

export default defineTool({
  description: 'Rank portfolio projects for a recruiter intent such as impact, trading, agents, or shipped work.',
  inputSchema: z.object({
    intent: z.string().optional(),
    ids: z.array(z.string()).optional(),
    limit: z.number().int().min(1).max(12).optional(),
  }),
  execute(input) {
    return rankProjects(input);
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
