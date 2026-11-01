import { Prisma, PrismaClient } from 'prisma/generated/client';

const SOFT_DELETE_MODELS = new Set([
  'User',
  'Story',
  'Chapter',
  'Class',
  'Badge',
  'KindnessCornerItem',
  'Notification',
]);

const READ_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

function modelDelegate(client: PrismaClient, model: string) {
  const key = model.charAt(0).toLowerCase() + model.slice(1);
  return client[key as keyof PrismaClient] as {
    findFirst: (args: object) => Promise<unknown>;
    update: (args: object) => Promise<unknown>;
    updateMany: (args: object) => Promise<unknown>;
  };
}

export const softDeleteExtension = Prisma.defineExtension((client) => {
  return client.$extends({
    name: 'softDelete',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!SOFT_DELETE_MODELS.has(model)) {
            return query(args);
          }

          const delegate = modelDelegate(client as PrismaClient, model);

          if (operation === 'delete') {
            const where = (args as { where: object }).where;
            return delegate.update({
              where,
              data: { deleted_at: new Date() },
            });
          }

          if (operation === 'deleteMany') {
            const where = (args as { where?: object }).where;
            return delegate.updateMany({
              where,
              data: { deleted_at: new Date() },
            });
          }

          if (operation === 'findUnique' || operation === 'findUniqueOrThrow') {
            const readArgs = args as { where?: object };
            const row = await delegate.findFirst({
              ...readArgs,
              where: { deleted_at: null, ...readArgs.where },
            });
            if (!row && operation === 'findUniqueOrThrow') {
              throw new Prisma.PrismaClientKnownRequestError(
                `No ${model} found`,
                { code: 'P2025', clientVersion: Prisma.prismaVersion.client },
              );
            }
            return row;
          }

          if (READ_OPERATIONS.has(operation)) {
            const readArgs = args as { where?: object };
            readArgs.where = { deleted_at: null, ...readArgs.where };
            return query(args);
          }

          return query(args);
        },
      },
    },
  });
});
