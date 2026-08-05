import { IJobPosition } from '../models/JobPosition.model';
import { JobPositionStatus } from '../common/constants';

/** The "V" of MVC (D-003): the JSON shape a JobPosition takes on the way out. */
export interface PublicJobPosition {
  id: string;
  title: string;
  departmentId: string;
  description: string;
  requirements: string | null;
  status: JobPositionStatus;
  createdAt: string;
}

export const toPublicJobPosition = (position: IJobPosition): PublicJobPosition => ({
  id: String(position._id),
  title: position.title,
  departmentId: String(position.department),
  description: position.description,
  requirements: position.requirements ?? null,
  status: position.status,
  createdAt: position.createdAt.toISOString(),
});
