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

test("Community membership blocks Client Account deletion through an existence query", async () => {
  const queries = [];
  const guard = createClientDeletionGuard(
    createDependencyModels({
      communityModel: {
        exists: async (query) => {
          queries.push(query);
          return { _id: "private-community-id" };
        },
      },
    }),
  );

  const result = await guard.isBlocked(clientId);

  assert.equal(result, true);
  assert.deepEqual(queries, [{ clientMembers: clientId }]);
});

test("Course enrollment blocks Client Account deletion through an existence query", async () => {
  const queries = [];
  const guard = createClientDeletionGuard(
    createDependencyModels({
      courseModel: {
        exists: async (query) => {
          queries.push(query);
          return { _id: "private-course-id" };
        },
      },
    }),
  );

  const result = await guard.isBlocked(clientId);

  assert.equal(result, true);
  assert.deepEqual(queries, [{ enrolledClientsIds: clientId }]);
});

test("Conversation participation blocks Client Account deletion through an existence query", async () => {
  const queries = [];
  const guard = createClientDeletionGuard(
    createDependencyModels({
      conversationModel: {
        exists: async (query) => {
          queries.push(query);
          return { _id: "private-conversation-id" };
        },
      },
    }),
  );

  const result = await guard.isBlocked(clientId);

  assert.equal(result, true);
  assert.deepEqual(queries, [{ client: clientId }]);
});

test("Order ownership blocks Client Account deletion through an existence query", async () => {
  const queries = [];
  const guard = createClientDeletionGuard(
    createDependencyModels({
      orderModel: {
        exists: async (query) => {
          queries.push(query);
          return { _id: "private-order-id" };
        },
      },
    }),
  );

  const result = await guard.isBlocked(clientId);

  assert.equal(result, true);
  assert.deepEqual(queries, [{ clientId }]);
});

test("Request ownership blocks Client Account deletion through an existence query", async () => {
  const queries = [];
  const guard = createClientDeletionGuard(
    createDependencyModels({
      requestModel: {
        exists: async (query) => {
          queries.push(query);
          return { _id: "private-request-id" };
        },
      },
    }),
  );

  const result = await guard.isBlocked(clientId);

  assert.equal(result, true);
  assert.deepEqual(queries, [{ clientId }]);
});

test("Review ownership blocks Client Account deletion through an existence query", async () => {
  const queries = [];
  const guard = createClientDeletionGuard(
    createDependencyModels({
      reviewModel: {
        exists: async (query) => {
          queries.push(query);
          return { _id: "private-review-id" };
        },
      },
    }),
  );

  const result = await guard.isBlocked(clientId);

  assert.equal(result, true);
  assert.deepEqual(queries, [{ clientId }]);
});

test("Post poster references block unless the discriminator is explicitly Freelancer", async (t) => {
  const cases = [
    { name: "Client", discriminator: "client", blocked: true },
    { name: "Freelancer", discriminator: "freelancer", blocked: false },
    { name: "missing", discriminator: undefined, blocked: true },
    { name: "null", discriminator: null, blocked: true },
    { name: "empty", discriminator: "", blocked: true },
    { name: "wrong case", discriminator: "Client", blocked: true },
    { name: "unknown", discriminator: "administrator", blocked: true },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const queries = [];
      const post = { posterId: clientId };
      if (testCase.discriminator !== undefined) {
        post.posterType = testCase.discriminator;
      }
      const guard = createClientDeletionGuard(
        createDependencyModels({
          postModel: {
            exists: async (query) => {
              queries.push(query);
              return Object.hasOwn(query, "posterId") &&
                post.posterId === query.posterId &&
                post.posterType !== query.posterType?.$ne
                ? { _id: "private-post-id" }
                : null;
            },
          },
        }),
      );

      const result = await guard.isBlocked(clientId);

      assert.equal(result, testCase.blocked);
      assert.deepEqual(
        queries.filter((query) => Object.hasOwn(query, "posterId")),
        [{ posterId: clientId, posterType: { $ne: "freelancer" } }],
      );
    });
  }
});

test("Post comments block only when one matching comment is not explicitly Freelancer", async (t) => {
  const otherClientId = "507f1f77bcf86cd799439012";
  const cases = [
    {
      name: "Client comment",
      comments: [{ userId: clientId, userRole: "client" }],
      blocked: true,
    },
    {
      name: "Freelancer comment",
      comments: [{ userId: clientId, userRole: "freelancer" }],
      blocked: false,
    },
    {
      name: "missing role",
      comments: [{ userId: clientId }],
      blocked: true,
    },
    {
      name: "null role",
      comments: [{ userId: clientId, userRole: null }],
      blocked: true,
    },
    {
      name: "empty role",
      comments: [{ userId: clientId, userRole: "" }],
      blocked: true,
    },
    {
      name: "wrong-case role",
      comments: [{ userId: clientId, userRole: "Client" }],
      blocked: true,
    },
    {
      name: "unknown role",
      comments: [{ userId: clientId, userRole: "administrator" }],
      blocked: true,
    },
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
  const cases = [
    { name: "Client", discriminator: "client", blocked: true },
    { name: "Freelancer", discriminator: "freelancer", blocked: false },
    { name: "missing", discriminator: undefined, blocked: true },
    { name: "null", discriminator: null, blocked: true },
    { name: "empty", discriminator: "", blocked: true },
    { name: "wrong case", discriminator: "Client", blocked: true },
    { name: "unknown", discriminator: "administrator", blocked: true },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const queries = [];
      const message = { senderId: clientId };
      if (testCase.discriminator !== undefined) {
        message.senderType = testCase.discriminator;
      }
      const guard = createClientDeletionGuard(
        createDependencyModels({
          messageModel: {
            exists: async (query) => {
              queries.push(query);
              const match =
                message.senderId === query.senderId &&
                message.senderType !== query.senderType?.$ne;
              return match ? { _id: "private-message-id" } : null;
            },
          },
        }),
      );

      const result = await guard.isBlocked(clientId);

      assert.equal(result, testCase.blocked);
      assert.deepEqual(queries, [
        { senderId: clientId, senderType: { $ne: "freelancer" } },
      ]);
    });
  }
});

test("Chatbot Conversation sender references block unless the role is explicitly Freelancer", async (t) => {
  const cases = [
    { name: "Client", discriminator: "client", blocked: true },
    { name: "Freelancer", discriminator: "freelancer", blocked: false },
    { name: "missing", discriminator: undefined, blocked: true },
    { name: "null", discriminator: null, blocked: true },
    { name: "empty", discriminator: "", blocked: true },
    { name: "wrong case", discriminator: "Client", blocked: true },
    { name: "unknown", discriminator: "administrator", blocked: true },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const queries = [];
      const conversation = { senderId: clientId };
      if (testCase.discriminator !== undefined) {
        conversation.senderRole = testCase.discriminator;
      }
      const guard = createClientDeletionGuard(
        createDependencyModels({
          chatbotConversationModel: {
            exists: async (query) => {
              queries.push(query);
              const match =
                conversation.senderId === query.senderId &&
                conversation.senderRole !== query.senderRole?.$ne;
              return match ? { _id: "private-chatbot-conversation-id" } : null;
            },
          },
        }),
      );

      const result = await guard.isBlocked(clientId);

      assert.equal(result, testCase.blocked);
      assert.deepEqual(queries, [
        { senderId: clientId, senderRole: { $ne: "freelancer" } },
      ]);
    });
  }
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
