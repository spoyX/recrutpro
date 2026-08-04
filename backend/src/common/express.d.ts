import { IUser } from '../models/User.model';

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth. Present only on routes behind it. */
      currentUser?: IUser;
    }
  }
}

export {};
