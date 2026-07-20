import type { ThreadRecord } from '../storage/reddit-repository.js';

export interface ThreadWorkflowParameters {
  threadExternalId: string;
}

interface WorkflowInstance {
  id: string;
  status(): Promise<unknown>;
}

interface ThreadWorkflowBinding {
  create(options: {
    id: string;
    params: ThreadWorkflowParameters;
  }): Promise<WorkflowInstance>;
  get(id: string): Promise<WorkflowInstance>;
}

interface ThreadWorkflowRepository {
  listSelectedThreadsNeedingWorkflow(limit?: number): Promise<ThreadRecord[]>;
  ensureWorkflowIdentity(
    threadExternalId: string,
    proposedWorkflowId: string,
    assignedAt: string,
  ): Promise<{ assigned: boolean; workflowId: string }>;
  markWorkflowStarted(
    threadExternalId: string,
    workflowId: string,
    startedAt: string,
  ): Promise<ThreadRecord>;
}

export interface ThreadWorkflowStartResult {
  eligibleCount: number;
  assignedCount: number;
  createdCount: number;
  recoveredCount: number;
}

/**
 * Reserves a stable Workflow identity before creation. If the create response
 * was lost after Cloudflare accepted it, an existing instance is recovered and
 * marked started instead of creating a second monitor for the thread.
 */
export async function startSelectedThreadWorkflows(options: {
  repository: ThreadWorkflowRepository;
  workflow: ThreadWorkflowBinding;
  now: () => Date;
  limit?: number;
}): Promise<ThreadWorkflowStartResult> {
  const startedAt = currentTimestamp(options.now);
  const threads = await options.repository.listSelectedThreadsNeedingWorkflow(
    options.limit,
  );
  const result: ThreadWorkflowStartResult = {
    eligibleCount: threads.length,
    assignedCount: 0,
    createdCount: 0,
    recoveredCount: 0,
  };

  for (const thread of threads) {
    const assignment = await options.repository.ensureWorkflowIdentity(
      thread.threadExternalId,
      thread.workflowId ?? thread.threadExternalId,
      startedAt,
    );
    if (assignment.assigned) result.assignedCount += 1;

    let recovered = false;
    try {
      const instance = await options.workflow.create({
        id: assignment.workflowId,
        params: { threadExternalId: thread.threadExternalId },
      });
      if (instance.id !== assignment.workflowId) {
        throw new ThreadWorkflowStartError('unexpected_instance_id');
      }
      result.createdCount += 1;
    } catch (error) {
      try {
        const instance = await options.workflow.get(assignment.workflowId);
        await instance.status();
        recovered = true;
      } catch {
        throw error;
      }
    }
    await options.repository.markWorkflowStarted(
      thread.threadExternalId,
      assignment.workflowId,
      startedAt,
    );
    if (recovered) result.recoveredCount += 1;
  }

  return result;
}

export class ThreadWorkflowStartError extends Error {
  constructor(readonly category: 'unexpected_instance_id') {
    super(`Thread Workflow start failed: ${category}`);
    this.name = 'ThreadWorkflowStartError';
  }
}

function currentTimestamp(now: () => Date): string {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) {
    throw new TypeError('Invalid current time');
  }
  return value.toISOString();
}
