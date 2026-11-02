FROM nginx:1.27-alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/40-generate-manifest.sh /docker-entrypoint.d/40-generate-manifest.sh
# Strip any Windows line endings so the script runs, then make it executable.
RUN sed -i 's/\r$//' /docker-entrypoint.d/40-generate-manifest.sh \
 && chmod +x /docker-entrypoint.d/40-generate-manifest.sh

COPY public/ /usr/share/nginx/html/

EXPOSE 80
