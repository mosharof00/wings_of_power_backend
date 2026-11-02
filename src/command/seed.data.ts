import * as bcrypt from 'bcrypt';
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

export interface SeedEnv {
  adminEmail?: string;
  adminPassword?: string;
  teacherEmail?: string;
  teacherPassword?: string;
  studentPassword?: string;
  saltRounds?: number;
}

export interface SeedHeroData {
  code: string;
  display_name: string;
  role_title: string;
  bullied_for: string;
  power_code: PowerCode;
  power_label: string;
  power_description: string;
  quote: string;
  sort_order: number;
  unlock_stories_required: number;
}

export interface SeedBadgeData {
  code: BadgeCode;
  title: string;
  description: string;
  how_to_earn: string;
  criteria_json: Record<string, any>;
}

export interface SeedPointRuleData {
  key: string;
  value_int: number;
}

export interface SeedQuizOptionData {
  sort_order: number;
  label: string;
  is_correct: boolean;
}

export interface SeedQuizQuestionData {
  sort_order: number;
  type: QuestionType;
  prompt: string;
  hint?: string;
  explanation?: string;
  options: SeedQuizOptionData[];
}

export interface SeedQuizData {
  kind: QuizKind;
  title: string;
  questions: SeedQuizQuestionData[];
}

export interface SeedPackQuestionData {
  round_type: RoundType;
  sort_order: number;
  type: QuestionType;
  prompt: string;
  options_json: any;
  meta_json?: any;
}

export interface SeedPlan {
  school: {
    name: string;
    profile_json?: Record<string, any>;
  };
  admin: {
    email: string;
    role: Role;
    status: UserStatus;
    password_hash: string;
    email_verified: boolean;
    real_name: string;
  };
  teacher: {
    email: string;
    role: Role;
    status: UserStatus;
    password_hash: string;
    email_verified: boolean;
    real_name: string;
    settings_json: { canAccessSafeSpace: boolean };
  };
  classInfo: {
    name: string;
    grade_label: string;
    age_group: AgeGroup;
  };
  classCode: {
    code: string;
    status: ClassCodeStatus;
  };
  students: {
    pending: {
      username: string;
      role: Role;
      status: UserStatus;
      nickname: string;
      real_name: string;
      membershipStatus: JoinRequestStatus;
    };
    active: {
      username: string;
      role: Role;
      status: UserStatus;
      nickname: string;
      real_name: string;
      password_hash: string;
      membershipStatus: JoinRequestStatus;
    };
  };
  heroes: SeedHeroData[];
  badges: SeedBadgeData[];
  pointRules: SeedPointRuleData[];
  eligibility: {
    required_stories: number;
    required_chapters: number;
    min_quiz_percent: number;
  };
  story: {
    title: string;
    slug: string;
    synopsis: string;
    category: StoryCategory;
    age_group: AgeGroup;
    status: PublishStatus;
    estimated_minutes: number;
    chapter_count: number;
    chapters: Array<{
      number: number;
      title: string;
      page_count: number;
      pages: Array<{
        number: number;
        body_text: string;
      }>;
    }>;
  };
  quizzes: SeedQuizData[];
  pack: {
    title: string;
    age_group: AgeGroup;
    status: PublishStatus;
    questions: SeedPackQuestionData[];
  };
}

export interface SeedResult {
  skipped: boolean;
  schoolId?: string;
  adminEmail?: string;
  teacherEmail?: string;
  classCode?: string;
  plan?: SeedPlan;
}

export const DEMO_SCHOOL_NAME = 'Demo Elementary';

export async function buildSeedPlan(env?: Partial<SeedEnv>): Promise<SeedPlan> {
  const adminEmail =
    env?.adminEmail || process.env.SEED_ADMIN_EMAIL || 'admin@demo.school';
  const adminPassword =
    env?.adminPassword || process.env.SEED_ADMIN_PASSWORD || 'change-me';
  const teacherEmail =
    env?.teacherEmail || process.env.SEED_TEACHER_EMAIL || 'teacher@demo.school';
  const teacherPassword =
    env?.teacherPassword || process.env.SEED_TEACHER_PASSWORD || 'change-me';
  const studentPassword =
    env?.studentPassword || process.env.SEED_STUDENT_PASSWORD || 'change-me';
  const saltRounds = env?.saltRounds ?? 10;

  const [adminHash, teacherHash, studentHash] = await Promise.all([
    bcrypt.hash(adminPassword, saltRounds),
    bcrypt.hash(teacherPassword, saltRounds),
    bcrypt.hash(studentPassword, saltRounds),
  ]);

  return {
    school: {
      name: DEMO_SCHOOL_NAME,
      profile_json: {
        address: '123 Kindness Way',
        city: 'Metropolis',
        state: 'CA',
        zip: '90210',
      },
    },
    admin: {
      email: adminEmail,
      role: Role.ADMIN,
      status: UserStatus.ACTIVE,
      password_hash: adminHash,
      email_verified: true,
      real_name: 'Demo Admin',
    },
    teacher: {
      email: teacherEmail,
      role: Role.TEACHER,
      status: UserStatus.ACTIVE,
      password_hash: teacherHash,
      email_verified: true,
      real_name: 'Demo Teacher',
      settings_json: { canAccessSafeSpace: true },
    },
    classInfo: {
      name: 'Grade 4 · Amber',
      grade_label: 'Grade 4',
      age_group: AgeGroup.AGE_6_9,
    },
    classCode: {
      code: 'WING-4320',
      status: ClassCodeStatus.ACTIVE,
    },
    students: {
      pending: {
        username: 'student.pending',
        role: Role.STUDENT,
        status: UserStatus.PENDING,
        nickname: 'Pending Sam',
        real_name: 'Sam Rivera',
        membershipStatus: JoinRequestStatus.PENDING,
      },
      active: {
        username: 'student.active',
        role: Role.STUDENT,
        status: UserStatus.ACTIVE,
        nickname: 'Active Alex',
        real_name: 'Alex Chen',
        password_hash: studentHash,
        membershipStatus: JoinRequestStatus.APPROVED,
      },
    },
    heroes: [
      {
        code: 'FAITH',
        display_name: 'Faith',
        role_title: 'Violinist',
        bullied_for: 'loving violin',
        power_code: PowerCode.MELODY,
        power_label: 'Melody Shot',
        power_description: 'Melody Shot: extra focus time',
        quote: 'My music makes me strong.',
        sort_order: 1,
        unlock_stories_required: 0,
      },
      {
        code: 'HAROLD',
        display_name: 'Harold',
        role_title: 'Young Scientist',
        bullied_for: 'loving science too much',
        power_code: PowerCode.LAB,
        power_label: 'Lab Shot',
        power_description: 'Lab Shot: removes 2 wrong answers',
        quote: 'Curiosity is my superpower.',
        sort_order: 2,
        unlock_stories_required: 2,
      },
      {
        code: 'RALPH',
        display_name: 'Ralph',
        role_title: 'Nature Explorer',
        bullied_for: 'carrying a magnifying glass, loving insects',
        power_code: PowerCode.NATURE,
        power_label: 'Nature Shot',
        power_description: 'Nature Shot: reveals an animal hint',
        quote: 'Small things matter.',
        sort_order: 3,
        unlock_stories_required: 2,
      },
      {
        code: 'MICHELE',
        display_name: 'Michele',
        role_title: 'Artist',
        bullied_for: 'her art and her beautiful unique skin pigmentation',
        power_code: PowerCode.COLOR,
        power_label: 'Color Shot',
        power_description: 'Color Shot: freezes the timer',
        quote: 'My art and my skin tell my story.',
        sort_order: 4,
        unlock_stories_required: 2,
      },
      {
        code: 'SAMANTHA',
        display_name: 'Samantha',
        role_title: 'Singer',
        bullied_for: 'playing guitar and singing',
        power_code: PowerCode.HARMONY,
        power_label: 'Harmony Shot',
        power_description: 'Harmony Shot: ask a teammate for help',
        quote: 'My voice deserves to be heard.',
        sort_order: 5,
        unlock_stories_required: 2,
      },
      {
        code: 'MICHAEL',
        display_name: 'Michael',
        role_title: 'Chess Thinker',
        bullied_for: 'loving chess',
        power_code: PowerCode.CHECKMATE,
        power_label: 'Checkmate Shot',
        power_description: 'Checkmate Shot: sees defense strategy',
        quote: 'Smart moves win kind games.',
        sort_order: 6,
        unlock_stories_required: 2,
      },
      {
        code: 'CHI',
        display_name: 'Chi',
        role_title: 'Numbers Star',
        bullied_for: 'loving statistics and geometry',
        power_code: PowerCode.PRISM,
        power_label: 'Prism Shot',
        power_description:
          'Prism Shot: calculates the perfect angle and shows probability',
        quote: 'Numbers tell beautiful stories.',
        sort_order: 7,
        unlock_stories_required: 2,
      },
    ],
    badges: [
      {
        code: BadgeCode.KINDNESS_CHAMPION,
        title: 'Kindness Champion',
        description: 'Earn kindness points through acts of kindness and gameplay.',
        how_to_earn: 'Earn kindness points in games and stories.',
        criteria_json: {},
      },
      {
        code: BadgeCode.STORY_EXPLORER,
        title: 'Story Explorer',
        description: 'Complete stories to explore new worlds.',
        how_to_earn: 'Complete reading stories.',
        criteria_json: {},
      },
      {
        code: BadgeCode.HELPING_HAND,
        title: 'Helping Hand',
        description: 'Support your classmates and team.',
        how_to_earn: 'Help teammates and earn awards.',
        criteria_json: {},
      },
      {
        code: BadgeCode.SPEAK_UP,
        title: 'Speak Up',
        description: 'Stand up against bullying and be an upstander.',
        how_to_earn: 'Make upstander choices in defense rounds.',
        criteria_json: {},
      },
      {
        code: BadgeCode.POSITIVE_LEADER,
        title: 'Positive Leader',
        description: 'Lead by positive example in your school.',
        how_to_earn: 'Earn teacher awards for positive leadership.',
        criteria_json: {},
      },
      {
        code: BadgeCode.GAME_SHOW_READY,
        title: 'Game Show Ready',
        description: 'Qualify for the basketball game show.',
        how_to_earn: 'Achieve qualifying quiz scores.',
        criteria_json: {},
      },
    ],
    pointRules: [
      { key: 'STORY_QUESTION', value_int: 1 },
      { key: 'KINDNESS_ROUND', value_int: 50 },
      { key: 'TEACHER_AWARD_MAX', value_int: 5 },
    ],
    eligibility: {
      required_stories: 2,
      required_chapters: 6,
      min_quiz_percent: 70,
    },
    story: {
      title: 'Faith and the Power of Melody',
      slug: 'faith-and-the-power-of-melody',
      synopsis:
        'Faith discovers how her violin music can bring students together and stand up against bullying.',
      category: StoryCategory.KINDNESS,
      age_group: AgeGroup.AGE_6_9,
      status: PublishStatus.PUBLISHED,
      estimated_minutes: 8,
      chapter_count: 2,
      chapters: [
        {
          number: 1,
          title: 'Chapter 1: The Practice Room',
          page_count: 2,
          pages: [
            {
              number: 1,
              body_text:
                'Faith held her violin gently under her chin, tuning each string before the afternoon bell rang.',
            },
            {
              number: 2,
              body_text:
                'Through the classroom window, she noticed a fellow student standing alone in the school courtyard.',
            },
          ],
        },
        {
          number: 2,
          title: 'Chapter 2: Playing Together',
          page_count: 2,
          pages: [
            {
              number: 1,
              body_text:
                'Faith invited her classmates to listen and share their own favorite hobbies during recess.',
            },
            {
              number: 2,
              body_text:
                'Together, they discovered that every unique hobby gave them wings to support one another.',
            },
          ],
        },
      ],
    },
    quizzes: [
      {
        kind: QuizKind.CHECKPOINT,
        title: 'Mid-Chapter Checkpoint',
        questions: [
          {
            sort_order: 1,
            type: QuestionType.MCQ,
            prompt: 'What musical instrument does Faith play?',
            hint: 'It is played with a bow.',
            explanation: 'Faith plays the violin.',
            options: [
              { sort_order: 1, label: 'Violin', is_correct: true },
              { sort_order: 2, label: 'Drums', is_correct: false },
              { sort_order: 3, label: 'Guitar', is_correct: false },
              { sort_order: 4, label: 'Piano', is_correct: false },
            ],
          },
          {
            sort_order: 2,
            type: QuestionType.MCQ,
            prompt: 'Where did Faith notice a classmate standing alone?',
            hint: 'Outside the classroom window.',
            explanation: 'She saw them in the courtyard.',
            options: [
              { sort_order: 1, label: 'In the school courtyard', is_correct: true },
              { sort_order: 2, label: 'In the cafeteria', is_correct: false },
              { sort_order: 3, label: 'On the bus', is_correct: false },
              { sort_order: 4, label: 'At the library', is_correct: false },
            ],
          },
        ],
      },
      {
        kind: QuizKind.CHAPTER,
        title: 'Chapter 1 End Quiz',
        questions: [
          {
            sort_order: 1,
            type: QuestionType.MCQ,
            prompt: 'What did Faith do before playing her violin?',
            hint: 'She prepared the strings.',
            explanation: 'She tuned each string.',
            options: [
              { sort_order: 1, label: 'Tuned each string', is_correct: true },
              { sort_order: 2, label: 'Packed it away', is_correct: false },
              { sort_order: 3, label: 'Left the room', is_correct: false },
              { sort_order: 4, label: 'Ate lunch', is_correct: false },
            ],
          },
          {
            sort_order: 2,
            type: QuestionType.MCQ,
            prompt: 'What is the kind choice when someone is alone at recess?',
            hint: 'Think about inclusion.',
            explanation: 'Inviting them to join is the upstander choice.',
            options: [
              { sort_order: 1, label: 'Invite them to join in', is_correct: true },
              { sort_order: 2, label: 'Walk past them', is_correct: false },
              { sort_order: 3, label: 'Point and whisper', is_correct: false },
              { sort_order: 4, label: 'Ignore them', is_correct: false },
            ],
          },
        ],
      },
    ],
    pack: {
      title: 'Kindness & Upstanders Season 1',
      age_group: AgeGroup.AGE_6_9,
      status: PublishStatus.PUBLISHED,
      questions: [
        {
          round_type: RoundType.Q1_WARMUP,
          sort_order: 1,
          type: QuestionType.MCQ,
          prompt: 'What is the best first step when you see teasing on the playground?',
          options_json: [
            { label: 'Step in kindly or ask an adult for help', is_correct: true },
            { label: 'Join in the teasing', is_correct: false },
            { label: 'Cheer for the bully', is_correct: false },
            { label: 'Run away quietly', is_correct: false },
          ],
          meta_json: { correctIndex: 0 },
        },
        {
          round_type: RoundType.Q2_DEFENSE,
          sort_order: 2,
          type: QuestionType.FREE_TEXT,
          prompt: 'Share one way you can make a classmate feel welcome when they are new.',
          options_json: [],
          meta_json: {},
        },
        {
          round_type: RoundType.Q3_HOBBY,
          sort_order: 3,
          type: QuestionType.MCQ,
          prompt: 'How does practicing a hobby like art or music help students?',
          options_json: [
            { label: 'It builds confidence and reduces stress', is_correct: true },
            { label: 'It makes them boastful', is_correct: false },
            { label: 'It wastes study time', is_correct: false },
            { label: 'It prevents making friends', is_correct: false },
          ],
          meta_json: { correctIndex: 0 },
        },
        {
          round_type: RoundType.Q4_FINALS,
          sort_order: 4,
          type: QuestionType.MCQ,
          prompt: 'How can a classroom team create a true culture of kindness?',
          options_json: [
            {
              label: 'Listen to everyone and celebrate each other’s strengths',
              is_correct: true,
            },
            { label: 'Form exclusive groups', is_correct: false },
            { label: 'Only help when asked by teachers', is_correct: false },
            { label: 'Compete against each other angrily', is_correct: false },
          ],
          meta_json: { correctIndex: 0 },
        },
      ],
    },
  };
}

export async function executeSeed(
  prisma: any,
  env?: Partial<SeedEnv>,
): Promise<SeedResult> {
  const existingSchool = await prisma.school.findFirst({
    where: { name: DEMO_SCHOOL_NAME },
  });

  if (existingSchool) {
    console.log(
      `School "${DEMO_SCHOOL_NAME}" already exists (id: ${existingSchool.id}). Skipping seed.`,
    );
    return {
      skipped: true,
      schoolId: existingSchool.id,
    };
  }

  const plan = await buildSeedPlan(env);

  // 1. School
  const school = await prisma.school.create({
    data: {
      name: plan.school.name,
      profile_json: plan.school.profile_json,
    },
  });

  // 2. Admin
  const admin = await prisma.user.create({
    data: {
      email: plan.admin.email,
      role: plan.admin.role,
      status: plan.admin.status,
      password_hash: plan.admin.password_hash,
      email_verified_at: new Date(),
      school_id: school.id,
      real_name: plan.admin.real_name,
    },
  });

  // 3. Teacher
  const teacher = await prisma.user.create({
    data: {
      email: plan.teacher.email,
      role: plan.teacher.role,
      status: plan.teacher.status,
      password_hash: plan.teacher.password_hash,
      email_verified_at: new Date(),
      school_id: school.id,
      real_name: plan.teacher.real_name,
      settings_json: plan.teacher.settings_json,
    },
  });

  // 4. Class
  const cls = await prisma.class.create({
    data: {
      school_id: school.id,
      name: plan.classInfo.name,
      grade_label: plan.classInfo.grade_label,
      age_group: plan.classInfo.age_group,
      teacher_id: teacher.id,
    },
  });

  // 5. ClassCode
  const classCode = await prisma.classCode.create({
    data: {
      class_id: cls.id,
      code: plan.classCode.code,
      status: plan.classCode.status,
      created_by_id: teacher.id,
    },
  });

  // 6. Students
  const pendingStudent = await prisma.user.create({
    data: {
      username: plan.students.pending.username,
      role: plan.students.pending.role,
      status: plan.students.pending.status,
      nickname: plan.students.pending.nickname,
      real_name: plan.students.pending.real_name,
      school_id: school.id,
    },
  });
  await prisma.classMembership.create({
    data: {
      class_id: cls.id,
      user_id: pendingStudent.id,
      status: plan.students.pending.membershipStatus,
      joined_via_code_id: classCode.id,
    },
  });

  const activeStudent = await prisma.user.create({
    data: {
      username: plan.students.active.username,
      password_hash: plan.students.active.password_hash,
      role: plan.students.active.role,
      status: plan.students.active.status,
      nickname: plan.students.active.nickname,
      real_name: plan.students.active.real_name,
      school_id: school.id,
    },
  });
  await prisma.classMembership.create({
    data: {
      class_id: cls.id,
      user_id: activeStudent.id,
      status: plan.students.active.membershipStatus,
      joined_via_code_id: classCode.id,
      approved_by_id: teacher.id,
      approved_at: new Date(),
    },
  });

  // 7. Heroes
  for (const hero of plan.heroes) {
    await prisma.hero.upsert({
      where: { code: hero.code },
      create: hero,
      update: hero,
    });
  }

  // 8. Badges
  for (const badge of plan.badges) {
    await prisma.badge.upsert({
      where: { code: badge.code },
      create: {
        ...badge,
        school_id: school.id,
      },
      update: {
        ...badge,
        school_id: school.id,
      },
    });
  }

  // 9. Point rules
  for (const rule of plan.pointRules) {
    await prisma.pointRule.create({
      data: {
        school_id: school.id,
        key: rule.key,
        value_int: rule.value_int,
      },
    });
  }

  // 10. Eligibility
  await prisma.gameEligibilityConfig.upsert({
    where: { school_id: school.id },
    create: {
      school_id: school.id,
      required_stories: plan.eligibility.required_stories,
      required_chapters: plan.eligibility.required_chapters,
      min_quiz_percent: plan.eligibility.min_quiz_percent,
    },
    update: {
      required_stories: plan.eligibility.required_stories,
      required_chapters: plan.eligibility.required_chapters,
      min_quiz_percent: plan.eligibility.min_quiz_percent,
    },
  });

  // 11. Story, Chapters, Pages
  const story = await prisma.story.create({
    data: {
      school_id: school.id,
      title: plan.story.title,
      slug: plan.story.slug,
      synopsis: plan.story.synopsis,
      category: plan.story.category,
      age_group: plan.story.age_group,
      status: plan.story.status,
      estimated_minutes: plan.story.estimated_minutes,
      chapter_count: plan.story.chapter_count,
      created_by_id: admin.id,
    },
  });

  const createdChapters: any[] = [];
  for (const ch of plan.story.chapters) {
    const chapter = await prisma.chapter.create({
      data: {
        story_id: story.id,
        number: ch.number,
        title: ch.title,
        page_count: ch.page_count,
      },
    });
    createdChapters.push(chapter);

    for (const pg of ch.pages) {
      await prisma.page.create({
        data: {
          chapter_id: chapter.id,
          number: pg.number,
          body_text: pg.body_text,
        },
      });
    }
  }

  // 12. Quizzes (on Chapter 1)
  const chapter1 = createdChapters.find((c) => c.number === 1) || createdChapters[0];
  for (const quizPlan of plan.quizzes) {
    const quiz = await prisma.quiz.create({
      data: {
        kind: quizPlan.kind,
        chapter_id: chapter1.id,
        title: quizPlan.title,
        created_by_id: teacher.id,
      },
    });

    for (const q of quizPlan.questions) {
      const question = await prisma.question.create({
        data: {
          quiz_id: quiz.id,
          sort_order: q.sort_order,
          type: q.type,
          prompt: q.prompt,
          hint: q.hint,
          explanation: q.explanation,
        },
      });

      for (const opt of q.options) {
        await prisma.questionOption.create({
          data: {
            question_id: question.id,
            sort_order: opt.sort_order,
            label: opt.label,
            is_correct: opt.is_correct,
          },
        });
      }
    }
  }

  // 13. Game Question Pack & Story link
  const pack = await prisma.gameQuestionPack.create({
    data: {
      school_id: school.id,
      title: plan.pack.title,
      age_group: plan.pack.age_group,
      status: plan.pack.status,
      created_by_id: teacher.id,
    },
  });

  await prisma.gamePackStory.create({
    data: {
      pack_id: pack.id,
      story_id: story.id,
    },
  });

  for (const gq of plan.pack.questions) {
    await prisma.gamePackQuestion.create({
      data: {
        pack_id: pack.id,
        round_type: gq.round_type,
        sort_order: gq.sort_order,
        type: gq.type,
        prompt: gq.prompt,
        options_json: gq.options_json,
        meta_json: gq.meta_json,
      },
    });
  }

  console.log(
    `Seed succeeded: School "${DEMO_SCHOOL_NAME}" created with admin ${plan.admin.email}, teacher ${plan.teacher.email}, class code ${plan.classCode.code}.`,
  );

  return {
    skipped: false,
    schoolId: school.id,
    adminEmail: plan.admin.email,
    teacherEmail: plan.teacher.email,
    classCode: plan.classCode.code,
    plan,
  };
}
