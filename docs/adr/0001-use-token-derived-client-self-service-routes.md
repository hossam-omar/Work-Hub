# Use token-derived Client Self-Service routes

Client Self-Service uses `PATCH /clients/me`, `PATCH /clients/me/password`, and `DELETE /clients/me`, protected by Client authentication and deriving the target Client Account exclusively from the verified token. The legacy ID-targeted mutation routes are removed: preserving their compatibility would retain an unsafe, ambiguous ownership interface, while administrative Client management belongs under explicitly administrative routes.
