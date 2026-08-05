import ChatbotConversationModel from "../../../DB/models/chatbotConversation_model.js";
import CommunityModel from "../../../DB/models/community_model.js";
import CourseModel from "../../../DB/models/course_model.js";
import ConversationModel from "../../../DB/models/conversation_model.js";
import MessageModel from "../../../DB/models/message_model.js";
import OrderModel from "../../../DB/models/order_model.js";
import PostModel from "../../../DB/models/post_model.js";
import RequestModel from "../../../DB/models/request_model.js";
import ReviewModel from "../../../DB/models/review_model.js";

export const createClientDeletionGuard = ({
  chatbotConversationModel = ChatbotConversationModel,
  communityModel = CommunityModel,
  courseModel = CourseModel,
  conversationModel = ConversationModel,
  messageModel = MessageModel,
  orderModel = OrderModel,
  postModel = PostModel,
  requestModel = RequestModel,
  reviewModel = ReviewModel,
} = {}) => {
  return Object.freeze({
    isBlocked: async (clientId) => {
      const matches = await Promise.all([
        chatbotConversationModel.exists({
          senderId: clientId,
          senderRole: { $ne: "freelancer" },
        }),
        communityModel.exists({ clientMembers: clientId }),
        courseModel.exists({ enrolledClientsIds: clientId }),
        conversationModel.exists({ client: clientId }),
        messageModel.exists({
          senderId: clientId,
          senderType: { $ne: "freelancer" },
        }),
        orderModel.exists({ clientId }),
        postModel.exists({
          posterId: clientId,
          posterType: { $ne: "freelancer" },
        }),
        postModel.exists({
          comments: {
            $elemMatch: {
              userId: clientId,
              userRole: { $ne: "freelancer" },
            },
          },
        }),
        postModel.exists({ likes: clientId }),
        requestModel.exists({ clientId }),
        reviewModel.exists({ clientId }),
      ]);

      return matches.some(Boolean);
    },
  });
};

export const clientDeletionGuard = createClientDeletionGuard();
