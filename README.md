# Collegium Server

This repository contains the backend server for the Collegium platform, built with [NestJS](https://nestjs.com/). It handles the API requests, business logic, PostgreSQL/Prisma database integration, and the Glicko-2 ranking engine.

## Prerequisites

- [Node.js](https://nodejs.org/) (v20 or higher recommended)
- [pnpm](https://pnpm.io/)
- Docker (for running PostgreSQL and Redis via docker-compose)

## Project setup

First, install the dependencies:

```bash
pnpm install
```

Start the required services using Docker Compose:

```bash
docker-compose up -d
```

## Compile and run the project

```bash
# development
pnpm run start

# watch mode (recommended for development)
pnpm run start:dev

# production mode
pnpm run start:prod
```

## Run tests

```bash
# unit tests
pnpm run test

# e2e tests
pnpm run test:e2e

# test coverage
pnpm run test:cov
```
