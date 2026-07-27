# Enforce Client mutation races in the database

Client mutations use database-level atomic conditions rather than a per-Client in-memory request queue: image replacement is conditional on the previously observed image reference, while password change and account deletion are conditional on the verified password state; supplied `name` and `email` fields remain last-write-wins. This preserves the confirmed conflict behavior across multiple Node.js processes and avoids process-local queue, upload-waiting, cancellation, and lock-release failure modes.
