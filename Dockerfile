# Kept in step with .nvmrc; Angular 22 refuses to run on an unsupported Node.
FROM node:22.23.2 AS build-stage
WORKDIR /app
COPY . .
RUN npm ci
EXPOSE 8080
CMD ["npm", "run", "start", "--", "--port=8080", "--host=0.0.0.0", "--watch"]
