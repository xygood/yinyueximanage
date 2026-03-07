// 教研室/专业类型
export interface Faculty {
  id: string;
  faculty_name: string;      // 教研室名称（钢琴教研室、声乐教研室、器乐教研室）
  faculty_code: string;      // 教研室代码（PIANO, VOCAL, INSTRUMENT, THEORY）
  description?: string;
  created_at: string;
  updated_at?: string;       // 自动更新timestamp
}

// 教研室工作量统计视图类型
export interface FacultyWorkloadDaily {
  faculty_name: string;
  faculty_code: string;
  date: string;
  class_count: number;
  teacher_count: number;
  student_count: number;
}

// 教师资格概览视图类型
export interface TeacherQualification {
  teacher_id: string;
  full_name: string;
  faculty_name: string;
  faculty_code: string;
  primary_instrument: string;
  qualified_instruments: string[];
  instrument_count: number;
}

// 教研室配置
export const FACULTIES = [
  { faculty_name: '钢琴教研室', faculty_code: 'PIANO', description: '负责所有钢琴课程教学' },
  { faculty_name: '声乐教研室', faculty_code: 'VOCAL', description: '负责所有声乐课程教学' },
  { faculty_name: '器乐教研室', faculty_code: 'INSTRUMENT', description: '负责所有器乐课程教学（古筝、笛子、古琴、葫芦丝、双排键、小提琴、萨克斯等）' },
  { faculty_name: '理论教研室', faculty_code: 'THEORY', description: '负责所有音乐理论课程教学' },
] as const;

export type FacultyCode = typeof FACULTIES[number]['faculty_code'];

// 熟练程度类型
export type ProficiencyLevel = 'primary' | 'secondary' | 'assistant';

// 教师可教授乐器类型
export interface TeacherInstrument {
  id: string;
  teacher_id: string;
  instrument_name: string;
  proficiency_level: ProficiencyLevel;
  created_at: string;
}

// 乐器配置类型
export interface InstrumentConfig {
  id: string;
  instrument_name: string;
  max_students_per_class: number;  // 每节课最大学生数
  faculty_id?: string;             // 教研室ID（外键）
  faculty_code: string;            // 教研室代码
  duration_coefficient: {
    major_duration: number;        // 主修课时系数
    minor_duration: number;        // 副修课时系数
  };
  created_at: string;
  updated_at?: string;             // 更新时间
}

// 乐器配置数据
export const INSTRUMENT_CONFIGS: Record<string, InstrumentConfig> = {
  '钢琴': {
    id: 'piano',
    instrument_name: '钢琴',
    max_students_per_class: 5,
    faculty_code: 'PIANO',
    duration_coefficient: { major_duration: 0.5, minor_duration: 0.25 },
    created_at: new Date().toISOString(),
  },
  '声乐': {
    id: 'vocal',
    instrument_name: '声乐',
    max_students_per_class: 5,
    faculty_code: 'VOCAL',
    duration_coefficient: { major_duration: 0.5, minor_duration: 0.25 },
    created_at: new Date().toISOString(),
  },
  // 器乐专业 - 特殊乐器（最多8人）
  '古筝': {
    id: 'guzheng',
    instrument_name: '古筝',
    max_students_per_class: 8,
    faculty_code: 'INSTRUMENT',
    duration_coefficient: { major_duration: 0.5, minor_duration: 0.25 },
    created_at: new Date().toISOString(),
  },
  '笛子': {
    id: 'flute',
    instrument_name: '笛子',
    max_students_per_class: 8,
    faculty_code: 'INSTRUMENT',
    duration_coefficient: { major_duration: 0.5, minor_duration: 0.25 },
    created_at: new Date().toISOString(),
  },
  '竹笛': {
    id: 'bamboo_flute',
    instrument_name: '竹笛',
    max_students_per_class: 8,
    faculty_code: 'INSTRUMENT',
    duration_coefficient: { major_duration: 0.5, minor_duration: 0.25 },
    created_at: new Date().toISOString(),
  },
  '葫芦丝': {
    id: 'hulusi',
    instrument_name: '葫芦丝',
    max_students_per_class: 8,
    faculty_code: 'INSTRUMENT',
    duration_coefficient: { major_duration: 0.5, minor_duration: 0.25 },
    created_at: new Date().toISOString(),
  },
  // 器乐专业 - 普通乐器（最多5人）
  '古琴': {
    id: 'guqin',
    instrument_name: '古琴',
    max_students_per_class: 5,
    faculty_code: 'INSTRUMENT',
    duration_coefficient: { major_duration: 0.5, minor_duration: 0.25 },
    created_at: new Date().toISOString(),
  },
  '双排键': {
    id: 'double_keys',
    instrument_name: '双排键',
    max_students_per_class: 5,
    faculty_code: 'INSTRUMENT',
    duration_coefficient: { major_duration: 0.5, minor_duration: 0.25 },
    created_at: new Date().toISOString(),
  },
  '小提琴': {
    id: 'violin',
    instrument_name: '小提琴',
    max_students_per_class: 5,
    faculty_code: 'INSTRUMENT',
    duration_coefficient: { major_duration: 0.5, minor_duration: 0.25 },
    created_at: new Date().toISOString(),
  },
  '萨克斯': {
    id: 'saxophone',
    instrument_name: '萨克斯',
    max_students_per_class: 5,
    faculty_code: 'INSTRUMENT',
    duration_coefficient: { major_duration: 0.5, minor_duration: 0.25 },
    created_at: new Date().toISOString(),
  },
  '大提琴': {
    id: 'cello',
    instrument_name: '大提琴',
    max_students_per_class: 5,
    faculty_code: 'INSTRUMENT',
    duration_coefficient: { major_duration: 0.5, minor_duration: 0.25 },
    created_at: new Date().toISOString(),
  },
  // 通用类别
  '器乐': {
    id: 'general_instrument',
    instrument_name: '器乐',
    max_students_per_class: 5,
    faculty_code: 'INSTRUMENT',
    duration_coefficient: { major_duration: 0.5, minor_duration: 0.25 },
    created_at: new Date().toISOString(),
  },
  // 理论课程
  '音乐理论': {
    id: 'music_theory',
    instrument_name: '音乐理论',
    max_students_per_class: 30,
    faculty_code: 'THEORY', // 理论课程归属理论教研室
    duration_coefficient: { major_duration: 1.0, minor_duration: 0.5 },
    created_at: new Date().toISOString(),
  },
};

// 获取乐器的最大学生数
export function getMaxStudentsForInstrument(instrument: string): number {
  const config = INSTRUMENT_CONFIGS[instrument];
  return config?.max_students_per_class || 5;
}

// 获取乐器的教研室代码
export function getFacultyCodeForInstrument(instrument: string): string {
  const config = INSTRUMENT_CONFIGS[instrument];
  return config?.faculty_code || 'INSTRUMENT';
}

// 获取教研室代码对应的显示名称（琴房）
export function getFacultyDisplayName(facultyCode: string): string {
  const facultyNames: Record<string, string> = {
    'PIANO': '钢琴琴房',
    'VOCAL': '声乐琴房',
    'INSTRUMENT': '器乐琴房',
    'THEORY': '理论教室',
  };
  return facultyNames[facultyCode] || '通用琴房';
}

// 获取教研室代码对应的教研室名称（用于显示教研室）
export function getFacultyName(facultyCode: string): string {
  const facultyNames: Record<string, string> = {
    'PIANO': '钢琴教研室',
    'VOCAL': '声乐教研室',
    'INSTRUMENT': '器乐教研室',
    'THEORY': '理论教研室',
  };
  return facultyNames[facultyCode] || facultyCode;
}

// 获取教研室代码对应的教研室代码（列名）
export function getFacultyColumnName(facultyCode: string): string {
  const columnNames: Record<string, string> = {
    'PIANO': '钢琴琴房',
    'VOCAL': '声乐琴房',
    'INSTRUMENT': '器乐琴房',
    'THEORY': '理论教室',
  };
  return columnNames[facultyCode] || '教室';
}

// 根据专业代码获取教师对应的琴房
export function getTeacherRoomByFaculty(teacher: Teacher, facultyCode: string): string | undefined {
  // 先检查 fixed_rooms（新格式）
  if (teacher.fixed_rooms) {
    const room = teacher.fixed_rooms.find(r => r.faculty_code === facultyCode);
    if (room) return room.room_id;
  }
  // 兼容旧版本：检查 fixed_room_id
  if (teacher.fixed_room_id) {
    return teacher.fixed_room_id;
  }
  return undefined;
}

// 根据专业代码设置教师对应的琴房
export function setTeacherRoomByFaculty(
  teacher: Teacher,
  facultyCode: string,
  roomId: string
): Teacher {
  const updatedTeacher = { ...teacher };

  // 初始化 fixed_rooms 数组
  if (!updatedTeacher.fixed_rooms) {
    // 如果有旧的 fixed_room_id，先迁移到新格式
    if (updatedTeacher.fixed_room_id) {
      // 尝试根据 room_id 推断 faculty_code
      updatedTeacher.fixed_rooms = [{
        room_id: updatedTeacher.fixed_room_id,
        faculty_code: 'PIANO' as string, // 默认钢琴
      }];
      updatedTeacher.fixed_room_id = undefined; // 清空旧字段
    } else {
      updatedTeacher.fixed_rooms = [];
    }
  }

  // 更新或添加对应教研室的琴房
  const existingIndex = updatedTeacher.fixed_rooms.findIndex(
    r => r.faculty_code === facultyCode
  );

  if (existingIndex >= 0) {
    updatedTeacher.fixed_rooms[existingIndex].room_id = roomId;
  } else {
    updatedTeacher.fixed_rooms.push({ room_id: roomId, faculty_code: facultyCode });
  }

  return updatedTeacher;
}

// 教师类型
export interface Teacher {
  id: string;
  teacher_id?: string;              // 工号，如 120150375
  name?: string;                    // 教师姓名
  email?: string;                   // 邮箱
  phone?: string;                   // 电话
  full_name?: string;               // 姓名（兼容旧版本）
  department?: string;              // 兼容旧版本：教研室名称
  faculty_id: string;               // 教研室ID（PIANO, VOCAL, INSTRUMENT）
  faculty_code?: string;            // 教研室代码（PIANO, VOCAL, INSTRUMENT）
  faculty_name?: string;            // 教研室名称
  position?: string;                // 职称（教授、副教授、讲师、助教）
  hire_date?: string;               // 入职日期
  status?: 'active' | 'inactive' | 'on_leave';  // 状态
  primary_instrument?: string;      // 主要教学乐器
  qualifications?: TeacherQualificationData[];  // 教学资质
  can_teach_instruments: string[];  // 可教授的乐器列表
  max_students_per_class?: number;  // 每班最大学生数
  fixed_room_id?: string;           // 固定琴房ID（兼容旧版本，单一琴房）
  fixed_rooms?: {                   // 多琴房配置（一位教师多个琴房）
    room_id: string;
    faculty_code: string;           // PIANO/VOCAL/INSTRUMENT
  }[];
  created_at: string;
  updated_at?: string;              // 更新时间
  remarks?: string;                 // 备注信息
}

// 教师资质数据类型
export interface TeacherQualificationData {
  course_name: string;
  proficiency_level: 'primary' | 'secondary' | 'assistant';
  granted_at?: string;
}

// 课程/专业类型（基于真实教师数据）
export const INSTRUMENTS = [
  '钢琴', '声乐', '古筝', '竹笛', '葫芦丝', '古琴', '小提琴', '萨克斯', '双排键', '音乐理论'
] as const;

export type Instrument = typeof INSTRUMENTS[number];

// 教研室类型（兼容旧版本）
export const DEPARTMENTS = [
  '钢琴教研室',
  '声乐教研室',
  '器乐教研室',
] as const;

export type Department = typeof DEPARTMENTS[number];

// 乐器与教研室映射（基于真实教师数据）
export const INSTRUMENT_TO_FACULTY: Record<string, string> = {
  '钢琴': 'PIANO',
  '声乐': 'VOCAL',
  '古筝': 'INSTRUMENT',
  '小提琴': 'INSTRUMENT',
  '竹笛': 'INSTRUMENT',
  '葫芦丝': 'INSTRUMENT',
  '古琴': 'INSTRUMENT',
  '萨克斯': 'INSTRUMENT',
  '双排键': 'INSTRUMENT',
  '器乐': 'INSTRUMENT',
  '音乐理论': 'THEORY',
};

// 课程类型（简化分类）
export const COURSE_TYPES = ['钢琴', '声乐', '器乐'] as const;

// 学生类型
export interface Student {
  id: string;
  teacher_id?: string;
  student_id: string;
  name: string;
  major_class: string;
  grade: number;
  student_type: 'general' | 'upgrade';
  primary_instrument?: string;
  secondary_instruments: string[];
  remarks?: string;
  faculty_code: string;
  status: 'active' | 'inactive';
  enrollment_year?: number;
  current_grade?: number;
  student_status?: 'active' | 'inactive' | 'suspended' | 'graduated';
  created_at: string;
  updated_at?: string;
  assigned_teachers?: {
    primary_teacher_id?: string;
    primary_teacher_name?: string;
  };
  secondary1_teacher_id?: string;
  secondary1_teacher_name?: string;
  secondary2_teacher_id?: string;
  secondary2_teacher_name?: string;
  secondary3_teacher_id?: string;
  secondary3_teacher_name?: string;
  secondary_instrument1?: string;
  secondary_instrument2?: string;
  secondary_instrument3?: string;
  notes?: string;
  instrument?: string;
  grade_text?: string;
}

// 新增：学生-教师分配关联表接口
export interface StudentTeacherAssignment {
  id: string;
  student_id: string;
  teacher_id: string;
  faculty_code: 'PIANO' | 'VOCAL' | 'INSTRUMENT'; // 教研室代码
  instrument_name: string;        // 具体乐器名称
  assignment_type: 'primary' | 'secondary' | 'substitute'; // 分配类型
  is_active: boolean;            // 是否活跃
  assignment_status: 'active' | 'inactive' | 'suspended'; // 分配状态
  assigned_at: string;           // 分配时间
  effective_date: string;        // 生效日期
  ended_at?: string;             // 结束日期
  created_at: string;
  updated_at?: string;
  assigned_by?: string;          // 分配操作者
  // 关联数据（用于查询时显示）
  teacher_name?: string;         // 教师姓名
  faculty_name?: string;         // 教研室名称
  student_name?: string;         // 学生姓名
}

// 新增：学生专业分配总表接口
export interface StudentMajorAssignment {
  id: string;
  student_id: string;
  primary_faculty: 'PIANO' | 'VOCAL' | 'INSTRUMENT'; // 主修教研室
  secondary_faculties: Array<'PIANO' | 'VOCAL' | 'INSTRUMENT'>; // 副修教研室数组
  enrollment_year: number;       // 入学年份
  expected_graduation_year?: number; // 预期毕业年份
  current_grade?: number;        // 当前年级
  is_active: boolean;            // 是否活跃
  assignment_status: 'active' | 'inactive' | 'suspended'; // 分配状态
  created_at: string;
  updated_at?: string;
  // 关联数据（用于查询时显示）
  student_name?: string;         // 学生姓名
  primary_faculty_name?: string; // 主修教研室名称
}

// 新增：学生分配概览视图接口
export interface StudentAssignmentOverview {
  student_id: string;
  student_name: string;
  student_number: string;
  major_class: string;
  grade: number;
  enrollment_year: number;
  student_status: string;
  // 各专业教师数量
  piano_teachers: number;
  vocal_teachers: number;
  instrument_teachers: number;
  active_assignments: number; // 当前活跃分配数
  // 教师姓名
  piano_teacher_names?: string;
  vocal_teacher_names?: string;
  instrument_teacher_names?: string;
}

// 新增：教师工作量统计接口
export interface TeacherWorkloadStats {
  teacher_id: string;
  teacher_name: string;
  primary_instrument?: string;
  faculty_id?: string;
  faculty_name?: string;
  faculty_code: string;
  // 学生数量统计
  total_students: number;
  piano_students: number;
  vocal_students: number;
  instrument_students: number;
  active_assignments: number; // 活跃分配数
  avg_assignments_per_faculty: number; // 平均每个专业的分配数
}

// 新增：分配历史记录接口
export interface AssignmentHistory {
  assignment_id: string;
  teacher_name: string;
  faculty_name: string;
  instrument_name: string;
  assignment_type: 'primary' | 'secondary' | 'substitute';
  assignment_status: 'active' | 'inactive' | 'suspended';
  assigned_at: string;
  effective_date: string;
  ended_at?: string;
}

// 新增：器乐专业配置
export const INSTRUMENT_SPECIALTIES = {
  PIANO: {
    code: 'PIANO',
    name: '钢琴专业',
    instruments: ['钢琴']
  },
  VOCAL: {
    code: 'VOCAL', 
    name: '声乐专业',
    instruments: ['声乐']
  },
  INSTRUMENT: {
    code: 'INSTRUMENT',
    name: '器乐专业', 
    instruments: [
      '古筝',
      '竹笛', 
      '古琴',
      '葫芦丝',
      '双排键',
      '小提琴',
      '萨克斯'
    ]
  }
} as const;

export type FacultyCode = typeof INSTRUMENT_SPECIALTIES[keyof typeof INSTRUMENT_SPECIALTIES]['code'];
export type InstrumentName = typeof INSTRUMENT_SPECIALTIES[keyof typeof INSTRUMENT_SPECIALTIES]['instruments'][number];

// 新增：分配类型枚举
export const ASSIGNMENT_TYPES = {
  PRIMARY: 'primary',      // 主修
  SECONDARY: 'secondary',  // 辅修  
  SUBSTITUTE: 'substitute' // 代课
} as const;

export type AssignmentType = typeof ASSIGNMENT_TYPES[keyof typeof ASSIGNMENT_TYPES];

// 新增：分配状态枚举
export const ASSIGNMENT_STATUS = {
  ACTIVE: 'active',        // 活跃
  INACTIVE: 'inactive',    // 非活跃
  SUSPENDED: 'suspended'    // 暂停
} as const;

export type AssignmentStatus = typeof ASSIGNMENT_STATUS[keyof typeof ASSIGNMENT_STATUS];

// 兼容旧版本的简化Student接口
export interface StudentSimple {
  id: string;
  teacher_id: string;
  student_id: string;
  name: string;
  instrument: string;
  grade: string;
  created_at: string;
}

// 获取学生的乐器（兼容旧版本）
export function getStudentInstrument(student: Student): string {
  if (student.primary_instrument) {
    return student.primary_instrument;
  }
  if (student.secondary_instruments && student.secondary_instruments.length > 0) {
    return student.secondary_instruments[0];
  }
  return '钢琴'; // 默认
}

// 课程类型
export interface Course {
  id: string;
  course_id?: string;
  teacher_id: string;
  teacher_name?: string;
  course_name: string;
  course_type: '钢琴' | '声乐' | '器乐';
  faculty_id?: string;
  student_id?: string;
  student_name?: string;
  major_class?: string;
  academic_year?: string;
  semester?: number;
  semester_label?: string;
  course_category: 'primary' | 'secondary' | 'general';
  primary_instrument?: string;
  secondary_instrument?: string;
  duration: number;
  week_frequency: number;
  credit?: number;
  credit_hours?: number;
  required_hours?: number;
  total_hours?: number;
  weeks?: number;
  group_size?: number;
  student_count?: number;
  teaching_type?: '专业大课' | '小组课' ;
  created_at: string;
  updated_at?: string;
}

// 小组类型
export type GroupType = 'primary' | 'secondary' | 'mixed'; // 主项/副项/混合（1主1副）

// 学生类型
export type StudentType = 'general' | 'upgrade' | 'six_semester';

// 课时系数配置
export interface HourCoefficient {
  group_type: GroupType;
  min_persons: number;
  max_persons: number;
  coefficient: number;
  total_weeks?: number;  // 需排课时总数（可选）
}

// 课时系数规则（根据Excel规则）- 普通班
export const GENERAL_HOUR_COEFFICIENTS: HourCoefficient[] = [
  { group_type: 'primary', min_persons: 1, max_persons: 1, coefficient: 0.35, total_weeks: 16 },
  { group_type: 'secondary', min_persons: 1, max_persons: 1, coefficient: 0.175, total_weeks: 16 },
  { group_type: 'primary', min_persons: 2, max_persons: 2, coefficient: 0.8, total_weeks: 16 },
  { group_type: 'secondary', min_persons: 2, max_persons: 2, coefficient: 0.4, total_weeks: 16 },
  { group_type: 'secondary', min_persons: 2, max_persons: 2, coefficient: 0.8, total_weeks: 8 },
  { group_type: 'secondary', min_persons: 1, max_persons: 1, coefficient: 0.35, total_weeks: 8 },
  { group_type: 'mixed', min_persons: 2, max_persons: 2, coefficient: 0.6, total_weeks: 16 },
  { group_type: 'secondary', min_persons: 3, max_persons: 3, coefficient: 0.9, total_weeks: 16 },
  { group_type: 'mixed', min_persons: 3, max_persons: 3, coefficient: 0.9, total_weeks: 16 },
  { group_type: 'secondary', min_persons: 4, max_persons: 4, coefficient: 0.9, total_weeks: 16 },
  { group_type: 'secondary', min_persons: 5, max_persons: 8, coefficient: 1.0, total_weeks: 16 },
];

// 专升本课时系数
export const UPGRADE_HOUR_COEFFICIENTS: HourCoefficient[] = [
  { group_type: 'secondary', min_persons: 1, max_persons: 1, coefficient: 0.35, total_weeks: 16 },
  { group_type: 'secondary', min_persons: 2, max_persons: 2, coefficient: 0.8, total_weeks: 16 },
];


// 第6学期特殊课时系数（钢琴/器乐/声乐）
export const SIX_SEMESTER_HOUR_COEFFICIENTS: HourCoefficient[] = [
  { group_type: 'primary', min_persons: 1, max_persons: 1, coefficient: 0.7, total_weeks: 16 },
  { group_type: 'secondary', min_persons: 1, max_persons: 1, coefficient: 0.35, total_weeks: 16 },
  { group_type: 'secondary', min_persons: 1, max_persons: 1, coefficient: 0.7, total_weeks: 8 },
  { group_type: 'secondary', min_persons: 2, max_persons: 2, coefficient: 0.8, total_weeks: 16 },
];

// 根据学生类型获取对应的课时系数规则
export function getHourCoefficientsByStudentType(studentType: StudentType): HourCoefficient[] {
  switch (studentType) {
    case 'upgrade':
      return UPGRADE_HOUR_COEFFICIENTS;
    case 'six_semester':
      return SIX_SEMESTER_HOUR_COEFFICIENTS;
    default:
      return GENERAL_HOUR_COEFFICIENTS;
  }
}

// 根据小组类型、人数和总周数获取课时系数
export function getHourCoefficient(
  groupType: GroupType,
  persons: number,
  totalWeeks: number,
  studentType: StudentType = 'general'
): number {
  const rules = getHourCoefficientsByStudentType(studentType);
  const rule = rules.find(
    r => r.group_type === groupType &&
        persons >= r.min_persons &&
        persons <= r.max_persons &&
        r.total_weeks === totalWeeks
  );
  return rule?.coefficient || 0.35;
}

// 根据小组类型和人数确定混合组类型
function getMixedGroupType(persons: number, primaryCount: number): GroupType {
  const secondaryCount = persons - primaryCount;
  if (primaryCount === 1 && secondaryCount === 1) return 'mixed';
  if (primaryCount === 1 && secondaryCount === 2) return 'mixed';
  return 'secondary';
}

// 计算课时工作量（单节课时量 = 课时系数 × 实际排课周数）
export function calculateWorkload(
  groupType: GroupType,
  persons: number,
  scheduledWeeks: number,
  totalWeeks: number,
  studentType: StudentType = 'general'
): number {
  const coefficient = getHourCoefficient(groupType, persons, totalWeeks, studentType);
  return coefficient * scheduledWeeks;
}

// 学分规则
export const CREDIT_RULES = {
  six_semester_credit: 2,      // 第6学期课程为2学分
  upgrade_credit: 2,           // 专升本所有课程为2学分
  default_credit: 1,           // 默认1学分
  hours_per_credit: 16,        // 1学分=16课时
};

// 根据课程名称和学期序号获取学分
export function getCourseCredit(courseName: string, semester: number, studentType: 'general' | 'upgrade' = 'general'): number {
  // 专升本所有课程为2学分
  if (studentType === 'upgrade') return CREDIT_RULES.upgrade_credit;

  // 第6学期课程为2学分
  if (semester === 6) return CREDIT_RULES.six_semester_credit;

  // 第8学期不排专业课
  if (semester === 8) return 0;

  // 其它为1学分
  return CREDIT_RULES.default_credit;
}

// 根据课程名称和学期序号获取所需课时
export function getRequiredHours(courseName: string, semester: number, studentType: 'general' | 'upgrade' = 'general'): number {
  // 专业小课所有班级都是16节，无论学分是多少
  return 16;
}

// 根据课程类别和人数确定小组类型
export function getGroupType(courseCategory: 'primary' | 'secondary' | 'general', persons: number): GroupType {
  if (courseCategory === 'primary') return 'primary';
  if (courseCategory === 'secondary') return 'secondary';
  // general 课程按副项处理
  return 'secondary';
}

// 计算单节课时数（兼容旧版本，仍使用系数，不乘以周数）
export function calculateClassHours(
  courseCategory: 'primary' | 'secondary' | 'general',
  persons: number,
  totalWeeks: number = 16,
  studentType: StudentType = 'general'
): number {
  const groupType = getGroupType(courseCategory, persons);
  return getHourCoefficient(groupType, persons, totalWeeks, studentType);
}

// 课程类型配置
export const COURSE_CONFIG = {
  durationOptions: [15, 30, 45, 60, 90, 120] as const,
  weekFrequencyOptions: [1, 2, 3, 4, 5] as const,
};

// 学年配置
export const ACADEMIC_YEARS = [
  '2024-2025',
  '2025-2026',
  '2026-2027',
  '2027-2028',
  '2028-2029',
];

// 学期配置（用于显示）
export const SEMESTERS = [
  { value: 1, label: '第1学期' },
  { value: 2, label: '第2学期' },
  { value: 3, label: '第3学期' },
  { value: 4, label: '第4学期' },
  { value: 5, label: '第5学期' },
  { value: 6, label: '第6学期' },
  { value: 7, label: '第7学期' },
  { value: 8, label: '第8学期' },
];

// 根据班级编号和学期计算学期序号
export function calculateSemesterNumber(classId: string, academicYear: string, semester: string): number {
  // 提取入学年份
  const enrollmentYear = 2000 + parseInt(classId.slice(0, 2)); // 2301 -> 2023

  // 提取当前学年
  const currentYear = parseInt(academicYear.split('-')[0]); // 2025-2026 -> 2025

  // 计算学年差（当前学年 - 入学学年）
  const yearDiff = currentYear - enrollmentYear;

  // 计算学期序号
  // 例如：26xx班在2026-2027-1学期
  // 2026 - 2026 = 0, 0 * 2 + 1 = 1（第一学期）
  return yearDiff * 2 + parseInt(semester);
}

// 根据学期序号生成学期标签
export function getSemesterLabel(academicYear: string, semesterNumber: number): string {
  const semesterPart = semesterNumber % 2 === 1 ? '1' : '2';
  return `${academicYear}-${semesterPart}`;
}

// 生成完整的学期选择列表（学年+学期）
export function generateSemesterOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];

  for (const year of ACADEMIC_YEARS) {
    options.push({ value: `${year}-1`, label: `${year}-1 学期` });
    options.push({ value: `${year}-2`, label: `${year}-2 学期` });
  }

  return options;
}

// 教室类型
export interface Room {
  id: string;
  teacher_id: string;
  room_name: string;
  room_type: '琴房' | '教室' | '大教室' | '排练厅';
  faculty_code?: string;         // 琴房对应的专业代码（PIANO/VOCAL/INSTRUMENT），用于多琴房场景
  capacity: number;
  location?: string;             // 位置
  equipment?: string[];           // 设备配置
  status?: '空闲' | '占用';       // 状态
  last_maintenance?: string;      // 最后维护时间
  created_at: string;
  updated_at?: string;           // 更新时间戳
}

// 教师-琴房关联类型（支持一位教师多个琴房）
export interface TeacherRoom {
  id: string;
  teacher_id: string;
  room_id: string;
  faculty_code: string;          // 专业代码（PIANO/VOCAL/INSTRUMENT）
  created_at: string;
}



// 节次配置（两节课之间休息10分钟）
export const PERIOD_CONFIG = [
  { period: 1, label: '第1节', startTime: '08:10', endTime: '08:55' },
  { period: 2, label: '第2节', startTime: '09:05', endTime: '09:50' },
  { period: 3, label: '第3节', startTime: '10:05', endTime: '10:50' },
  { period: 4, label: '第4节', startTime: '10:55', endTime: '11:40' },
  { period: 5, label: '第5节', startTime: '13:45', endTime: '14:30' },
  { period: 6, label: '第6节', startTime: '14:40', endTime: '15:25' },
  { period: 7, label: '第7节', startTime: '15:40', endTime: '16:25' },
  { period: 8, label: '第8节', startTime: '16:35', endTime: '17:20' },
  { period: 9, label: '第9节', startTime: '18:30', endTime: '19:15' },
  { period: 10, label: '第10节', startTime: '19:25', endTime: '20:10' },
];

// 冲突类型
export interface Conflict {
  id: string;
  teacher_id: string;
  type: 'room_conflict' | 'teacher_conflict' | 'student_conflict';
  scheduled_class_id: string;
  conflicting_class_id?: string;
  description: string;
  resolved: boolean;
  created_at: string;
}

// 教研室与乐器对应关系
export const FACULTY_INSTRUMENTS: Record<string, string[]> = {
  'PIANO': ['钢琴'],
  'VOCAL': ['声乐'],
  'INSTRUMENT': ['双排键', '小提琴', '古筝', '笛子', '古琴', '葫芦丝', '萨克斯'],
  'THEORY': ['音乐理论'],
};

// 获取乐器对应的课程类型
export function getCourseTypeByInstrument(instrument: string): '钢琴' | '声乐' | '器乐' {
  if (instrument === '钢琴') return '钢琴';
  if (instrument === '声乐') return '声乐';
  return '器乐';
}

// 获取教师可教授的课程类型列表
export function getCourseTypesByInstruments(instruments: string[]): ('钢琴' | '声乐' | '器乐')[] {
  const courseTypes = new Set<('钢琴' | '声乐' | '器乐')>();
  instruments.forEach(instrument => {
    courseTypes.add(getCourseTypeByInstrument(instrument));
  });
  return Array.from(courseTypes);
}

// ==================== 周次排课相关类型 ====================

// 学期周次配置
export interface SemesterWeekConfig {
  id: string;
  academic_year: string;
  semester_label: string;
  start_date: string;
  total_weeks: number;
  created_at: string;
  updated_at?: string;
}

export interface Class {
  id: string;
  class_id?: string;
  class_name: string;
  enrollment_year?: number;
  class_number?: number;
  student_count?: number;
  student_type?: 'general' | 'upgrade';
  status?: 'active' | 'inactive';
  created_at?: string;
  updated_at?: string;
}

export interface User {
  id: string;
  teacher_id?: string;
  email?: string;
  full_name?: string;
  department?: string;
  faculty_id?: string;
  faculty_code?: string;
  specialty?: string[];
  is_admin?: boolean;
  created_at?: string;
  updated_at?: string;
}

export type BlockedSlotType = 'specific' | 'recurring';

// 禁排时段
export interface BlockedSlot {
  id: string;
  academic_year: string;
  semester_label: string;
  type: BlockedSlotType;
  class_associations?: { id: string; name: string }[];
  week_number?: number;
  specific_week_days?: { week: number; day: number }[];
  day_of_week?: number;
  start_period?: number;
  end_period?: number;
  start_date?: string;
  end_date?: string;
  reason?: string;
  weeks?: string;
  created_at: string;
  updated_at?: string;
}

export interface TimeSlot {
  id: string;
  day_of_week: number;
  period: number;
  duration: number;
}

export interface ScheduledClass {
  id: string;
  teacher_id: string;
  teacher_name?: string;
  course_id: string;
  course_code?: string;
  class_id?: string;
  room_id: string;
  student_id: string;
  day_of_week: number;
  date?: string;
  period: number;
  duration?: number;
  start_week: number;
  end_week: number;
  specific_dates?: string[];
  week_number?: number;
  faculty_id?: string;
  semester_label?: string;
  academic_year?: string;
  semester?: number;
  status: 'scheduled' | 'completed' | 'cancelled';
  group_id?: string;
  created_at: string;
  updated_at?: string;
}

// 获取周次列表（1-N周）
export function generateWeekNumbers(totalWeeks: number): number[] {
  return Array.from({ length: totalWeeks }, (_, i) => i + 1);
}

// 根据学期开始日期和周次计算某周的开始日期
export function getWeekStartDate(semesterStartDate: string, weekNumber: number): string {
  const startDate = new Date(semesterStartDate);
  const weekStartDate = new Date(startDate);
  weekStartDate.setDate(startDate.getDate() + (weekNumber - 1) * 7);
  return weekStartDate.toISOString().split('T')[0];
}

// 检查某个日期是否在周次范围内
export function isDateInWeekRange(
  date: string,
  weekNumber: number,
  semesterStartDate: string,
  totalWeeks: number
): boolean {
  const targetDate = new Date(date);
  const startDate = new Date(semesterStartDate);

  if (targetDate < startDate) return false;

  const daysDiff = Math.floor((targetDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const targetWeek = Math.floor(daysDiff / 7) + 1;

  return targetWeek >= 1 && targetWeek <= totalWeeks && targetWeek === weekNumber;
}

// 获取日期对应的周次
export function getWeekNumber(date: string, semesterStartDate: string): number {
  const targetDate = new Date(date);
  const startDate = new Date(semesterStartDate);

  if (targetDate < startDate) return 0;

  const daysDiff = Math.floor((targetDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  return Math.floor(daysDiff / 7) + 1;
}

// ==================== 大课表相关类型 ====================

// 单个大课表课程条目
export interface LargeClassEntry {
  id: string;
  class_name: string;           // 班级名称，如 "23级音乐（1）班"
  course_name: string;          // 课程名称
  teacher_name: string;         // 任课教师
  location: string;             // 上课地点
  day_of_week: number;          // 星期几 (1-7)
  period_start: number;         // 开始节次 (1-10)
  period_end: number;           // 结束节次 (1-10)
  week_range?: string;          // 周次范围，如 "1-16周"
  academic_year: string;        // 学年
  semester_label: string;       // 学期标签
  created_at: string;
}

// 大课表导入记录
export interface LargeClassSchedule {
  id: string;
  file_name: string;            // 原始文件名
  academic_year: string;        // 学年
  semester_label: string;       // 学期标签
  entries: LargeClassEntry[];   // 所有课程条目
  imported_at: string;          // 导入时间
}

// 星期几映射
export const DAY_OF_WEEK_MAP: Record<string, number> = {
  '周一': 1,
  '星期一': 1,
  '一': 1,        // 简写形式
  '周二': 2,
  '星期二': 2,
  '二': 2,        // 简写形式
  '周三': 3,
  '星期三': 3,
  '三': 3,        // 简写形式
  '周四': 4,
  '星期四': 4,
  '四': 4,        // 简写形式
  '周五': 5,
  '星期五': 5,
  '五': 5,        // 简写形式
  '周六': 6,
  '星期六': 6,
  '六': 6,        // 简写形式
  '周日': 7,
  '星期日': 7,
  '日': 7,        // 简写形式
};

// 根据数字获取星期几文字
export function getDayOfWeekText(day: number): string {
  const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return days[day] || '';
}

// 根据数字获取星期几文字（周一作为第一天）
export function getDayOfWeekTextMondayFirst(day: number): string {
  const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  return days[day - 1] || '';
}

// 将JavaScript getDay()返回值（0-6，周日为0）转换为周一作为第一天的格式（1-7，周一为1）
export function convertToMondayFirst(day: number): number {
  return day === 0 ? 7 : day;
}

// 解析周次范围字符串，返回开始和结束周次
export function parseWeekRange(weekRangeStr: string): { startWeek: number; endWeek: number } | null {
  if (!weekRangeStr) return null;

  // 匹配 "1-16周" 或 "1-16" 格式
  const match = weekRangeStr.match(/(\d+)[-–](\d+)/);
  if (match) {
    const startWeek = parseInt(match[1]);
    const endWeek = parseInt(match[2]);
    return { startWeek, endWeek };
  }

  // 匹配单个周次 "第1周" 或 "1周"
  const singleMatch = weekRangeStr.match(/第?(\d+)周?/);
  if (singleMatch) {
    const week = parseInt(singleMatch[1]);
    return { startWeek: week, endWeek: week };
  }

  return null;
}
