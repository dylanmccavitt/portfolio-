import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { readResume } from '../../src/lib/eve/data-tools';

export default defineTool({
  description: 'Read Dylan McCavitt resume timeline tracks from canonical resume data.',
  inputSchema: z.object({
    trackIds: z.array(z.string()).optional(),
  }),
  execute(input) {
    return readResume(input);
  },
  toModelOutput(output) {
    return {
      type: 'json',
      value: {
        title: output.title,
        line: output.line,
        trackIds: output.tracks.map((track) => track.id),
        count: output.tracks.length,
      },
    };
  },
});
