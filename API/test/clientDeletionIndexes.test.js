import test from "node:test";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import ChatbotConversationModel from "../DB/models/chatbotConversation_model.js";
import CommunityModel from "../DB/models/community_model.js";
import ConversationModel from "../DB/models/conversation_model.js";
import CourseModel from "../DB/models/course_model.js";
import MessageModel from "../DB/models/message_model.js";
import OrderModel from "../DB/models/order_model.js";
import PostModel from "../DB/models/post_model.js";
import RequestModel from "../DB/models/request_model.js";
import ReviewModel from "../DB/models/review_model.js";

// The merged guard has no $or predicate, so no branch-specific rows apply.
const predicateIndexCoverage = Object.freeze([
  {
    operation: "Chatbot Conversation sender",
    kind: "polymorphic ambiguous discriminator",
    predicate: "senderId = ClientId AND senderRole != freelancer",
    model: ChatbotConversationModel,
    index: { senderId: 1, senderRole: 1 },
    coverage: "selected after explain",
  },
  {
    operation: "Community membership",
    kind: "direct multikey",
    predicate: "clientMembers = ClientId",
    model: CommunityModel,
    index: { clientMembers: 1 },
    coverage: "existing index reuse",
  },
  {
    operation: "Course enrollment",
    kind: "direct multikey",
    predicate: "enrolledClientsIds = ClientId",
    model: CourseModel,
    index: { enrolledClientsIds: 1 },
    coverage: "selected after explain",
  },
  {
    operation: "Conversation participation",
    kind: "direct reference",
    predicate: "client = ClientId",
    model: ConversationModel,
    index: { client: 1 },
    coverage: "selected after explain",
  },
  {
    operation: "Message sender",
    kind: "polymorphic ambiguous discriminator",
    predicate: "senderId = ClientId AND senderType != freelancer",
    model: MessageModel,
    index: { senderId: 1, senderType: 1 },
    coverage: "selected after explain",
  },
  {
    operation: "Order ownership",
    kind: "direct reference",
    predicate: "clientId = ClientId",
    model: OrderModel,
    index: { clientId: 1 },
    coverage: "selected after explain",
  },
  {
    operation: "Post poster",
    kind: "polymorphic ambiguous discriminator",
    predicate: "posterId = ClientId AND posterType != freelancer",
    model: PostModel,
    index: { posterType: 1, posterId: 1 },
    coverage: "existing index reuse",
  },
  {
    operation: "Post comment",
    kind: "nested same-array polymorphic discriminator",
    predicate:
      "comments elemMatch userId = ClientId AND userRole != freelancer",
    model: PostModel,
    index: { "comments.userId": 1, "comments.userRole": 1 },
    coverage: "selected after explain",
  },
  {
    operation: "Post like",
    kind: "untyped direct multikey",
    predicate: "likes = ClientId",
    model: PostModel,
    index: { likes: 1 },
    coverage: "selected after explain",
  },
  {
    operation: "Request ownership",
    kind: "direct reference",
    predicate: "clientId = ClientId",
    model: RequestModel,
    index: { clientId: 1 },
    coverage: "selected after explain",
  },
  {
    operation: "Review ownership",
    kind: "direct reference",
    predicate: "clientId = ClientId",
    model: ReviewModel,
    index: { clientId: 1 },
    coverage: "selected after explain",
  },
]);

const findExactIndexes = (model, expectedKeys) => {
  return model.schema.indexes().filter(([actualKeys]) => {
    return isDeepStrictEqual(
      Object.entries(actualKeys),
      Object.entries(expectedKeys),
    );
  });
};

test("the Client deletion predicate matrix has exact non-duplicated index coverage", async (t) => {
  for (const entry of predicateIndexCoverage) {
    await t.test(entry.operation, () => {
      const matches = findExactIndexes(entry.model, entry.index);

      assert.equal(matches.length, 1, `${entry.predicate}: ${entry.coverage}`);
      const [, options] = matches[0];
      assert.equal(options.unique, undefined);
      assert.equal(options.sparse, undefined);
      assert.equal(options.partialFilterExpression, undefined);
    });
  }
});

test("the existing Post poster prefix is reused without a redundant reversal", () => {
  assert.equal(
    findExactIndexes(PostModel, { posterId: 1, posterType: 1 }).length,
    0,
  );
});

test("the matrix covers every final predicate and records proven index reuse", () => {
  assert.equal(predicateIndexCoverage.length, 11);
  assert.deepEqual(
    predicateIndexCoverage
      .filter(({ coverage }) => coverage === "existing index reuse")
      .map(({ operation }) => operation),
    ["Community membership", "Post poster"],
  );
});

test("Post array indexes never combine independent array paths", () => {
  const postIndexes = PostModel.schema.indexes().map(([keys]) => keys);

  assert.equal(
    postIndexes.some((keys) => {
      const fields = Object.keys(keys);
      return (
        fields.includes("likes") &&
        fields.some((field) => field.startsWith("comments."))
      );
    }),
    false,
  );
});
