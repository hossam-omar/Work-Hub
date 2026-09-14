# Work-Hub Marketplace

Work-Hub connects Clients who commission work with Freelancers who provide services.

## Language

**Client**:
A marketplace participant who commissions work from Freelancers.

**Client Profile**:
The public marketplace representation of a Client.

**Client Account**:
The private identity and security record through which a Client accesses Work-Hub.

**Client Self-Service**:
Management by an authenticated Client of that Client's own Client Account. It does not include administrative management of another Client.

**Client Administration**:
Management of Client Accounts by an authorized Administrator, separate from Client Self-Service.

## Context Boundary

Work-Hub may be refactored across modules when doing so improves its safety and maintainability. Existing API shapes are not domain constraints; Client Self-Service and Client Administration should remain explicit, separate capabilities.

## Confirmed Client Contract

Public Client Profiles are available through `GET /clients` and `GET /clients/:id`. Both operations expose exactly `id`, `name`, `imageUrl`, `coverImageUrl`, and `country`. All other Client Account data and any fields added to its persistence model in the future remain private unless deliberately added to this allowlist.

`GET /clients` returns `200 OK` with `{"clients":[...],"pagination":{...}}` for both populated and empty results. An empty collection is successful and is not a `404 Not Found`. The endpoint accepts optional positive-integer `page` and `limit` query parameters, defaulting to `page=1` and `limit=20`; `limit` is capped at 100 so the public query remains bounded. The `pagination` object exposes exactly `page`, `limit`, `totalClients`, `totalPages`, `hasNextPage`, and `hasPreviousPage`. An empty collection has `totalClients: 0`, `totalPages: 0`, and both navigation flags set to `false`.

When a valid requested `page` exceeds `totalPages`, `GET /clients` returns `200 OK` with an empty `clients` array, preserves the requested page and actual totals, and sets `hasNextPage` to `false`. `hasPreviousPage` is `true` only when `page > 1` and at least one earlier result page exists; an entirely empty collection keeps both navigation flags `false`.

`GET /clients` orders profiles by `createdAt` descending and then `_id` descending as a deterministic tie-breaker for offset pagination. These persistence fields control ordering but are not exposed in the public representation.

Public Client Profile image fields contain normalized `/uploads/{filename}` paths or `null` when absent. They never contain filesystem paths or origins derived from request headers.

Client Self-Service is available through `PATCH /clients/me`, `PATCH /clients/me/password`, and `DELETE /clients/me`. These operations require Client authentication and use the authenticated Client's identity as their only target; they do not accept a Client identifier through path parameters, query parameters, or request bodies. Identity fields supplied in mutation bodies are invalid. Client Self-Service provides no administrative bypass.

`PATCH /clients/me/password` accepts exactly the required body fields `currentPassword`, `newPassword`, and `confirmPassword`. Missing fields and every additional body field are invalid. This contract deliberately replaces the legacy Client field names `password`, `newPassword`, and `confirmNewPassword` and matches the newer Admin convention.

Only `newPassword` is validated against the existing shared password policy: at least eight characters, including an uppercase letter, lowercase letter, digit, and one of `@#$%^&+=!`, with no whitespace. `currentPassword` is not policy-validated because a legitimate legacy credential may predate that policy. `confirmPassword` is checked only for exact equality with `newPassword`. Broader password-policy modernization is outside this Client-module task.

If `currentPassword` does not match the authenticated Client's stored password, the operation returns `400 Bad Request` with `Current password is incorrect.` It does not return `401 Unauthorized`, because bearer-token authentication has already succeeded.

If `confirmPassword` does not exactly equal `newPassword`, the operation returns `400 Bad Request` with `Password confirmation does not match.` The response never echoes a submitted password.

If `newPassword` fails the shared password policy, the operation returns `400 Bad Request` with `New password does not meet requirements.` The API documentation may describe the requirements, but the response does not contain raw validator or regular-expression details or echo the submitted value.

If `newPassword` matches the authenticated Client's current password, the operation returns `400 Bad Request` with `New password must be different from current password.` A same-password request is not reported as a successful change.

On a successful password change, the new password hash, `token: null`, and `activityStatus: "offline"` are persisted together in one database mutation. Clearing the stored token invalidates the request credential and every token under the current single-token Client authentication model, so the Client must sign in again. The offline activity state reflects that no valid Client session remains.

After a successful `PATCH /clients/me/password`, the API returns `200 OK` with `{"message":"Password updated successfully. Please sign in again."}`. It returns no Client representation or token because the prior credential has been revoked.

`DELETE /clients/me` requires exactly one body field, `currentPassword`, in addition to the authenticated Client token. Missing fields and every additional body field are invalid. This credential confirmation protects the irreversible deletion while the authenticated Client identity remains the operation's only target.

If the deletion `currentPassword` does not match the authenticated Client's stored password, the operation returns `400 Bad Request` with `Current password is incorrect.` It does not return an authentication failure because the bearer token was already accepted.

Client self-deletion is blocked while any `Community.clientMembers`, `Course.enrolledClientsIds`, `Conversation.client`, `Order.clientId`, `Request.clientId`, or `Review.clientId` value references the Client. Every matching reference blocks deletion regardless of lifecycle status or record age. The guard uses existence checks and neither loads nor exposes the dependent records. It returns a generic `409 Conflict` rather than deleting the Client Account and silently orphaning records. Cascading, unlinking, or anonymizing data owned by those modules is outside this Client-module task.

Any dependency collision returns `409 Conflict` with `Client account cannot be deleted while related records exist.` The same response applies to every dependency type and does not expose collections, record types, identifiers, statuses, or counts.

The dependency pre-check and Client deletion are not atomic across the separate collections. A related record can be created after the checks and before deletion, so the guard cannot fully prevent every concurrent orphan. Full referential enforcement would require coordinated changes to every dependent module's write path, including transactional Client-existence enforcement, and remains outside this Client-module task.

After a successful `DELETE /clients/me`, the API returns `200 OK` with `{"message":"Client account deleted successfully."}` and no deleted Client representation or token. Database deletion is the success boundary; subsequent best-effort image cleanup does not change this response.

If the authenticated Client disappears after authentication but before this request's deletion executes, `DELETE /clients/me` returns `404 Not Found` with `Client account not found.` It does not report success when this request deleted nothing and does not reclassify the race as an authentication failure.

Unexpected database failures in Client Self-Service return `500 Internal Server Error` with `{"message":"Internal server error."}`. The underlying error is logged internally, but MongoDB messages, stack traces, collection names, query details, and filesystem paths are not exposed. This generic response does not replace the specific email-conflict mappings or alter the documented cleanup-error precedence.

`PATCH /clients/me` accepts only optional `name` and `email` body fields and, for multipart requests, at most one optional file field named `image`. Image references are never accepted as body fields. Query parameters and every body or file field outside this allowlist are invalid. A request must contain at least one allowed input, although the supplied value need not differ from its stored value. The update is constructed only from validated allowed inputs; password, country, cover-image, identity, authorization, security, activity, and persistence fields are outside this operation.

Structural request-shape violations in Client Self-Service return `400 Bad Request` with `{"message":"Invalid request."}`. This includes unexpected query or body fields, wrong or multiple file fields, missing required password or deletion fields, and a profile PATCH with no allowed input. The response does not echo field names or raw Multer or Joi details. Invalid field values, invalid image content, and email conflicts retain their more specific responses.

Invalid `name` and `email` values return `400 Bad Request` with `{"message":"Validation failed.","errors":{...}}`. The `errors` object includes every invalid supplied allowlisted field and no others. Its fixed messages are `Name must be between 2 and 100 characters.` for `name` and `Email must be a valid email address.` for `email`. The response does not echo submitted values or raw validator text.

After a successful `PATCH /clients/me`, the API returns `200 OK` with `{"message":"Client profile updated successfully.","client":{...}}`. The `client` property contains the persisted, sanitized Client self representation. The operation does not return `204 No Content` or a message-only response; the representation supplies the authoritative normalized values and retained image reference without requiring another request. The self representation exposes exactly `id`, `name`, `email`, `imageUrl`, `coverImageUrl`, and `country`. Password, token, role, activity data, counters, timestamps, `_id`, `__v`, and every other persistence or security field remain private.

When a request supplies only `name` and/or `email` values that normalize to the authenticated Client's current values and supplies no image, `PATCH /clients/me` is a genuine no-op. It skips the database write, does not change `updatedAt`, and returns the same successful `200 OK` envelope using the stored Client representation.

When supplied to Client Self-Service, `name` is trimmed and must contain 2–100 characters after trimming. Names may contain Unicode and ordinary punctuation. `email` is trimmed, lowercased, limited to 254 characters, and validated as an email address without a restricted top-level-domain list. The normalized values are the values checked and persisted.

The normalized email is logically unique across Admin, Client, and Freelancer accounts. Before a Client Profile update changes or reuses an email, all Admin and Freelancer accounts and all Client accounts except the authenticated Client identified by `req.user._id` are checked for that normalized email. Reusing the authenticated Client's current normalized email is valid and may succeed as a no-op. Any collision aborts the entire profile mutation and returns `409 Conflict` with `Email is already in use.` regardless of the conflicting account's role or collection; the response never reveals who owns the email.

The Client collection retains a unique email index as race protection within that collection. Only a duplicate-key failure identified as involving the Client email field maps to the same generic `409 Conflict`; unrelated duplicate-key failures do not. The cross-role pre-check is not atomic across the separate Admin, Client, and Freelancer collections, so concurrent writes can still violate logical cross-role uniqueness. Full atomic enforcement requires a shared identity store or unified account model and is outside this Client-module task.

Because a Client Profile update may include a newly uploaded image, its later file-lifecycle contract must require best-effort cleanup of that new file whenever an email conflict, email-related Client duplicate-key failure, validation failure, or database failure aborts the update.

Client image uploads accept only JPEG, PNG, or WebP files up to 5 MiB. Acceptance requires the file's actual content signature to match its declared format in addition to the existing MIME-type and filename-extension checks. Spoofed, malformed, mismatched, or otherwise invalid image content aborts the update and the newly uploaded file is cleaned up under the failure lifecycle rule.

An image that exceeds the 5 MiB limit returns `413 Payload Too Large`. Any partial file created before the limit is detected is cleaned up.

Every other invalid-image failure, including an unsupported type, unsafe extension, content-signature mismatch, or malformed content, returns `400 Bad Request` with `Invalid image file.` The response does not include the submitted filename or parser details; more specific diagnostics are internal only.

File cleanup makes exactly one best-effort attempt during the request. An already-missing file is a successful cleanup outcome. There are no synchronous retries, retry queues, scheduled reconciliation jobs, or repository-wide orphan-file sweepers in this Client-module task because retrying within the request adds latency without durable recovery guarantees.

If cleanup fails, an actionable internal log records the cleanup phase and operation, a safe relative file identifier or path, the underlying filesystem error code and message, and an available request or correlation identifier. Cleanup logs and API responses never include tokens, credentials, request bodies, unnecessary account data, or exposed filesystem paths. If the main operation failed, its original status and response are preserved; if its database mutation succeeded, its successful response is preserved. Cleanup failure never masks or replaces the primary outcome.

A failed best-effort cleanup may leave an orphaned file; this is an accepted limitation. Durable retries and orphan-file reconciliation require broader storage-lifecycle infrastructure and remain outside this task.

After a successful Client Profile image replacement, the database update is completed before best-effort deletion of the previous locally managed Client image. External URLs, default or shared assets, unsafe paths, and the newly retained file are never deletion targets. Failure to delete the previous file is logged but does not turn the successful profile update into an error.

After a successful `DELETE /clients/me`, the Client Account is deleted from the database before best-effort deletion of its locally managed profile and cover images. External URLs, default or shared assets, and unsafe paths are never deletion targets. File cleanup failure is logged but does not change the successful account-deletion response; if database deletion fails, no referenced image is deleted.

Client Administration is a separate capability. Future administrative operations must use explicitly administrative routes and authorization, such as `/admins/clients/:id`, and are outside the current Client-module task.
