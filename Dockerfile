# Rann Code daemon image.
#
# Build:
#   docker build -t rann-code .
#   docker build --build-arg RANN_VERSION=0.1.1 -t rann-code:0.1.1 .
#
# Jalankan:
#   docker run --rm -it -v rann-data:/data rann-code
#
# Daemon berjalan di foreground lewat binary rannd, bukan lewat
# "rann daemon start" yang men-spawn proses latar.

ARG RANN_VERSION=latest

FROM node:22-bookworm-slim AS build
ARG RANN_VERSION
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g --prefix /opt/rann "rann-code@${RANN_VERSION}" \
  && npm cache clean --force

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    RANN_HOME=/data \
    PATH=/opt/rann/bin:$PATH \
    NPM_CONFIG_UPDATE_NOTIFIER=false

RUN groupadd --system --gid 10001 rann \
  && useradd --system --uid 10001 --gid rann --home-dir /data --shell /usr/sbin/nologin rann \
  && mkdir -p /data \
  && chown rann:rann /data

COPY --from=build /opt/rann /opt/rann

USER rann
WORKDIR /data
VOLUME ["/data"]
EXPOSE 8787

ENTRYPOINT ["/opt/rann/bin/rannd"]
