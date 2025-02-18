FROM node:18.18-buster

RUN apt update
RUN apt install -y libsecret-1-dev

RUN npm i -g pnpm

USER node

WORKDIR /home/node/logstore-node

COPY --chown=node:node ./package.json ./
COPY --chown=node:node ./pnpm-lock.yaml ./
COPY --chown=node:node ./pnpm-workspace.yaml ./
COPY --chown=node:node ./tsconfig.node.json ./

COPY --chown=node:node ./packages/core/package.json ./packages/core/
COPY --chown=node:node ./packages/program/package.json ./packages/program/
COPY --chown=node:node ./packages/program-evm-validate/package.json ./packages/program-evm-validate/
COPY --chown=node:node ./packages/program-solana-validate/package.json ./packages/program-solana-validate/

# Include storage-proxy as core has a devDependency on it.
# devDeps are required to actually build the monorepo.
COPY --chown=node:node ./packages/storage-proxy/package.json ./packages/storage-proxy/

RUN pnpm install

COPY --chown=node:node ./ ./

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
