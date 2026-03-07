import { WEEKDAYS } from './types';

// 生成周次范围文本
export const getWeekRange = (weeks: number[]): string => {
  if (weeks.length === 0) return '';
  
  // 去重并排序周次
  const uniqueWeeks = [...new Set(weeks)];
  if (uniqueWeeks.length === 1) return `第${uniqueWeeks[0]}周`;
  
  // 排序周次
  const sortedWeeks = uniqueWeeks.sort((a, b) => a - b);
  
  // 检测连续范围
  const ranges = [];
  let start = sortedWeeks[0];
  let end = sortedWeeks[0];
  
  for (let i = 1; i < sortedWeeks.length; i++) {
    if (sortedWeeks[i] === end + 1) {
      end = sortedWeeks[i];
    } else {
      ranges.push(start === end ? `${start}` : `${start}-${end}`);
      start = sortedWeeks[i];
      end = sortedWeeks[i];
    }
  }
  ranges.push(start === end ? `${start}` : `${start}-${end}`);
  
  return `第${ranges.join('、')}周`;
};

// 检查周次是否为禁排周
export const isWeekBlocked = (
  week: number, 
  blockedSlots: any[], 
  currentClassId: string, 
  currentClassName: string
): boolean => {
  return blockedSlots.some(slot => {
    // 检查是否指定了班级，如果指定了，只有当班级匹配时才禁排
    if (slot.class_associations && slot.class_associations.length > 0) {
      const hasClassAssociation = slot.class_associations.some(assoc => 
        assoc.id === currentClassId || 
        assoc.name === currentClassName ||
        assoc.id === currentClassName ||
        assoc.name === currentClassId
      );
      if (!hasClassAssociation) {
        return false;
      }
    }
    
    if (slot.type === 'specific') {
      // 仅当“整周禁排”时才返回 true。specific_week_days 表示“特定周次的特定星期”禁排，属于部分禁排，不算全周禁排
      if (slot.specific_week_days && slot.specific_week_days.length > 0) {
        return false; // 有 specific_week_days 时只禁排部分天，不算全周禁排
      }
      // 无 specific_week_days 时，week_number 表示整周禁排
      if (slot.week_number === week) {
        return true;
      }
    }
    return false;
  });
};

// 检查时段是否可用
export const isSlotAvailable = (
  week: number, 
  day: number, 
  period: number, 
  blockedSlots: any[], 
  currentClassId: string, 
  currentClassName: string
): boolean => {
  // 检查该时段是否为禁排时段（考虑班级）
  const isBlocked = blockedSlots.some(slot => {
    // 检查是否指定了班级，如果指定了，只有当班级匹配时才禁排
    if (slot.class_associations && slot.class_associations.length > 0) {
      // 检查当前班级是否在禁排关联班级中
      const hasClassAssociation = slot.class_associations.some(assoc => 
        assoc.id === currentClassId || 
        assoc.name === currentClassName ||
        assoc.id === currentClassName ||
        assoc.name === currentClassId
      );
      if (!hasClassAssociation) {
        return false;
      }
    }
    
    if (slot.type === 'recurring' && slot.day_of_week === day) {
      if (slot.start_period && slot.end_period) {
        return period >= slot.start_period && period <= slot.end_period;
      }
    }
    if (slot.type === 'specific' && slot.specific_week_days) {
      const isSpecificWeekDay = slot.specific_week_days.some(wd => wd.week === week && wd.day === day);
      if (isSpecificWeekDay && slot.start_period && slot.end_period) {
        return period >= slot.start_period && period <= slot.end_period;
      }
    }
    if (slot.type === 'specific' && slot.week_number === week) {
      return true;
    }
    return false;
  });
  
  return !isBlocked;
};

// 计算实际序号（考虑分页）
export const getActualIndex = (startIndex: number, index: number): number => {
  return startIndex + index;
};

// 生成默认课程状态
export const generateDefaultCourseStatus = (
  course: any, 
  defaultClass: any, 
  defaultRoom: any
): any => {
  return {
    id: `${course.id}_${defaultClass?.class_id || 'default'}`,
    course_id: course.id,
    class_id: defaultClass?.class_id || '',
    course_name: course.course_name,
    class_name: defaultClass?.class_name || '未选择班级',
    room_id: defaultRoom?.id || '',
    room_name: defaultRoom?.room_name || '未选择教室',
    total_hours: course.credit_hours || 32,
    scheduled_hours: 0,
    status: 'pending',
    schedule_time: '未安排',
    week_number: 0,
    day_of_week: 0,
    period: 0,
    teaching_type: course.teaching_type
  };
};

// 生成排课记录
export const generateScheduleRecord = (
  id: string,
  courseId: string,
  classId: string,
  roomId: string,
  week: number,
  day: number,
  period: number
): any => {
  return {
    id,
    course_id: courseId,
    class_id: classId,
    room_id: roomId,
    week_number: week,
    day_of_week: day,
    period: period,
    start_week: week,
    end_week: week,
    created_at: new Date().toISOString(),
    status: 'draft' // 标记为草稿状态
  };
};

// 检测冲突
export const detectConflicts = (
  week: number, 
  day: number, 
  period: number, 
  courseId: string,
  scheduledClasses: any[],
  courses: any[]
): any[] => {
  const newConflicts = [];
  
  // 检查时间冲突
  const timeConflict = scheduledClasses.some(schedule => 
    schedule.week_number === week &&
    schedule.day_of_week === day &&
    schedule.period === period
  );
  
  if (timeConflict) {
    newConflicts.push({
      week,
      day,
      period,
      type: 'time' as const,
      message: `第${week}周${WEEKDAYS[day-1].label}第${period}节已被占用`,
      suggestion: '请选择其他时间'
    });
  }
  
  // 检查教师冲突
  const teacherConflict = scheduledClasses.some(schedule => {
    const scheduleCourse = courses.find(c => c.id === schedule.course_id);
    const currentCourse = courses.find(c => c.id === courseId);
    return scheduleCourse && currentCourse &&
      scheduleCourse.teacher_id === currentCourse.teacher_id &&
      schedule.week_number === week &&
      schedule.day_of_week === day &&
      schedule.period === period;
  });
  
  if (teacherConflict) {
    newConflicts.push({
      week,
      day,
      period,
      type: 'time' as const,
      message: `教师在第${week}周${WEEKDAYS[day-1].label}第${period}节有其他课程`,
      suggestion: '请选择其他时间'
    });
  }
  
  return newConflicts;
};

// 处理批量选择的时间槽
export const processBatchSelection = (
  selectedTimeSlots: any[],
  batchWeeks: number[],
  day: number,
  period: number,
  blockedSlots: any[],
  currentClassId: string,
  currentClassName: string
): any[] => {
  const newSlots = [];
  
  // 遍历所有批量周次
  for (const batchWeek of batchWeeks) {
    // 检查当前周次、当前课时是否为禁排时段
    const isBlocked = blockedSlots.some(slot => {
      if (slot.class_associations && slot.class_associations.length > 0) {
        const hasClassAssociation = slot.class_associations.some(assoc => 
          assoc.id === currentClassId || 
          assoc.name === currentClassName ||
          assoc.id === currentClassName ||
          assoc.name === currentClassId
        );
        if (!hasClassAssociation) {
          return false;
        }
      }
      
      if (slot.type === 'recurring' && slot.day_of_week === day) {
        if (slot.start_period && slot.end_period) {
          return period >= slot.start_period && period <= slot.end_period;
        }
      }
      if (slot.type === 'specific' && slot.specific_week_days) {
        const isSpecificWeekDay = slot.specific_week_days.some(wd => wd.week === batchWeek && wd.day === day);
        if (isSpecificWeekDay && slot.start_period && slot.end_period) {
          return period >= slot.start_period && period <= slot.end_period;
        }
      }
      if (slot.type === 'specific' && slot.week_number === batchWeek) {
        return true;
      }
      return false;
    });
    
    if (!isBlocked) {
      newSlots.push({ week: batchWeek, day, period });
    }
  }
  
  // 避免重复添加
  const filteredNewSlots = newSlots.filter(newSlot => 
    !selectedTimeSlots.some(existingSlot => 
      existingSlot.week === newSlot.week && 
      existingSlot.day === newSlot.day && 
      existingSlot.period === newSlot.period
    )
  );
  
  return filteredNewSlots;
};
