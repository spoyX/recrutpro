import { RequestHandler } from 'express';
import { buildDashboard } from '../services/dashboard.service';
import { toPublicDashboard } from '../views/dashboard.view';

/** GET /api/v1/dashboard — FR-45, FR-46, FR-47 (UC-14) */
export const show: RequestHandler = async (req, res, next) => {
  try {
    // The role comes from the reloaded session user (D-027), never from the
    // request — there is no parameter here for a caller to point at another
    // role's dashboard.
    const data = await buildDashboard(req.currentUser!);
    res.status(200).json(toPublicDashboard(data));
  } catch (error) {
    next(error);
  }
};
