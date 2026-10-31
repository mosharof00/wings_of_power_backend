import { Command, CommandRunner } from 'nest-commander';

@Command({ name: 'seed', description: 'prisma db seed' })
export class SeedCommand extends CommandRunner {
  async run(): Promise<void> {
    console.log('Product seed arrives in T-BE-027. No rows written.');
  }
}
