import { IDepartment } from '../models/Department.model';

/** The "V" of MVC (D-003): the JSON shape a Department takes on the way out. */
export interface PublicDepartment {
  id: string;
  name: string;
  isActive: boolean;
}

export const toPublicDepartment = (department: IDepartment): PublicDepartment => ({
  id: String(department._id),
  name: department.name,
  isActive: department.isActive,
});
