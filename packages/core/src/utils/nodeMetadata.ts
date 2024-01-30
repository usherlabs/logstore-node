import { NodeMetadata } from '@logsn/client';

export const getNodeMetadata = () => {
	const brokerMetadataString = process.env.BROKER_METADATA;
	const metadata = JSON.parse(brokerMetadataString ?? '{}') as
		| unknown
		| NodeMetadata;
	if (!metadata || typeof metadata !== 'object' || !('http' in metadata)) {
		throw new Error('Invalid metadata. Received string: brokerMetadataString');
	}
	return metadata as NodeMetadata;
};
