export const ACTIVE_COMPANY_COOKIE = "talora_active_company_id";

export const activeCompanyCookieOptions = {
  httpOnly: true,
  maxAge: 60 * 60 * 24 * 365,
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

