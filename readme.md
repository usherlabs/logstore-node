![Log Store Cover](https://github.com/usherlabs/logstore-mirror/raw/master/assets/readmes/logstore-cover.png)

# **Log Store Node**

Welcome to the repository for the Log Store Node – a critical component of the Log Store Network.

LS Node enriches your data sources with verifiability.

While primarily a part of the Log Store Network, functioning in **`network`** mode and creating a trustless, decentralized, and verifiable columnar database, we make this code available to you for use in **`standalone`** mode to create your own **Verifiable Columnar Database**.

## **Getting Started with a Standalone Node**

To set up your standalone Log Store Node, follow these steps:

1. **Set Up CassandraDB**:
	- Install and run CassandraDB, either as a Docker service or on your preferred host.
	- Refer to **`keyspace.example.cql`** for the expected schema.
2. **Configure Your Node**
	- Create a configuration file in **`standalone`** mode.
	- Define the streams you want to track and query.
	- Example configurations can be found in our `**config-examples**` directory.
3. **Clone This Repository**:
	- Clone the repository to your local machine.
4. **Build the Docker Image**:
	- Use the following command:
	```bash
	docker build . -f ./dev-network/Dockerfile -t usherlabs/logsn-node
 	```

5. **Start Your Node**:
	- Run the following command, replacing the path with your configuration file's location:
	```bash
	docker run \
		-v ./node-config.json:/home/node/.logstore/config/default.json \
		-p 7774:7774 \
		-t usherlabs/logsn-node:latest \
		logstore-broker start
	```


## **Features**

### **Queryable Streams**

- Easily enable querying existing or your own Streamr streams through the endpoint.
- Learn how to create and publish data through streams with our [documentation](https://docs.logstore.usher.so/).
- Note: LSAN token staking is ONLY required for Network Nodes. **Standalone Nodes do not require it.**

### **Programs**

- Use predefined processes for additional data validations (e.g., verifying Ethereum contract events authenticity).
- Create and assign a **`topics`** stream for retrieval of validation results.

### **Verifiability**

- Each data item received by the Log Store is cryptographically signed.
- By using our client, data verification is performed by default on the client side for an additional security layer, ensuring data integrity.

## **Learn More**

Explore the capabilities of running a node by diving into our [documentation](https://docs.logstore.usher.so/). Discover how our technology can and fit into your use cases and unlock powerful possibilities.

## **Get Involved**

Join our [Discord server](https://go.usher.so/discord) to engage in discussions, ask questions, and share ideas and experiences.
