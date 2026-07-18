import type {
  RedditConversation,
  RedditSourceObject,
} from '../contracts/reddit-source.js';
import { computeContentVersion } from '../domain/source-identity.js';

interface ConversationSnapshotRepository {
  storeSourceVersion(
    source: RedditSourceObject,
    contentVersion: string,
    seenAt: string,
  ): Promise<{ inserted: boolean }>;
}

export interface RedditConversationSnapshotResult {
  observedObjectCount: number;
  insertedSourceVersionCount: number;
  repeatedSourceVersionCount: number;
}

/**
 * Persists every object present in one validated conversation snapshot.
 * Absence is deliberately not interpreted as deletion or removal.
 */
export async function storeRedditConversationSnapshot(
  conversation: RedditConversation,
  repository: ConversationSnapshotRepository,
  seenAt: string,
): Promise<RedditConversationSnapshotResult> {
  const result: RedditConversationSnapshotResult = {
    observedObjectCount: conversation.objects.length,
    insertedSourceVersionCount: 0,
    repeatedSourceVersionCount: 0,
  };

  for (const source of conversation.objects) {
    const stored = await repository.storeSourceVersion(
      source,
      await computeContentVersion(source),
      seenAt,
    );
    if (stored.inserted) result.insertedSourceVersionCount += 1;
    else result.repeatedSourceVersionCount += 1;
  }

  return result;
}
