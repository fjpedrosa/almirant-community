import { db } from "../../client";
import { documents, documentCategories } from "../../schema/documents";
import { projects } from "../../schema/projects";
import { workItems } from "../../schema/work-items";
import { documentWorkItems } from "../../schema/document-work-items";
import { eq, and, or, ilike, notInArray, sql, desc } from "drizzle-orm";

// Common stop words to filter out from keyword extraction
const STOP_WORDS = new Set([
  // Spanish
  "de", "en", "la", "el", "los", "las", "un", "una", "y", "o", "a", "para",
  "con", "del", "al", "es", "que", "se", "por", "no", "su", "como", "pero",
  "más", "este", "esta", "estos", "estas", "ese", "esa", "esos", "esas",
  // English
  "the", "and", "for", "with", "to", "in", "of", "is", "are", "was", "were",
  "be", "been", "being", "have", "has", "had", "do", "does", "did", "will",
  "would", "could", "should", "may", "might", "can", "shall", "must",
  "not", "but", "or", "if", "then", "than", "so", "as", "at", "by", "from",
  "on", "an", "this", "that", "these", "those", "it", "its", "we", "our",
  "they", "their", "them", "you", "your", "he", "she", "his", "her",
]);

// Minimum keyword length to consider
const MIN_KEYWORD_LENGTH = 3;

// Extract meaningful keywords from text
const extractKeywords = (text: string): string[] => {
  if (!text) return [];

  return text
    .toLowerCase()
    .replace(/[^a-záéíóúüñ\s-]/gi, " ") // keep letters, spaces, hyphens
    .split(/\s+/)
    .filter((word) => word.length >= MIN_KEYWORD_LENGTH && !STOP_WORDS.has(word))
    .filter((word, index, arr) => arr.indexOf(word) === index) // unique
    .slice(0, 15); // max 15 keywords
};

export interface SuggestedDocument {
  id: string;
  title: string;
  contentPreview: string | null;
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  createdAt: Date;
  matchScore: number;
}

// Get suggested documents for a work item based on keyword matching
export const getSuggestedDocuments = async (
  workItemId: string,
  limit = 8
): Promise<SuggestedDocument[]> => {
  // 1. Fetch the work item
  const [item] = await db
    .select({
      title: workItems.title,
      description: workItems.description,
    })
    .from(workItems)
    .where(eq(workItems.id, workItemId))
    .limit(1);

  if (!item) return [];

  // 2. Extract keywords from title and description
  const titleKeywords = extractKeywords(item.title);
  const descriptionKeywords = extractKeywords(item.description ?? "");
  const allKeywords = [...new Set([...titleKeywords, ...descriptionKeywords])];

  if (allKeywords.length === 0) return [];

  // 3. Get already-linked document IDs to exclude them
  const linkedDocs = await db
    .select({ documentId: documentWorkItems.documentId })
    .from(documentWorkItems)
    .where(eq(documentWorkItems.workItemId, workItemId));

  const linkedDocIds = linkedDocs.map((d) => d.documentId);

  // 4. Build ILIKE conditions for each keyword against title and content
  const keywordConditions = allKeywords.map((keyword) =>
    or(
      ilike(documents.title, `%${keyword}%`),
      ilike(documents.content, `%${keyword}%`)
    )
  );

  // Build a score expression: count how many keywords match in title or content
  // Title matches are weighted 2x, content matches 1x
  const scoreExpression = sql<number>`(
    ${sql.join(
      allKeywords.map(
        (keyword) =>
          sql`(CASE WHEN ${ilike(documents.title, `%${keyword}%`)} THEN 2 ELSE 0 END + CASE WHEN ${ilike(documents.content, `%${keyword}%`)} THEN 1 ELSE 0 END)`
      ),
      sql` + `
    )}
  )`;

  // 5. Query documents that match at least one keyword
  const whereConditions = [or(...keywordConditions)!];

  // Exclude already-linked documents
  if (linkedDocIds.length > 0) {
    whereConditions.push(notInArray(documents.id, linkedDocIds));
  }

  const results = await db
    .select({
      id: documents.id,
      title: documents.title,
      content: documents.content,
      projectId: documents.projectId,
      projectName: projects.name,
      projectColor: projects.color,
      categoryName: documentCategories.name,
      categoryColor: documentCategories.color,
      createdAt: documents.createdAt,
      matchScore: scoreExpression,
    })
    .from(documents)
    .leftJoin(projects, eq(documents.projectId, projects.id))
    .leftJoin(documentCategories, eq(documents.categoryId, documentCategories.id))
    .where(and(...whereConditions))
    .orderBy(desc(scoreExpression), desc(documents.updatedAt))
    .limit(limit);

  // 6. Map results with content preview
  return results.map((row) => ({
    id: row.id,
    title: row.title,
    contentPreview: row.content
      ? row.content.slice(0, 150).replace(/\n+/g, " ").trim() +
        (row.content.length > 150 ? "..." : "")
      : null,
    projectId: row.projectId,
    projectName: row.projectName,
    projectColor: row.projectColor,
    categoryName: row.categoryName,
    categoryColor: row.categoryColor,
    createdAt: row.createdAt,
    matchScore: row.matchScore,
  }));
};
