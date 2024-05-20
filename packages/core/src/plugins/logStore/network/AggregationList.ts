import { MessageRef } from '@streamr/protocol';

/**
 * THe AggregationList class manages a list of message references and their readiness state,
 * used to aggregate and process data messages in a specific order.
 */
export class AggregationList {
	private readonly items: { messageRef: MessageRef; isReady: boolean }[] = [];
	private _threshold: MessageRef | undefined;

	/**
	 * Checks if the aggregation list is empty.
	 *
	 * @returns {boolean} True if the list is empty, otherwise false.
	 */
	public get isEmpty() {
		return this.items.length === 0;
	}

	/**
	 * Gets the first message reference that is ready.
	 *
	 * @returns {MessageRef | undefined} The first ready message reference, or undefined if none are ready.
	 */
	public get readyFrom() {
		if (this.items.length > 0 && this.items[0].isReady) {
			return this.items[0].messageRef;
		}

		return undefined;
	}

	/**
	 * Gets the last message reference that is ready in a contiguous sequence.
	 *
	 * @returns {MessageRef | undefined} The last ready message reference in a sequence, or undefined if none are ready.
	 */
	public get readyTo() {
		if (this.items.length === 0 || !this.items[0].isReady) {
			return undefined;
		}

		let i = 1;
		while (i < this.items.length && this.items[i].isReady) {
			i++;
		}

		if (i <= this.items.length) {
			return this.items[i - 1].messageRef;
		}

		return undefined;
	}

	/**
	 * Pushes a primary message reference to the list and marks it as ready.
	 *
	 * @param {MessageRef} messageRef - The message reference to add.
	 */
	public pushPrimary(messageRef: MessageRef) {
		this.push(messageRef, true);
	}

	/**
	 * Pushes a foreign message reference to the list and marks it as not ready.
	 *
	 * @param {MessageRef} messageRef - The message reference to add.
	 */
	public pushForeign(messageRef: MessageRef) {
		this.push(messageRef, false);
	}

	/**
	 * Pushes a propagated message reference to the list and marks it as ready.
	 *
	 * @param {MessageRef} messageRef - The message reference to add.
	 */
	public pushPropagation(messageRef: MessageRef) {
		this.push(messageRef, true);
	}

	/**
	 * Pushes a message reference to the list with its readiness state.
	 *
	 * @param {MessageRef} messageRef - The message reference to add.
	 * @param {boolean} isReady - Indicates whether the message reference is ready.
	 * @private
	 */
	private push(messageRef: MessageRef, isReady: boolean) {
		if (this._threshold && this._threshold.compareTo(messageRef) >= 0) {
			return;
		}

		const item = this.items.find(
			(i) => i.messageRef.compareTo(messageRef) === 0
		);

		if (item) {
			item.isReady ||= isReady;
		} else {
			this.items.push({ messageRef, isReady });
			this.items.sort((a, b) => a.messageRef.compareTo(b.messageRef));
		}
	}

	/**
	 * Shrinks the aggregation list by removing all message references up to a given threshold.
	 *
	 * @param {MessageRef} threshold - The threshold up to which message references are removed.
	 */
	public shrink(threshold: MessageRef) {
		let i = 0;
		while (
			i < this.items.length &&
			this.items[i].messageRef.compareTo(threshold) <= 0
		) {
			i++;
		}

		if (i > 0) {
			this.items.splice(0, i);
		}

		this._threshold = threshold;
	}
}
