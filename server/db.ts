import { PrismaClient } from '@prisma/client';

/**
 * Single PrismaClient for the process. PrismaClient manages its own
 * connection pool; creating one per request would leak connections.
 */
export const prisma = new PrismaClient();
