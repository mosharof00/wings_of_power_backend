import { Command, CommandRunner } from 'nest-commander';
import { PrismaService } from '../prisma/prisma.service';
import { executeSeed } from './seed.data';

@Command({ name: 'seed', description: 'Seed demo school and default records' })
export class SeedCommand extends CommandRunner {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async run(): Promise<void> {
    const result = await executeSeed(this.prisma);
    if (result.skipped) {
      console.log('Seed skipped: Demo school already exists.');
    } else {
      console.log(
        `Seed finished: created school ${result.schoolId} for admin ${result.adminEmail}.`,
      );
    }
  }
}
