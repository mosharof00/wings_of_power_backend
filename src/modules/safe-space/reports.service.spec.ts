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
      findMany: jest.Mock;
    };
    class: {
      findMany: jest.Mock;
    };
    safeSpaceReport: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
    };
    safeSpaceNote: {
      create: jest.Mock;
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

  const activeTeacher = {
    id: 'teacher-1',
    role: Role.TEACHER,
    status: UserStatus.ACTIVE,
    school_id: 'school-1',
    settings_json: { canAccessSafeSpace: true },
  };

  const blockedTeacher = {
    id: 'teacher-blocked',
    role: Role.TEACHER,
    status: UserStatus.ACTIVE,
    school_id: 'school-1',
    settings_json: { canAccessSafeSpace: false },
  };

  const adminUser = {
    id: 'admin-1',
    role: Role.ADMIN,
    status: UserStatus.ACTIVE,
    school_id: 'school-1',
  };

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      class: {
        findMany: jest.fn(),
      },
      safeSpaceReport: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      safeSpaceNote: {
        create: jest.fn(),
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
        student_id: 'student-2',
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

    it('student-facing method still has no notes after this change', async () => {
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

  describe('Teacher Safe Space', () => {
    it('canAccessSafeSpace: false → 403 on list', async () => {
      prisma.user.findUnique.mockResolvedValue(blockedTeacher);

      await expect(
        service.listTeacherReports('teacher-blocked'),
      ).rejects.toThrow(
        expect.objectContaining({
          status: HttpStatus.FORBIDDEN,
        }),
      );
    });

    it('canAccessSafeSpace: false → 403 on detail', async () => {
      prisma.user.findUnique.mockResolvedValue(blockedTeacher);

      await expect(
        service.getTeacherReport('teacher-blocked', 'rep-1'),
      ).rejects.toThrow(
        expect.objectContaining({
          status: HttpStatus.FORBIDDEN,
        }),
      );
    });

    it('canAccessSafeSpace: false → 403 on add note', async () => {
      prisma.user.findUnique.mockResolvedValue(blockedTeacher);

      await expect(
        service.addTeacherReportNote('teacher-blocked', 'rep-1', {
          body: 'Note text',
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          status: HttpStatus.FORBIDDEN,
        }),
      );
    });

    it('status value outside the enum → 400 on teacher list', async () => {
      prisma.user.findUnique.mockResolvedValue(activeTeacher);

      await expect(
        service.listTeacherReports('teacher-1', {
          status: 'INVALID_STATUS' as any,
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          status: HttpStatus.BAD_REQUEST,
        }),
      );
    });

    it('teacher does not see another class’s report on detail', async () => {
      prisma.user.findUnique.mockResolvedValue(activeTeacher);
      // Teacher teaches class-1
      prisma.class.findMany.mockResolvedValue([{ id: 'class-1' }]);

      // Report belongs to class-99, student belongs to class-99
      prisma.safeSpaceReport.findUnique.mockResolvedValue({
        id: 'rep-other-class',
        class_id: 'class-99',
        student: {
          id: 'student-99',
          memberships: [{ class_id: 'class-99' }],
        },
      });

      await expect(
        service.getTeacherReport('teacher-1', 'rep-other-class'),
      ).rejects.toThrow(
        expect.objectContaining({
          status: HttpStatus.NOT_FOUND,
        }),
      );
    });

    it('teacher list queries reports for teacher assigned classes or member students', async () => {
      prisma.user.findUnique.mockResolvedValue(activeTeacher);
      prisma.class.findMany.mockResolvedValue([
        { id: 'class-1' },
        { id: 'class-2' },
      ]);

      const mockReports = [
        {
          id: 'rep-1',
          public_ref: 'WP-1001',
          school_id: 'school-1',
          student_id: 'student-1',
          class_id: 'class-1',
          category: ReportCategory.HURTFUL_WORDS,
          body: 'Called names',
          feel_safe: true,
          status: ReportStatus.NEW,
          student: {
            id: 'student-1',
            nickname: 'Speedy',
            real_name: 'Alex Smith',
            avatar_url: 'https://example.com/a.png',
          },
          class: { id: 'class-1', name: 'Grade 4A', grade: '4' },
          assignee: null,
          submitted_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      prisma.safeSpaceReport.findMany.mockResolvedValue(mockReports);
      prisma.safeSpaceReport.count.mockResolvedValue(1);

      const result = await service.listTeacherReports('teacher-1', {
        status: ReportStatus.NEW,
        page: 1,
        perPage: 10,
      });

      expect(result.success).toBe(true);
      expect(result.data.items).toHaveLength(1);
      expect(result.data.items[0].id).toBe('rep-1');
      expect(result.data.items[0].studentNickname).toBe('Speedy');

      expect(prisma.safeSpaceReport.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { class_id: { in: ['class-1', 'class-2'] } },
              {
                student: {
                  memberships: {
                    some: {
                      class_id: { in: ['class-1', 'class-2'] },
                      status: JoinRequestStatus.APPROVED,
                    },
                  },
                },
              },
            ],
            status: ReportStatus.NEW,
          },
        }),
      );
    });

    it('teacher detail returns report including notes and student nickname', async () => {
      prisma.user.findUnique.mockResolvedValue(activeTeacher);
      prisma.class.findMany.mockResolvedValue([{ id: 'class-1' }]);

      prisma.safeSpaceReport.findUnique.mockResolvedValue({
        id: 'rep-1',
        public_ref: 'WP-1001',
        school_id: 'school-1',
        student_id: 'student-1',
        class_id: 'class-1',
        category: ReportCategory.HURTFUL_WORDS,
        body: 'Report detail body',
        feel_safe: true,
        status: ReportStatus.REVIEWING,
        student: {
          id: 'student-1',
          nickname: 'Speedy',
          real_name: 'Alex Smith',
          avatar_url: 'https://example.com/a.png',
          memberships: [{ class_id: 'class-1' }],
        },
        class: { id: 'class-1', name: 'Grade 4A', grade: '4' },
        assignee: { id: 'teacher-1', nickname: 'Coach', real_name: 'John Doe' },
        notes: [
          {
            id: 'note-1',
            report_id: 'rep-1',
            author_id: 'teacher-1',
            body: 'Spoke to student today.',
            created_at: new Date(),
            updated_at: new Date(),
            author: {
              id: 'teacher-1',
              nickname: 'Coach',
              real_name: 'John Doe',
              role: Role.TEACHER,
            },
          },
        ],
        submitted_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      });

      const result = await service.getTeacherReport('teacher-1', 'rep-1');

      expect(result.success).toBe(true);
      expect(result.data.id).toBe('rep-1');
      expect(result.data.studentNickname).toBe('Speedy');
      expect(result.data.notes).toHaveLength(1);
      expect(result.data.notes[0].body).toBe('Spoke to student today.');
      expect(result.data.notes[0].author_id).toBe('teacher-1');
      expect(result.data.notes[0].authorId).toBe('teacher-1');
    });

    it('note stores author_id on teacher add note', async () => {
      prisma.user.findUnique.mockResolvedValue(activeTeacher);
      prisma.class.findMany.mockResolvedValue([{ id: 'class-1' }]);
      prisma.safeSpaceReport.findUnique.mockResolvedValue({
        id: 'rep-1',
        class_id: 'class-1',
        student: { id: 'student-1', memberships: [{ class_id: 'class-1' }] },
      });

      prisma.safeSpaceNote.create.mockResolvedValue({
        id: 'note-created-1',
        report_id: 'rep-1',
        author_id: 'teacher-1',
        body: 'Teacher confidential note',
        created_at: new Date(),
        updated_at: new Date(),
        author: {
          id: 'teacher-1',
          nickname: 'Coach',
          real_name: 'John Doe',
          role: Role.TEACHER,
        },
      });

      const result = await service.addTeacherReportNote('teacher-1', 'rep-1', {
        body: 'Teacher confidential note',
      });

      expect(result.success).toBe(true);
      expect(prisma.safeSpaceNote.create).toHaveBeenCalledWith({
        data: {
          report_id: 'rep-1',
          author_id: 'teacher-1',
          body: 'Teacher confidential note',
        },
        include: {
          author: {
            select: { id: true, nickname: true, real_name: true, role: true },
          },
        },
      });

      expect(result.data.author_id).toBe('teacher-1');
      expect(result.data.authorId).toBe('teacher-1');
      expect(result.data.body).toBe('Teacher confidential note');
    });
  });

  describe('Admin Safe Space', () => {
    it('status value outside the enum → 400 on admin list', async () => {
      prisma.user.findUnique.mockResolvedValue(adminUser);

      await expect(
        service.listAdminReports('admin-1', {
          status: 'INVALID_STATUS' as any,
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          status: HttpStatus.BAD_REQUEST,
        }),
      );
    });

    it('status value outside the enum → 400 on admin patch', async () => {
      prisma.user.findUnique.mockResolvedValue(adminUser);
      prisma.safeSpaceReport.findUnique.mockResolvedValue({
        id: 'rep-1',
        school_id: 'school-1',
      });

      await expect(
        service.updateAdminReport('admin-1', 'rep-1', {
          status: 'BOGUS_STATUS' as any,
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          status: HttpStatus.BAD_REQUEST,
        }),
      );
    });

    it('admin patch assignee who is not a teacher → 400', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(adminUser) // admin lookup
        .mockResolvedValueOnce({
          id: 'rep-1',
          school_id: 'school-1',
        }) // report lookup in safeSpaceReport? Wait, user vs safeSpaceReport
        .mockResolvedValueOnce({
          id: 'student-assignee',
          role: Role.STUDENT, // NOT a teacher
          school_id: 'school-1',
        });

      // safeSpaceReport.findUnique mock
      prisma.safeSpaceReport.findUnique.mockResolvedValue({
        id: 'rep-1',
        school_id: 'school-1',
      });

      await expect(
        service.updateAdminReport('admin-1', 'rep-1', {
          assigneeId: 'student-assignee',
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          status: HttpStatus.BAD_REQUEST,
        }),
      );
    });

    it('admin patch updates status and assigneeId successfully', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(adminUser) // admin lookup
        .mockResolvedValueOnce({
          id: 'teacher-1',
          role: Role.TEACHER,
          school_id: 'school-1',
        }); // assignee lookup

      prisma.safeSpaceReport.findUnique.mockResolvedValue({
        id: 'rep-1',
        school_id: 'school-1',
        status: ReportStatus.NEW,
      });

      prisma.safeSpaceReport.update.mockResolvedValue({
        id: 'rep-1',
        public_ref: 'WP-1001',
        school_id: 'school-1',
        student_id: 'student-1',
        class_id: 'class-1',
        category: ReportCategory.HURTFUL_WORDS,
        body: 'Report updated',
        feel_safe: true,
        status: ReportStatus.REVIEWING,
        assignee_id: 'teacher-1',
        student: {
          id: 'student-1',
          nickname: 'Speedy',
          real_name: 'Alex Smith',
        },
        class: { id: 'class-1', name: 'Grade 4A' },
        assignee: { id: 'teacher-1', nickname: 'Coach', real_name: 'John Doe' },
        notes: [],
        submitted_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      });

      const result = await service.updateAdminReport('admin-1', 'rep-1', {
        status: ReportStatus.REVIEWING,
        assigneeId: 'teacher-1',
      });

      expect(result.success).toBe(true);
      expect(result.data.status).toBe(ReportStatus.REVIEWING);
      expect(result.data.assigneeId).toBe('teacher-1');
      expect(prisma.safeSpaceReport.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rep-1' },
          data: {
            status: ReportStatus.REVIEWING,
            assignee_id: 'teacher-1',
          },
        }),
      );
    });

    it('admin detail returns report with notes and student nickname', async () => {
      prisma.user.findUnique.mockResolvedValue(adminUser);

      prisma.safeSpaceReport.findUnique.mockResolvedValue({
        id: 'rep-1',
        public_ref: 'WP-1001',
        school_id: 'school-1',
        student_id: 'student-1',
        class_id: 'class-1',
        category: ReportCategory.HURTFUL_WORDS,
        body: 'Admin detail body',
        feel_safe: true,
        status: ReportStatus.ADDRESSED,
        student: {
          id: 'student-1',
          nickname: 'Speedy',
          real_name: 'Alex Smith',
          avatar_url: null,
        },
        class: { id: 'class-1', name: 'Grade 4A' },
        assignee: null,
        notes: [
          {
            id: 'note-admin-1',
            report_id: 'rep-1',
            author_id: 'admin-1',
            body: 'Followed up with school counselor.',
            created_at: new Date(),
            updated_at: new Date(),
            author: {
              id: 'admin-1',
              nickname: 'AdminUser',
              real_name: 'Admin Person',
              role: Role.ADMIN,
            },
          },
        ],
        submitted_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      });

      const result = await service.getAdminReport('admin-1', 'rep-1');

      expect(result.success).toBe(true);
      expect(result.data.id).toBe('rep-1');
      expect(result.data.studentNickname).toBe('Speedy');
      expect(result.data.notes).toHaveLength(1);
      expect(result.data.notes[0].author_id).toBe('admin-1');
      expect(result.data.notes[0].authorId).toBe('admin-1');
      expect(result.data.notes[0].body).toBe(
        'Followed up with school counselor.',
      );
    });

    it('note stores author_id on admin add note', async () => {
      prisma.user.findUnique.mockResolvedValue(adminUser);
      prisma.safeSpaceReport.findUnique.mockResolvedValue({
        id: 'rep-1',
        school_id: 'school-1',
      });

      prisma.safeSpaceNote.create.mockResolvedValue({
        id: 'note-admin-2',
        report_id: 'rep-1',
        author_id: 'admin-1',
        body: 'Admin note for audit',
        created_at: new Date(),
        updated_at: new Date(),
        author: {
          id: 'admin-1',
          nickname: 'AdminUser',
          real_name: 'Admin Person',
          role: Role.ADMIN,
        },
      });

      const result = await service.addAdminReportNote('admin-1', 'rep-1', {
        body: 'Admin note for audit',
      });

      expect(result.success).toBe(true);
      expect(prisma.safeSpaceNote.create).toHaveBeenCalledWith({
        data: {
          report_id: 'rep-1',
          author_id: 'admin-1',
          body: 'Admin note for audit',
        },
        include: {
          author: {
            select: { id: true, nickname: true, real_name: true, role: true },
          },
        },
      });

      expect(result.data.author_id).toBe('admin-1');
      expect(result.data.authorId).toBe('admin-1');
      expect(result.data.body).toBe('Admin note for audit');
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
