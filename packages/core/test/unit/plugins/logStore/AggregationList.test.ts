import { MessageRef } from '@streamr/protocol';

import { AggregationList } from '../../../../src/plugins/logStore/network/AggregationList';
import { mockStreamMessageRange } from './test-utils';

type Action = {
	name: string;
} & (
	| {
			type: 'push';
			source: 'primary' | 'foreign' | 'propagation';
			item: MessageRef;
	  }
	| {
			type: 'shrink';
			threshold: MessageRef;
	  }
);

type Sequence = {
	actions: Action[];
	isEmpty: boolean;
	readyFrom: MessageRef | undefined;
	readyTo: MessageRef | undefined;
};

// Test data
const [D0, D1, D2] = Array.from(
	mockStreamMessageRange(100200300, 100200303)
).map((m) => m.getMessageRef());

// Primary actions (P - stands for Primary)
const P0: Action = {
	name: 'P0',
	type: 'push',
	source: 'primary',
	item: D0,
};
const P1: Action = {
	name: 'P1',
	type: 'push',
	source: 'primary',
	item: D1,
};
const P2: Action = {
	name: 'P2',
	type: 'push',
	source: 'primary',
	item: D2,
};

// Foreign actions (F - stands for Foreign)
const F0: Action = {
	name: 'F0',
	type: 'push',
	source: 'foreign',
	item: D0,
};
const F1: Action = {
	name: 'F1',
	type: 'push',
	source: 'foreign',
	item: D1,
};
const F2: Action = {
	name: 'F2',
	type: 'push',
	source: 'foreign',
	item: D2,
};

// Propagation actions (G - stands for propaGation)
const G0: Action = {
	name: 'G0',
	type: 'push',
	source: 'propagation',
	item: D0,
};
const G1: Action = {
	name: 'G1',
	type: 'push',
	source: 'propagation',
	item: D1,
};
const G2: Action = {
	name: 'G2',
	type: 'push',
	source: 'propagation',
	item: D2,
};

// Shring actions (S - stands for Shring)
const S0: Action = { name: 'S0', type: 'shrink', threshold: D0 };
const S1: Action = { name: 'S1', type: 'shrink', threshold: D1 };
const S2: Action = { name: 'S2', type: 'shrink', threshold: D2 };

function sequenceToString(sequence: Sequence) {
	if (!sequence.actions.length) {
		return 'no actions';
	}

	return sequence.actions.reduce((name, action) => {
		const delimiter = name ? '-' : '';
		return `${name}${delimiter}${action.name}`;
	}, '');
}

function runSequence(sequence: Sequence) {
	const aggregationList = new AggregationList();

	for (const action of sequence.actions) {
		if (action.type === 'push') {
			switch (action.source) {
				case 'primary':
					aggregationList.pushPrimary(action.item);
					break;
				case 'foreign':
					aggregationList.pushForeign(action.item);
					break;
				case 'propagation':
					aggregationList.pushPropagation(action.item);
					break;
			}
		} else {
			aggregationList.shrink(action.threshold);
		}
	}

	expect(aggregationList.isEmpty).toEqual(sequence.isEmpty);
	expect(aggregationList.readyFrom).toEqual(sequence.readyFrom);
	expect(aggregationList.readyTo).toEqual(sequence.readyTo);
}

function testSequences(sequences: Sequence[]) {
	const testCases = sequences.map((sequence) => [
		sequenceToString(sequence),
		sequence,
	]) as [string, Sequence][];

	test.each(testCases)('sequence of %s', (_name, sequence) => {
		runSequence(sequence);
	});
}

describe('AggregationList is in a proper state when', () => {
	describe('there are no push actions', () => {
		testSequences([
			{
				actions: [],
				isEmpty: true,
				readyFrom: undefined,
				readyTo: undefined,
			},
			{
				actions: [S0],
				isEmpty: true,
				readyFrom: undefined,
				readyTo: undefined,
			},
		]);
	});

	describe('there are primary actions only', () => {
		testSequences([
			{
				actions: [P0],
				isEmpty: false,
				readyFrom: D0,
				readyTo: D0,
			},
			{
				actions: [P0, P1],
				isEmpty: false,
				readyFrom: D0,
				readyTo: D1,
			},
			{
				actions: [P0, P1, P2],
				isEmpty: false,
				readyFrom: D0,
				readyTo: D2,
			},
			{
				actions: [P0, P1, P2, S0],
				isEmpty: false,
				readyFrom: D1,
				readyTo: D2,
			},
			{
				actions: [P0, P1, P2, S1],
				isEmpty: false,
				readyFrom: D2,
				readyTo: D2,
			},
			{
				actions: [P0, P1, P2, S2],
				isEmpty: true,
				readyFrom: undefined,
				readyTo: undefined,
			},
		]);
	});

	describe('there are foreign actions only', () => {
		testSequences([
			{
				actions: [F0],
				isEmpty: false,
				readyFrom: undefined,
				readyTo: undefined,
			},
			{
				actions: [F0, F1],
				isEmpty: false,
				readyFrom: undefined,
				readyTo: undefined,
			},
			{
				actions: [F0, F1, F2],
				isEmpty: false,
				readyFrom: undefined,
				readyTo: undefined,
			},
			{
				actions: [F0, F1, F2, S0],
				isEmpty: false,
				readyFrom: undefined,
				readyTo: undefined,
			},
			{
				actions: [F0, F1, F2, S1],
				isEmpty: false,
				readyFrom: undefined,
				readyTo: undefined,
			},
			{
				actions: [F0, F1, F2, S2],
				isEmpty: true,
				readyFrom: undefined,
				readyTo: undefined,
			},
		]);
	});

	describe('there are propagation actions only', () => {
		testSequences([
			{
				actions: [G0],
				isEmpty: false,
				readyFrom: D0,
				readyTo: D0,
			},
			{
				actions: [G0, G1],
				isEmpty: false,
				readyFrom: D0,
				readyTo: D1,
			},
			{
				actions: [G0, G1, G2],
				isEmpty: false,
				readyFrom: D0,
				readyTo: D2,
			},
			{
				actions: [G0, G1, G2, S0],
				isEmpty: false,
				readyFrom: D1,
				readyTo: D2,
			},
			{
				actions: [G0, G1, G2, S1],
				isEmpty: false,
				readyFrom: D2,
				readyTo: D2,
			},
			{
				actions: [G0, G1, G2, S2],
				isEmpty: true,
				readyFrom: undefined,
				readyTo: undefined,
			},
		]);
	});

	describe('there are primary and foreign actions', () => {
		testSequences([
			{
				actions: [P0, F0],
				isEmpty: false,
				readyFrom: D0,
				readyTo: D0,
			},
			{
				actions: [P0, F0, F1],
				isEmpty: false,
				readyFrom: D0,
				readyTo: D0,
			},
			{
				actions: [P0, F0, F1, P1],
				isEmpty: false,
				readyFrom: D0,
				readyTo: D1,
			},
			{
				actions: [P0, P1, P2, F0, F1, F2],
				isEmpty: false,
				readyFrom: D0,
				readyTo: D2,
			},
			{
				actions: [F0, F1, F2, P0, P1, P2],
				isEmpty: false,
				readyFrom: D0,
				readyTo: D2,
			},
			{
				actions: [P0, P1, P2, F0, F1, F2, S0],
				isEmpty: false,
				readyFrom: D1,
				readyTo: D2,
			},
			{
				actions: [P0, P1, P2, F0, F1, F2, S1],
				isEmpty: false,
				readyFrom: D2,
				readyTo: D2,
			},
			{
				actions: [F0, F1, F2, P0, P1, P2, S2],
				isEmpty: true,
				readyFrom: undefined,
				readyTo: undefined,
			},
		]);
	});
	describe('there are primary, foreign and propagation actions', () => {
		testSequences([
			{
				actions: [P0, F1, G1],
				isEmpty: false,
				readyFrom: D0,
				readyTo: D1,
			},
			{
				actions: [P0, F1, F2, G1],
				isEmpty: false,
				readyFrom: D0,
				readyTo: D1,
			},
			{
				actions: [P0, F1, F2, G1, G2],
				isEmpty: false,
				readyFrom: D0,
				readyTo: D2,
			},
			{
				actions: [P0, F1, F2, G1, G2, S0],
				isEmpty: false,
				readyFrom: D1,
				readyTo: D2,
			},
			{
				actions: [P0, F1, F2, G1, G2, S1],
				isEmpty: false,
				readyFrom: D2,
				readyTo: D2,
			},
			{
				actions: [P0, F1, F2, G1, G2, S2],
				isEmpty: true,
				readyFrom: undefined,
				readyTo: undefined,
			},
			{
				actions: [P0, P2, F1, G1],
				isEmpty: false,
				readyFrom: D0,
				readyTo: D2,
			},
			{
				actions: [P0, P2, F1, F2, G1],
				isEmpty: false,
				readyFrom: D0,
				readyTo: D2,
			},
			{
				actions: [P0, P2, F1, F2, G1],
				isEmpty: false,
				readyFrom: D0,
				readyTo: D2,
			},
			{
				actions: [P0, P2, F1, F2, G1, S0],
				isEmpty: false,
				readyFrom: D1,
				readyTo: D2,
			},
			{
				actions: [P0, P2, F1, F2, G1, S1],
				isEmpty: false,
				readyFrom: D2,
				readyTo: D2,
			},
			{
				actions: [P0, P2, F1, F2, G1, S2],
				isEmpty: true,
				readyFrom: undefined,
				readyTo: undefined,
			},
		]);
	});

	// TODO: Add more sophisticated test cases
});
