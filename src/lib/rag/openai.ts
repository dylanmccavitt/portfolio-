import OpenAI, { toFile } from 'openai';
import type { RagIndexClient } from './ingestion';

export interface RagOpenAiEnv {
  OPENAI_API_KEY?: string;
  RAG_VECTOR_STORE_ID?: string;
}

export function readRagVectorStoreId(env: RagOpenAiEnv = process.env): string | undefined {
  return env.RAG_VECTOR_STORE_ID?.trim() || undefined;
}

export function createOpenAiRagIndexClient(client: OpenAI = new OpenAI()): RagIndexClient {
  return {
    async uploadFile({ filename, content, idempotencyKey, signal }) {
      const file = await client.files.create({
        file: await toFile(Buffer.from(content, 'utf8'), filename),
        purpose: 'assistants',
      }, { idempotencyKey, signal });
      return { fileId: file.id };
    },
    async createVectorStore({ name, idempotencyKey, signal }) {
      const store = await client.vectorStores.create({ name }, { idempotencyKey, signal });
      return { vectorStoreId: store.id };
    },
    async attachFile({ vectorStoreId, fileId, attributes, idempotencyKey, signal }) {
      await client.vectorStores.files.create(vectorStoreId, { file_id: fileId, attributes }, { idempotencyKey, signal });
    },
    async getFileIndexingStatus({ vectorStoreId, fileId, signal }) {
      const file = await client.vectorStores.files.retrieve(fileId, { vector_store_id: vectorStoreId }, { signal });
      return { status: file.status, errorMessage: file.last_error?.message ?? null };
    },
    async detachFile({ vectorStoreId, fileId, signal }) {
      await client.vectorStores.files.delete(fileId, { vector_store_id: vectorStoreId }, { signal });
    },
    async deleteFile({ fileId, signal }) {
      await client.files.delete(fileId, { signal });
    },
  };
}
