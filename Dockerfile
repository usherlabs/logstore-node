
# !!! To use this file, please run docker run at the root level of this repository
#
# Using rust:bookworm so that the builder image has OpenSSL 3.0 which is required by async-tungstenite, because
#
# (1) async-tungstenite dynamically links to the OS' OpenSSL by using openssl-sys crate (https://docs.rs/openssl/0.10.56/openssl/#automatic)
#
# (2) async-tungstenite does not utilise the "vendored" feature for its dependency crates, i.e.
# tokio-native-tls, tungstenite and native-tls. The "vendored" feature would have statically linked
# to a OpenSSL copy instead of dynamically link to the OS' OpenSSL (https://docs.rs/openssl/0.10.56/openssl/#vendored)
# — reported an issue here (https://github.com/sdroege/async-tungstenite/issues/119)
#
# (3) We want to use ubuntu:latest (22.04) as the runner image, which (only) has OpenSSL 3.0, because 
# OpenSSL 1.1.1 is reaching EOL in Sept 2023 (https://www.openssl.org/blog/blog/2023/03/28/1.1.1-EOL/)
#
# (4) Therefore, we need the builder image to have the same OpenSSL version, else the built binary will 
# try to dynamically link to a different (non-existing) version in the runner image
#
# (5) rust:latest is still using bullseye somehow which only has OpenSSL 1.1.1
FROM rust:bookworm AS builder
WORKDIR /usr/src/tlsn
COPY ./packages/mpc-tls .
COPY ./script.sh ./script.sh
RUN sh ./script.sh


FROM ubuntu:latest
RUN apt update
RUN apt install -y libsecret-1-dev cmake
# RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh | bash && nvm install node 


RUN update-alternatives --install /usr/bin/python python /usr/bin/python3 10
RUN wget -O - https://bootstrap.pypa.io/get-pip.py | python


# Install pkg-config and libssl-dev for async-tungstenite to use (as explained above)
RUN apt-get update && apt-get install -y curl && apt-get -y upgrade && apt-get install -y --no-install-recommends \
  pkg-config \
  libssl-dev \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*


RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash -

RUN apt install -y nodejs

RUN npm i -g pnpm

RUN adduser --system --group node;
USER node

WORKDIR /home/node/logstore-node

COPY --chown=node:node ./package.json ./
COPY --chown=node:node ./pnpm-lock.yaml ./
COPY --chown=node:node ./pnpm-workspace.yaml ./
COPY --chown=node:node ./tsconfig.node.json ./

COPY --chown=node:node ./packages/core/package.json ./packages/core/
# COPY --chown=node:node ./packages/core/scripts ./packages/core/scripts/
COPY --chown=node:node ./packages/core/bin ./packages/core/bin/


COPY --chown=node:node ./packages/program/package.json ./packages/program/
COPY --chown=node:node ./packages/program-evm-validate/package.json ./packages/program-evm-validate/
COPY --chown=node:node ./packages/program-solana-validate/package.json ./packages/program-solana-validate/

USER root
RUN chown -R node:node /home/node/logstore-node

USER node
WORKDIR /home/node/logstore-node


RUN pnpm install

COPY --chown=node:node ./ ./
# run the script to move the assets
RUN cd ./packages/mpc-tls/scripts && chmod +x ./move_assets.sh && sh ./move_assets.sh
RUN rm -rf packages/mpc-tls
COPY --from=builder /usr/src/tlsn/target/release/notary ./packages/core/bin
COPY --from=builder /usr/src/tlsn/target/release/prover ./packages/core/bin


# RUN  yes | curl https://sh.rustup.rs -sSf | sh -s -- -y && . "$HOME/.cargo/env" && pnpm build
# USER root
RUN pnpm build

WORKDIR /home/node

USER root
RUN mkdir /firstrun && chown node:node /firstrun
RUN npm i -g /home/node/logstore-node/packages/core

USER node
WORKDIR /home/node

COPY --chown=node:node docker/start-in-docker.sh /home/node/start-in-docker

ENTRYPOINT [ "/bin/bash" ]
CMD [ "start-in-docker" ]
