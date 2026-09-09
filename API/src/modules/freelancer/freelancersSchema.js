import Joi from "joi";

const freelancerName = Joi.string().trim().max(100);
const freelancerEmail = Joi.string().trim().lowercase().max(254).email();
const enforceBcryptByteLimit = (value, helpers) => {
  if (Buffer.byteLength(value, "utf8") <= 72) return value;

  return helpers.message("Password must not exceed 72 bytes");
};
const freelancerPassword = Joi.string()
  .min(8)
  .max(128)
  .custom(enforceBcryptByteLimit)
  .pattern(/^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[@#$%^&+=!])(?=\S+$).{8,}$/);
const freelancerImageUrl = Joi.string().trim().max(2048);
const freelancerPhoneNumber = Joi.string().trim().max(20);
const freelancerCountry = Joi.string().trim().max(100);
const freelancerDesc = Joi.string().trim().max(1000);
const freelancerLanguages = Joi.array().items(Joi.string().trim().max(50));
const freelancerSkills = Joi.array().items(Joi.string().trim().max(50));
const freelancerServicesCount = Joi.number().integer().min(0);
const freelancerSpecialization = Joi.string().trim().max(100);
const freelancerActivityStatus = Joi.string().valid("online", "offline");
export const updateInfoSchema = Joi.object({
  name: Joi.string(),
  email: Joi.string().email({ minDomainSegments: 2, tlds: { allow: ["com", "net"] } }),
  image_url: Joi.string(),
  phoneNumber: Joi.string()
    .regex(/^\d{11}$/)
    .message("Invalid phone number. Must be 11 digits."),
  country: Joi.string(),
  desc: Joi.string(),
});
export const updatePasswordSchema = Joi.object({
  password: Joi.string()
    .min(8)
    .max(20)
    .pattern(new RegExp("^(?=.?[A-Z])(?=.?[a-z])(?=.*?[0-9]).{8,}$")),
  newPassword: Joi.string()
    .min(8)
    .max(20)
    .pattern(new RegExp("^(?=.?[A-Z])(?=.?[a-z])(?=.*?[0-9]).{8,}$")),
  confirmNewPassword: Joi.string()
    .min(8)
    .max(20)
    .pattern(new RegExp("^(?=.?[A-Z])(?=.?[a-z])(?=.*?[0-9]).{8,}$")),
});
const getFreelancersQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(false);
const createFreelancerSchema = Joi.object({
  name: freelancerName.required(),
  email: freelancerEmail.required(),
  password: freelancerPassword.required(),
  phone_number: freelancerPhoneNumber.required(),
  country: freelancerCountry.required(),
  image_url: freelancerImageUrl,
  cover_image_url: freelancerImageUrl,
  activity_status: freelancerActivityStatus,
}).unknown(false);
