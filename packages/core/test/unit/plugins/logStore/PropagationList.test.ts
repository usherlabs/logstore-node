import { MessageRef } from '@streamr/protocol';

import { PropagationList } from '../../../../src/plugins/logStore/network/PropagationList';
import { mockStreamMessageRange } from './test-utils';

type Action = {
	node: 'primary' | 'foreign';
} & (
	| {
			index: number;
			data: MessageRef;
	  }
	| {
			index: 'finalize';
	  }
);

interface Sequence {
	actions: Action[];
	diff: MessageRef[];
	isFinalized: boolean;
}

// Test data
const data = Array.from(mockStreamMessageRange(100200300, 100200303)).map((m) =>
	m.getMessageRef()
);

// Primary actions
const P0: Action = { node: 'primary', index: 0, data: data[0] };
const P1: Action = { node: 'primary', index: 1, data: data[1] };
const P2: Action = { node: 'primary', index: 2, data: data[2] };
const PF: Action = { node: 'primary', index: 'finalize' };

// Foreign actions
const F0: Action = { node: 'foreign', index: 0, data: data[0] };
const F1: Action = { node: 'foreign', index: 1, data: data[1] };
const F2: Action = { node: 'foreign', index: 2, data: data[2] };
const FF: Action = { node: 'foreign', index: 'finalize' };

function sequenceToString(sequence: Sequence) {
	if (!sequence.actions.length) {
		return 'no actions';
	}

	return sequence.actions.reduce((name, action) => {
		const delimiter = name ? '-' : '';
		const nodeStr = action.node[0].toUpperCase();
		const dataStr = action.index == 'finalize' ? 'F' : action.index;
		return `${name}${delimiter}${nodeStr}${dataStr}`;
	}, '');
}

function tеstCasesFromSequences(sequences: Sequence[]) {
	return sequences.map((sequence) => [
		sequenceToString(sequence),
		sequence,
	]) as [string, Sequence][];
}

function runSequence(sequence: Sequence) {
	const propagationList = new PropagationList();

	for (const action of sequence.actions) {
		switch (action.node) {
			case 'primary':
				if (action.index !== 'finalize') {
					propagationList.pushPrimary(data[action.index]);
				} else {
					propagationList.finalizePrimary();
				}
				break;
			case 'foreign':
				if (action.index !== 'finalize') {
					propagationList.pushForeign(data[action.index]);
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

describe('PropagationList is in a proper state when', () => {
	describe('there are no actions', () => {
		const testCases = tеstCasesFromSequences([
			{
				actions: [],
				diff: [],
				isFinalized: false,
			},
		]);

		test.each(testCases)('Sequence of %s', (_name, sequence) => {
			runSequence(sequence);
		});
	});

	describe('there are primary actions only', () => {
		const testCases = tеstCasesFromSequences([
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

		test.each(testCases)('Sequence of %s', (_name, sequence) => {
			runSequence(sequence);
		});
	});

	describe('there are foreign actions only', () => {
		const testCases = tеstCasesFromSequences([
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

		test.each(testCases)('Sequence of %s', (_name, sequence) => {
			runSequence(sequence);
		});
	});

	describe('there are the same primary and foreign actions', () => {
		const testCases = tеstCasesFromSequences([
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

		test.each(testCases)('Sequence of %s', (_name, sequence) => {
			runSequence(sequence);
		});
	});

	describe('there are different primary and foreign actions', () => {
		describe('and the primary actions run first', () => {
			const testCases = tеstCasesFromSequences([
				{
					actions: [PF, F0],
					diff: [F0.data],
					isFinalized: false,
				},
				{
					actions: [PF, F0, FF],
					diff: [F0.data],
					isFinalized: true,
				},
				{
					actions: [PF, F0, F1],
					diff: [F0.data, F1.data],
					isFinalized: false,
				},
				{
					actions: [PF, F0, F1, FF],
					diff: [F0.data, F1.data],
					isFinalized: true,
				},
			]);

			test.each(testCases)('Sequence of %s', (_name, sequence) => {
				runSequence(sequence);
			});
		});

		describe('and the foreign actions run first', () => {
			const testCases = tеstCasesFromSequences([
				{
					actions: [F0, PF],
					diff: [F0.data],
					isFinalized: false,
				},
				{
					actions: [F0, FF, PF],
					diff: [F0.data],
					isFinalized: true,
				},
				{
					actions: [F0, F1, PF],
					diff: [F0.data, F1.data],
					isFinalized: false,
				},
				{
					actions: [F0, F1, FF, PF],
					diff: [F0.data, F1.data],
					isFinalized: true,
				},
			]);

			test.each(testCases)('Sequence of %s', (_name, sequence) => {
				runSequence(sequence);
			});
		});

		describe('and the actions run in a mixed order', () => {
			const testCases = tеstCasesFromSequences([
				{
					actions: [P1, PF, F2],
					diff: [F2.data],
					isFinalized: false,
				},
				{
					actions: [F0, F1, P0, P1, F2, PF],
					diff: [F2.data],
					isFinalized: false,
				},
				{
					actions: [P0, F0, F1, P2],
					diff: [F1.data],
					isFinalized: false,
				},
				{
					actions: [P0, F0, F1, P2, FF, PF],
					diff: [F1.data],
					isFinalized: true,
				},
			]);

			test.each(testCases)('Sequence of %s', (_name, sequence) => {
				runSequence(sequence);
			});
		});
		// TODO: Add more sophisticated test cases
	});
});
