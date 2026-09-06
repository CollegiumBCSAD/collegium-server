# Collegium Server

The backend API server for the Collegium platform

## Prerequisites

- Node.js (v20 or higher)
- pnpm
- Docker (for PostgreSQL and Redis via docker-compose)

## Setup

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   Open `.env` and fill in the values described in the [Environment Variables](#environment-variables) section below.

3. **Start local services:**
   ```bash
   docker-compose up -d
   ```
   This spins up PostgreSQL on port `5432` and Redis on port `6379`.

4. **Initialize database schema:**
   ```bash
   pnpm prisma migrate dev
   ```
   This applies migrations and generates the Prisma client.

5. **Run the server in development mode:**
   ```bash
   pnpm run start:dev
   ```
   The backend will run by default at `http://localhost:5000`.

## Environment Variables

The application loads variables from `.env`. An overview of required values:

| Variable | Description | Example / Default | Note |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://collegium_user:collegium_password@localhost:5432/collegium_dev?schema=public` | Matches database container configuration |
| `PORT` | Server listening port | `5000` | Port for the backend API |
| `NODE_ENV` | Environment mode | `development` | `development`, `production`, etc. |
| `FRONTEND_URL` | Frontend URL for CORS | `http://localhost:3000` | Address of the frontend client |
| `JWT_SECRET` | Secret key for JWT signing | `your-secret-key` | Can generate with `openssl rand -hex 32` |
| `JWT_EXPIRES_IN` | Token expiration duration | `7d` | String parsed by ms (e.g. `1h`, `7d`) |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID | `your-client-id` | From Google Cloud Console Credentials |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret | `your-client-secret` | From Google Cloud Console Credentials |
| `GOOGLE_CALLBACK_URL` | Google OAuth Callback URL | `http://localhost:5000/auth/google/callback` | Must match authorized redirect URIs in Google Cloud Console |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` | Configured in `app.module.ts`; optional for basic local dev |

## Database & Migrations

Prisma is used for schema and migration management.

- **Create a migration:**
  When schema changes are made to `prisma/schema.prisma`, generate and run a migration:
  ```bash
  pnpm prisma migrate dev --name <migration_name>
  ```
- **Draft a migration (without applying):**
  Generate a migration SQL file to review or edit before applying it to the database:
  ```bash
  pnpm prisma migrate dev --create-only --name <migration_name>
  ```
- **Generate Prisma Client:**
  Generate the Prisma Client code matching the schema:
  ```bash
  pnpm prisma generate
  ```
- **Push schema changes directly (prototyping):**
  To sync the schema with the database without generating migration files:
  ```bash
  pnpm prisma db push
  ```
- **Apply migrations (production/ci):**
  Apply existing migrations without database drift checking or prompting:
  ```bash
  pnpm prisma migrate deploy
  ```
- **Open Prisma Studio:**
  Open a browser GUI to view and edit database rows:
  ```bash
  pnpm prisma studio
  ```


## Development Scripts

```bash
# Run local dev server with watch mode
pnpm run start:dev

# Run start script in production mode
pnpm run build
pnpm run start:prod
```

## Testing

```bash
# Run unit tests
pnpm run test

# Run tests in watch mode
pnpm run test:watch

# Run e2e tests
pnpm run test:e2e

# Run test coverage
pnpm run test:cov
```
