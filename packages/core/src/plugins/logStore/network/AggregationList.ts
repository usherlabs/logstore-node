import { MessageRef } from '@streamr/protocol';

export class AggreagationList {
	private readonly items: { messageRef: MessageRef; isReady: boolean }[] = [];
	private _threshold: MessageRef | undefined;

	public get isEmpty() {
		return this.items.length === 0;
	}

	public get readyFrom() {
		if (this.items.length > 0 && this.items[0].isReady) {
			return this.items[0].messageRef;
		}

		return undefined;
	}

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

	public get threshold() {
		return this._threshold;
	}

	public push(messageRef: MessageRef, isReady: boolean) {
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
