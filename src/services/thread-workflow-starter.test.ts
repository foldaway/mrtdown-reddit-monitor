import { describe, expect, it, vi } from 'vitest';

import { startSelectedThreadWorkflows } from './thread-workflow-starter.js';

const NOW = new Date('2026-07-20T00:00:00.000Z');
const selectedThread = {
  threadExternalId: 't3_synthetic1',
  subreddit: 'singapore',
  selectionStatus: 'selected' as const,
  firstSeenAt: '2026-07-19T23:59:00.000Z',
  lastSeenAt: '2026-07-19T23:59:00.000Z',
};

describe('thread Workflow starter', () => {
  it('reserves a deterministic identity, starts one instance, and records it', async () => {
    const markWorkflowStarted = vi.fn().mockResolvedValue({
      ...selectedThread,
      workflowId: selectedThread.threadExternalId,
      workflowAssignedAt: NOW.toISOString(),
      workflowStartedAt: NOW.toISOString(),
    });
    const create = vi.fn().mockResolvedValue({
      id: selectedThread.threadExternalId,
      status: async () => ({ status: 'queued' }),
    });

    await expect(
      startSelectedThreadWorkflows({
        repository: {
          listSelectedThreadsNeedingWorkflow: async () => [selectedThread],
          ensureWorkflowIdentity: async (_threadId, workflowId) => ({
            assigned: true,
            workflowId,
          }),
          markWorkflowStarted,
        },
        workflow: {
          create,
          get: vi.fn(),
        },
        now: () => NOW,
      }),
    ).resolves.toEqual({
      eligibleCount: 1,
      assignedCount: 1,
      createdCount: 1,
      recoveredCount: 0,
    });
    expect(create).toHaveBeenCalledWith({
      id: 't3_synthetic1',
      params: { threadExternalId: 't3_synthetic1' },
    });
    expect(markWorkflowStarted).toHaveBeenCalledWith(
      't3_synthetic1',
      't3_synthetic1',
      NOW.toISOString(),
    );
  });

  it('recovers an already-created instance after an ambiguous create response', async () => {
    const status = vi.fn().mockResolvedValue({ status: 'running' });

    await expect(
      startSelectedThreadWorkflows({
        repository: {
          listSelectedThreadsNeedingWorkflow: async () => [
            {
              ...selectedThread,
              workflowId: 't3_synthetic1',
              workflowAssignedAt: NOW.toISOString(),
            },
          ],
          ensureWorkflowIdentity: async () => ({
            assigned: false,
            workflowId: 't3_synthetic1',
          }),
          markWorkflowStarted: vi.fn().mockResolvedValue(selectedThread),
        },
        workflow: {
          create: vi
            .fn()
            .mockRejectedValue(new Error('instance already exists')),
          get: vi.fn().mockResolvedValue({
            id: 't3_synthetic1',
            status,
          }),
        },
        now: () => NOW,
      }),
    ).resolves.toMatchObject({
      createdCount: 0,
      recoveredCount: 1,
    });
    expect(status).toHaveBeenCalledOnce();
  });
});
