import bcrypt from "bcryptjs";
import { randomInt } from "crypto";

export const generateOtp = () =>
  String(randomInt(0, 1000000)).padStart(6, "0");

export const hashOtp = async (otp) => {
  return bcrypt.hash(otp, 10);
};
