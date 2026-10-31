// Concurrency error handling - Prisma 6.x uses extensions instead of middleware
// This is kept for reference but middleware is deprecated in Prisma 6.x

export function checkConcurrencyError(
  action: string,
  where: any,
  result: { count: number },
): void {
  if (
    (action === 'updateMany' || action === 'deleteMany') &&
    where?.version &&
    result.count === 0
  ) {
    throw new Error(
      'Concurrency error: Record was modified by another process',
    );
  }
}
