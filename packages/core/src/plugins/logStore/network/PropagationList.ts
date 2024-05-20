import { MessageRef } from '@streamr/protocol';

/**
 * The PropagationList Class manages the propagation list of message references,
 * handling primary node messages and foreign node messages and their finalization states.
 */
export class PropagationList {
	private readonly primaryItems: MessageRef[] = [];
	private latestPrimary: MessageRef | undefined;
	private isPrimaryFinalized: boolean = false;
	private readonly foreignItems: MessageRef[] = [];
	private isForeignFinalized: boolean = false;

	/**
	 * Pushes a primary node message reference to the list.
	 *
	 * @param {MessageRef} messageRef - The message reference to push.
	 */
	public pushPrimary(messageRef: MessageRef) {
		this.latestPrimary = messageRef;

		const index = this.foreignItems.findIndex(
			(item) => item.compareTo(messageRef) === 0
		);

		if (index != -1) {
			this.foreignItems.splice(index, 1);
		} else {
			this.primaryItems.push(messageRef);
		}
	}

	/**
	 * Pushes a foreign node message reference to the list.
	 *
	 * @param {MessageRef} messageRef - The message reference to push.
	 */
	public pushForeign(messageRef: MessageRef) {
		const index = this.primaryItems.findIndex(
			(item) => item.compareTo(messageRef) === 0
		);

		if (index != -1) {
			this.primaryItems.splice(0, index + 1);
		} else {
			this.foreignItems.push(messageRef);
		}
	}

	/**
	 * Finalizes the primary message list.
	 */
	public finalizePrimary() {
		this.isPrimaryFinalized = true;
	}

	/**
	 * Finalizes the foreign message list.
	 */
	public finalizeForeign() {
		this.isForeignFinalized = true;
	}

	/**
	 * Checks if both primary and foreign lists are finalized.
	 *
	 * @returns {boolean} True if both lists are finalized, false otherwise.
	 */
	public get isFinalized() {
		return this.isPrimaryFinalized && this.isForeignFinalized;
	}

	/**
	 * Gets the difference between the latest primary message reference and the
	 * foreign message references, and removes the returned references from the
	 * foreign list.
	 *
	 * @returns {MessageRef[]} The list of message references that are in the foreign list
	 * but not in the primary list.
	 */
	public getDiffAndShrink() {
		if (this.isPrimaryFinalized) {
			return this.foreignItems.splice(0, this.foreignItems.length);
		}

		if (!this.latestPrimary) {
			return [];
		}

		let i = 0;
		while (
			i < this.foreignItems.length &&
			this.foreignItems[i].compareTo(this.latestPrimary) <= 0
		) {
			i++;
		}

		return this.foreignItems.splice(0, i);
	}
}
