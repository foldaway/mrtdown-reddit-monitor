import type { RedditDiscoveryCandidate } from '../contracts/reddit-search-atom.js';
import type { RedditSourceObject } from '../contracts/reddit-source.js';
import { computeContentVersion } from '../domain/source-identity.js';
import type {
  PublicConversationFetchResult,
  PublicDiscoveryFetchResult,
} from './public-shadow-reddit-transport.js';

interface DiscoveryTransport {
  fetchCandidates(
    subreddit: string,
    query: string,
  ): Promise<PublicDiscoveryFetchResult>;
}

interface ConversationTransport {
  fetchConversation(
    threadExternalId: string,
  ): Promise<PublicConversationFetchResult>;
}

interface DiscoveryRepository {
  getThread(
    threadExternalId: string,
  ): Promise<{ threadExternalId: string } | null>;
  storeSourceVersion(
    source: RedditSourceObject,
    contentVersion: string,
    seenAt: string,
  ): Promise<{ inserted: boolean }>;
}

interface DiscoveryCandidateQueue {
  enqueue(
    candidate: RedditDiscoveryCandidate,
    discoveredAt: string,
  ): Promise<void>;
  getOldest(): Promise<{
    threadExternalId: string;
    subreddit: string;
  } | null>;
  remove(threadExternalId: string): Promise<void>;
}

export interface RedditDiscoveryOptions {
  subreddits: string[];
  query: string;
  discoveryTransport: DiscoveryTransport;
  conversationTransport: ConversationTransport;
  repository: DiscoveryRepository;
  now: () => Date;
}

export interface ScheduledRedditDiscoveryOptions {
  subreddits: string[];
  query: string;
  discoveryTransport: DiscoveryTransport;
  conversationTransport: ConversationTransport;
  candidateQueue: DiscoveryCandidateQueue;
  repository: DiscoveryRepository;
  now: () => Date;
}

export interface RedditDiscoveryResult {
  feedCount: number;
  candidateCount: number;
  rejectedFeedEntryCount: number;
  duplicateCandidateCount: number;
  existingThreadCount: number;
  fetchedConversationCount: number;
  insertedSourceVersionCount: number;
  repeatedSourceVersionCount: number;
}

export interface ScheduledRedditDiscoveryResult {
  action: 'searched' | 'hydrated' | 'discarded_stale_candidate';
  feedCount: number;
  candidateCount: number;
  rejectedFeedEntryCount: number;
  duplicateCandidateCount: number;
  existingThreadCount: number;
  queuedCandidateCount: number;
  fetchedConversationCount: number;
  insertedSourceVersionCount: number;
  repeatedSourceVersionCount: number;
}

export class RedditDiscoveryError extends Error {
  constructor(
    readonly category: 'candidate_mismatch' | 'conversation_missing',
  ) {
    super(`Reddit discovery failed: ${category}`);
    this.name = 'RedditDiscoveryError';
  }
}

export async function runRedditDiscovery(
  options: RedditDiscoveryOptions,
): Promise<RedditDiscoveryResult> {
  const seenAt = readCurrentTimestamp(options.now);
  const result: RedditDiscoveryResult = {
    feedCount: 0,
    candidateCount: 0,
    rejectedFeedEntryCount: 0,
    duplicateCandidateCount: 0,
    existingThreadCount: 0,
    fetchedConversationCount: 0,
    insertedSourceVersionCount: 0,
    repeatedSourceVersionCount: 0,
  };
  const seenCandidates = new Set<string>();

  for (const subreddit of options.subreddits) {
    const fetched = await options.discoveryTransport.fetchCandidates(
      subreddit,
      options.query,
    );
    result.feedCount += 1;
    result.rejectedFeedEntryCount += fetched.feed.rejectedEntryCount;
    result.duplicateCandidateCount += fetched.feed.duplicateEntryCount;

    for (const candidate of fetched.feed.candidates) {
      if (seenCandidates.has(candidate.threadExternalId)) {
        result.duplicateCandidateCount += 1;
        continue;
      }
      seenCandidates.add(candidate.threadExternalId);
      result.candidateCount += 1;

      if (
        (await options.repository.getThread(candidate.threadExternalId)) !==
        null
      ) {
        result.existingThreadCount += 1;
        continue;
      }

      const conversation =
        await options.conversationTransport.fetchConversation(
          candidate.threadExternalId,
        );
      result.fetchedConversationCount += 1;
      if (conversation.kind !== 'conversation') {
        throw new RedditDiscoveryError('conversation_missing');
      }
      const root = conversation.conversation.objects.at(0);
      if (
        !matchesCandidate(root, candidate.threadExternalId, candidate.subreddit)
      ) {
        throw new RedditDiscoveryError('candidate_mismatch');
      }

      const stored = await options.repository.storeSourceVersion(
        root,
        await computeContentVersion(root),
        seenAt,
      );
      if (stored.inserted) result.insertedSourceVersionCount += 1;
      else result.repeatedSourceVersionCount += 1;
    }
  }

  return result;
}

/**
 * Performs exactly one RSS operation: either search one community or hydrate
 * one persisted candidate. The caller's transport policy reserves the shared
 * RSS budget before the operation starts.
 */
export async function runScheduledRedditDiscovery(
  options: ScheduledRedditDiscoveryOptions,
): Promise<ScheduledRedditDiscoveryResult> {
  const seenAt = readCurrentTimestamp(options.now);
  const candidate = await options.candidateQueue.getOldest();
  if (candidate !== null) {
    if (
      (await options.repository.getThread(candidate.threadExternalId)) !== null
    ) {
      await options.candidateQueue.remove(candidate.threadExternalId);
      return {
        ...emptyScheduledResult('discarded_stale_candidate'),
        existingThreadCount: 1,
      };
    }

    const conversation = await options.conversationTransport.fetchConversation(
      candidate.threadExternalId,
    );
    if (conversation.kind !== 'conversation') {
      throw new RedditDiscoveryError('conversation_missing');
    }
    const root = conversation.conversation.objects.at(0);
    if (
      !matchesCandidate(root, candidate.threadExternalId, candidate.subreddit)
    ) {
      throw new RedditDiscoveryError('candidate_mismatch');
    }
    const stored = await options.repository.storeSourceVersion(
      root,
      await computeContentVersion(root),
      seenAt,
    );
    await options.candidateQueue.remove(candidate.threadExternalId);
    return {
      ...emptyScheduledResult('hydrated'),
      candidateCount: 1,
      fetchedConversationCount: 1,
      insertedSourceVersionCount: stored.inserted ? 1 : 0,
      repeatedSourceVersionCount: stored.inserted ? 0 : 1,
    };
  }

  const subreddit = selectSubreddit(options.subreddits, options.now);
  const fetched = await options.discoveryTransport.fetchCandidates(
    subreddit,
    options.query,
  );
  const result: ScheduledRedditDiscoveryResult = {
    ...emptyScheduledResult('searched'),
    feedCount: 1,
    candidateCount: fetched.feed.candidates.length,
    rejectedFeedEntryCount: fetched.feed.rejectedEntryCount,
    duplicateCandidateCount: fetched.feed.duplicateEntryCount,
  };
  for (const feedCandidate of fetched.feed.candidates) {
    if (
      (await options.repository.getThread(feedCandidate.threadExternalId)) !==
      null
    ) {
      result.existingThreadCount += 1;
      continue;
    }
    await options.candidateQueue.enqueue(feedCandidate, seenAt);
    result.queuedCandidateCount += 1;
  }
  return result;
}

function emptyScheduledResult(
  action: ScheduledRedditDiscoveryResult['action'],
): ScheduledRedditDiscoveryResult {
  return {
    action,
    feedCount: 0,
    candidateCount: 0,
    rejectedFeedEntryCount: 0,
    duplicateCandidateCount: 0,
    existingThreadCount: 0,
    queuedCandidateCount: 0,
    fetchedConversationCount: 0,
    insertedSourceVersionCount: 0,
    repeatedSourceVersionCount: 0,
  };
}

function selectSubreddit(subreddits: string[], now: () => Date): string {
  if (subreddits.length === 0) throw new TypeError('No discovery subreddits');
  const timestamp = now();
  if (!(timestamp instanceof Date) || !Number.isFinite(timestamp.valueOf())) {
    throw new TypeError('Invalid current time');
  }
  const minute = Math.floor(timestamp.valueOf() / 60_000);
  return subreddits[minute % subreddits.length] as string;
}

function matchesCandidate(
  root: RedditSourceObject | undefined,
  threadExternalId: string,
  subreddit: string,
): root is RedditSourceObject {
  return (
    root !== undefined &&
    root.sourceKind === 'post' &&
    root.externalId === threadExternalId &&
    root.threadExternalId === threadExternalId &&
    root.subreddit.toLowerCase() === subreddit.toLowerCase()
  );
}

function readCurrentTimestamp(now: () => Date): string {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) {
    throw new TypeError('Invalid current time');
  }
  return value.toISOString();
}
