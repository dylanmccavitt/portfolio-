import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { getContact } from '../../src/lib/eve/data-tools';

export default defineTool({
  description: 'Return Dylan McCavitt contact and next-click routes from canonical resume data.',
  inputSchema: z.object({}),
  execute() {
    return getContact();
  },
  toModelOutput(output) {
    return {
      type: 'json',
      value: {
        location: output.location,
        status: output.status,
        links: output.links.map(([label, href]) => ({ label, href })),
      },
    };
  },
});
