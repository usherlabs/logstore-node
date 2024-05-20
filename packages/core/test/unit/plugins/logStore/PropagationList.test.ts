import { MessageRef } from '@streamr/protocol';

import { PropagationList } from '../../../../src/plugins/logStore/network/PropagationList';
import { mockStreamMessageRange } from './test-utils';

type Action = {
	name: string;
	source: 'primary' | 'foreign';
} & (
	| {
			type: 'push';
			item: MessageRef;
	  }
	| {
			type: 'finalize';
	  }
);

type Sequence = {
	actions: Action[];
	diff: MessageRef[];
	isFinalized: boolean;
};

// Test data
const [D0, D1, D2] = Array.from(
	mockStreamMessageRange(100200300, 100200303)
).map((m) => m.getMessageRef());

// Primary actions (P - stands for Primary)
const P0: Action = {
	name: 'P0',
	source: 'primary',
	type: 'push',
	item: D0,
};
const P1: Action = {
	name: 'P1',
	source: 'primary',
	type: 'push',
	item: D1,
};
const P2: Action = {
	name: 'P2',
	source: 'primary',
	type: 'push',
	item: D2,
};
const PF: Action = { name: 'PF', source: 'primary', type: 'finalize' };

// Foreign actions (F - stands for Foreign)
const F0: Action = {
	name: 'F0',
	source: 'foreign',
	type: 'push',
	item: D0,
};
const F1: Action = {
	name: 'F1',
	source: 'foreign',
	type: 'push',
	item: D1,
};
const F2: Action = {
	name: 'F2',
	source: 'foreign',
	type: 'push',
	item: D2,
};
const FF: Action = { name: 'FF', source: 'foreign', type: 'finalize' };

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
	const propagationList = new PropagationList();

	for (const action of sequence.actions) {
		switch (action.source) {
			case 'primary':
				if (action.type === 'push') {
					propagationList.pushPrimary(action.item);
				} else {
					propagationList.finalizePrimary();
				}
				break;
			case 'foreign':
				if (action.type === 'push') {
					propagationList.pushForeign(action.item);
				} else {
					propagationList.finalizeForeign();
				}
				break;
		}
	}

	const diff = propagationList.getDiffAndShrink();

	expect(diff).toEqual(sequence.diff);
	expect(propagationList.isFinalized).toEqual(sequence.isFinalized);
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

describe('PropagationList is in a proper state when', () => {
	describe('there are no actions', () => {
		testSequences([
			{
				actions: [],
				diff: [],
				isFinalized: false,
			},
		]);
	});

	describe('there are primary actions only', () => {
		testSequences([
			{
				actions: [PF],
				diff: [],
				isFinalized: false,
			},
			{
				actions: [P0, PF],
				diff: [],
				isFinalized: false,
			},
			{
				actions: [P0, P1, PF],
				diff: [],
				isFinalized: false,
			},
			{
				actions: [P0, P1, P2, PF],
				diff: [],
				isFinalized: false,
			},
		]);
	});

	describe('there are foreign actions only', () => {
		testSequences([
			{
				actions: [FF],
				diff: [],
				isFinalized: false,
			},
			{
				actions: [F0, FF],
				diff: [],
				isFinalized: false,
			},
			{
				actions: [F0, F1, FF],
				diff: [],
				isFinalized: false,
			},
			{
				actions: [F0, F1, F2, FF],
				diff: [],
				isFinalized: false,
			},
		]);
	});

	describe('there are the same primary and foreign actions', () => {
		testSequences([
			{
				actions: [PF, FF],
				diff: [],
				isFinalized: true,
			},
			{
				actions: [P0, PF, F0, FF],
				diff: [],
				isFinalized: true,
			},
			{
				actions: [P0, P1, PF, F0, F1, FF],
				diff: [],
				isFinalized: true,
			},
			{
				actions: [P0, P1, P2, PF, F0, F1, F2, FF],
				diff: [],
				isFinalized: true,
			},
		]);
	});

	describe('there are different primary and foreign actions', () => {
		describe('and the primary actions run first', () => {
			testSequences([
				{
					actions: [PF, F0],
					diff: [D0],
					isFinalized: false,
				},
				{
					actions: [PF, F0, FF],
					diff: [D0],
					isFinalized: true,
				},
				{
					actions: [PF, F0, F1],
					diff: [D0, D1],
					isFinalized: false,
				},
				{
					actions: [PF, F0, F1, FF],
					diff: [D0, D1],
					isFinalized: true,
				},
			]);
		});

		describe('and the foreign actions run first', () => {
			testSequences([
				{
					actions: [F0, PF],
					diff: [D0],
					isFinalized: false,
				},
				{
					actions: [F0, FF, PF],
					diff: [D0],
					isFinalized: true,
				},
				{
					actions: [F0, F1, PF],
					diff: [D0, D1],
					isFinalized: false,
				},
				{
					actions: [F0, F1, FF, PF],
					diff: [D0, D1],
					isFinalized: true,
				},
			]);
		});

		describe('and the actions run in a mixed order', () => {
			testSequences([
				{
					actions: [P1, PF, F2],
					diff: [D2],
					isFinalized: false,
				},
				{
					actions: [F0, F1, P0, P1, F2, PF],
					diff: [D2],
					isFinalized: false,
				},
				{
					actions: [P0, F0, F1, P2],
					diff: [D1],
					isFinalized: false,
				},
				{
					actions: [P0, F0, F1, P2, FF, PF],
					diff: [D1],
					isFinalized: true,
				},
			]);
		});
	});

	// TODO: Add more sophisticated test cases
});
