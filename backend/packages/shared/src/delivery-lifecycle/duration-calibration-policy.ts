import { z } from "zod";

export const DURATION_CALIBRATION_POLICY_VERSION = "duration-calibration/v1" as const;
export const DURATION_CALIBRATION_POLICY_V1 = Object.freeze({
  version: DURATION_CALIBRATION_POLICY_VERSION,
  mode: "observe_only" as const,
  canEmitCalibrated: false as const,
});

export const durationV1Schema = z.object({
  minMinutes: z.number().int().positive(),
  maxMinutes: z.number().int().positive(),
  calibration: z.literal("uncalibrated"),
  calibrationPolicyVersion: z.literal(DURATION_CALIBRATION_POLICY_VERSION),
}).strict().refine(
  (duration) => duration.minMinutes <= duration.maxMinutes,
  { message: "Duration minMinutes cannot exceed maxMinutes." },
);

export type DurationV1 = z.infer<typeof durationV1Schema>;
