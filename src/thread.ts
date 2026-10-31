import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { runTurn } from "./brain/turn";

/**
 * One instance per customer phone number (idFromName(phone)).
 * It is the thread's mailbox and timer: work for one customer runs one at a time (no double replies),
 * and its alarm implements both the burst debounce and the owner's grace window.
 * All data lives in D1; this object only remembers which customer it belongs to.
 */
export class Thread extends DurableObject<Env> {
  /** A new customer text arrived. Each one pushes the alarm back, so a burst gets one reply. */
  async inbound(customerId: number, delayMs: number): Promise<void> {
    await this.ctx.storage.put("customerId", customerId);
    await this.ctx.storage.setAlarm(Date.now() + delayMs);
  }

  /** The owner answered this customer himself: cancel the pending AI turn. */
  async ownerReplied(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
  }

  async alarm(): Promise<void> {
    const customerId = await this.ctx.storage.get<number>("customerId");
    if (customerId !== undefined) await runTurn(this.env, customerId);
  }
}
