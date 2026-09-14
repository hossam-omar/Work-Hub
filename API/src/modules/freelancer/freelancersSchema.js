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
export const updateInfoSchema = Joi.object({
  name: freelancerName,
  email: freelancerEmail,
  image_url: freelancerImageUrl,
  phoneNumber: freelancerPhoneNumber,
  country: freelancerCountry,
  desc: freelancerDesc,
  languages: freelancerLanguages,
  skills: freelancerSkills,
  servicesCount: freelancerServicesCount,
  specialization: freelancerSpecialization,
});
export const updatePasswordSchema = Joi.object({
  password: freelancerPassword.required(),
  newPassword: freelancerPassword.required(),
  confirmNewPassword: Joi.string().valid(Joi.ref("newPassword")).required(),
});
export const getFreelancersQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(false);
