import { MessageRef } from '@streamr/protocol';

export class PropagationList {
	private readonly primaryItems: MessageRef[] = [];
	private latestPrimary: MessageRef | undefined;
	private isPrimaryFinalized: boolean = false;
	private readonly foreignItems: MessageRef[] = [];
	private isForeignFinalized: boolean = false;

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

	public fnalizePrimary() {
		this.isPrimaryFinalized = true;
	}

	public fnalizeForeign() {
		this.isForeignFinalized = true;
	}

	public get isFinalized() {
		return this.isPrimaryFinalized && this.isForeignFinalized;
	}

	public getDiffAndSrink() {
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
