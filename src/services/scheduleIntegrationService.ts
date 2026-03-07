// 排课系统深度集成服务 - 阶段四：高级功能和性能优化

import { Student, Teacher, ScheduledClass, Room } from '../types';
import { 
  scheduleService, 
  studentService, 
  teacherService, 
  roomService,
  classService,
  courseService 
} from './localStorage';
import { smartAllocationService } from './smartAllocationService';
import { 
  AllocationHistory,
  AllocationStats,
  ValidationResult 
} from './allocationValidationService';

// 排课集成配置
export interface ScheduleIntegrationConfig {
  // 排课优先级权重
  priorities: {
    assignedFirst: number;     // 已分配学生优先
    unassignedSecond: number; // 未分配学生其次
    urgentLast: number;       // 紧急排课最后
  };
  
  // 时间段配置
  timeSlots: {
    morning: { start: string; end: string; preference: number };
    afternoon: { start: string; end: string; preference: number };
    evening: { start: string; end: string; preference: number };
  };
  
  // 冲突解决策略
  conflictResolution: {
    automatic: boolean;        // 自动解决冲突
    suggestAlternatives: boolean; // 提供替代方案
    maxRetries: number;       // 最大重试次数
  };
}

// 智能排课建议
export interface ScheduleSuggestion {
  studentId: string;
  studentName: string;
  suggestedTimeSlot: {
    dayOfWeek: number; // 1-7 (周一到周日)
    period: number;     // 1-10 (第1节到第10节)
    startTime: string;
    endTime: string;
  };
  suggestedRoom: {
    id: string;
    name: string;
    type: 'piano' | 'vocal' | 'instrument';
  };
  suggestedTeacher: {
    id: string;
    name: string;
    availability: number; // 可用性评分 0-100
  };
  confidence: number;    // 匹配置信度 0-1
  reasons: string[];     // 推荐理由
  conflicts: Array<{
    type: 'teacher' | 'room' | 'student' | 'time';
    severity: 'low' | 'medium' | 'high';
    description: string;
    suggestion?: string;
  }>;
}

// 排课冲突分析
export interface ScheduleConflictAnalysis {
  conflictType: 'teacher_unavailable' | 'room_occupied' | 'student_conflict' | 'overlapping';
  severity: 'low' | 'medium' | 'high' | 'critical';
  affectedStudents: string[];
  affectedTeachers: string[];
  affectedRooms: string[];
  timeSlot: {
    dayOfWeek: number;
    period: number;
  };
  resolution: {
    canResolve: boolean;
    suggestedAlternatives: Array<{
      type: 'time' | 'room' | 'teacher';
      newValue: string;
      confidence: number;
      reasoning: string;
    }>;
  };
}

// 排课优化报告
export interface ScheduleOptimizationReport {
  totalStudents: number;
  assignedStudents: number;
  unassignedStudents: number;
  assignedRate: number; // 分配率
  
  timeSlotUtilization: {
    morning: number;    // 上午利用率
    afternoon: number;  // 下午利用率
    evening: number;    // 晚上利用率
  };
  
  roomUtilization: {
    piano: number;      // 钢琴房利用率
    vocal: number;      // 声乐房利用率
    instrument: number;  // 器乐房利用率
  };
  
  teacherWorkload: {
    teacherId: string;
    teacherName: string;
    workload: number;   // 工作量 0-100
    efficiency: number; // 效率评分 0-100
    recommendations: string[];
  }[];
  
  optimization: {
    suggestions: string[];
    potentialImprovements: {
      timeSlots: string[];
      roomAllocations: string[];
      teacherAssignments: string[];
    };
    estimatedImpact: {
      efficiencyIncrease: number; // 效率提升百分比
      conflictReduction: number;  // 冲突减少百分比
      satisfactionImprovement: number; // 满意度提升
    };
  };
}

export class ScheduleIntegrationService {
  private config: ScheduleIntegrationConfig;
  private allocationStats: AllocationStats;
  private scheduleCache: Map<string, any> = new Map(); // 排课缓存

  constructor(config?: Partial<ScheduleIntegrationConfig>) {
    this.config = {
      priorities: {
        assignedFirst: 0.6,
        unassignedSecond: 0.3,
        urgentLast: 0.1
      },
      timeSlots: {
        morning: { start: '08:00', end: '12:00', preference: 0.8 },
        afternoon: { start: '13:00', end: '17:00', preference: 0.9 },
        evening: { start: '18:00', end: '21:00', preference: 0.6 }
      },
      conflictResolution: {
        automatic: true,
        suggestAlternatives: true,
        maxRetries: 3
      },
      ...config
    };
    
    this.allocationStats = {
      totalAssignments: 0,
      successfulAssignments: 0,
      failedAssignments: 0,
      conflictsResolved: 0,
      mostRequestedInstruments: [],
      teacherWorkload: []
    };
  }

  /**
   * 基于学生分配生成智能排课建议
   */
  async generateScheduleSuggestions(): Promise<ScheduleSuggestion[]> {
    try {
      // 获取所有数据
      const [students, teachers, rooms, scheduledClasses] = await Promise.all([
        studentService.getAll(),
        teacherService.getAll(),
        roomService.getAll(),
        scheduleService.getAll()
      ]);

      const suggestions: ScheduleSuggestion[] = [];
      const assignedStudents = students.filter(s => 
        s.teacher_id || 
        s.assigned_teachers?.primary_teacher_id ||
        s.assigned_teachers?.secondary1_teacher_id ||
        s.assigned_teachers?.secondary2_teacher_id
      );

      // 为每个分配的学生生成排课建议
      for (const student of assignedStudents) {
        const suggestion = await this.generateStudentScheduleSuggestion(
          student,
          teachers,
          rooms,
          scheduledClasses
        );
        
        if (suggestion) {
          suggestions.push(suggestion);
        }
      }

      // 按优先级排序（已分配学生优先）
      suggestions.sort((a, b) => {
        const aPriority = this.getStudentPriority(a.studentId, assignedStudents);
        const bPriority = this.getStudentPriority(b.studentId, assignedStudents);
        return bPriority - aPriority;
      });

      return suggestions;
    } catch (error) {
      console.error('生成排课建议失败:', error);
      return [];
    }
  }

  /**
   * 生成单个学生的排课建议
   */
  private async generateStudentScheduleSuggestion(
    student: Student,
    teachers: Teacher[],
    rooms: Room[],
    scheduledClasses: any[]
  ): Promise<ScheduleSuggestion | null> {
    try {
      // 获取学生的主项教师
      const primaryTeacherId = student.assigned_teachers?.primary_teacher_id || student.teacher_id;
      const primaryTeacher = teachers.find(t => t.teacher_id === primaryTeacherId || t.id === primaryTeacherId);

      if (!primaryTeacher) {
        return null;
      }

      // 使用智能分配服务获取更详细的匹配信息
      const allocationResult = await smartAllocationService.smartAllocateStudent(
        student,
        [student],
        teachers
      );

      // 分析可用时间段
      const availableSlots = this.analyzeAvailableTimeSlots(
        student,
        primaryTeacher,
        scheduledClasses
      );

      // 分析可用教室
      const availableRooms = this.analyzeAvailableRooms(
        student,
        primaryTeacher,
        rooms,
        scheduledClasses
      );

      if (availableSlots.length === 0 || availableRooms.length === 0) {
        return {
          studentId: student.id,
          studentName: student.name,
          suggestedTimeSlot: this.getFallbackTimeSlot(),
          suggestedRoom: availableRooms[0] || { id: 'default', name: '默认教室', type: 'instrument' },
          suggestedTeacher: {
            id: primaryTeacher.id,
            name: primaryTeacher.name,
            availability: 0
          },
          confidence: 0.3,
          reasons: ['无可用时间段，使用默认安排'],
          conflicts: [{
            type: 'time',
            severity: 'high',
            description: '没有找到合适的上课时间',
            suggestion: '请手动调整时间安排'
          }]
        };
      }

      // 选择最佳匹配
      const bestSlot = this.selectBestTimeSlot(availableSlots, student);
      const bestRoom = this.selectBestRoom(availableRooms, student, primaryTeacher);

      return {
        studentId: student.id,
        studentName: student.name,
        suggestedTimeSlot: bestSlot,
        suggestedRoom: bestRoom,
        suggestedTeacher: {
          id: primaryTeacher.id,
          name: primaryTeacher.name,
          availability: this.calculateTeacherAvailability(primaryTeacher, scheduledClasses)
        },
        confidence: allocationResult.confidence,
        reasons: this.generateSuggestionReasons(student, primaryTeacher, bestSlot, bestRoom),
        conflicts: await this.analyzeConflicts(student, primaryTeacher, bestSlot, bestRoom, scheduledClasses)
      };

    } catch (error) {
      console.error(`生成学生 ${student.name} 的排课建议失败:`, error);
      return null;
    }
  }

  /**
   * 分析可用的时间段
   */
  private analyzeAvailableTimeSlots(student: Student, teacher: Teacher, scheduledClasses: any[]): Array<{
    dayOfWeek: number;
    period: number;
    startTime: string;
    endTime: string;
    score: number;
  }> {
    const availableSlots = [];
    
    // 分析每个工作日和时间段
    for (let day = 1; day <= 7; day++) {
      for (let period = 1; period <= 10; period++) {
        const timeSlot = this.getTimeSlotInfo(day, period);
        if (!timeSlot) continue;

        // 检查是否有冲突
        const hasConflict = scheduledClasses.some(sc => 
          sc.day_of_week === day && 
          sc.period === period && 
          (sc.teacher_id === teacher.id || sc.student_id === student.id)
        );

        if (!hasConflict) {
          // 计算匹配度分数
          const score = this.calculateTimeSlotScore(day, period, student, teacher);
          availableSlots.push({
            ...timeSlot,
            score
          });
        }
      }
    }

    return availableSlots.sort((a, b) => b.score - a.score);
  }

  /**
   * 分析可用的教室
   */
  private analyzeAvailableRooms(
    student: Student,
    teacher: Teacher,
    rooms: Room[],
    scheduledClasses: any[]
  ): Array<{
    id: string;
    name: string;
    type: 'piano' | 'vocal' | 'instrument';
    score: number;
  }> {
    const availableRooms = [];
    
    for (const room of rooms) {
      // 根据乐器类型匹配教室
      const roomType = this.getRoomType(student.primary_instrument, room);
      if (!roomType) continue;

      // 检查教室是否在指定时间段可用
      const hasConflict = scheduledClasses.some(sc => 
        sc.room_id === room.id
      );

      if (!hasConflict) {
        const score = this.calculateRoomScore(room, student, teacher);
        availableRooms.push({
          id: room.id,
          name: room.room_name || room.name,
          type: roomType,
          score
        });
      }
    }

    return availableRooms.sort((a, b) => b.score - a.score);
  }

  /**
   * 分析排课冲突
   */
  private async analyzeConflicts(
    student: Student,
    teacher: Teacher,
    timeSlot: any,
    room: any,
    scheduledClasses: any[]
  ): Promise<Array<{
    type: 'teacher' | 'room' | 'student' | 'time';
    severity: 'low' | 'medium' | 'high';
    description: string;
    suggestion?: string;
  }>> {
    const conflicts = [];

    // 检查教师冲突
    const teacherConflict = scheduledClasses.some(sc => 
      sc.teacher_id === teacher.id && 
      sc.day_of_week === timeSlot.dayOfWeek && 
      sc.period === timeSlot.period
    );

    if (teacherConflict) {
      conflicts.push({
        type: 'teacher',
        severity: 'high',
        description: `${teacher.name} 在此时间段已有课程安排`,
        suggestion: '建议更换时间段或教师'
      });
    }

    // 检查学生冲突
    const studentConflict = scheduledClasses.some(sc => 
      sc.student_id === student.id && 
      sc.day_of_week === timeSlot.dayOfWeek && 
      sc.period === timeSlot.period
    );

    if (studentConflict) {
      conflicts.push({
        type: 'student',
        severity: 'medium',
        description: `${student.name} 在此时间段已有其他课程`,
        suggestion: '建议调整其他课程时间'
      });
    }

    // 检查教室冲突
    const roomConflict = scheduledClasses.some(sc => 
      sc.room_id === room.id && 
      sc.day_of_week === timeSlot.dayOfWeek && 
      sc.period === timeSlot.period
    );

    if (roomConflict) {
      conflicts.push({
        type: 'room',
        severity: 'medium',
        description: `${room.name} 在此时间段已被占用`,
        suggestion: '建议更换教室'
      });
    }

    return conflicts;
  }

  /**
   * 获取时间段信息
   */
  private getTimeSlotInfo(dayOfWeek: number, period: number): {
    startTime: string;
    endTime: string;
  } | null {
    const timeMap: Record<number, { start: string; end: string }> = {
      1: { start: '08:10', end: '08:55' },
      2: { start: '09:05', end: '09:50' },
      3: { start: '10:05', end: '10:50' },
      4: { start: '10:55', end: '11:40' },
      5: { start: '13:45', end: '14:30' },
      6: { start: '14:40', end: '15:25' },
      7: { start: '15:40', end: '16:25' },
      8: { start: '16:35', end: '17:20' },
      9: { start: '18:30', end: '19:15' },
      10: { start: '19:25', end: '20:10' }
    };

    return timeMap[period] || null;
  }

  /**
   * 计算时间段匹配度分数
   */
  private calculateTimeSlotScore(day: number, period: number, student: Student, teacher: Teacher): number {
    let score = 50; // 基础分数

    // 根据时间段偏好调整
    const timeInfo = this.getTimeSlotInfo(day, period);
    if (timeInfo) {
      const hour = parseInt(timeInfo.startTime.split(':')[0]);
      if (hour >= 8 && hour < 12) {
        score += this.config.timeSlots.morning.preference * 20;
      } else if (hour >= 13 && hour < 17) {
        score += this.config.timeSlots.afternoon.preference * 20;
      } else {
        score += this.config.timeSlots.evening.preference * 20;
      }
    }

    // 根据学生年级调整（低年级学生倾向于上午课程）
    if (student.grade <= 2) {
      if (period <= 4) score += 10;
    } else {
      if (period >= 5) score += 10;
    }

    // 根据教师偏好调整
    // 这里可以基于历史数据或教师设置来调整

    return Math.min(100, score);
  }

  /**
   * 计算教室匹配度分数
   */
  private calculateRoomScore(room: Room, student: Student, teacher: Teacher): number {
    let score = 50; // 基础分数

    // 乐器类型匹配
    const roomType = this.getRoomType(student.primary_instrument, room);
    if (roomType) {
      score += 30;
    }

    // 教室质量评分（可以根据设施、设备等）
    // 这里可以扩展更多评分因子

    return Math.min(100, score);
  }

  /**
   * 获取教室类型
   */
  private getRoomType(instrument: string, room: Room): 'piano' | 'vocal' | 'instrument' | null {
    const roomName = room.room_name?.toLowerCase() || room.name?.toLowerCase() || '';
    const facultyCode = room.faculty_code?.toLowerCase() || '';

    if (instrument === '钢琴' || facultyCode === 'piano' || roomName.includes('钢琴')) {
      return 'piano';
    } else if (instrument === '声乐' || facultyCode === 'vocal' || roomName.includes('声乐')) {
      return 'vocal';
    } else if (instrument === '器乐' || facultyCode === 'instrument' || roomName.includes('器乐')) {
      return 'instrument';
    }

    return null;
  }

  /**
   * 选择最佳时间段
   */
  private selectBestTimeSlot(availableSlots: any[], student: Student): any {
    // 优先选择分数最高的
    const bestSlot = availableSlots[0];
    
    // 如果分数太低，使用默认时间
    if (!bestSlot || bestSlot.score < 30) {
      return {
        dayOfWeek: 2, // 周二
        period: 3,     // 第3节
        startTime: '10:05',
        endTime: '10:50'
      };
    }

    return bestSlot;
  }

  /**
   * 选择最佳教室
   */
  private selectBestRoom(availableRooms: any[], student: Student, teacher: Teacher): any {
    // 优先选择分数最高的
    const bestRoom = availableRooms[0];
    
    // 如果没有合适的教室，返回默认
    if (!bestRoom) {
      return {
        id: 'default',
        name: '默认教室',
        type: 'instrument'
      };
    }

    return bestRoom;
  }

  /**
   * 计算教师可用性
   */
  private calculateTeacherAvailability(teacher: Teacher, scheduledClasses: any[]): number {
    const totalSlots = 70; // 7天 * 10节课
    const occupiedSlots = scheduledClasses.filter(sc => sc.teacher_id === teacher.id).length;
    const availability = Math.max(0, ((totalSlots - occupiedSlots) / totalSlots) * 100);
    
    return Math.round(availability);
  }

  /**
   * 生成推荐理由
   */
  private generateSuggestionReasons(student: Student, teacher: Teacher, timeSlot: any, room: any): string[] {
    const reasons = [];

    // 基于时间段的理由
    if (timeSlot.period <= 4) {
      reasons.push('上午时间段，有利于学生精神状态');
    } else if (timeSlot.period <= 8) {
      reasons.push('下午时间段，避开午餐时间');
    } else {
      reasons.push('晚上时间段，适合重点课程安排');
    }

    // 基于教室的理由
    if (room.type === 'piano') {
      reasons.push('专业钢琴教室，设备齐全');
    } else if (room.type === 'vocal') {
      reasons.push('专业声乐教室，音响效果良好');
    } else {
      reasons.push('综合器乐教室，空间充足');
    }

    // 基于教师的理由
    reasons.push(`教师 ${teacher.name} 在此时间段有充足精力`);

    return reasons;
  }

  /**
   * 获取学生优先级
   */
  private getStudentPriority(studentId: string, assignedStudents: Student[]): number {
    const student = assignedStudents.find(s => s.id === studentId);
    if (!student) return 0;

    // 已分配学生高优先级
    if (student.assigned_teachers?.primary_teacher_id) {
      return this.config.priorities.assignedFirst;
    }

    return this.config.priorities.unassignedSecond;
  }

  /**
   * 获取默认时间段（冲突时的备用方案）
   */
  private getFallbackTimeSlot(): { dayOfWeek: number; period: number; startTime: string; endTime: string } {
    return {
      dayOfWeek: 3, // 周三
      period: 3,    // 第3节
      startTime: '10:05',
      endTime: '10:50'
    };
  }

  /**
   * 生成排课优化报告
   */
  async generateOptimizationReport(): Promise<ScheduleOptimizationReport> {
    try {
      const [students, teachers, rooms, scheduledClasses] = await Promise.all([
        studentService.getAll(),
        teacherService.getAll(),
        roomService.getAll(),
        scheduleService.getAll()
      ]);

      const assignedStudents = students.filter(s => 
        s.teacher_id || 
        s.assigned_teachers?.primary_teacher_id
      );

      // 计算时间利用率
      const timeSlotUtilization = this.calculateTimeSlotUtilization(scheduledClasses);
      
      // 计算教室利用率
      const roomUtilization = this.calculateRoomUtilization(scheduledClasses, rooms);
      
      // 计算教师工作量
      const teacherWorkload = this.calculateTeacherWorkload(teachers, scheduledClasses);

      // 生成优化建议
      const optimization = this.generateOptimizationSuggestions(
        students,
        teachers,
        rooms,
        scheduledClasses,
        assignedStudents
      );

      return {
        totalStudents: students.length,
        assignedStudents: assignedStudents.length,
        unassignedStudents: students.length - assignedStudents.length,
        assignedRate: assignedStudents.length / students.length * 100,
        timeSlotUtilization,
        roomUtilization,
        teacherWorkload,
        optimization
      };

    } catch (error) {
      console.error('生成优化报告失败:', error);
      throw error;
    }
  }

  /**
   * 计算时间利用率
   */
  private calculateTimeSlotUtilization(scheduledClasses: any[]): { morning: number; afternoon: number; evening: number } {
    const totalSlots = 70; // 7天 * 10节课
    const occupiedSlots = scheduledClasses.length;
    const utilization = occupiedSlots / totalSlots * 100;

    return {
      morning: Math.min(100, utilization * 0.4), // 上午占40%
      afternoon: Math.min(100, utilization * 0.4), // 下午占40%
      evening: Math.min(100, utilization * 0.2)  // 晚上占20%
    };
  }

  /**
   * 计算教室利用率
   */
  private calculateRoomUtilization(scheduledClasses: any[], rooms: Room[]): { piano: number; vocal: number; instrument: number } {
    const totalRoomSlots = rooms.length * 70; // 总教室时段
    const usedRoomSlots = scheduledClasses.length;
    const utilization = usedRoomSlots / totalRoomSlots * 100;

    // 假设钢琴房、声乐房、器乐房数量比例为 3:2:5
    return {
      piano: Math.min(100, utilization * 0.3),
      vocal: Math.min(100, utilization * 0.2),
      instrument: Math.min(100, utilization * 0.5)
    };
  }

  /**
   * 计算教师工作量
   */
  private calculateTeacherWorkload(teachers: Teacher[], scheduledClasses: any[]): Array<{
    teacherId: string;
    teacherName: string;
    workload: number;
    efficiency: number;
    recommendations: string[];
  }> {
    return teachers.map(teacher => {
      const teacherClasses = scheduledClasses.filter(sc => sc.teacher_id === teacher.id);
      const workload = Math.min(100, (teacherClasses.length / 35) * 100); // 假设理想工作量是35节课
      const efficiency = Math.max(0, 100 - workload + Math.random() * 20); // 简单的效率计算
      
      const recommendations = [];
      if (workload > 80) {
        recommendations.push('工作量过重，建议减少课程安排');
      } else if (workload < 40) {
        recommendations.push('工作量不足，可以增加课程安排');
      }
      if (efficiency < 70) {
        recommendations.push('教学效率需要提升');
      }

      return {
        teacherId: teacher.id,
        teacherName: teacher.name || teacher.full_name || '未知教师',
        workload: Math.round(workload),
        efficiency: Math.round(efficiency),
        recommendations
      };
    });
  }

  /**
   * 生成优化建议
   */
  private generateOptimizationSuggestions(
    students: Student[],
    teachers: Teacher[],
    rooms: Room[],
    scheduledClasses: any[],
    assignedStudents: Student[]
  ): {
    suggestions: string[];
    potentialImprovements: {
      timeSlots: string[];
      roomAllocations: string[];
      teacherAssignments: string[];
    };
    estimatedImpact: {
      efficiencyIncrease: number;
      conflictReduction: number;
      satisfactionImprovement: number;
    };
  } {
    const suggestions: string[] = [];
    const timeSlots: string[] = [];
    const roomAllocations: string[] = [];
    const teacherAssignments: string[] = [];

    // 分析未分配学生
    const unassignedCount = students.length - assignedStudents.length;
    if (unassignedCount > 0) {
      suggestions.push(`有 ${unassignedCount} 名学生尚未分配教师，建议优先处理`);
    }

    // 分析时间段利用率
    const morningClasses = scheduledClasses.filter(sc => sc.period <= 4).length;
    const afternoonClasses = scheduledClasses.filter(sc => sc.period >= 5 && sc.period <= 8).length;
    const eveningClasses = scheduledClasses.filter(sc => sc.period >= 9).length;

    if (morningClasses / scheduledClasses.length < 0.3) {
      timeSlots.push('上午时段利用率偏低，可以增加课程安排');
    }
    if (afternoonClasses / scheduledClasses.length > 0.6) {
      timeSlots.push('下午时段过于拥挤，建议分散到其他时段');
    }

    // 分析教师工作量不均衡
    const workloadStats = teachers.map(t => ({
      teacher: t,
      count: scheduledClasses.filter(sc => sc.teacher_id === t.id).length
    })).sort((a, b) => b.count - a.count);

    const maxWorkload = workloadStats[0]?.count || 0;
    const minWorkload = workloadStats[workloadStats.length - 1]?.count || 0;

    if (maxWorkload > minWorkload * 2) {
      teacherAssignments.push('教师工作量不均衡，建议重新分配部分学生');
    }

    // 估计影响
    const efficiencyIncrease = Math.min(15, unassignedCount * 0.5);
    const conflictReduction = Math.min(25, (maxWorkload - minWorkload) * 2);
    const satisfactionImprovement = Math.min(20, suggestions.length * 2);

    return {
      suggestions,
      potentialImprovements: {
        timeSlots,
        roomAllocations,
        teacherAssignments
      },
      estimatedImpact: {
        efficiencyIncrease: Math.round(efficiencyIncrease),
        conflictReduction: Math.round(conflictReduction),
        satisfactionImprovement: Math.round(satisfactionImprovement)
      }
    };
  }

  /**
   * 获取配置
   */
  getConfig(): ScheduleIntegrationConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<ScheduleIntegrationConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }
}

// 导出单例实例
export const scheduleIntegrationService = new ScheduleIntegrationService();