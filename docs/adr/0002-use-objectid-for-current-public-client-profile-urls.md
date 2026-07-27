# Use ObjectId for current public Client Profile URLs

The current Client-module scope uses the Client Account's MongoDB ObjectId in the public `GET /clients/:id` Client Profile URL. Readable usernames would provide a better long-term public identity, but introducing them now would require a new uniqueness lifecycle, registration and update rules, existing-data migration, and widespread caller changes; that work is deferred to a dedicated Public Profile Identity task despite the resulting temporary coupling between public URLs and MongoDB.
