import freelancersRoutes from "../modules/freelancer/freelancerRouter.js";
import adminRoutes from "../modules/admin/adminRoutes.js";
import categoriesRoute from "../modules/categories/categoriesRoutes.js";
import clientsRoute from "../modules/clients/clientsRoutes.js";
import ordersRoute from "../modules/orders/ordersRoutes.js";
import requestsRoute from "../modules/requests/requestsRoutes.js";
import communitiesRoutes from "../modules/communities/communitiesRoutes.js";
import conversationsRoutes from "../modules/conversations/conversationsRoutes.js";
import messagesRoutes from "../modules/messages/messagesRoutes.js";
import postsRoutes from "../modules/posts/postRoutes.js";
import professorsRoutes from "../modules/professors/professorsRoutes.js";
import authRoutes from "../modules/auth/authRoutes.js";
import servicesRoutes from "../modules/service/service.router.js";
import reviewsRoutes from "../modules/reviews/reviewRouter.js";
import coursesRoutes from "../modules/courses/coursesRoutes.js";
import healthRoutes from "../modules/health/healthRoutes.js";
import { Router } from "express";

const router = Router();
export const registerRoutes = (app) => {
  router.use("/categories", categoriesRoute);
  router.use("/clients", clientsRoute);
  router.use("/orders", ordersRoute);
  router.use("/requests", requestsRoute);
  router.use("/freelancers", freelancersRoutes);
  router.use("/admins", adminRoutes);
  router.use("/communities", communitiesRoutes);
  router.use("/conversations", conversationsRoutes);
  router.use("/messages", messagesRoutes);
  router.use("/posts", postsRoutes);
  router.use("/professors", professorsRoutes);
  router.use("/auth", authRoutes);
  router.use("/services", servicesRoutes);
  router.use("/reviews", reviewsRoutes);
  router.use("/courses", coursesRoutes);

  app.use("/api/health", healthRoutes);
  app.use("/api/v1", router);
};
