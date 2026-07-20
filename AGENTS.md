# AGENTS.md

This file gives instructions to AI coding agents working on Work-Hub.

## Project Context

Work-Hub is a freelancing marketplace platform being refactored into an interview-ready backend/database portfolio project. The repository contains an existing backend and frontend from a graduation project.

## Current Focus

- Work on backend/database tasks unless explicitly told otherwise.
- Backend folder: `API`
- Frontend folder: `Front-End`
- Do not touch `Front-End` unless the user explicitly requests it.

## Target Backend Direction

- Node.js
- Express.js
- PostgreSQL
- Prisma ORM
- JavaScript for now

The current active backend still uses MongoDB/Mongoose. Prisma/PostgreSQL work should be introduced gradually.

## Working Rules

- Do one small, reviewable task at a time.
- Do not rewrite the whole project in one step.
- Do not delete existing features silently.
- Before coding, inspect relevant files and explain the plan.
- Prefer existing project patterns unless the task is explicitly about improving them.
- After coding, summarize changed files, commands run, validation results, and next steps.

## Git Rules

- Work on feature branches; never commit or push directly to `main`.
- After completing and successfully testing or validating an approved task, Codex may stage the relevant files and create a focused local commit automatically, but only on a feature branch.
- Ask for the user's explicit approval before pushing any branch, merging, opening a pull request, modifying GitHub Issues or pull requests, or performing destructive Git operations.
- Do not run `git add .`.
- Stage only files relevant to the approved task.
- Keep commits small and focused.
- Never revert user changes unless the user explicitly asks.

## Safety Rules

- Never commit `.env` files.
- Never hardcode secrets, database passwords, JWT secrets, API keys, or private tokens.
- Never commit `node_modules`, logs, build folders, temporary files, uploads, local model files, or generated junk.
- Do not run destructive database commands.
- Do not reset, wipe, or recreate the database unless the user explicitly asks and understands the impact.
- Do not run forceful dependency or migration commands without a specific request.

## Backend Quality Rules

- Keep `app.js` focused on Express app setup.
- Keep `server.js` responsible for server startup and database connection.
- Keep route registration centralized.
- Separate routes, controllers, services, validators, middleware, config, and database logic where possible.
- Avoid unnecessary large architecture.
- Keep route paths stable unless the user explicitly approves an API change.
- Do not refactor auth, database models, or controller logic as part of unrelated cleanup tasks.

## Validation Rules

- Run available backend checks before reporting completion.
- Run `npm run prisma:generate` and `npx prisma validate` if Prisma files or Prisma dependencies change.
- Run `npm run start` when backend startup could be affected.
- If tests do not exist, say so clearly.
- If MongoDB is not running locally, report that separately instead of hiding the error.

## Documentation Rules

- Keep `README.md` honest and updated.
- Do not claim unfinished features as complete.
- Document current behavior separately from planned/in-progress migration work.
- Update `API/.env.example` when adding environment variables.
- Mention legacy code clearly when relevant.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues for this repository. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles use their default label strings. See `docs/agents/triage-labels.md`.

### Domain docs

This repository uses a single-context domain-doc layout. See `docs/agents/domain.md`.
