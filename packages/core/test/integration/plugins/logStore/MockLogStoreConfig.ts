import { StreamPartID } from '@streamr/protocol';

export const createMockLogStoreConfig = (streamParts: StreamPartID[]): any => {
	return {
		hasStreamPart: (streamPart: StreamPartID) => {
			return streamParts.includes(streamPart);
		},
		getStreamParts: () => {
			return streamParts;
		},
		addChangeListener: () => {},
		startChainEventsListener: jest.fn(),
		stopChainEventsListener: jest.fn(),
		startAssignmentEventListener: jest.fn(),
		stopAssignmentEventListener: jest.fn(),
		cleanup: jest.fn().mockResolvedValue(undefined),
	};
};
