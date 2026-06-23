import { z } from "zod";
const z4mini = await import("zod/v4-mini");

// Test the problematic schema
const schema = z.object({
  metadata: z.record(z.unknown()).optional().describe("test"),
});

try {
  z4mini.toJSONSchema(schema, { target: 'draft-7', io: 'input' });
  console.log("OK with z.record(z.unknown())");
} catch (e: any) {
  console.log(`FAIL with z.record(z.unknown()): ${e.message}`);
}

// Test alternative
const schema2 = z.object({
  metadata: z.record(z.string(), z.any()).optional().describe("test"),
});

try {
  z4mini.toJSONSchema(schema2, { target: 'draft-7', io: 'input' });
  console.log("OK with z.record(z.string(), z.any())");
} catch (e: any) {
  console.log(`FAIL with z.record(z.string(), z.any()): ${e.message}`);
}

// Test with z.any()
const schema3 = z.object({
  metadata: z.record(z.any()).optional().describe("test"),
});

try {
  z4mini.toJSONSchema(schema3, { target: 'draft-7', io: 'input' });
  console.log("OK with z.record(z.any())");
} catch (e: any) {
  console.log(`FAIL with z.record(z.any()): ${e.message}`);
}

// Test without metadata field at all
const schema4 = z.object({
  type: z.string(),
  title: z.string(),
});

try {
  z4mini.toJSONSchema(schema4, { target: 'draft-7', io: 'input' });
  console.log("OK simple schema");
} catch (e: any) {
  console.log(`FAIL simple schema: ${e.message}`);
}

process.exit(0);
