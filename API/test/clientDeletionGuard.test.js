import test from "node:test";
import assert from "node:assert/strict";
import { createClientDeletionGuard } from "../src/modules/clients/clientDeletionGuard.js";

const clientId = "507f1f77bcf86cd799439011";

const createDependencyModels = (overrides = {}) => {
  const notFound = { exists: async () => null };

  return {
    communityModel: notFound,
    courseModel: notFound,
    conversationModel: notFound,
    orderModel: notFound,
    requestModel: notFound,
    reviewModel: notFound,
    postModel: notFound,
    messageModel: notFound,
    chatbotConversationModel: notFound,
    ...overrides,
  };
};

const typedReferenceCases = [
  { name: "Client", discriminator: "client", blocked: true },
  { name: "Freelancer", discriminator: "freelancer", blocked: false },
  { name: "missing", discriminator: undefined, blocked: true },
  { name: "null", discriminator: null, blocked: true },
  { name: "empty", discriminator: "", blocked: true },
  { name: "wrong case", discriminator: "Client", blocked: true },
  { name: "unknown", discriminator: "administrator", blocked: true },
];

const assertTypedReferenceCases = async (
  t,
  { model, idField, roleField, expectedQuery, privateIdentifier },
) => {
  for (const testCase of typedReferenceCases) {
    await t.test(testCase.name, async () => {
      const queries = [];
      const record = { [idField]: clientId };
      if (testCase.discriminator !== undefined) {
        record[roleField] = testCase.discriminator;
      }
      const guard = createClientDeletionGuard(
        createDependencyModels({
          [model]: {
            exists: async (query) => {
              queries.push(query);
              const targetsReference = Object.hasOwn(query, idField);
              const match =
                targetsReference &&
                record[idField] === query[idField] &&
                record[roleField] !== query[roleField]?.$ne;
              return match ? { _id: privateIdentifier } : null;
            },
          },
        }),
      );

      const result = await guard.isBlocked(clientId);

      assert.equal(result, testCase.blocked);
      assert.deepEqual(
        queries.filter((query) => Object.hasOwn(query, idField)),
        [expectedQuery],
      );
    });
  }
};

test("every direct reference blocks Client Account deletion through its existence query", async (t) => {
  const cases = [
    {
      name: "Community membership",
      model: "communityModel",
      query: { clientMembers: clientId },
    },
    {
      name: "Course enrollment",
      model: "courseModel",
      query: { enrolledClientsIds: clientId },
    },
    {
      name: "Conversation participation",
      model: "conversationModel",
      query: { client: clientId },
    },
    { name: "Order ownership", model: "orderModel", query: { clientId } },
    { name: "Request ownership", model: "requestModel", query: { clientId } },
    { name: "Review ownership", model: "reviewModel", query: { clientId } },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const queries = [];
      const guard = createClientDeletionGuard(
        createDependencyModels({
          [testCase.model]: {
            exists: async (query) => {
              queries.push(query);
              return { _id: "private-dependency-id" };
            },
          },
        }),
      );

      const result = await guard.isBlocked(clientId);

      assert.equal(result, true);
      assert.deepEqual(queries, [testCase.query]);
    });
  }
});

test("Post poster references block unless the discriminator is explicitly Freelancer", async (t) => {
  await assertTypedReferenceCases(t, {
    model: "postModel",
    idField: "posterId",
    roleField: "posterType",
    expectedQuery: {
      posterId: clientId,
      posterType: { $ne: "freelancer" },
    },
    privateIdentifier: "private-post-id",
  });
});

test("Post comments block only when one matching comment is not explicitly Freelancer", async (t) => {
  const otherClientId = "507f1f77bcf86cd799439012";
  const cases = [
    ...typedReferenceCases.map((testCase) => {
      const comment = { userId: clientId };
      if (testCase.discriminator !== undefined) {
        comment.userRole = testCase.discriminator;
      }
      return {
        name: testCase.name,
        comments: [comment],
        blocked: testCase.blocked,
      };
    }),
    {
      name: "different comments cannot combine their fields",
      comments: [
        { userId: clientId, userRole: "freelancer" },
        { userId: otherClientId, userRole: "client" },
      ],
      blocked: false,
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const queries = [];
      const guard = createClientDeletionGuard(
        createDependencyModels({
          postModel: {
            exists: async (query) => {
              queries.push(query);
              const predicate = query.comments?.$elemMatch;
              const match = predicate
                ? testCase.comments.some((comment) => {
                    return (
                      comment.userId === predicate.userId &&
                      comment.userRole !== predicate.userRole?.$ne
                    );
                  })
                : false;
              return match ? { _id: "private-post-id" } : null;
            },
          },
        }),
      );

      const result = await guard.isBlocked(clientId);

      assert.equal(result, testCase.blocked);
      assert.deepEqual(
        queries.filter((query) => Object.hasOwn(query, "comments")),
        [
          {
            comments: {
              $elemMatch: {
                userId: clientId,
                userRole: { $ne: "freelancer" },
              },
            },
          },
        ],
      );
    });
  }
});

test("an untyped Post like blocks Client Account deletion", async () => {
  const queries = [];
  const guard = createClientDeletionGuard(
    createDependencyModels({
      postModel: {
        exists: async (query) => {
          queries.push(query);
          return Object.hasOwn(query, "likes")
            ? { _id: "private-post-id" }
            : null;
        },
      },
    }),
  );

  const result = await guard.isBlocked(clientId);

  assert.equal(result, true);
  assert.deepEqual(
    queries.filter((query) => Object.hasOwn(query, "likes")),
    [{ likes: clientId }],
  );
});

test("Message sender references block unless the discriminator is explicitly Freelancer", async (t) => {
  await assertTypedReferenceCases(t, {
    model: "messageModel",
    idField: "senderId",
    roleField: "senderType",
    expectedQuery: {
      senderId: clientId,
      senderType: { $ne: "freelancer" },
    },
    privateIdentifier: "private-message-id",
  });
});

test("Chatbot Conversation sender references block unless the role is explicitly Freelancer", async (t) => {
  await assertTypedReferenceCases(t, {
    model: "chatbotConversationModel",
    idField: "senderId",
    roleField: "senderRole",
    expectedQuery: {
      senderId: clientId,
      senderRole: { $ne: "freelancer" },
    },
    privateIdentifier: "private-chatbot-conversation-id",
  });
});

test("an unreferenced Client is unblocked after every final existence predicate is checked", async () => {
  const queries = {
    community: [],
    course: [],
    conversation: [],
    order: [],
    request: [],
    review: [],
    post: [],
    message: [],
    chatbotConversation: [],
  };
  const track = (dependency) => ({
    exists: async (query) => {
      queries[dependency].push(query);
      return null;
    },
  });
  const guard = createClientDeletionGuard({
    communityModel: track("community"),
    courseModel: track("course"),
    conversationModel: track("conversation"),
    orderModel: track("order"),
    requestModel: track("request"),
    reviewModel: track("review"),
    postModel: track("post"),
    messageModel: track("message"),
    chatbotConversationModel: track("chatbotConversation"),
  });

  const result = await guard.isBlocked(clientId);

  assert.equal(result, false);
  assert.deepEqual(queries, {
    community: [{ clientMembers: clientId }],
    course: [{ enrolledClientsIds: clientId }],
    conversation: [{ client: clientId }],
    order: [{ clientId }],
    request: [{ clientId }],
    review: [{ clientId }],
    post: [
      { posterId: clientId, posterType: { $ne: "freelancer" } },
      {
        comments: {
          $elemMatch: {
            userId: clientId,
            userRole: { $ne: "freelancer" },
          },
        },
      },
      { likes: clientId },
    ],
    message: [
      { senderId: clientId, senderType: { $ne: "freelancer" } },
    ],
    chatbotConversation: [
      { senderId: clientId, senderRole: { $ne: "freelancer" } },
    ],
  });
});

test("multiple simultaneous dependency matches still reveal only a blocked boolean", async () => {
  const guard = createClientDeletionGuard(
    createDependencyModels({
      communityModel: {
        exists: async () => ({ _id: "private-community-id" }),
      },
      orderModel: {
        exists: async () => ({ _id: "private-order-id" }),
      },
      postModel: {
        exists: async (query) => {
          return Object.hasOwn(query, "likes")
            ? { _id: "private-post-id" }
            : null;
        },
      },
    }),
  );

  const result = await guard.isBlocked(clientId);

  assert.equal(result, true);
  assert.equal(typeof result, "boolean");
});

test("every dependency persistence failure propagates unchanged", async (t) => {
  const cases = [
    { name: "Community", model: "communityModel", call: 0 },
    { name: "Course", model: "courseModel", call: 0 },
    { name: "Conversation", model: "conversationModel", call: 0 },
    { name: "Order", model: "orderModel", call: 0 },
    { name: "Request", model: "requestModel", call: 0 },
    { name: "Review", model: "reviewModel", call: 0 },
    { name: "Post poster", model: "postModel", call: 0 },
    { name: "Post comments", model: "postModel", call: 1 },
    { name: "Post likes", model: "postModel", call: 2 },
    { name: "Message", model: "messageModel", call: 0 },
    {
      name: "Chatbot Conversation",
      model: "chatbotConversationModel",
      call: 0,
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const persistenceError = new Error(
        `private ${testCase.name} persistence failure`,
      );
      let calls = 0;
      const guard = createClientDeletionGuard(
        createDependencyModels({
          [testCase.model]: {
            exists: async () => {
              const currentCall = calls;
              calls += 1;
              if (currentCall === testCase.call) throw persistenceError;
              return null;
            },
          },
        }),
      );

      await assert.rejects(
        () => guard.isBlocked(clientId),
        (receivedError) => {
          assert.equal(receivedError, persistenceError);
          return true;
        },
      );
    });
  }
});
