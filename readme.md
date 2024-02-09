![Log Store Cover](https://github.com/usherlabs/logstore-mirror/raw/master/assets/readmes/logstore-cover.png)

# **Log Store Node**

Welcome to the repository for the Log Store Node – a critical component of the Log Store Network.

LS Node enriches your data sources with verifiability.

While primarily a part of the Log Store Network, functioning in **`network`** mode and creating a trustless, decentralized, and verifiable columnar database, we make this code available to you for use in **`standalone`** mode to create your own **Verifiable Columnar Database**.

## **Getting Started with a Standalone Node**

To set up your standalone Log Store Node, follow these steps:

1. **Configure Your Node**
	- Create a configuration file in **`standalone`** mode.
	- Define the streams you want to track and query.
	- Example configurations can be found in our `config-examples` directory.
2. **Start Your Node**:
	- Run the following command, replacing the path with your configuration file's location:
	 ```sh
	 docker run
			 -v ./path/to/logstore-config.json:/home/node/.logstore/config/default.json \
			 -v ./path/to/data:/home/node/.logstore/data \
			 -p 7774:7774 \
			 ghcr.io/usherlabs/logstore-node:latest
	 ```
	Notes:
	- `-v ./path/to/data:/home/node/.logstore/data`: this line binds your local directory to where we store messages inside the docker container. It's optional, but useful to persist data and easily inspect the database from the host.
	- `-p 7774:7774`: this line publishes the 7774 port to the host. The port may be modified in `logstore-config.json`.

That's it. Your node will start listening and storing streams determined on the configuration file.

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

## **Pushing to GitHub Docker Registry**
1. Build an image for the `Dockerfile` present at the root of this project
	```sh
	docker build -t ghcr.io/usherlabs/logstore-node:<desired-tag> -f ./Dockerfile .
	```
2. Follow [this guide](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry#authenticating-with-a-personal-access-token-classic) to get your authentication token, then login to the GitHub Container Registry:
	```sh
	export CR_PAT=YOUR_TOKEN
	echo $CR_PAT | docker login ghcr.io -u <username> --password-stdin
	```
3. Push the image
	```sh
	docker push ghcr.io/usherlabs/logstore-node:<desired-tag>
	```
4. Done! The image is now available on the GitHub Container Registry.

## **Learn More**

Explore the capabilities of running a node by diving into our [documentation](https://docs.logstore.usher.so/). Discover how our technology can and fit into your use cases and unlock powerful possibilities.

## **Get Involved**

Join our [Discord server](https://go.usher.so/discord) to engage in discussions, ask questions, and share ideas and experiences.
