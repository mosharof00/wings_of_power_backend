import {
  AgeGroup,
  BadgeCode,
  ClassCodeStatus,
  JoinRequestStatus,
  PowerCode,
  PublishStatus,
  QuestionType,
  QuizKind,
  Role,
  RoundType,
  StoryCategory,
  UserStatus,
} from 'prisma/generated/client';
import * as bcrypt from 'bcrypt';
import { buildSeedPlan, DEMO_SCHOOL_NAME, executeSeed } from './seed.data';

describe('SeedCommand and buildSeedPlan', () => {
  describe('buildSeedPlan pure tests', () => {
    it('sets admin email from env value or options', async () => {
      const plan = await buildSeedPlan({
        adminEmail: 'test-admin@custom.school',
        saltRounds: 1,
      });

      expect(plan.admin.email).toBe('test-admin@custom.school');
      expect(plan.admin.role).toBe(Role.ADMIN);
      expect(plan.admin.status).toBe(UserStatus.ACTIVE);
      expect(plan.admin.email_verified).toBe(true);
    });

    it('creates exactly 6 badges with empty criteria_json', async () => {
      const plan = await buildSeedPlan({ saltRounds: 1 });

      expect(plan.badges).toHaveLength(6);
      const codes = plan.badges.map((b) => b.code);
      expect(codes).toContain(BadgeCode.KINDNESS_CHAMPION);
      expect(codes).toContain(BadgeCode.STORY_EXPLORER);
      expect(codes).toContain(BadgeCode.HELPING_HAND);
      expect(codes).toContain(BadgeCode.SPEAK_UP);
      expect(codes).toContain(BadgeCode.POSITIVE_LEADER);
      expect(codes).toContain(BadgeCode.GAME_SHOW_READY);

      for (const badge of plan.badges) {
        expect(badge.criteria_json).toEqual({});
      }
    });

    it('sets point-rule values to 1, 50, and 5', async () => {
      const plan = await buildSeedPlan({ saltRounds: 1 });

      const ruleMap = new Map(plan.pointRules.map((r) => [r.key, r.value_int]));
      expect(ruleMap.get('STORY_QUESTION')).toBe(1);
      expect(ruleMap.get('KINDNESS_ROUND')).toBe(50);
      expect(ruleMap.get('TEACHER_AWARD_MAX')).toBe(5);
    });

    it('configures eligibility with 2 / 6 / 70', async () => {
      const plan = await buildSeedPlan({ saltRounds: 1 });

      expect(plan.eligibility).toEqual({
        required_stories: 2,
        required_chapters: 6,
        min_quiz_percent: 70,
      });
    });

    it('configures 7 heroes with unlock_stories_required 0 for Faith and 2 for others', async () => {
      const plan = await buildSeedPlan({ saltRounds: 1 });

      expect(plan.heroes).toHaveLength(7);
      const faith = plan.heroes.find((h) => h.code === 'FAITH');
      expect(faith).toBeDefined();
      expect(faith?.unlock_stories_required).toBe(0);
      expect(faith?.power_code).toBe(PowerCode.MELODY);

      const others = plan.heroes.filter((h) => h.code !== 'FAITH');
      expect(others).toHaveLength(6);
      for (const hero of others) {
        expect(hero.unlock_stories_required).toBe(2);
      }
    });

    it('hashes passwords and does not keep plain text', async () => {
      const plan = await buildSeedPlan({
        adminPassword: 'super-admin-pass',
        teacherPassword: 'teacher-pass',
        studentPassword: 'student-pass',
        saltRounds: 1,
      });

      expect(plan.admin.password_hash).not.toBe('super-admin-pass');
      expect(
        await bcrypt.compare('super-admin-pass', plan.admin.password_hash),
      ).toBe(true);
      expect(
        await bcrypt.compare('teacher-pass', plan.teacher.password_hash),
      ).toBe(true);
      expect(
        await bcrypt.compare('student-pass', plan.students.active.password_hash),
      ).toBe(true);
    });

    it('configures published story with at least 2 chapters and pages', async () => {
      const plan = await buildSeedPlan({ saltRounds: 1 });

      expect(plan.story.status).toBe(PublishStatus.PUBLISHED);
      expect(plan.story.category).toBe(StoryCategory.KINDNESS);
      expect(plan.story.age_group).toBe(AgeGroup.AGE_6_9);
      expect(plan.story.chapters.length).toBeGreaterThanOrEqual(2);
      for (const ch of plan.story.chapters) {
        expect(ch.pages.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('configures CHECKPOINT and CHAPTER quizzes on chapter 1 with 2 MCQ each and 1 correct option', async () => {
      const plan = await buildSeedPlan({ saltRounds: 1 });

      expect(plan.quizzes).toHaveLength(2);
      const kinds = plan.quizzes.map((q) => q.kind);
      expect(kinds).toContain(QuizKind.CHECKPOINT);
      expect(kinds).toContain(QuizKind.CHAPTER);

      for (const quiz of plan.quizzes) {
        expect(quiz.questions).toHaveLength(2);
        for (const q of quiz.questions) {
          expect(q.type).toBe(QuestionType.MCQ);
          const correctOptions = q.options.filter((opt) => opt.is_correct);
          expect(correctOptions).toHaveLength(1);
        }
      }
    });

    it('configures published pack with Q1-Q4 questions', async () => {
      const plan = await buildSeedPlan({ saltRounds: 1 });

      expect(plan.pack.status).toBe(PublishStatus.PUBLISHED);
      expect(plan.pack.questions).toHaveLength(4);
      const roundTypes = plan.pack.questions.map((q) => q.round_type);
      expect(roundTypes).toContain(RoundType.Q1_WARMUP);
      expect(roundTypes).toContain(RoundType.Q2_DEFENSE);
      expect(roundTypes).toContain(RoundType.Q3_HOBBY);
      expect(roundTypes).toContain(RoundType.Q4_FINALS);
    });
  });

  describe('executeSeed idempotent execution with mocked Prisma', () => {
    let mockPrisma: any;

    beforeEach(() => {
      mockPrisma = {
        school: {
          findFirst: jest.fn(),
          create: jest.fn().mockResolvedValue({ id: 'school-1', name: DEMO_SCHOOL_NAME }),
        },
        user: {
          create: jest.fn().mockImplementation(({ data }) =>
            Promise.resolve({ id: `user-${data.role || 'student'}`, ...data }),
          ),
        },
        class: {
          create: jest.fn().mockResolvedValue({ id: 'class-1', name: 'Grade 4 · Amber' }),
        },
        classCode: {
          create: jest.fn().mockResolvedValue({ id: 'code-1', code: 'WING-4320' }),
        },
        classMembership: {
          create: jest.fn().mockResolvedValue({ id: 'membership-1' }),
        },
        hero: {
          upsert: jest.fn().mockResolvedValue({ id: 'hero-1' }),
        },
        badge: {
          upsert: jest.fn().mockResolvedValue({ id: 'badge-1' }),
        },
        pointRule: {
          create: jest.fn().mockResolvedValue({ id: 'pr-1' }),
        },
        gameEligibilityConfig: {
          upsert: jest.fn().mockResolvedValue({ school_id: 'school-1' }),
        },
        story: {
          create: jest.fn().mockResolvedValue({ id: 'story-1' }),
        },
        chapter: {
          create: jest.fn().mockImplementation(({ data }) =>
            Promise.resolve({ id: `chapter-${data.number}`, ...data }),
          ),
        },
        page: {
          create: jest.fn().mockResolvedValue({ id: 'page-1' }),
        },
        quiz: {
          create: jest.fn().mockResolvedValue({ id: 'quiz-1' }),
        },
        question: {
          create: jest.fn().mockResolvedValue({ id: 'question-1' }),
        },
        questionOption: {
          create: jest.fn().mockResolvedValue({ id: 'option-1' }),
        },
        gameQuestionPack: {
          create: jest.fn().mockResolvedValue({ id: 'pack-1' }),
        },
        gamePackStory: {
          create: jest.fn().mockResolvedValue({ id: 'gps-1' }),
        },
        gamePackQuestion: {
          create: jest.fn().mockResolvedValue({ id: 'gpq-1' }),
        },
      };
    });

    it('does not create a second school when one exists', async () => {
      mockPrisma.school.findFirst.mockResolvedValue({
        id: 'existing-school-1',
        name: DEMO_SCHOOL_NAME,
      });

      const result = await executeSeed(mockPrisma);

      expect(result.skipped).toBe(true);
      expect(result.schoolId).toBe('existing-school-1');
      expect(mockPrisma.school.create).not.toHaveBeenCalled();
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
      expect(mockPrisma.class.create).not.toHaveBeenCalled();
      expect(mockPrisma.story.create).not.toHaveBeenCalled();
    });

    it('creates all seed entities when school does not exist', async () => {
      mockPrisma.school.findFirst.mockResolvedValue(null);

      const result = await executeSeed(mockPrisma, {
        adminEmail: 'fresh-admin@demo.school',
        teacherEmail: 'fresh-teacher@demo.school',
        saltRounds: 1,
      });

      expect(result.skipped).toBe(false);
      expect(result.schoolId).toBe('school-1');
      expect(result.adminEmail).toBe('fresh-admin@demo.school');
      expect(result.teacherEmail).toBe('fresh-teacher@demo.school');
      expect(result.classCode).toBe('WING-4320');

      // School created
      expect(mockPrisma.school.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ name: DEMO_SCHOOL_NAME }),
      });

      // Admin & teacher created
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'fresh-admin@demo.school',
            role: Role.ADMIN,
            status: UserStatus.ACTIVE,
          }),
        }),
      );
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'fresh-teacher@demo.school',
            role: Role.TEACHER,
            status: UserStatus.ACTIVE,
            settings_json: { canAccessSafeSpace: true },
          }),
        }),
      );

      // Class and class code
      expect(mockPrisma.class.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Grade 4 · Amber',
          age_group: AgeGroup.AGE_6_9,
        }),
      });
      expect(mockPrisma.classCode.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          code: 'WING-4320',
          status: ClassCodeStatus.ACTIVE,
        }),
      });

      // Students
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            role: Role.STUDENT,
            status: UserStatus.PENDING,
          }),
        }),
      );
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            role: Role.STUDENT,
            status: UserStatus.ACTIVE,
          }),
        }),
      );

      // Memberships: 1 pending, 1 approved
      expect(mockPrisma.classMembership.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: JoinRequestStatus.PENDING,
        }),
      });
      expect(mockPrisma.classMembership.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: JoinRequestStatus.APPROVED,
        }),
      });

      // 7 heroes
      expect(mockPrisma.hero.upsert).toHaveBeenCalledTimes(7);

      // 6 badges
      expect(mockPrisma.badge.upsert).toHaveBeenCalledTimes(6);

      // 3 point rules
      expect(mockPrisma.pointRule.create).toHaveBeenCalledTimes(3);

      // Eligibility 2 / 6 / 70
      expect(mockPrisma.gameEligibilityConfig.upsert).toHaveBeenCalledWith({
        where: { school_id: 'school-1' },
        create: {
          school_id: 'school-1',
          required_stories: 2,
          required_chapters: 6,
          min_quiz_percent: 70,
        },
        update: {
          required_stories: 2,
          required_chapters: 6,
          min_quiz_percent: 70,
        },
      });

      // Story, quizzes, pack
      expect(mockPrisma.story.create).toHaveBeenCalled();
      expect(mockPrisma.quiz.create).toHaveBeenCalledTimes(2);
      expect(mockPrisma.gameQuestionPack.create).toHaveBeenCalled();
      expect(mockPrisma.gamePackStory.create).toHaveBeenCalled();
      expect(mockPrisma.gamePackQuestion.create).toHaveBeenCalledTimes(4);
    });
  });
});
