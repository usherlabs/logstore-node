interface MessageId {
	streamId: string;
	streamPartition: number;
	timestamp: number;
	sequenceNumber: number;
	publisherId: string;
	msgChainId: string;
}

interface PrevMsgRef {
	timestamp: number;
	sequenceNumber: number;
}

export interface MessagePayload {
	messageId: MessageId;
	prevMsgRef?: PrevMsgRef | null;
	messageType: number;
	contentType: number;
	encryptionType: number;
	groupKeyId?: string | null;
	newGroupKey?: string | null;
	signature: string;
	serializedContent: string;
}
