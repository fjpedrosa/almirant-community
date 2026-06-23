import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env.DATABASE_URL!;

// Log connection info (without password)
const urlParts = new URL(databaseUrl);
console.log(
  `✅ Using database: ${urlParts.hostname}:${urlParts.port}${urlParts.pathname}`
);
console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
  verbose: true,
  strict: true,
});
