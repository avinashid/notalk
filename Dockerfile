# ==============================================================================
# Protocol Zero — 100% Serverless P2P Web Chat (Ultra-Lightweight Static Nginx)
# Image Size: ~5MB
# ==============================================================================
FROM nginx:alpine

# Remove default nginx static assets
RUN rm -rf /usr/share/nginx/html/*

# Copy custom Nginx configuration
COPY web-p2p/nginx.conf /etc/nginx/conf.d/default.conf

# Copy static frontend assets
COPY web-p2p/*.html /usr/share/nginx/html/
COPY web-p2p/*.css /usr/share/nginx/html/
COPY web-p2p/*.js /usr/share/nginx/html/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost/health || exit 1

CMD ["nginx", "-g", "daemon off;"]

