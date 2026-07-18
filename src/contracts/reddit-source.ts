export type RedditSourceLifecycle = 'active' | 'removed' | 'deleted';
export type RedditSourceKind = 'post' | 'reply';

export interface RedditSourceObject {
  sourceKind: RedditSourceKind;
  externalId: string;
  threadExternalId: string;
  parentExternalId: string | null;
  subreddit: string;
  lifecycle: RedditSourceLifecycle;
  sourceUrl: string | null;
  createdAt: string;
  editedAt: string | null;
  title: string | null;
  body: string | null;
}

export interface RedditConversation {
  objects: RedditSourceObject[];
  rejectedObjectCount: number;
  unsupportedObjectCount: number;
}
