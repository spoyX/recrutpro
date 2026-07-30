import { Schema, model, Document } from 'mongoose';

export interface IDepartment extends Document {
  name: string;
  isActive: boolean;
}

const departmentSchema = new Schema<IDepartment>({
  // FR-13: create and rename. Unique so a rename cannot collide with an
  // existing department and leave recruiters two identical choices.
  name: { type: String, required: true, unique: true, trim: true },

  // FR-13: a deactivated department disappears from selection lists but its
  // history is preserved, so this is a flag, never a delete.
  isActive: { type: Boolean, required: true, default: true },
});

export const Department = model<IDepartment>('Department', departmentSchema);
