import { HttpStatus } from '@nestjs/common';
import {
  JoinRequestStatus,
  ReportCategory,
  ReportStatus,
  Role,
  UserStatus,
} from 'prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  let service: ReportsService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
    };
    safeSpaceReport: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    safeSpaceVisit: {
      create: jest.Mock;
    };
  };

  const studentWithClass = {
    id: 'student-1',
    role: Role.STUDENT,
    status: UserStatus.ACTIVE,
    school_id: 'school-1',
    memberships: [
      {
        id: 'mem-1',
        class_id: 'class-1',
        status: JoinRequestStatus.APPROVED,
        class: {
          id: 'class-1',
          school_id: 'school-1',
        },
      },
    ],
  };

  const studentWithoutMembership = {
    id: 'student-2',
    role: Role.STUDENT,
    status: UserStatus.ACTIVE,
    school_id: 'school-2',
    memberships: [],
  };

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
      },
      safeSpaceReport: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      safeSpaceVisit: {
        create: jest.fn(),
      },
    };

    service = new ReportsService(prisma as unknown as PrismaService);
  });

  describe('createReport', () => {
    it('body length 201 → 400', async () => {
      prisma.user.findUnique.mockResolvedValue(studentWithClass);

      const longBody = 'a'.repeat(201);

      await expect(
        service.createReport('student-1', {
          category: ReportCategory.HURTFUL_WORDS,
          body: longBody,
          feelSafe: true,
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          status: HttpStatus.BAD_REQUEST,
        }),
      );
    });

    it('create returns a unique public_ref', async () => {
      prisma.user.findUnique.mockResolvedValue(studentWithClass);

      // First call to findUnique for public_ref check returns null (not taken)
      prisma.safeSpaceReport.findUnique.mockResolvedValue(null);

      prisma.safeSpaceReport.create.mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'report-1',
          ...data,
          created_at: new Date(),
          updated_at: new Date(),
        }),
      );

      const result = await service.createReport('student-1', {
        category: ReportCategory.CYBERBULLYING,
        body: 'Online mean messages',
        feelSafe: false,
      });

      expect(result.success).toBe(true);
      expect(result.data.public_ref).toMatch(/^WP-\d{4}$/);
      expect(result.data.publicRef).toMatch(/^WP-\d{4}$/);
      expect(result.data.report.publicRef).toBe(result.data.public_ref);

      expect(prisma.safeSpaceReport.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            public_ref: expect.stringMatching(/^WP-\d{4}$/),
            school_id: 'school-1',
            student_id: 'student-1',
            class_id: 'class-1',
            category: ReportCategory.CYBERBULLYING,
            body: 'Online mean messages',
            feel_safe: false,
            status: ReportStatus.NEW,
            submitted_at: expect.any(Date),
          }),
        }),
      );
    });

    it('sets school_id and student_id with null class_id when no approved membership exists', async () => {
      prisma.user.findUnique.mockResolvedValue(studentWithoutMembership);
      prisma.safeSpaceReport.findUnique.mockResolvedValue(null);
      prisma.safeSpaceReport.create.mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'report-2',
          ...data,
          created_at: new Date(),
          updated_at: new Date(),
        }),
      );

      const result = await service.createReport('student-2', {
        category: ReportCategory.PHYSICAL_UNSAFE,
        body: 'Pushed in hallway',
        feelSafe: false,
      });

      expect(result.success).toBe(true);
      expect(prisma.safeSpaceReport.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            school_id: 'school-2',
            student_id: 'student-2',
            class_id: null,
            category: ReportCategory.PHYSICAL_UNSAFE,
          }),
        }),
      );
    });

    it('retries when candidate public_ref already exists', async () => {
      prisma.user.findUnique.mockResolvedValue(studentWithClass);

      // First candidate collides, second candidate is free
      prisma.safeSpaceReport.findUnique
        .mockResolvedValueOnce({ id: 'existing-rep' })
        .mockResolvedValueOnce(null);

      prisma.safeSpaceReport.create.mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'report-new',
          ...data,
          created_at: new Date(),
          updated_at: new Date(),
        }),
      );

      const result = await service.createReport('student-1', {
        category: ReportCategory.SOMETHING_ELSE,
        body: 'Need to talk',
        feelSafe: true,
      });

      expect(result.success).toBe(true);
      expect(prisma.safeSpaceReport.findUnique).toHaveBeenCalledTimes(2);
      expect(prisma.safeSpaceReport.create).toHaveBeenCalled();
    });

    it('throws 404 when student not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.createReport('non-existent', {
          category: ReportCategory.HURTFUL_WORDS,
          body: 'Hello',
          feelSafe: true,
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          status: HttpStatus.NOT_FOUND,
        }),
      );
    });

    it('throws 400 when feelSafe is invalid or missing', async () => {
      await expect(
        service.createReport('student-1', {
          category: ReportCategory.HURTFUL_WORDS,
          body: 'Hello',
          feelSafe: 'yes' as any,
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          status: HttpStatus.BAD_REQUEST,
        }),
      );
    });
  });

  describe('listStudentReports', () => {
    it('list is only the caller’s reports', async () => {
      const callerReport = {
        id: 'report-caller-1',
        public_ref: 'WP-1111',
        school_id: 'school-1',
        student_id: 'student-1',
        class_id: 'class-1',
        category: ReportCategory.HURTFUL_WORDS,
        body: 'Report 1',
        feel_safe: true,
        status: ReportStatus.NEW,
        submitted_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      prisma.safeSpaceReport.findMany.mockResolvedValue([callerReport]);
      prisma.safeSpaceReport.count.mockResolvedValue(1);

      const result = await service.listStudentReports('student-1', {
        status: ReportStatus.NEW,
      });

      expect(prisma.safeSpaceReport.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            student_id: 'student-1',
            status: ReportStatus.NEW,
          },
        }),
      );

      expect(prisma.safeSpaceReport.count).toHaveBeenCalledWith({
        where: {
          student_id: 'student-1',
          status: ReportStatus.NEW,
        },
      });

      expect(result.data.items).toHaveLength(1);
      expect(result.data.items[0].id).toBe('report-caller-1');
      expect(result.data.items[0].studentId).toBe('student-1');
    });
  });

  describe('getStudentReport', () => {
    it('another student’s id → 404', async () => {
      prisma.safeSpaceReport.findUnique.mockResolvedValue({
        id: 'rep-other',
        student_id: 'student-2', // belongs to another student
        public_ref: 'WP-9999',
        body: 'Secret report',
        feel_safe: false,
        status: ReportStatus.NEW,
      });

      await expect(
        service.getStudentReport('student-1', 'rep-other'),
      ).rejects.toThrow(
        expect.objectContaining({
          status: HttpStatus.NOT_FOUND,
        }),
      );
    });

    it('throws 404 when report does not exist', async () => {
      prisma.safeSpaceReport.findUnique.mockResolvedValue(null);

      await expect(
        service.getStudentReport('student-1', 'rep-missing'),
      ).rejects.toThrow(
        expect.objectContaining({
          status: HttpStatus.NOT_FOUND,
        }),
      );
    });

    it('detail JSON has no notes key', async () => {
      prisma.safeSpaceReport.findUnique.mockResolvedValue({
        id: 'rep-1',
        public_ref: 'WP-1234',
        school_id: 'school-1',
        student_id: 'student-1',
        class_id: 'class-1',
        category: ReportCategory.HURTFUL_WORDS,
        body: 'Valid report body',
        feel_safe: true,
        status: ReportStatus.NEW,
        submitted_at: new Date('2026-11-01T10:00:00.000Z'),
        created_at: new Date('2026-11-01T10:00:00.000Z'),
        updated_at: new Date('2026-11-01T10:00:00.000Z'),
        // Even if DB row or query had notes or staff fields attached:
        notes: [{ id: 'note-1', body: 'Staff confidential note' }],
      });

      const result = await service.getStudentReport('student-1', 'rep-1');

      expect(result.success).toBe(true);
      expect(result.data.id).toBe('rep-1');
      expect(result.data.publicRef).toBe('WP-1234');
      expect(result.data).not.toHaveProperty('notes');
      expect('notes' in result.data).toBe(false);
    });
  });

  describe('createVisit', () => {
    it('visit insert stores user_id and does not require a match', async () => {
      prisma.safeSpaceVisit.create.mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'visit-1',
          ...data,
          created_at: new Date(),
          updated_at: new Date(),
        }),
      );

      const resultWithoutMatch = await service.createVisit('student-1', {});

      expect(resultWithoutMatch.success).toBe(true);
      expect(prisma.safeSpaceVisit.create).toHaveBeenCalledWith({
        data: {
          user_id: 'student-1',
          match_id: null,
        },
      });
      expect(resultWithoutMatch.data.userId).toBe('student-1');
      expect(resultWithoutMatch.data.matchId).toBeNull();

      // With matchId
      const resultWithMatch = await service.createVisit('student-1', {
        matchId: 'match-999',
      });

      expect(resultWithMatch.success).toBe(true);
      expect(prisma.safeSpaceVisit.create).toHaveBeenCalledWith({
        data: {
          user_id: 'student-1',
          match_id: 'match-999',
        },
      });
      expect(resultWithMatch.data.matchId).toBe('match-999');
    });
  });
});
