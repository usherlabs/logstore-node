import { QueryRequest } from '@logsn/protocol';
import { EthereumAddress, Logger, MetricsContext } from '@streamr/utils';
import { Schema } from 'ajv';
import { Readable } from 'stream';
import { Stream } from 'streamr-client';

import { Plugin, PluginOptions } from '../../Plugin';
import PLUGIN_CONFIG_SCHEMA from './config.schema.json';
import { logStoreContext } from './context';
import { createDataQueryEndpoint } from './http/dataQueryEndpoint';
import { LogStore, startCassandraLogStore } from './LogStore';
import { LogStoreConfig } from './LogStoreConfig';
import { MessageListener } from './MessageListener';
import { MessageProcessor } from './MessageProcessor';
import { NodeStreamsRegistry } from './NodeStreamsRegistry';
import { ValidationSchemaManager } from './validation-schema/ValidationSchemaManager';

const logger = new Logger(module);

export interface LogStorePluginConfig {
	cassandra: {
		hosts: string[];
		username: string;
		password: string;
		keyspace: string;
		datacenter: string;
	};
	logStoreConfig: {
		refreshInterval: number;
	};
	// TODO: Do we need the cluster config for LogStore
	cluster: {
		// If clusterAddress is undefined, the node's address will be used
		clusterAddress?: EthereumAddress;
		clusterSize: number;
		myIndexInCluster: number;
	};
	programs: {
		chainRpcUrls: {
			[key: string]: string;
		};
	};
	experimental?: {
		enableValidator?: boolean;
	};
}

export abstract class LogStorePlugin extends Plugin<LogStorePluginConfig> {
	protected maybeLogStore?: LogStore;
	protected maybeLogStoreConfig?: LogStoreConfig;
	private _metricsContext?: MetricsContext;
	protected readonly messageListener: MessageListener;
	protected readonly topicsStream: Stream | null;
	protected readonly validationErrorsStream: Stream | null;
	protected readonly validationManager: ValidationSchemaManager;
	protected readonly nodeStreamsRegistry: NodeStreamsRegistry;
	private readonly messageProcessor?: MessageProcessor;

	constructor(options: PluginOptions) {
		super(options);
		this.validationErrorsStream = options.validationErrorsStream;
		this.topicsStream = options.topicsStream;
		this.nodeStreamsRegistry = new NodeStreamsRegistry(this.streamrClient);
		this.validationManager = new ValidationSchemaManager(
			this.nodeStreamsRegistry,
			this.logStoreClient,
			this.streamrClient,
			this.validationErrorsStream
		);
		this.messageListener = new MessageListener(
			this.streamrClient,
			this.validationManager
		);

		if (this.topicsStream) {
			this.messageProcessor = new MessageProcessor(
				this.pluginConfig,
				this.streamrClient,
				this.topicsStream
			);

			this.messageListener.on(
				'message',
				(msg) => this.messageProcessor?.process(msg)
			);
		}
	}

	protected get metricsContext(): MetricsContext {
		if (!this._metricsContext) {
			throw new Error('MetricsContext not initialized');
		}
		return this._metricsContext;
	}

	protected get logStore(): LogStore {
		if (!this.maybeLogStore) {
			throw new Error('LogStore not initialized');
		}
		return this.maybeLogStore;
	}

	protected get logStoreConfig(): LogStoreConfig {
		if (!this.maybeLogStoreConfig) {
			throw new Error('LogStoreConfig not initialized');
		}
		return this.maybeLogStoreConfig;
	}

	getApiAuthentication(): undefined {
		return undefined;
	}

	/**
	 * IMPORTANT: Start after logStoreConfig is initialized
	 */
	async start(): Promise<void> {
		const clientId = await this.streamrClient.getAddress();

		// Context permits usage of this object in the current execution context
		// i.e. getting the queryRequestManager inside our http endpoint handlers
		logStoreContext.enterWith({
			logStorePlugin: this,
			clientId,
		});

		this._metricsContext = (
			await this.streamrClient.getNode()
		).getMetricsContext();

		await this.validationManager.start();

		this.maybeLogStore = await this.startCassandraStorage(this.metricsContext);

		await this.messageListener.start(this.maybeLogStore, this.logStoreConfig);

		this.addHttpServerEndpoint(createDataQueryEndpoint(this.metricsContext));
	}

	async stop(): Promise<void> {
		await Promise.all([
			this.messageListener.stop(),
			this.maybeLogStore?.close(),
			this.validationManager.stop(),
			this.maybeLogStoreConfig?.destroy(),
		]);
	}

	// eslint-disable-next-line class-methods-use-this
	override getConfigSchema(): Schema {
		return PLUGIN_CONFIG_SCHEMA;
	}

	public abstract processQueryRequest(request: QueryRequest): Promise<{
		participatingNodes: string[];
		data: Readable;
	}>;

	public abstract validateUserQueryAccess(
		address: EthereumAddress
	): Promise<{ valid: true } | { valid: false; message: string }>;

	private async startCassandraStorage(
		metricsContext: MetricsContext
	): Promise<LogStore> {
		const cassandraStorage = await startCassandraLogStore({
			contactPoints: [...this.pluginConfig.cassandra.hosts],
			localDataCenter: this.pluginConfig.cassandra.datacenter,
			keyspace: this.pluginConfig.cassandra.keyspace,
			username: this.pluginConfig.cassandra.username,
			password: this.pluginConfig.cassandra.password,
			opts: {
				useTtl: false,
			},
		});
		cassandraStorage.enableMetrics(metricsContext);
		return cassandraStorage;
	}
}
