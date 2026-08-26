/**
 * 排课视图服务 - 统一数据获取和转换
 * 为 FacultyScheduleView 和 ArrangeClass 提供统一的数据源
 */

import { supabase } from './supabase';
import { scheduleService, studentService, courseService, teacherService, roomService, weekConfigService } from './index';

const USE_DATABASE = import.meta.env.VITE_USE_DATABASE === 'true';
const USE_SUPABASE = false;

// 排课结果数据类型（来自 ArrangeClass）
export interface ScheduleResult {
  id: string;
  courseId: string;
  courseName: string;
  courseType: '钢琴' | '声乐' | '器乐';
  credits: number;
  teacherName: string;
  studentName: string;
  studentIds: string;
  studentClasses: string;
  studentClass: string;
  groupSize: number;
  scheduleTime: string;
  scheduledHours: number;
  room_id?: string;
  room_name?: string;
  originalSchedules: OriginalSchedule[];
  students: StudentInfo[];
  isLargeClass: boolean;
  // 由课程名和学生专业综合推断出的具体乐器（器乐教研室使用）
  specificInstrument?: string;
}

// 原始排课记录
export interface OriginalSchedule {
  id: string;
  day_of_week: number;
  period: number;
  week_number?: number;
  week?: number;
  start_week?: number;
  end_week?: number;
  room_id?: string;
  room_name?: string;
  course_name?: string;
  course_type?: string;
  teacher_id?: string;
  teacher_name?: string;
  student_id?: string;
  student_name?: string;
  class_name?: string;
  teaching_type?: string;
}

// 学生信息
export interface StudentInfo {
  id?: string;
  name: string;
  student_id?: string;
  className?: string;
  // 用于根据学生专业推断小组具体乐器
  primary_instrument?: string;
  instrument?: string;
  secondary_instruments?: string[];
}

// 视图层数据类型（用于 FacultyScheduleView）
export interface ScheduleClassView {
  id: string;
  courseName: string;
  studentName: string;
  instrument: string; // 课程类型：钢琴/声乐/器乐
  specificInstrument?: string; // 具体乐器：如古筝、竹笛等
  teachingType?: string; // 授课类型：专业大课/小组课
  roomName: string;
  room_id?: string;
  dayOfWeek: number;
  period: number;
  teacherName: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  // 扩展字段
  weekRange: string; // 周次范围，如 "1-5、7-13"
  studentClass: string;
  groupSize: number;
  courseId: string;
  credits: number;
  studentIds: string[];
  schedules: TimeSlot[]; // 所有时间段
  /** 小组唯一标识，用于视图中按小组分开展示、不合并 */
  groupId?: string;
}

// 时间段
export interface TimeSlot {
  week: number;
  day: number;
  period: number;
}

// 筛选条件
export interface ViewFilters {
  facultyCode?: string; // PIANO/VOCAL/INSTRUMENT
  instrument?: string; // 具体乐器
  teacherId?: string;   // 教师 id 或工号，匹配 scheduled_classes.teacher_id
  teacherWorkId?: string; // 教师工号，与 teacherId 二选一或同时用于匹配
  teacherName?: string; // 教师姓名（兜底匹配，兼容历史 teacher_id 不一致）
  weekRange?: {
    startWeek: number;
    endWeek: number;
  };
  academicYear?: string;
  semester?: string;
  totalWeeks?: number; // 学期总周数
}

// 解析后的时间信息
interface ParsedTimeInfo {
  weekRange: string;
  weeks: number[];
  day: number;
  dayName: string;
  period: number;
  periodText: string;
}

/**
 * 解析排课时间字符串
 * 格式示例："第1-5、7-13周 周一 第2节" 或 "第1周 周一 第2节"
 */
function parseScheduleTime(scheduleTime: string): ParsedTimeInfo[] {
  const results: ParsedTimeInfo[] = [];
  
  if (!scheduleTime) return results;
  
  // 分割多个时间段（用；或分号分隔）
  const timeSegments = scheduleTime.split(/[；;]/);
  
  for (const segment of timeSegments) {
    if (!segment.trim()) continue;
    
    // 匹配周次、星期、节次
    // 支持格式：
    // "第1-5、7-13周 周一 第2节"
    // "第1周 周一 第2节"
    // "第6-7、15周 周二 第1-2节"
    const match = segment.match(/第(.+?)周\s+(.+?)\s+第(.+?)节/);
    if (!match) {
      // 尝试另一种匹配方式
      const altMatch = segment.match(/第(.+?)周(.+?)第(.+?)节/);
      if (!altMatch) continue;
      
      const weekPart = altMatch[1].trim();
      const dayName = altMatch[2].trim();
      const periodPart = altMatch[3].trim();
      
      // 解析周次
      const weeks: number[] = [];
      const weekRanges = weekPart.split(/[、,]/);
      for (const range of weekRanges) {
        const trimmedRange = range.trim();
        if (trimmedRange.includes('-')) {
          const [start, end] = trimmedRange.split('-').map(Number);
          if (!isNaN(start) && !isNaN(end)) {
            for (let w = start; w <= end; w++) {
              weeks.push(w);
            }
          }
        } else {
          const weekNum = Number(trimmedRange);
          if (!isNaN(weekNum)) {
            weeks.push(weekNum);
          }
        }
      }
      
      // 星期映射
      const dayMap: Record<string, number> = {
        '周一': 1, '周二': 2, '周三': 3, '周四': 4,
        '周五': 5, '周六': 6, '周日': 7, '周天': 7
      };
      const day = dayMap[dayName] || 1;
      
      // 解析节次
      let period = 1;
      if (periodPart.includes('-')) {
        period = Number(periodPart.split('-')[0]);
      } else {
        period = Number(periodPart);
      }
      
      if (weeks.length > 0) {
        results.push({
          weekRange: weekPart,
          weeks,
          day,
          dayName,
          period,
          periodText: `第${periodPart}节`
        });
      }
      continue;
    }
    
    const weekPart = match[1].trim();
    const dayName = match[2].trim();
    const periodPart = match[3].trim();
    
    // 解析周次
    const weeks: number[] = [];
    const weekRanges = weekPart.split(/[、,]/);
    for (const range of weekRanges) {
      const trimmedRange = range.trim();
      if (trimmedRange.includes('-')) {
        const [start, end] = trimmedRange.split('-').map(Number);
        if (!isNaN(start) && !isNaN(end)) {
          for (let w = start; w <= end; w++) {
            weeks.push(w);
          }
        }
      } else {
        const weekNum = Number(trimmedRange);
        if (!isNaN(weekNum)) {
          weeks.push(weekNum);
        }
      }
    }
    
    // 星期映射
    const dayMap: Record<string, number> = {
      '周一': 1, '周二': 2, '周三': 3, '周四': 4,
      '周五': 5, '周六': 6, '周日': 7, '周天': 7
    };
    const day = dayMap[dayName] || 1;
    
    // 解析节次（可能为范围如 "1-2"）
    let period = 1;
    if (periodPart.includes('-')) {
      period = Number(periodPart.split('-')[0]);
    } else {
      period = Number(periodPart);
    }
    
    if (weeks.length > 0) {
      results.push({
        weekRange: weekPart,
        weeks,
        day,
        dayName,
        period,
        periodText: `第${periodPart}节`
      });
    }
  }
  
  return results;
}

/**
 * 从课程名称中提取具体乐器
 */
function extractSpecificInstrument(courseName: string): string | undefined {
  // 器乐教研室的乐器列表
  const instruments = ['古筝', '竹笛', '古琴', '葫芦丝', '双排键', '小提琴', '萨克斯', '二胡', '琵琶', '扬琴', '中阮', '大提琴'];
  
  for (const instrument of instruments) {
    if (courseName.includes(instrument)) {
      return instrument;
    }
  }
  
  // 如果课程名称包含"器乐"但没有具体乐器，返回"器乐"
  if (courseName.includes('器乐')) {
    return '器乐';
  }
  
  return undefined;
}

/**
 * 将 ScheduleResult 转换为 ScheduleClassView
 */
function convertToViewFormat(result: ScheduleResult): ScheduleClassView[] {
  const views: ScheduleClassView[] = [];
  const parsedTimes = parseScheduleTime(result.scheduleTime);
  
  // 解析学生信息
  const studentNames = result.studentName.split('<br>').filter(Boolean);
  const studentIds = result.studentIds.split('<br>').filter(Boolean);
  const studentClasses = result.studentClasses.split('<br>').filter(Boolean);
  
  const students: StudentInfo[] = studentNames.map((name, index) => ({
    name,
    student_id: studentIds[index] || '',
    className: studentClasses[index] || result.studentClass
  }));
  
  // 为每个时间段创建视图记录
  for (const timeInfo of parsedTimes) {
    // 为每个学生创建一条记录（保持与现有视图兼容）
    for (const student of students) {
      const view: ScheduleClassView = {
        id: `${result.id}_${timeInfo.day}_${timeInfo.period}_${student.student_id || student.name}`,
        groupId: result.id,
        courseName: result.courseName,
        studentName: student.name,
        instrument: result.courseType,
        specificInstrument: result.specificInstrument || extractSpecificInstrument(result.courseName),
        roomName: result.room_name || '',
        room_id: result.room_id,
        dayOfWeek: timeInfo.day,
        period: timeInfo.period,
        teacherName: result.teacherName,
        status: 'scheduled',
        weekRange: timeInfo.weekRange,
        studentClass: student.className || '',
        groupSize: result.groupSize,
        courseId: result.courseId,
        credits: result.credits,
        studentIds: students.map(s => s.student_id || ''),
        schedules: timeInfo.weeks.map(w => ({
          week: w,
          day: timeInfo.day,
          period: timeInfo.period
        }))
      };
      views.push(view);
    }
  }
  
  return views;
}

/**
 * 从原始排课数据构建 ScheduleResult
 * @param includeMajorClass 是否包含专业大课（理论教研室需要）
 */
function buildScheduleResults(
  scheduledClasses: any[],
  students: any[],
  courses: any[],
  teachers: any[],
  totalWeeks: number = 17,
  includeMajorClass: boolean = false
): ScheduleResult[] {
  // 构建查找映射（同时支持内部ID和课程编号）
  const coursesMap = new Map();
  courses.forEach(c => {
    coursesMap.set(c.id, c);
    if ((c as any).course_id) {
      coursesMap.set((c as any).course_id, c);
    }
  });
  const studentsMap = new Map();
  students.forEach(s => {
    studentsMap.set(s.id, s);
    if ((s as any).student_id) {
      studentsMap.set((s as any).student_id, s);
    }
  });
  const teachersMap = new Map();
  teachers.forEach(t => {
    teachersMap.set(t.id, t);
    if ((t as any).teacher_id) {
      teachersMap.set((t as any).teacher_id, t);
    }
  });
  
  // 按课程+教师+时间分组
  const groups: Record<string, any> = {};
  
  for (const schedule of scheduledClasses) {
    // 先获取课程信息（用于判断 teaching_type）
    const course = coursesMap.get(schedule.course_id);
    
    // 获取授课类型和课程类型（优先从课程数据获取，其次从排课数据获取）
    const teachingType = (course as any)?.teaching_type || schedule.teaching_type;
    const courseType = course?.course_type || schedule.course_type;
    const courseName = schedule.course_name || course?.course_name || '';
    
    // 判断是否为专业大课（多种方式）
    const isMajorClass = teachingType === '专业大课' || 
                         courseType === '专业大课' ||
                         courseName.includes('专业大课');
    
    // 判断是否为理论课
    const isTheoryClass = courseType === '理论课' || courseName.includes('理论');
    
    // 根据参数决定是否过滤专业大课
    if (!includeMajorClass) {
      // 钢琴、声乐、器乐教研室：只显示小组课，过滤掉专业大课和理论课
      if (isMajorClass || isTheoryClass) continue;
    } else {
      // 理论教研室：只显示专业大课，过滤掉小组课
      if (!isMajorClass) continue;
    }
    
    // 获取学生和教师信息
    const student = studentsMap.get(schedule.student_id);
    const teacher = teachersMap.get(schedule.teacher_id);
    
    // 确定课程类型
    let courseTypeName: '钢琴' | '声乐' | '器乐' = '器乐';
    const fullCourseName = courseName || course?.course_name || '课程';
    if (fullCourseName.includes('钢琴')) courseTypeName = '钢琴';
    else if (fullCourseName.includes('声乐')) courseTypeName = '声乐';
    else if (fullCourseName.includes('器乐')) courseTypeName = '器乐';
    
    // 获取教师名称（优先从课程数据获取，专业大课的教师信息在课程中）
    const teacherName = schedule.teacher_name || course?.teacher_name || teacher?.name || '未知教师';
    
    // 分组键：有 group_id 时按小组拆分（同一教师、同一课程、同一节次下的不同小组分开展示）；无则沿用原逻辑
    const timeKey = `${schedule.day_of_week}_${schedule.period}`;
    const teacherKey = schedule.teacher_id || teacherName;
    const groupKey = (schedule as any).group_id
      ? `${(schedule as any).group_id}`
      : `${fullCourseName}_${courseTypeName}_${teacherKey}_${timeKey}`;
    
    // 获取班级信息（专业大课的班级信息可能在课程或排课记录中）
    const classInfo = schedule.class_name || course?.major_class || '';
    
    if (!groups[groupKey]) {
      groups[groupKey] = {
        courseId: schedule.course_id,
        courseName: fullCourseName,
        courseType: courseTypeName,
        teacherId: schedule.teacher_id,
        teacherName: teacherName,
        className: classInfo,
        students: [],
        schedules: []
      };
    }
    
    // 添加学生（附带专业信息，便于后续推断具体乐器）
    const studentObj: StudentInfo = {
      id: schedule.student_id,
      name: schedule.student_name || student?.name || '未知学生',
      student_id: student?.student_id || schedule.student_id,
      className: student?.major_class || (student as any)?.class_name || schedule.class_name || '',
      primary_instrument: (student as any)?.primary_instrument || (student as any)?.instrument,
      instrument: (student as any)?.instrument,
      secondary_instruments: (student as any)?.secondary_instruments,
    };
    
    if (!groups[groupKey].students.some((s: any) => s.id === studentObj.id)) {
      groups[groupKey].students.push(studentObj);
    }
    
    groups[groupKey].schedules.push(schedule);
  }
  
  // 转换为 ScheduleResult 数组
  const results: ScheduleResult[] = [];
  
  for (const group of Object.values(groups)) {
    // 判断是否为专业大课
    const firstSchedule = group.schedules[0];
    const course = coursesMap.get(group.courseId);
    const teachingType = firstSchedule?.teaching_type || course?.teaching_type;
    const courseType = firstSchedule?.course_type || course?.course_type;
    const courseName = group.courseName || '';
    const isMajorClassResult = teachingType === '专业大课' || 
                               courseType === '专业大课' ||
                               courseName.includes('专业大课');
    
    // 格式化时间
    const timeGroups = new Map<string, { day: number; period: number; weeks: number[] }>();
    for (const schedule of group.schedules) {
      const key = `${schedule.day_of_week}_${schedule.period}`;
      if (!timeGroups.has(key)) {
        timeGroups.set(key, {
          day: schedule.day_of_week,
          period: schedule.period,
          weeks: []
        });
      }
      // 获取周次：优先使用 week_number，其次 week，再次 start_week
      // 如果有 start_week 和 end_week，添加范围内所有周次
      if (schedule.week_number) {
        timeGroups.get(key)!.weeks.push(schedule.week_number);
      } else if (schedule.week) {
        timeGroups.get(key)!.weeks.push(schedule.week);
      } else if (schedule.start_week && schedule.end_week) {
        for (let w = schedule.start_week; w <= schedule.end_week; w++) {
          timeGroups.get(key)!.weeks.push(w);
        }
      } else if (schedule.start_week) {
        timeGroups.get(key)!.weeks.push(schedule.start_week);
      } else {
        // 默认添加所有周次（根据学期总周数）
        for (let w = 1; w <= totalWeeks; w++) {
          timeGroups.get(key)!.weeks.push(w);
        }
      }
    }
    
    // 格式化时间段
    const dayMap = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const timeStrings: string[] = [];
    
    for (const [key, timeGroup] of timeGroups) {
      const sortedWeeks = [...new Set(timeGroup.weeks)].sort((a: number, b: number) => a - b);
      
      // 合并连续周次
      const weekRanges: string[] = [];
      let start = sortedWeeks[0];
      let end = start;
      
      for (let i = 1; i < sortedWeeks.length; i++) {
        if (sortedWeeks[i] === end + 1) {
          end = sortedWeeks[i];
        } else {
          weekRanges.push(start === end ? `${start}` : `${start}-${end}`);
          start = sortedWeeks[i];
          end = start;
        }
      }
      weekRanges.push(start === end ? `${start}` : `${start}-${end}`);
      
      const dayName = dayMap[timeGroup.day];
      const periodText = timeGroup.period % 2 === 1 
        ? `${timeGroup.period}-${timeGroup.period + 1}` 
        : `${timeGroup.period}`;
      
      timeStrings.push(`第${weekRanges.join('、')}周 ${dayName} 第${periodText}节`);
    }
    
    // 根据学生专业推断器乐类课程的具体乐器（如：古筝、竹笛、葫芦丝）
    let specificInstrument: string | undefined = undefined;
    if (group.courseType === '器乐') {
      const instrumentCount: Record<string, number> = {};
      for (const s of group.students as StudentInfo[]) {
        const candidates: string[] = [];
        if (s.primary_instrument) candidates.push(s.primary_instrument);
        if (Array.isArray(s.secondary_instruments)) {
          candidates.push(...s.secondary_instruments);
        }
        if (s.instrument) candidates.push(s.instrument);

        for (const inst of candidates) {
          if (!inst) continue;
          // 过滤掉大类名称，只统计具体乐器
          if (inst === '钢琴' || inst === '声乐' || inst === '器乐') continue;
          instrumentCount[inst] = (instrumentCount[inst] || 0) + 1;
        }
      }

      const sorted = Object.entries(instrumentCount).sort((a, b) => b[1] - a[1]);
      if (sorted.length > 0) {
        specificInstrument = sorted[0][0];
      }
    }

    // 获取课程编号和学分
    const credits = course?.credit || course?.credits || 1;
    
    // 获取琴房信息（尝试多种可能的字段路径）
    const roomName = firstSchedule?.room_name 
      || firstSchedule?.rooms?.room_name 
      || (firstSchedule as any)?.room?.room_name
      || (firstSchedule as any)?.room_name
      || '';
    
    // 如果还是没有琴房名称，尝试从 room_id 查找
    let finalRoomName = roomName;
    if (!finalRoomName && firstSchedule?.room_id) {
      try {
        const rooms = JSON.parse(localStorage.getItem('music_scheduler_rooms') || '[]');
        const room = rooms.find((r: any) => r.id === firstSchedule.room_id);
        if (room) {
          finalRoomName = room.room_name;
        }
      } catch (e) {
        // 忽略错误
      }
    }
    
    results.push({
      id: `${group.courseId}_${group.teacherId}_${Date.now()}`,
      courseId: course?.course_id || group.courseId,
      courseName: group.courseName,
      courseType: group.courseType,
      credits,
      teacherName: group.teacherName,
      studentName: group.students.map((s: any) => s.name).join('<br>'),
      studentIds: group.students.map((s: any) => s.student_id || '').join('<br>'),
      studentClasses: group.students.map((s: any) => s.className || '').join('<br>'),
      studentClass: group.students[0]?.className || group.className || '',
      groupSize: group.students.length || 1,
      scheduleTime: timeStrings.join('；'),
      scheduledHours: group.schedules.length,
      room_id: firstSchedule?.room_id,
      room_name: finalRoomName,
      originalSchedules: group.schedules,
      students: group.students,
      isLargeClass: isMajorClassResult,
      specificInstrument,
    });
  }
  
  return results;
}

/**
 * 排课视图服务
 */
export const scheduleViewService = {
  /**
   * 获取排课结果数据（原始格式）
   */
  async getScheduleResults(filters?: ViewFilters): Promise<ScheduleResult[]> {
    try {
      const normalizeName = (name?: string) =>
        (name || '')
          .trim()
          .replace(/\s+/g, '')
          .replace(/老师$/, '');

      let scheduledClasses: any[] = [];
      let students: any[] = [];
      let courses: any[] = [];
      let teachers: any[] = [];
      
      if (USE_DATABASE) {
        // 从 API 获取数据
        scheduledClasses = await scheduleService.getAll();
        students = await studentService.getAll();
        courses = await courseService.getAll();
        teachers = await teacherService.getAll();
      } else if (USE_SUPABASE) {
        // 从 Supabase 获取数据
        const { data: classesData } = await supabase
          .from('scheduled_classes')
          .select('*, courses(*), rooms(*)');
        scheduledClasses = classesData || [];
        
        const { data: studentsData } = await supabase.from('students').select('*');
        students = studentsData || [];
        
        const { data: coursesData } = await supabase.from('courses').select('*');
        courses = coursesData || [];
        
        const { data: teachersData } = await supabase.from('teachers').select('*');
        teachers = teachersData || [];
      } else {
        // 从 LocalStorage 获取数据
        scheduledClasses = JSON.parse(localStorage.getItem('music_scheduler_scheduled_classes') || '[]');
        students = JSON.parse(localStorage.getItem('music_scheduler_students') || '[]');
        courses = JSON.parse(localStorage.getItem('music_scheduler_courses') || '[]');
        teachers = JSON.parse(localStorage.getItem('music_scheduler_teachers') || '[]');
      }
      
      // 构建 ScheduleResult
      const totalWeeks = filters?.totalWeeks || 17;
      // 理论教研室需要包含专业大课
      const includeMajorClass = filters?.facultyCode === 'THEORY';
      let results = buildScheduleResults(scheduledClasses, students, courses, teachers, totalWeeks, includeMajorClass);
      
      // 应用筛选
      if (filters) {
        if (filters.facultyCode) {
          // 理论教研室显示所有专业大课（不按课程类型筛选）
          if (filters.facultyCode !== 'THEORY') {
            const facultyMap: Record<string, string[]> = {
              'PIANO': ['钢琴'],
              'VOCAL': ['声乐'],
              'INSTRUMENT': ['器乐']
            };
            const allowedTypes = facultyMap[filters.facultyCode] || [];
            results = results.filter(r => allowedTypes.includes(r.courseType));
          }
        }
        
        if (filters.teacherId || filters.teacherWorkId || filters.teacherName) {
          const ids = [filters.teacherId, filters.teacherWorkId].filter(Boolean);
          const teacherName = normalizeName(filters.teacherName);
          results = results.filter(r =>
            // 1) 先看原始排课中的 teacher_id / teacher_name（最准确）
            r.originalSchedules.some((s: any) => {
              const scheduleTeacherName = normalizeName(s.teacher_name);
              return ids.includes(s.teacher_id) ||
                (teacherName !== '' && scheduleTeacherName === teacherName);
            }) ||
            // 2) 兜底看聚合结果里的 teacherName（兼容历史 teacher_name 丢失/不一致）
            (teacherName !== '' && normalizeName(r.teacherName) === teacherName)
          );
        }
      }
      
      return results;
    } catch (error) {
      console.error('获取排课结果失败:', error);
      return [];
    }
  },

  /**
   * 获取视图格式的排课数据
   */
  async getViewSchedules(filters?: ViewFilters): Promise<ScheduleClassView[]> {
    const results = await this.getScheduleResults(filters);
    
    // 转换为视图格式
    let views: ScheduleClassView[] = [];
    for (const result of results) {
      const viewItems = convertToViewFormat(result);
      views.push(...viewItems);
    }
    
    // 应用周次筛选
    if (filters?.weekRange) {
      const { startWeek, endWeek } = filters.weekRange;
      views = views.filter(view => {
        // 检查是否有任何时间段在筛选范围内
        return view.schedules.some(slot => 
          slot.week >= startWeek && slot.week <= endWeek
        );
      });
    }
    
    return views;
  },

  /**
   * 获取指定时间段的排课
   */
  async getSchedulesByTimeSlot(
    dayOfWeek: number,
    period: number,
    week?: number,
    filters?: ViewFilters
  ): Promise<ScheduleClassView[]> {
    const views = await this.getViewSchedules(filters);
    
    return views.filter(view => {
      const timeMatch = view.dayOfWeek === dayOfWeek && view.period === period;
      if (week !== undefined) {
        return timeMatch && view.schedules.some(s => s.week === week);
      }
      return timeMatch;
    });
  },

  /**
   * 获取教师课表
   */
  async getTeacherSchedule(teacherId: string): Promise<ScheduleClassView[]> {
    return this.getViewSchedules({ teacherId });
  },

  /**
   * 获取教研室统计
   */
  async getFacultyStats(facultyCode: string): Promise<{
    classCount: number;
    teacherCount: number;
    studentCount: number;
    courseCount: number;
  }> {
    const results = await this.getScheduleResults({ facultyCode });
    
    const uniqueTeachers = new Set(results.map(r => r.teacherName));
    const uniqueStudents = new Set(results.flatMap(r => r.students.map(s => s.student_id || s.name)));
    const uniqueCourses = new Set(results.map(r => r.courseName));
    
    return {
      classCount: results.length,
      teacherCount: uniqueTeachers.size,
      studentCount: uniqueStudents.size,
      courseCount: uniqueCourses.size
    };
  },

  /**
   * 订阅排课数据变化（Realtime）
   */
  subscribeToChanges(callback: (payload: any) => void): () => void {
    if (USE_DATABASE) {
      // 数据库模式：定时轮询检查变化
      let lastCount = 0;
      const checkChanges = async () => {
        try {
          const schedules = await scheduleService.getAll();
          if (schedules.length !== lastCount) {
            lastCount = schedules.length;
            callback({ event: 'change', table: 'scheduled_classes' });
          }
        } catch (e) {
          // 忽略错误
        }
      };
      const interval = setInterval(checkChanges, 5000);
      return () => clearInterval(interval);
    }
    
    if (!USE_SUPABASE) {
      // LocalStorage 模式：使用 storage 事件
      const handleStorage = (e: StorageEvent) => {
        if (e.key === 'music_scheduler_scheduled_classes') {
          callback({ event: 'change', table: 'scheduled_classes' });
        }
      };
      window.addEventListener('storage', handleStorage);
      return () => window.removeEventListener('storage', handleStorage);
    }
    
    // Supabase Realtime
    const subscription = supabase
      .channel('scheduled_classes_changes')
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'scheduled_classes' },
        callback
      )
      .subscribe();
    
    return () => {
      subscription.unsubscribe();
    };
  }
};

export default scheduleViewService;
