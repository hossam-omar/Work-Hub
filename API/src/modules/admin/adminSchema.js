import Joi from "joi";

const adminName = Joi.string().trim().max(100);
const adminEmail = Joi.string().trim().lowercase().max(254).email();
const adminPassword = Joi.string()
  .min(8)
  .max(128)
  .pattern(/^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[@#$%^&+=!])(?=\S+$).{8,}$/);
const adminImageUrl = Joi.string().trim().max(2048);
const adminActivityStatus = Joi.string().valid("online", "offline");

export const getAdminsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(false);

export const createAdminSchema = Joi.object({
  name: adminName.required(),
  email: adminEmail.required(),
  password: adminPassword.required(),
  image_url: adminImageUrl.optional(),
  activityStatus: adminActivityStatus.optional(),
}).unknown(false);

export const updateInfoSchema = Joi.object({
  name: adminName.optional(),
  email: adminEmail.optional(),
  image_url: adminImageUrl.optional(),
})
  .min(1)
  .unknown(false);

export const updateAdminPasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: adminPassword.required(),
  confirmPassword: Joi.string().valid(Joi.ref("newPassword")).required().messages({
    "any.only": "confirmPassword must match newPassword",
  }),
}).unknown(false);
