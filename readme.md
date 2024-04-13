![Log Store Cover](https://github.com/usherlabs/logstore-mirror/raw/master/assets/readmes/logstore-cover.png)

# **Log Store Node**

Welcome to the official repository for the Log Store Node – a versatile and foundational element of the Log Store Network that ensures data verifiability across systems.

The Log Store Node is designed to operate in two distinct modes to enhance the decentralized data availability network that underpins real-time cryptographic attestations:

**Network Mode**: When running in **network** mode, the Log Store Node contributes to a robust, distributed network. This collective approach provides the backbone for a decentralized system, facilitating the secure and transparent availability and notarisation of data.

**Standalone Mode**: In **standalone** mode, the Log Store Node serves as an interoperable unit within the network. It can independently prove, publish, and collect attestations regarding off-chain data and processes, interacting cohesively with network nodes to maintain the integrity and verifiability of data.

Both modes are integral to delivering a comprehensive solution that ensures the authenticity and reliability of information within the Log Store Network.

To delve into the functionalities and deployment of the Log Store Node in standalone mode, start with [the Log Store Node Documentation](https://docs.logstore.usher.so/node/quick-start/install).

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

The Standalone Log Store Node is an integral part of the Log Store Network, designed to provide a sophisticated data management and attestation framework. Here are its core features:

1. **Real-time Data Collection**: Effortlessly aggregates data from various third-party sources in real-time, facilitating dynamic and adaptive data handling.
2. **Off-chain Data and Process Proofs**: Constructs cryptographic proofs for a diverse array of off-chain data and processes, encompassing everything from operational metrics to arbitrary messages and traditional Web2 API data sources.
3. **Attestation Publishing**: Relays a consistent stream of attestations pertaining to off-chain operations, establishing a transparent and verifiable ledger of activities.
4. **Data Verifiability**: Guarantees that all data is cryptographically signed and verifiable, forming a reliable base for Smart Contracts and Zero-Knowledge (ZK) Circuits.
5. **Data Availability**: Enables seamless integration with Log Store Network Nodes to assure that all disseminated data is accessible for queries and validation processes.
6. **Private and Encrypted**: Provides the capability to emit verifiable attestations and real-world data to private Streams, where data is automatically encrypted and key-based access is controlled through secure invitations.
7. **Queries**: Facilitates the capability to query collected data within your Node, making it accessible for other services.
8. **Web2-like Interfaces**: Designed with HTTP and similar network interfaces in mind, the Node offers straightforward integration capabilities, bypassing the need for deep SDK knowledge or reliance on complex embedded components.
9. **Validation over Data**: Empowers you to define data schemas on-chain, ensuring that your Node acknowledges validation prerequisites prior to finalizing data storage, as detailed here: [Schema Validation Documentation](https://docs.logstore.usher.so/network/sdk/schema).

<<<<<<< HEAD

## Explore Further

=======

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

> > > > > > > feature/t-node

For more detailed insights into each feature and instructions on how to harness the full potential of the Log Store, visit our [comprehensive documentation](https://docs.logstore.usher.so/). Whether you are looking to enhance your decentralized data management strategies or integrate advanced attestation mechanisms, the Log Store provides the tools and guidance necessary to elevate your operations.

## **Get Involved**

Join our [Discord server](https://go.usher.so/discord) to engage in discussions, ask questions, and share ideas and experiences.
