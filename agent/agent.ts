import { defineAgent } from 'eve';
import { resolveModelId } from '../src/lib/eve/runtime';

const provider = requiredEnv('EVE_PROVIDER');
const model = requiredEnv('EVE_MODEL');

export default defineAgent({
  model: resolveModelId(provider, model),
});

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required to run Eve. Configure it in the deployment environment.`);
  }
  return value;
}
