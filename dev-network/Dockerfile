FROM node:18.18-buster

RUN apt update
RUN apt install -y libsecret-1-dev

RUN update-alternatives --install /usr/bin/python python /usr/bin/python3 10
RUN wget -O - https://bootstrap.pypa.io/get-pip.py | python

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

RUN pnpm install

COPY --chown=node:node ./ ./

RUN pnpm build

WORKDIR /home/node

USER root
RUN mkdir /firstrun && chown node:node /firstrun
RUN npm i -g /home/node/logstore-node/packages/core

USER node
WORKDIR /home/node

CMD [ "start-in-docker" ]
