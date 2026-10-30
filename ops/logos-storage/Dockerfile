# Logos Storage node behind a bearer-token proxy, for the native-log mirror.
# The release binary needs glibc >= 2.38, hence Debian trixie.
FROM caddy:2.11-alpine AS caddy

FROM debian:trixie-slim
ARG LOGOS_VERSION=v0.5.3
ARG LOGOS_SHA256=1086fae4f283cab882f133abe4d5a88cfae8d61edba9f0094c7f75b368ec9d56
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl unzip libstdc++6 libgcc-s1 \
 && curl -fsSL -o /tmp/logos.zip "https://github.com/logos-storage/logos-storage-nim/releases/download/${LOGOS_VERSION}/logos-storage-linux-amd64-${LOGOS_VERSION}.zip" \
 && echo "${LOGOS_SHA256}  /tmp/logos.zip" | sha256sum -c - \
 && unzip -q /tmp/logos.zip -d /tmp/logos \
 && install -m 0755 "/tmp/logos/logos-storage-linux-amd64-${LOGOS_VERSION}" /usr/local/bin/logos-storage \
 && rm -rf /tmp/logos /tmp/logos.zip \
 && apt-get purge -y curl unzip && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY --from=caddy /usr/bin/caddy /usr/local/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
COPY start.sh /usr/local/bin/start.sh
RUN chmod 0755 /usr/local/bin/start.sh
VOLUME /data
EXPOSE 8080
CMD ["/usr/local/bin/start.sh"]
