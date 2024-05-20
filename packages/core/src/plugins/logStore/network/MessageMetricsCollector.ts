import { SystemMessageType } from '@logsn/protocol';
import { MessageMetadata } from '@streamr/sdk';

import { BroadbandSubscriber } from '../../../shared/BroadbandSubscriber';
import {
	MessageMetricsSubject,
	MessageMetricsSummary,
} from '../../../shared/MessageMetricsSummary';

const METRICS_SUBJECTS: MessageMetricsSubject[] = [
	{
		subject: 'QueryRequest',
		type: SystemMessageType.QueryRequest,
	},
	{
		subject: 'QueryResponse',
		type: SystemMessageType.QueryResponse,
	},
	{
		subject: 'QueryPropagate',
		type: SystemMessageType.QueryPropagate,
	},
];

export class MessageMetricsCollector {
	private readonly messageMetricsSummary: MessageMetricsSummary;

	constructor(private readonly systemSubscriber: BroadbandSubscriber) {
		this.messageMetricsSummary = new MessageMetricsSummary(METRICS_SUBJECTS);
	}

	public async start() {
		await this.systemSubscriber.subscribe(this.onSystemMessage.bind(this));
	}

	public get summary() {
		return this.messageMetricsSummary.summary;
	}

	public async stop() {
		await this.systemSubscriber.unsubscribe();
	}

	private async onSystemMessage(message: unknown, metadata: MessageMetadata) {
		this.messageMetricsSummary.update(message, metadata);
	}

	private async onRecoveryMessage(message: unknown, metadata: MessageMetadata) {
		this.messageMetricsSummary.update(message, metadata);
	}
}
