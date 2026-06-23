import type { SeedWithRelations } from "@/domains/planning/domain/types";

const MAX_DESCRIPTION_LENGTH = 200;

const truncate = (text: string, maxLength: number): string =>
  text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;

export const buildSeedContextPrefix = (
  seeds: SeedWithRelations[],
  annotations?: Record<string, string>,
): string => {
  if (seeds.length === 0) return "";

  const lines = seeds.map((seed) => {
    const description = seed.description
      ? truncate(seed.description, MAX_DESCRIPTION_LENGTH)
      : "Sin descripción";
    const annotation = annotations?.[seed.id];
    const annotationSuffix = annotation
      ? ` [Nota del usuario: ${annotation}]`
      : "";
    return `- ${seed.title}: ${description}${annotationSuffix}`;
  });

  return `Seeds seleccionados para planning:\n${lines.join("\n")}\n---\n`;
};
