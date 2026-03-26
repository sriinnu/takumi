import { createLogger } from "@takumi/core";
import type { MessagePayload } from "./loop.js";
import { buildUserMessage } from "./message.js";
import { SteeringPriority, type SteeringQueue } from "./steering-queue.js";

// ── Preempt watcher ───────────────────────────────────────────────────────────

/** Handle returned by {@link setupPreemptWatcher}. */
export interface PreemptWatcher {
	/** Merged AbortSignal: fires on INTERRUPT enqueue OR outer signal abort. */
	signal: AbortSignal;
	/** True when an INTERRUPT-priority item triggered the abort. */
	readonly fired: boolean;
	/** Unsubscribe from the queue. Call this after tool execution completes. */
	dispose(): void;
}

/**
 * Create a per-turn preemption watcher for the tool-execution phase.
 *
 * Subscribes to the steering queue's onEnqueued event. When an
 * INTERRUPT-priority item arrives while tools are running, the returned
 * signal is aborted immediately so tool handlers can react mid-execution
 * rather than waiting for the next turn boundary.
 *
 * The outerSignal (user cancel) is wired in so tools still honour it too.
 */
export function setupPreemptWatcher(queue?: SteeringQueue, outerSignal?: AbortSignal): PreemptWatcher {
	const controller = new AbortController();
	let fired = false;

	// Wire in the user-cancel signal so tools see both abort sources.
	if (outerSignal?.aborted) {
		controller.abort(outerSignal.reason);
	} else if (outerSignal) {
		outerSignal.addEventListener("abort", () => controller.abort(outerSignal.reason), { once: true });
	}

	const unsub = queue?.onEnqueued((item) => {
		if (item.priority === SteeringPriority.INTERRUPT && !controller.signal.aborted) {
			controller.abort();
			fired = true;
		}
	});

	return {
		signal: controller.signal,
		get fired() {
			return fired;
		},
		dispose() {
			unsub?.();
		},
	};
}

const log = createLogger("loop-steering");

/**
 * Promote exactly one queued steering directive into the next user turn.
 *
 * Processing a single item at a time preserves FIFO order within each
 * priority level, lets interrupt items jump ahead without discarding the rest
 * of the queue, and keeps queued work cancellable until it is actually run.
 */
export function injectNextSteeringDirective(messages: MessagePayload[], steeringQueue?: SteeringQueue): boolean {
	if (!steeringQueue || steeringQueue.isEmpty) return false;

	const item = steeringQueue.dequeue();
	if (!item) return false;

	const renderedText = item.priority === SteeringPriority.INTERRUPT ? item.text : `[Steering directive] ${item.text}`;
	messages.push({ role: "user", content: buildUserMessage(renderedText) });

	const priorityLabel = item.priority === SteeringPriority.INTERRUPT ? "interrupt" : "queued directive";
	log.info(`Steering: promoting ${priorityLabel} ${item.id} (${steeringQueue.size} remaining)`);
	return true;
}
