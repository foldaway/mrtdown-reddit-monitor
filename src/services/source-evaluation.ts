import type { ParserDecision } from '../contracts/crowd-report.js';
import type { RedditSourceObject } from '../contracts/reddit-source.js';
import { computeExternalReportId } from '../domain/source-identity.js';
import { isSourceRailRelated } from '../domain/rail-relevance.js';
import type {
  SourceVersionKey,
  StoredSourceVersion,
} from '../storage/reddit-repository.js';

interface EvaluationRepository {
  listPendingEvaluations(limit?: number): Promise<StoredSourceVersion[]>;
  recordEvaluation(
    key: SourceVersionKey,
    decision: unknown,
    evaluatedAt: string,
    externalReportId?: string,
  ): Promise<StoredSourceVersion>;
}

interface SemanticParser {
  parse(source: RedditSourceObject): Promise<ParserDecision>;
}

export interface SourceEvaluationResult {
  pendingCount: number;
  filterRejectedCount: number;
  parserIrrelevantCount: number;
  reportCount: number;
}

export async function evaluatePendingSources(options: {
  repository: EvaluationRepository;
  semanticParser: SemanticParser;
  now: () => Date;
  limit?: number;
}): Promise<SourceEvaluationResult> {
  const evaluatedAt = readCurrentTimestamp(options.now);
  const pending = await options.repository.listPendingEvaluations(
    options.limit,
  );
  const result: SourceEvaluationResult = {
    pendingCount: pending.length,
    filterRejectedCount: 0,
    parserIrrelevantCount: 0,
    reportCount: 0,
  };

  for (const record of pending) {
    const key = {
      sourceExternalId: record.source.externalId,
      contentVersion: record.contentVersion,
    };
    if (!shouldParse(record.source)) {
      await options.repository.recordEvaluation(
        key,
        { decision: 'irrelevant' },
        evaluatedAt,
      );
      result.filterRejectedCount += 1;
      continue;
    }

    const decision = await options.semanticParser.parse(record.source);
    if (decision.decision === 'irrelevant') {
      await options.repository.recordEvaluation(key, decision, evaluatedAt);
      result.parserIrrelevantCount += 1;
      continue;
    }

    await options.repository.recordEvaluation(
      key,
      decision,
      evaluatedAt,
      await computeExternalReportId(
        record.source.externalId,
        record.contentVersion,
      ),
    );
    result.reportCount += 1;
  }

  return result;
}

function shouldParse(source: RedditSourceObject): boolean {
  if (source.lifecycle !== 'active') return false;
  if (source.sourceKind === 'post') return isSourceRailRelated(source);
  return source.body !== null && source.body.length > 0;
}

function readCurrentTimestamp(now: () => Date): string {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) {
    throw new TypeError('Invalid current time');
  }
  return value.toISOString();
}
