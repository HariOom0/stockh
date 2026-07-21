import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import { createClient } from '@libsql/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const dbUrl = process.env.DATABASE_URL!
  const directUrl = process.env.DIRECT_DATABASE_URL

  // If DIRECT_DATABASE_URL is set, use the libSQL adapter (Turso cloud)
  if (directUrl) {
    const libsql = createClient({
      url: dbUrl,
      authToken: directUrl,
    })
    const adapter = new PrismaLibSQL(libsql)
    return new PrismaClient({ adapter, log: process.env.NODE_ENV === 'development' ? ['query'] : [] })
  }

  // Fallback: local SQLite (for dev)
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query'] : [],
  })
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
