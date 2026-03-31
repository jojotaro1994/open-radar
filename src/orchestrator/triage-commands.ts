/**
 * Triage CLI
 *
 * Usage:
 *   node dist/orchestrator/triage-commands.js list
 *   node dist/orchestrator/triage-commands.js list pending
 *   node dist/orchestrator/triage-commands.js status <signalId>
 *   node dist/orchestrator/triage-commands.js approve <signalId> <reviewedBy>
 *   node dist/orchestrator/triage-commands.js reject <signalId> <reviewedBy> <reason>
 *   node dist/orchestrator/triage-commands.js defer <signalId> <reviewedBy>
 *
 * Examples:
 *   node dist/orchestrator/triage-commands.js list pending
 *   node dist/orchestrator/triage-commands.js approve norm-mock-confluence-002 alice
 *   node dist/orchestrator/triage-commands.js reject norm-mock-twitter-001 alice "Not relevant to roadmap"
 *   node dist/orchestrator/triage-commands.js status norm-mock-confluence-002
 */

import * as path from 'path';
import { ReviewQueue, type ReviewQueueItem } from '../engine/review-queue.js';

const DATA_DIR = process.env.RADAR_DATA_DIR || path.join(process.cwd(), 'data');
const queue = new ReviewQueue(DATA_DIR);

async function triageApprove(signalId: string, reviewedBy: string): Promise<void> {
  await queue.triage(signalId, "approved", reviewedBy);
  console.log(`[triage] Approved: ${signalId} by ${reviewedBy}`);
}

async function triageReject(signalId: string, reviewedBy: string, reason: string): Promise<void> {
  await queue.triage(signalId, "rejected", reviewedBy, reason);
  console.log(`[triage] Rejected: ${signalId} by ${reviewedBy}, reason: ${reason}`);
}

async function triageDefer(signalId: string, reviewedBy: string): Promise<void> {
  await queue.triage(signalId, "deferred", reviewedBy);
  console.log(`[triage] Deferred: ${signalId} by ${reviewedBy}`);
}

async function triageStatus(signalId: string): Promise<void> {
  const item = await queue.getItem(signalId);
  if (!item) {
    console.log(`[triage] Signal ${signalId} not found in queue`);
    return;
  }
  console.log(`[triage] Status for ${signalId}: ${item.status}`);
  console.log(`  Cycle: ${item.cycleId}`);
  console.log(`  Enqueued at: ${item.enqueuedAt}`);
  if (item.triage) {
    console.log(`  Decision: ${item.triage.decision}`);
    console.log(`  Reviewed by: ${item.triage.reviewedBy}`);
    console.log(`  Reviewed at: ${item.triage.reviewedAt}`);
    if (item.triage.reason) console.log(`  Reason: ${item.triage.reason}`);
  }
}

async function triageList(filter?: string): Promise<void> {
  let items: ReviewQueueItem[];

  switch (filter) {
    case "pending":   items = await queue.getPending();   break;
    case "approved":  items = await queue.getApproved();  break;
    case "rejected":  items = await queue.getRejected();  break;
    case "deferred":  items = await queue.getDeferred();  break;
    default:
      items = [
        ...(await queue.getPending()),
        ...(await queue.getApproved()),
        ...(await queue.getRejected()),
        ...(await queue.getDeferred()),
      ];
  }

  console.log(`[triage] ${items.length} item(s):`);
  for (const item of items) {
    const triageInfo = item.triage ? ` by ${item.triage.reviewedBy}` : "";
    console.log(`  ${item.signalId} [${item.status}]${triageInfo}`);
  }
}

// CLI entry point
const [, , command, ...args] = process.argv;

async function main() {
  switch (command) {
    case "list": {
      const filter = args[0] as "pending" | "approved" | "rejected" | "deferred" | undefined;
      await triageList(filter);
      break;
    }
    case "status": {
      if (!args[0]) { console.error("Usage: triage status <signalId>"); process.exit(1); }
      await triageStatus(args[0]);
      break;
    }
    case "approve": {
      if (!args[0] || !args[1]) { console.error("Usage: triage approve <signalId> <reviewedBy>"); process.exit(1); }
      await triageApprove(args[0], args[1]);
      break;
    }
    case "reject": {
      if (!args[0] || !args[1] || !args[2]) { console.error("Usage: triage reject <signalId> <reviewedBy> <reason>"); process.exit(1); }
      await triageReject(args[0], args[1], args[2]);
      break;
    }
    case "defer": {
      if (!args[0] || !args[1]) { console.error("Usage: triage defer <signalId> <reviewedBy>"); process.exit(1); }
      await triageDefer(args[0], args[1]);
      break;
    }
    default:
      console.log(`Commands: list [filter], status <id>, approve <id> <by>, reject <id> <by> <reason>, defer <id> <by>`);
      process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
