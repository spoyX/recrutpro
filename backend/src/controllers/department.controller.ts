import { RequestHandler } from 'express';
import {
  listDepartments,
  createDepartment,
  renameDepartment,
  deactivateDepartment,
  reactivateDepartment,
} from '../services/department.service';
import { toPublicDepartment } from '../views/department.view';
import { AppError } from '../common/errors';

const asName = (value: unknown): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(400, 'VALIDATION_ERROR', 'Le champ « nom » est requis.');
  }
  return value;
};

/** GET /api/v1/departments — FR-13 (readable by any authenticated user) */
export const list: RequestHandler = async (req, res, next) => {
  try {
    const departments = await listDepartments(req.query.includeInactive === 'true');
    res.status(200).json(departments.map(toPublicDepartment));
  } catch (error) {
    next(error);
  }
};

/** POST /api/v1/departments — FR-13 */
export const create: RequestHandler = async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const department = await createDepartment(asName(body.name), String(req.currentUser?._id));
    res.status(201).json(toPublicDepartment(department));
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/v1/departments/:id — FR-13 (rename) */
export const rename: RequestHandler = async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const department = await renameDepartment(
      String(req.params.id),
      asName(body.name),
      String(req.currentUser?._id),
    );
    res.status(200).json(toPublicDepartment(department));
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/v1/departments/:id/deactivate — FR-13 */
export const deactivate: RequestHandler = async (req, res, next) => {
  try {
    const department = await deactivateDepartment(
      String(req.params.id),
      String(req.currentUser?._id),
    );
    res.status(200).json(toPublicDepartment(department));
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/v1/departments/:id/reactivate — D-035 */
export const reactivate: RequestHandler = async (req, res, next) => {
  try {
    const department = await reactivateDepartment(
      String(req.params.id),
      String(req.currentUser?._id),
    );
    res.status(200).json(toPublicDepartment(department));
  } catch (error) {
    next(error);
  }
};
