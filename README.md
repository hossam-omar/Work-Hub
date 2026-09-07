# Work-Hub

Work-Hub is a freelancing marketplace platform that connects clients with freelancers. Clients can browse and request services, while freelancers can publish services and communicate with clients through marketplace workflows.

## Project Status

This repository started as a graduation project and is currently being refactored into an interview-ready backend/database portfolio project. The current focus is backend and database architecture. The frontend still exists in the repository, but the active improvement phase is focused on the API, data model, security, and maintainability.

MongoDB with Mongoose is the project's chosen database direction and the active backend's only database dependency.

## Main Features

The repository includes backend modules for:

- Authentication and user account flows.
- Clients, freelancers, and admins.
- Services/gigs and categories.
- Requests and orders.
- Reviews.
- Conversations and messages.
- Communities and posts.
- Courses and professors from the original graduation-project scope.

Some modules are legacy and still being reviewed as part of the backend refactor.

## Tech Stack

**Backend**
- Node.js
- Express.js
- JavaScript ES modules

**Database**
- MongoDB
- Mongoose for schemas, models, and data access

**Frontend**
- React.js
- React Router
- Sass
- Material UI and supporting UI/chart libraries

**Tooling**
- Nodemon
- dotenv
- Joi validation

## Repository Structure

```text
Work-Hub/
  API/
    app.js
    server.js
    DB/
    src/
  Front-End/
  README.md
  AGENTS.md
```

## Backend Setup

```bash
cd API
npm install
```

Create a local environment file:

```bash
cp .env.example .env
```

On Windows PowerShell, you can copy it with:

```powershell
Copy-Item .env.example .env
```

Set the local JWT secret and ensure MongoDB is running at `CONNECTION_URL`, then start the backend:

```bash
npm run start
```

## Environment Variables

Real secrets must stay local and must not be committed.

The backend environment is documented in `API/.env.example`:

- `PORT`: Express server port.
- `CONNECTION_URL`: MongoDB connection string used by the current Mongoose implementation.
- `TOKEN_SECRETkEY`: existing JWT secret variable name used by the current auth code.
- `BEARER_KEY`: token prefix expected by current auth middleware.
- `SALT_ROUND`: password hashing salt rounds.

## Bootstrap the First Admin

The public signup flow accepts only clients and freelancers, while the existing Admin creation endpoint is intentionally protected by Admin authentication. The first Admin must therefore be created once through the MongoDB CLI bootstrap instead of through a public HTTP route.

Set these values in the local runtime environment:

- `CONNECTION_URL`
- `INITIAL_ADMIN_NAME`
- `INITIAL_ADMIN_EMAIL`
- `INITIAL_ADMIN_PASSWORD`

`SALT_ROUND` is optional. It defaults to `10` when omitted; an explicitly provided value must be an integer from `4` to `15`. Never commit real bootstrap credentials.

Run the bootstrap from the backend directory:

```bash
cd API
npm run admin:bootstrap
```

The command works only while the Admin collection is empty and uses a database uniqueness guard so concurrent bootstrap attempts cannot create multiple initial Admins. Run it while API processes that can accept new signups are stopped, because email uniqueness across the legacy account collections is application-enforced. After creation, remove the real `INITIAL_ADMIN_*` values from the runtime environment and log in through the existing `POST /api/v1/auth/login` endpoint. Create all subsequent Admins through the protected `POST /api/v1/admins/addAdmin` flow.

## Database Notes

The backend uses MongoDB with Mongoose models in `API/DB/models`. MongoDB/Mongoose is the chosen direction for ongoing database work. Legacy modules remain subject to incremental review while preserving existing collections, data, and application behavior.

`GET /api/health` reports MongoDB readiness from the Mongoose connection state. It returns HTTP `200` with `status: "ok"` when connected, or HTTP `503` with `status: "degraded"` otherwise. The JSON response contains `status`, `environment`, `timestamp`, and `mongo: { status }`.

Run the backend checks with `npm test` from `API`. Health tests cover connected, disconnected, connecting, disconnecting, and unknown MongoDB states without requiring a database connection.
