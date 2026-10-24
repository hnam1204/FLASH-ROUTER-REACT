import { randomUUID } from 'node:crypto';
import type { EventHub } from '../events/index.js';

export type JobStatus = 'QUEUED' | 'RUNNING' | 'WAITING_FOR_USER' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type Job = { id: string; accountId: string; stage: string; status: JobStatus; startedAt?: string; finishedAt?: string; errorCode?: string };
type Task = { job: Job; run: () => Promise<void> };

export class JobManager {
  private readonly jobs = new Map<string, Job>();
  private readonly queues = new Map<string, Task[]>();
  private readonly active = new Set<string>();
  private readonly activePromises = new Map<string, Promise<void>>();
  private shuttingDown = false;
  constructor(private readonly events: EventHub, private readonly maxConcurrent = 2) {}

  enqueue(accountId: string, stage: string, run: () => Promise<void>): Job {
    if (this.shuttingDown) throw new Error('JOB_MANAGER_SHUTTING_DOWN');
    const job = { id: randomUUID(), accountId, stage, status: 'QUEUED' as const };
    this.jobs.set(job.id, job);
    const queue = this.queues.get(accountId) ?? [];
    queue.push({ job, run });
    this.queues.set(accountId, queue);
    this.events.publish({ account_id: accountId, job_id: job.id, type: 'JOB', severity: 'info', stage, safe_message: 'Job đã xếp hàng.' });
    void this.pump(accountId);
    return job;
  }

  get(id: string): Job | undefined { return this.jobs.get(id); }
  cancel(id: string): boolean { const job = this.jobs.get(id); if (!job || job.status !== 'QUEUED') return false; job.status = 'CANCELLED'; job.finishedAt = new Date().toISOString(); this.events.publish({ account_id: job.accountId, job_id: job.id, type: 'JOB', severity: 'warning', stage: job.stage, safe_message: 'Job đã bị hủy.' }); return true; }
  cancelAccount(accountId: string): void {
    for (const job of this.jobs.values()) if (job.accountId === accountId) this.cancel(job.id);
  }

  async drainAccount(accountId: string): Promise<void> {
    const active = this.activePromises.get(accountId);
    if (active) await active;
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    for (const accountId of this.queues.keys()) this.cancelAccount(accountId);
    await Promise.all([...this.activePromises.values()]);
  }

  private async pump(accountId: string): Promise<void> {
    if (this.active.size >= this.maxConcurrent || this.active.has(accountId)) return;
    const task = this.queues.get(accountId)?.find((item) => item.job.status === 'QUEUED');
    if (!task) return;
    this.active.add(accountId);
    task.job.status = 'RUNNING'; task.job.startedAt = new Date().toISOString();
    this.events.publish({ account_id: accountId, job_id: task.job.id, type: 'JOB', severity: 'info', stage: task.job.stage, safe_message: 'Job bắt đầu.' });
    const running = (async () => {
      try {
        await task.run();
        task.job.status = 'COMPLETED';
        this.events.publish({ account_id: accountId, job_id: task.job.id, type: 'JOB', severity: 'info', stage: task.job.stage, safe_message: 'Job hoàn tất.' });
      } catch {
        task.job.status = 'FAILED';
        task.job.errorCode = 'JOB_FAILED';
        this.events.publish({ account_id: accountId, job_id: task.job.id, type: 'ERROR', severity: 'error', stage: task.job.stage, safe_message: 'Job không hoàn tất.', error_code: task.job.errorCode });
      } finally {
        task.job.finishedAt = new Date().toISOString();
        this.active.delete(accountId);
        this.activePromises.delete(accountId);
        void this.pumpAll();
      }
    })();
    this.activePromises.set(accountId, running);
    await running;
  }

  private async pumpAll(): Promise<void> {
    for (const accountId of this.queues.keys()) {
      if (this.active.size >= this.maxConcurrent) return;
      void this.pump(accountId);
    }
  }
}
