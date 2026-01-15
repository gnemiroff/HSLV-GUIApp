# Build-Stage
FROM node:18-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* yarn.lock* ./

RUN npm install

COPY . .

RUN npm run build

# Production-Stage mit nginx
FROM nginx:1.25-alpine

COPY --from=build /app/build /usr/share/nginx/html

# Prepare mount points

# OLD !!! 11.01.26
#RUN mkdir -p /home/data \

# Shared folder mount point (will be bind-mounted on the host).
#
# The n8n container will write result files + a "fertig" marker into this
# shared folder. We expose these folders as static paths under nginx:
#   - /results  -> /shared/out
#   - /status   -> /shared/status
#
# This keeps the React GUI container stateless while still making the
# workflow output accessible to the browser.
RUN mkdir -p /shared \
  && rm -rf /usr/share/nginx/html/results /usr/share/nginx/html/status \
  && ln -s /shared/out /usr/share/nginx/html/results \
  && ln -s /shared/status /usr/share/nginx/html/status

 
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
