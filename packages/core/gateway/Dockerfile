FROM nginx:latest

RUN apt-get update && apt-get install -y procps

# TODO copy the standalone or network config depending on your node type
COPY ./standalone.conf /etc/nginx/conf.d/default.conf
# COPY ./network.conf /etc/nginx/conf.d/default.conf