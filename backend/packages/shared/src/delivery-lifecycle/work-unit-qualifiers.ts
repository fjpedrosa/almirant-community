import { z } from "zod";

const workUnitSizeSchema = z.enum(["XS", "S", "M", "L", "XL"]);
const workUnitSizeOriginSchema = z.enum(["plan", "legacy_points"]);
const backlogIntentSchema = z.enum(["new", "fix"]);

const workUnitQualifiersSchema = z.object({
  workUnitSize: workUnitSizeSchema.nullable(),
  workUnitSizeOrigin: workUnitSizeOriginSchema.nullable(),
  backlogIntent: backlogIntentSchema.nullable(),
}).strict().refine(
  ({ workUnitSize, workUnitSizeOrigin }) =>
    (workUnitSize === null) === (workUnitSizeOrigin === null),
  { message: "Work Unit size and origin must be set or null together." },
);

export type WorkUnitSizeOrigin = z.infer<typeof workUnitSizeOriginSchema>;
export type BacklogIntent = z.infer<typeof backlogIntentSchema>;
export type WorkUnitQualifiers = z.infer<typeof workUnitQualifiersSchema>;

export const parseWorkUnitQualifiers = (input: unknown): WorkUnitQualifiers =>
  workUnitQualifiersSchema.parse(input);
