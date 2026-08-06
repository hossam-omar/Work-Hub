import test from "node:test";
import assert from "node:assert/strict";
import Conversation from "../DB/models/conversation_model.js";
import Order from "../DB/models/order_model.js";
import Request from "../DB/models/request_model.js";
import Review from "../DB/models/review_model.js";
import {
  addConversation,
  getAllConversations,
  getConversationById,
  getConversationsByUserId,
} from "../src/modules/conversations/conversationsController.js";
import {
  getAllOrders,
  getUserOrders,
} from "../src/modules/orders/ordersController.js";
import {
  getAllRequests,
  getClientRequests,
  getFreelancerRequests,
  getUserRequests,
} from "../src/modules/requests/requestsController.js";
import { getServiceReviews } from "../src/modules/reviews/reviewController.js";

const clientProjection = {
  _id: 1,
  name: 1,
  image_url: 1,
  coverImage_url: 1,
  country: 1,
};

const populatedClient = {
  _id: "507f1f77bcf86cd799439011",
  name: "Ada Client",
  image_url: "client-profile.jpg",
  coverImage_url: "client-cover.jpg",
  country: "Egypt",
  email: "private@example.com",
  password: "password-hash",
  token: "private-token",
  activityStatus: "online",
  ordersCount: 9,
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
  __v: 3,
  futurePrivateField: "must never leak",
};

const expectedClient = {
  _id: populatedClient._id,
  name: populatedClient.name,
  image_url: populatedClient.image_url,
  coverImage_url: populatedClient.coverImage_url,
  country: populatedClient.country,
};

const createResponse = () => {
  return {
    statusCode: undefined,
    body: undefined,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
};

const createPopulatedQuery = ({ populationCalls, result }) => {
  return {
    populate(path, projection) {
      populationCalls.push({ path, projection });
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
};

test("Conversation responses expose only their explicit Client allowlist", async (t) => {
  const originalFind = Conversation.find;
  const populationCalls = [];
  const conversation = {
    _doc: {
      _id: "conversation-1",
      conversationName: "Portfolio project",
      futureConversationField: "preserved",
      freelancer: { _id: "freelancer-1", name: "Grace Freelancer" },
      client: { _doc: populatedClient },
    },
  };
  Conversation.find = () =>
    createPopulatedQuery({ populationCalls, result: [conversation] });
  t.after(() => {
    Conversation.find = originalFind;
  });
  const response = createResponse();

  await getAllConversations({}, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(populationCalls, [
    { path: "freelancer", projection: undefined },
    { path: "client", projection: clientProjection },
  ]);
  assert.deepEqual(response.body, {
    allConversations: [
      {
        _id: "conversation-1",
        conversationName: "Portfolio project",
        futureConversationField: "preserved",
        freelancer: { _id: "freelancer-1", name: "Grace Freelancer" },
        client: expectedClient,
      },
    ],
  });
});

test("a single Conversation response cannot serialize future Client fields", async (t) => {
  const originalFindById = Conversation.findById;
  const populationCalls = [];
  const conversation = {
    _doc: {
      _id: "conversation-2",
      lastMessage: "Required conversation data",
      freelancer: {
        _id: "freelancer-2",
        name: "Lin Freelancer",
        image_url: "freelancer-profile.jpg",
      },
      client: populatedClient,
    },
  };
  Object.assign(conversation, conversation._doc);
  Conversation.findById = () =>
    createPopulatedQuery({ populationCalls, result: conversation });
  t.after(() => {
    Conversation.findById = originalFindById;
  });
  const response = createResponse();

  await getConversationById(
    { params: { id: "conversation-2" }, hostname: "api.test" },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(populationCalls, [
    { path: "freelancer", projection: undefined },
    { path: "client", projection: clientProjection },
  ]);
  assert.deepEqual(response.body, {
    conversationData: {
      _id: "conversation-2",
      lastMessage: "Required conversation data",
      freelancer: {
        _id: "freelancer-2",
        name: "Lin Freelancer",
        image_url: "http://api.test:3000/uploads/freelancer-profile.jpg",
      },
      client: {
        ...expectedClient,
        image_url: "http://api.test:3000/uploads/client-profile.jpg",
      },
    },
  });
});

test("user Conversation responses preserve messages while allowlisting Clients", async (t) => {
  const originalDeleteMany = Conversation.deleteMany;
  const originalFind = Conversation.find;
  const deleteFilters = [];
  const findFilters = [];
  const populationCalls = [];
  const conversation = {
    _doc: {
      _id: "conversation-3",
      lastMessage: { _id: "message-1", messageContent: "Required message" },
      freelancer: {
        _doc: {
          _id: "freelancer-3",
          name: "Margaret Freelancer",
          image_url: "freelancer-three.jpg",
        },
      },
      client: { _doc: populatedClient },
    },
  };
  Conversation.deleteMany = async (filter) => {
    deleteFilters.push(filter);
  };
  Conversation.find = (filter) => {
    findFilters.push(filter);
    return createPopulatedQuery({ populationCalls, result: [conversation] });
  };
  t.after(() => {
    Conversation.deleteMany = originalDeleteMany;
    Conversation.find = originalFind;
  });
  const response = createResponse();

  await getConversationsByUserId(
    { params: { id: "freelancer-3" }, hostname: "api.test" },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(deleteFilters, [{ lastMessage: undefined }]);
  assert.deepEqual(findFilters, [{ freelancer: "freelancer-3" }]);
  assert.deepEqual(populationCalls, [
    { path: "freelancer", projection: undefined },
    { path: "client", projection: clientProjection },
    { path: "lastMessage", projection: undefined },
  ]);
  assert.deepEqual(response.body, {
    result: [
      {
        _id: "conversation-3",
        lastMessage: {
          _id: "message-1",
          messageContent: "Required message",
        },
        freelancer: {
          _id: "freelancer-3",
          name: "Margaret Freelancer",
          image_url: "http://api.test:3000/uploads/freelancer-three.jpg",
        },
        client: {
          ...expectedClient,
          image_url: "http://api.test:3000/uploads/client-profile.jpg",
        },
      },
    ],
  });
});

test("new Conversation responses cannot reintroduce private Client fields", async (t) => {
  const originalFind = Conversation.find;
  const originalFindOne = Conversation.findOne;
  const originalSave = Conversation.prototype.save;
  const populationCalls = [];
  const newConversationResponse = {
    _doc: {
      _id: "conversation-4",
      conversationName: "New conversation",
      freelancer: { _id: "freelancer-4", email: "kept@example.com" },
      client: { _doc: populatedClient },
    },
  };
  Conversation.findOne = async () => null;
  Conversation.prototype.save = async function saveConversation() {
    return this;
  };
  Conversation.find = () =>
    createPopulatedQuery({
      populationCalls,
      result: [newConversationResponse],
    });
  t.after(() => {
    Conversation.find = originalFind;
    Conversation.findOne = originalFindOne;
    Conversation.prototype.save = originalSave;
  });
  const response = createResponse();

  await addConversation(
    {
      body: {
        conversationName: "New conversation",
        freelancer: "freelancer-4",
        client: populatedClient._id,
      },
    },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(populationCalls, [
    {
      path: "freelancer",
      projection: { _id: 1, name: 1, email: 1 },
    },
    { path: "client", projection: clientProjection },
  ]);
  assert.deepEqual(response.body, {
    msg: "Conversation has been created successfuly.",
    newConversationData: [
      {
        _id: "conversation-4",
        conversationName: "New conversation",
        freelancer: { _id: "freelancer-4", email: "kept@example.com" },
        client: expectedClient,
      },
    ],
  });
});

test("Order list responses expose only their explicit Client allowlist", async (t) => {
  const originalFind = Order.find;
  const populationCalls = [];
  const order = {
    _doc: {
      _id: "order-1",
      orderTitle: "Required order title",
      orderStatus: "Pending",
      clientId: { _doc: populatedClient },
      freelancerId: { _id: "freelancer-5", email: "kept@example.com" },
      serviceId: { _id: "service-1", serviceTitle: "Required service" },
    },
  };
  Order.find = () =>
    createPopulatedQuery({ populationCalls, result: [order] });
  t.after(() => {
    Order.find = originalFind;
  });
  const response = createResponse();

  await getAllOrders({}, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(populationCalls, [
    { path: "clientId", projection: clientProjection },
    { path: "freelancerId", projection: undefined },
    { path: "serviceId", projection: undefined },
  ]);
  assert.deepEqual(response.body, [
    {
      _id: "order-1",
      orderTitle: "Required order title",
      orderStatus: "Pending",
      clientId: expectedClient,
      freelancerId: { _id: "freelancer-5", email: "kept@example.com" },
      serviceId: { _id: "service-1", serviceTitle: "Required service" },
    },
  ]);
});

test("user Order responses preserve service data while allowlisting Clients", async (t) => {
  const originalFind = Order.find;
  const findFilters = [];
  const populationCalls = [];
  const order = {
    _doc: {
      _id: "order-2",
      orderPrice: 250,
      clientId: { _doc: populatedClient },
      freelancerId: { _id: "freelancer-6", name: "Edsger Freelancer" },
      serviceId: {
        _doc: {
          _id: "service-2",
          serviceTitle: "Required service",
          serviceCover_url: "service-cover.jpg",
          futureServiceField: "preserved",
        },
      },
    },
  };
  Order.find = (filter) => {
    findFilters.push(filter);
    return createPopulatedQuery({ populationCalls, result: [order] });
  };
  t.after(() => {
    Order.find = originalFind;
  });
  const response = createResponse();

  await getUserOrders(
    {
      params: { role: "freelancer", id: "freelancer-6" },
      hostname: "api.test",
    },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(findFilters, [{ freelancerId: "freelancer-6" }]);
  assert.deepEqual(populationCalls, [
    { path: "clientId", projection: clientProjection },
    { path: "serviceId", projection: undefined },
    { path: "freelancerId", projection: undefined },
  ]);
  assert.deepEqual(response.body, {
    ordersData: [
      {
        _id: "order-2",
        orderPrice: 250,
        clientId: expectedClient,
        freelancerId: {
          _id: "freelancer-6",
          name: "Edsger Freelancer",
        },
        serviceId: {
          _id: "service-2",
          serviceTitle: "Required service",
          serviceCover_url: "http://api.test:3000/uploads/service-cover.jpg",
          futureServiceField: "preserved",
        },
      },
    ],
  });
});

test("Request list responses expose only their explicit Client allowlist", async (t) => {
  const originalFind = Request.find;
  const populationCalls = [];
  const request = {
    _doc: {
      _id: "request-1",
      requestStatus: "Pending",
      requestDescription: "Required request data",
      clientId: { _doc: populatedClient },
      freelancerId: "freelancer-7",
      serviceId: {
        _doc: {
          _id: "service-3",
          serviceTitle: "Required request service",
          serviceCover_url: "request-service.jpg",
        },
      },
    },
  };
  Request.find = () =>
    createPopulatedQuery({ populationCalls, result: [request] });
  t.after(() => {
    Request.find = originalFind;
  });
  const response = createResponse();

  await getAllRequests({ hostname: "api.test" }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(populationCalls, [
    { path: "clientId", projection: clientProjection },
    { path: "serviceId", projection: undefined },
  ]);
  assert.deepEqual(response.body, [
    {
      _id: "request-1",
      requestStatus: "Pending",
      requestDescription: "Required request data",
      clientId: expectedClient,
      freelancerId: "freelancer-7",
      serviceId: {
        _id: "service-3",
        serviceTitle: "Required request service",
        serviceCover_url: "http://api.test:3000/uploads/request-service.jpg",
      },
    },
  ]);
});

test("every filtered Request response applies the Client allowlist", async (t) => {
  const originalFind = Request.find;
  t.after(() => {
    Request.find = originalFind;
  });

  const cases = [
    {
      name: "Client Requests",
      invoke: (response) =>
        getClientRequests(
          { params: { id: populatedClient._id }, hostname: "api.test" },
          response,
        ),
      filter: { clientId: populatedClient._id },
    },
    {
      name: "Freelancer Requests",
      invoke: (response) =>
        getFreelancerRequests(
          { params: { id: "freelancer-8" }, hostname: "api.test" },
          response,
        ),
      filter: { freelancerId: "freelancer-8" },
    },
    {
      name: "role-derived Freelancer Requests",
      invoke: (response) =>
        getUserRequests(
          {
            params: { role: "freelancer", id: "freelancer-8" },
            hostname: "api.test",
          },
          response,
        ),
      filter: { freelancerId: "freelancer-8" },
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const findFilters = [];
      const populationCalls = [];
      const request = {
        _doc: {
          _id: "request-2",
          requestStatus: "Pending",
          clientId: { _doc: populatedClient },
          freelancerId: "freelancer-8",
          serviceId: {
            _doc: {
              _id: "service-4",
              serviceCover_url: "filtered-request-service.jpg",
              futureServiceField: "preserved",
            },
          },
        },
      };
      Request.find = (filter) => {
        findFilters.push(filter);
        return createPopulatedQuery({ populationCalls, result: [request] });
      };
      const response = createResponse();

      await testCase.invoke(response);

      assert.equal(response.statusCode, 200);
      assert.deepEqual(findFilters, [testCase.filter]);
      assert.deepEqual(populationCalls, [
        { path: "clientId", projection: clientProjection },
        { path: "serviceId", projection: undefined },
      ]);
      assert.deepEqual(response.body, [
        {
          _id: "request-2",
          requestStatus: "Pending",
          clientId: expectedClient,
          freelancerId: "freelancer-8",
          serviceId: {
            _id: "service-4",
            serviceCover_url:
              "http://api.test:3000/uploads/filtered-request-service.jpg",
            futureServiceField: "preserved",
          },
        },
      ]);
    });
  }
});

test("Review responses expose only their explicit Client allowlist", async (t) => {
  const originalFind = Review.find;
  const findFilters = [];
  const populationCalls = [];
  const clientDocument = { ...populatedClient, _doc: populatedClient };
  const review = {
    _doc: {
      _id: "review-1",
      rating: 5,
      reviewDesc: "Required review data",
      futureReviewField: "preserved",
      clientId: clientDocument,
      serviceId: {
        _id: "service-5",
        serviceTitle: "Required reviewed service",
      },
    },
  };
  Review.find = (filter) => {
    findFilters.push(filter);
    return createPopulatedQuery({ populationCalls, result: [review] });
  };
  t.after(() => {
    Review.find = originalFind;
  });
  const response = createResponse();

  await getServiceReviews(
    { params: { id: "service-5" }, hostname: "api.test" },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(findFilters, [{ serviceId: "service-5" }]);
  assert.deepEqual(populationCalls, [
    { path: "clientId", projection: clientProjection },
    { path: "serviceId", projection: undefined },
  ]);
  assert.deepEqual(response.body, {
    success: true,
    message: "here u r",
    reviews: [
      {
        _id: "review-1",
        rating: 5,
        reviewDesc: "Required review data",
        futureReviewField: "preserved",
        clientId: {
          ...expectedClient,
          image_url: "http://api.test:3000/uploads/client-profile.jpg",
        },
        serviceId: {
          _id: "service-5",
          serviceTitle: "Required reviewed service",
        },
      },
    ],
  });
});
