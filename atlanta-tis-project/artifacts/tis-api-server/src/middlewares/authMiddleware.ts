/**
 * Per-request session resolver. Reads the opaque session cookie,
 * fetches the server-side session record, and attaches the user to
 * `req`. Sessions naturally expire via the `expire` column on the
 * `sessions` table; we don't refresh tokens here anymore (the Phase-13
 * removal of Replit OIDC dropped the only flow that needed refresh).
 */
import { type Request, type Response, type NextFunction } from "express";
import {
  clearSession,
  getSessionId,
  getSession,
  type AuthUser,
} from "../lib/auth";

declare global {
  namespace Express {
    interface User extends AuthUser {}

    interface Request {
      isAuthenticated(): this is AuthedRequest;
      user?: User | undefined;
    }

    export interface AuthedRequest {
      user: User;
    }
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  req.isAuthenticated = function (this: Request) {
    return this.user != null;
  } as Request["isAuthenticated"];

  const sid = getSessionId(req);
  if (!sid) return next();

  const session = await getSession(sid);
  if (!session?.user?.id) {
    await clearSession(res, sid);
    return next();
  }

  req.user = session.user;
  next();
}
