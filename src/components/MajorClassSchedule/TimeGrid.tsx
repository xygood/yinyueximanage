import React from 'react';
import { Clock, XCircle, CheckCircle, Check } from 'lucide-react';
import { WEEKDAYS } from './types';
import SelectedTimeSlots from './SelectedTimeSlots';

interface TimeGridProps {
  timeGridStatus: any;
  selectedWeek: number;
  selectionMode: 'single' | 'batch';
  selectedTimeSlots: any[];
  scheduledClasses: any[];
  currentCourse: any;
  selectedClass: string;
  selectedRoom: string;
  classes: any[];
  courses: any[];
  rooms: any[];
  blockedSlots: any[];
  largeClassEntries: any[];
  importedBlockedTimes: any[];
  isDragging: boolean;
  dragStart: any;
  dragEnd: any;
  onClearSelection: () => void;
  onTimeSlotClick: (week: number, day: number, period: number) => void;
  onDragStart: (day: number, period: number) => void;
  onDragEnter: (day: number, period: number) => void;
  onDragEnd: () => void;
  onSelectionModeChange: (mode: 'single' | 'batch') => void;
  onRemoveSlot?: (day: number, startPeriod: number, endPeriod: number, weeks: number[]) => void;
  selectedSemesterLabel: string;
  semesterStartDate?: string;
}

const TimeGrid: React.FC<TimeGridProps> = ({
  timeGridStatus,
  selectedWeek,
  selectionMode,
  selectedTimeSlots,
  scheduledClasses,
  currentCourse,
  selectedClass,
  selectedRoom,
  classes,
  courses,
  rooms,
  blockedSlots,
  largeClassEntries,
  importedBlockedTimes,
  isDragging,
  dragStart,
  dragEnd,
  onClearSelection,
  onTimeSlotClick,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onSelectionModeChange,
  onRemoveSlot,
  selectedSemesterLabel,
  semesterStartDate
}) => {
  // 计算指定周和星期几的具体日期
  const getDayDate = (week: number, dayOfWeek: number): string => {
    if (!semesterStartDate) return '';
    
    try {
      const startDate = new Date(semesterStartDate);
      
      // 获取某日期所在周的周一
      const getMonday = (date: Date): Date => {
        const d = new Date(date);
        const day = d.getDay();
        // getDay() 返回 0-6，其中 0 是星期日
        // 周一为一周的第一天：周日(0)属于上一周
        const diff = day === 0 ? -6 : 1 - day;
        d.setDate(d.getDate() + diff);
        return d;
      };
      
      // 学期开始的周一
      const startMonday = getMonday(startDate);
      
      // 计算目标周的周一
      const targetMonday = new Date(startMonday);
      targetMonday.setDate(startMonday.getDate() + (week - 1) * 7);
      
      // 计算目标日期（周一=1，周日=7）
      const targetDate = new Date(targetMonday);
      targetDate.setDate(targetMonday.getDate() + (dayOfWeek - 1));
      
      // 格式化日期（MM-DD）
      const month = (targetDate.getMonth() + 1).toString().padStart(2, '0');
      const day = targetDate.getDate().toString().padStart(2, '0');
      
      return `${month}-${day}`;
    } catch (error) {
      return '';
    }
  };
  // 解析周次范围字符串，返回包含的周次数组
  const parseWeekRange = (weekRange: string): number[] => {
    const weeks: number[] = [];
    if (!weekRange) return weeks;
    
    // 分割多个周次范围
    const ranges = weekRange.split(/[,，;；]/).map(r => r.trim()).filter(r => r);
    
    for (const range of ranges) {
      // 处理单个周次，如 "1"
      if (/^\d+$/.test(range)) {
        weeks.push(parseInt(range));
      }
      // 处理周次范围，如 "1-5"
      else if (/-/.test(range)) {
        const [start, end] = range.split('-').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
        if (start && end && start <= end) {
          for (let i = start; i <= end; i++) {
            weeks.push(i);
          }
        }
      }
    }
    
    // 去重并排序
    return [...new Set(weeks)].sort((a, b) => a - b);
  };
  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <Clock className="w-5 h-5 text-purple-600" />
        时间网格 (第{selectedWeek}周)
      </h2>
      
      {/* 操作栏 - 选择模式、清空选择、已选时段 */}
      <div className="flex flex-wrap gap-3 items-center mb-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">选择模式:</span>
          <select
            value={selectionMode}
            onChange={(e) => onSelectionModeChange(e.target.value as 'single' | 'batch')}
            className="px-3 py-1 border border-gray-300 rounded-md focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
          >
            <option value="single">单选</option>
            <option value="batch">批量选择</option>
          </select>
        </div>
        
        <button
          onClick={onClearSelection}
          className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors flex items-center gap-2"
          disabled={selectedTimeSlots.length === 0}
        >
          <XCircle className="w-4 h-4" />
          清空选择
        </button>
        
        {/* 已选时段 */}
        <div className="flex-grow">
          <SelectedTimeSlots
            selectedTimeSlots={selectedTimeSlots}
            onRemoveSlot={onRemoveSlot}
          />
        </div>
      </div>
      
      <div className="overflow-x-auto">
        <div className="min-w-[800px]">
          {/* 星期表头 */}
          <div className="grid grid-cols-8 gap-1 mb-1">
            <div className="col-span-1 flex flex-col items-center justify-center py-2 bg-gray-100 rounded-md font-medium min-h-[60px]">
              节次
            </div>
            {WEEKDAYS.map(day => (
              <div key={day.value} className="flex flex-col items-center justify-center py-2 bg-gray-100 rounded-md font-medium min-h-[60px]">
                <span>{day.label}</span>
                <span className="text-xs text-gray-500 font-normal">{getDayDate(selectedWeek, day.value)}</span>
              </div>
            ))}
          </div>
          
          {/* 时间网格 - 两节连排 */}
          {Array.from({ length: 5 }, (_, majorPeriodIndex) => majorPeriodIndex + 1).map(majorPeriod => {
            const startPeriod = (majorPeriod - 1) * 2 + 1;
            const endPeriod = startPeriod + 1;
            
            return (
              <div key={majorPeriod} className="grid grid-cols-8 gap-1 mb-1">
                {/* 节次标签 */}
                <div className="col-span-1 flex items-center justify-center py-4 bg-gray-50 rounded-md font-medium">
                  {startPeriod}-{endPeriod}节
                </div>
                
                {/* 每天的时间格子 */}
                {WEEKDAYS.map(day => {
                  // 检查当前大节是否已经被排课
                  const isScheduled = (scheduledClasses || []).some(sc => 
                    sc?.course_id === currentCourse?.course_id && 
                    sc?.class_id === currentCourse?.class_id && 
                    sc?.week_number === selectedWeek && 
                    sc?.day_of_week === day.value && 
                    (sc?.period === startPeriod || sc?.period === endPeriod)
                  );
                  
                  // 检查当前大节是否被选择
                  const isSelected = (selectedTimeSlots || []).some(
                    slot => slot?.week === selectedWeek && slot?.day === day.value && 
                    (slot?.period === startPeriod || slot?.period === endPeriod)
                  );
                  
                  // 检查当前大节是否为禁排时段（考虑班级）
                  const currentClassId = selectedClass || currentCourse?.class_id;
                  const currentClassName = classes.find(c => c.class_id === currentClassId)?.class_name;
                  
                  // 检查传统禁排时段
      const isBlockedByConfig = (blockedSlots || []).some(slot => {
        // 检查学期是否匹配
        if (slot.semester_label && slot.semester_label !== selectedSemesterLabel) {
          return false;
        }
        
        // 检查是否指定了班级，如果指定了，只有当班级匹配时才禁排
        if (slot.class_associations && slot.class_associations.length > 0) {
          // 检查当前班级是否在禁排关联班级中
          const hasClassAssociation = slot.class_associations?.some(assoc => {
            // 处理不同格式的班级关联
            if (typeof assoc === 'string') {
              // 如果assoc是字符串，直接匹配班级名称或ID
              return assoc === currentClassId || assoc === currentClassName || 
                     currentClassName?.includes(assoc) || assoc.includes(currentClassName || '');
            } else {
              // 如果assoc是对象，匹配ID或名称
              return assoc?.id === currentClassId || 
                     assoc?.name === currentClassName ||
                     assoc?.id === currentClassName ||
                     assoc?.name === currentClassId ||
                     currentClassName?.includes(assoc?.name || '') ||
                     (assoc?.name || '').includes(currentClassName || '');
            }
          }) || false;
          if (!hasClassAssociation) {
            return false;
          }
        }
        
        // 检查每周循环禁排
        if (slot.type === 'recurring' && slot.day_of_week === day.value) {
            if (slot.start_period != null && slot.end_period != null) {
              return (startPeriod >= slot.start_period && startPeriod <= slot.end_period) || 
                     (endPeriod >= slot.start_period && endPeriod <= slot.end_period);
            }
            return false; // 未指定节次范围时不禁排，避免行政例会等误显示为整日禁排
          }
        
        // 检查特定周次的特定星期禁排
        if (slot.type === 'specific' && slot.specific_week_days) {
          const isSpecificWeekDay = slot.specific_week_days?.some(wd => wd.week === selectedWeek && wd.day === day.value) || false;
          if (isSpecificWeekDay) {
            if (slot.start_period != null && slot.end_period != null) {
              return (startPeriod >= slot.start_period && startPeriod <= slot.end_period) || 
                     (endPeriod >= slot.start_period && endPeriod <= slot.end_period);
            }
            return false; // 未指定节次范围时不禁排
          }
        }
        
        // 检查特定周次的特定天禁排
        if (slot.type === 'specific' && slot.week_number === selectedWeek && slot.day_of_week === day.value) {
          if (slot.start_period != null && slot.end_period != null) {
            return (startPeriod >= slot.start_period && startPeriod <= slot.end_period) || 
                   (endPeriod >= slot.start_period && endPeriod <= slot.end_period);
          }
          return false; // 未指定节次范围时不禁排
        }
        
        // 检查全周禁排（仅当未使用 specific_week_days 时）
        if (slot.type === 'specific' && slot.week_number === selectedWeek && (!slot.specific_week_days || slot.specific_week_days.length === 0)) {
          if (slot.start_period != null && slot.end_period != null) {
            return (startPeriod >= slot.start_period && startPeriod <= slot.end_period) || 
                   (endPeriod >= slot.start_period && endPeriod <= slot.end_period);
          }
          return false; // 未指定节次范围时不禁排
        }
        
        return false;
      });
                  
                  // 检查通适大课禁排
                  const isBlockedByLargeClass = (largeClassEntries || []).some(entry => {
                    // 检查班级是否匹配
                    if (currentClassName && entry.class_name !== currentClassName) {
                      return false;
                    }
                    
                    // 检查星期是否匹配
                    if (entry.day_of_week !== day.value) {
                      return false;
                    }
                    
                    // 检查节次是否匹配
                    if (startPeriod < entry.period_start || endPeriod > entry.period_end) {
                      return false;
                    }
                    
                    // 检查周次是否匹配
                    const weeks = parseWeekRange(entry.week_range || '');
                    return weeks.includes(selectedWeek);
                  });
                  
                  // 检查专业大课和专业小课的教师冲突
                  const currentTeacherId = currentCourse?.teacher_id;
                  const currentTeacherName = currentCourse?.teacher_name;
                  const isBlockedByTeacherConflict = (scheduledClasses || []).some(schedule => {
                    // 排除当前课程的排课记录
                    if (currentCourse && schedule.course_id === currentCourse.course_id) {
                      return false;
                    }
                    // 检查教师是否匹配
                    // 如果teacher_id有效且不是'unknown'，使用teacher_id比较
                    if (currentTeacherId && currentTeacherId !== 'unknown' && schedule.teacher_id && schedule.teacher_id !== 'unknown') {
                      if (schedule.teacher_id === currentTeacherId) {
                        // 检查时间是否匹配
                        return schedule.week_number === selectedWeek && 
                               schedule.day_of_week === day.value && 
                               (schedule.period === startPeriod || schedule.period === endPeriod);
                      }
                    } else if (currentTeacherId === 'unknown' && schedule.teacher_id === 'unknown') {
                      // 如果两个teacher_id都是'unknown'，必须使用teacher_name比较
                      if (currentTeacherName && schedule.teacher_name && schedule.teacher_name === currentTeacherName) {
                        // 检查时间是否匹配
                        return schedule.week_number === selectedWeek && 
                               schedule.day_of_week === day.value && 
                               (schedule.period === startPeriod || schedule.period === endPeriod);
                      }
                    }
                    return false;
                  });
                  
                  // 检查导入的禁排时间
                  const isBlockedByImported = (importedBlockedTimes || []).some(item => {
                    // 检查班级是否匹配
                    if (currentClassName && item.class_name !== currentClassName) {
                      return false;
                    }
                    // 检查周次是否匹配
                    if (!item.weeks.includes(selectedWeek)) {
                      return false;
                    }
                    // 检查星期是否匹配
                    if (item.day !== day.value) {
                      return false;
                    }
                    // 检查节次是否匹配
                    return (item.periods.includes(startPeriod) || item.periods.includes(endPeriod));
                  });
                  
                  // 检查教室占用：选择教室后，该教室已被其他课程占用的时段显示为禁排
                  const isBlockedByRoomConflict = selectedRoom ? (scheduledClasses || []).some(schedule => {
                    // 排除当前课程的排课记录（编辑时保留已排时段可选）
                    if (currentCourse && schedule.course_id === currentCourse.course_id) {
                      return false;
                    }
                    if (schedule.room_id !== selectedRoom) return false;
                    if (schedule.week_number !== selectedWeek || schedule.day_of_week !== day.value) return false;
                    return schedule.period === startPeriod || schedule.period === endPeriod;
                  }) : false;
                  
                  // 获取禁排原因
                  const getBlockReason = (): string => {
                    // 检查传统禁排时段
                    const blockedSlot = (blockedSlots || []).find(slot => {
                      // 检查学期是否匹配
                      if (slot.semester_label && slot.semester_label !== selectedSemesterLabel) {
                        return false;
                      }
                      
                      // 检查是否指定了班级
                      if (slot.class_associations && slot.class_associations.length > 0) {
                        const hasClassAssociation = slot.class_associations?.some((assoc: any) => {
                          if (typeof assoc === 'string') {
                            return assoc === currentClassId || assoc === currentClassName || 
                                   currentClassName?.includes(assoc) || assoc.includes(currentClassName || '');
                          } else {
                            return assoc?.id === currentClassId || 
                                   assoc?.name === currentClassName ||
                                   assoc?.id === currentClassName ||
                                   assoc?.name === currentClassId ||
                                   currentClassName?.includes(assoc?.name || '') ||
                                   (assoc?.name || '').includes(currentClassName || '');
                          }
                        }) || false;
                        if (!hasClassAssociation) {
                          return false;
                        }
                      }
                      
                      // 检查每周循环禁排
                      if (slot.type === 'recurring' && slot.day_of_week === day.value) {
                        if (slot.start_period != null && slot.end_period != null) {
                          if ((startPeriod >= slot.start_period && startPeriod <= slot.end_period) || 
                              (endPeriod >= slot.start_period && endPeriod <= slot.end_period)) {
                            return true;
                          }
                          return false;
                        }
                        return false; // 未指定节次范围时不禁排
                      }
                      
                      // 检查特定周次的特定星期禁排
                      if (slot.type === 'specific' && slot.specific_week_days) {
                        const isSpecificWeekDay = slot.specific_week_days?.some((wd: any) => wd.week === selectedWeek && wd.day === day.value) || false;
                        if (isSpecificWeekDay) {
                          if (slot.start_period != null && slot.end_period != null) {
                            if ((startPeriod >= slot.start_period && startPeriod <= slot.end_period) || 
                                (endPeriod >= slot.start_period && endPeriod <= slot.end_period)) {
                              return true;
                            }
                          }
                          return false; // 未指定节次范围时不禁排
                        }
                      }
                      
                      // 检查特定周次的特定天禁排
                      if (slot.type === 'specific' && slot.week_number === selectedWeek && slot.day_of_week === day.value) {
                        if (slot.start_period != null && slot.end_period != null) {
                          if ((startPeriod >= slot.start_period && startPeriod <= slot.end_period) || 
                              (endPeriod >= slot.start_period && endPeriod <= slot.end_period)) {
                            return true;
                          }
                          return false;
                        }
                        return false; // 未指定节次范围时不禁排
                      }
                      
                      // 检查全周禁排（仅当未使用 specific_week_days 时）
                      if (slot.type === 'specific' && slot.week_number === selectedWeek && (!slot.specific_week_days || slot.specific_week_days.length === 0)) {
                        if (slot.start_period != null && slot.end_period != null) {
                          if ((startPeriod >= slot.start_period && startPeriod <= slot.end_period) || 
                              (endPeriod >= slot.start_period && endPeriod <= slot.end_period)) {
                            return true;
                          }
                          return false;
                        }
                        return false; // 未指定节次范围时不禁排
                      }
                      
                      return false;
                    });
                    
                    if (blockedSlot) {
                      return blockedSlot.reason || '该时段被禁排';
                    }
                    
                    // 检查通适大课禁排
                    const largeClassEntry = (largeClassEntries || []).find((entry: any) => {
                      if (currentClassName && entry.class_name !== currentClassName) {
                        return false;
                      }
                      if (entry.day_of_week !== day.value) {
                        return false;
                      }
                      if (startPeriod < entry.period_start || endPeriod > entry.period_end) {
                        return false;
                      }
                      const weeks = parseWeekRange(entry.week_range || '');
                      return weeks.includes(selectedWeek);
                    });
                    
                    if (largeClassEntry) {
                      return '通适大课';
                    }
                    
                    // 检查导入的禁排时间
                    const importedBlocked = (importedBlockedTimes || []).find((item: any) => {
                      if (currentClassName && item.class_name !== currentClassName) {
                        return false;
                      }
                      if (!item.weeks.includes(selectedWeek)) {
                        return false;
                      }
                      if (item.day !== day.value) {
                        return false;
                      }
                      return (item.periods.includes(startPeriod) || item.periods.includes(endPeriod));
                    });
                    
                    if (importedBlocked) {
                      return importedBlocked.reason || '该时段被禁排';
                    }
                    
                    // 检查教师冲突
                    const teacherConflict = (scheduledClasses || []).find((schedule: any) => {
                      if (currentTeacherId && schedule.teacher_id === currentTeacherId) {
                        return schedule.week_number === selectedWeek && 
                               schedule.day_of_week === day.value && 
                               (schedule.period === startPeriod || schedule.period === endPeriod);
                      }
                      return false;
                    });
                    
                    if (teacherConflict) {
                      return '您在该时段已有其他课程安排';
                    }

                    // 检查教室占用
                    const roomConflict = selectedRoom ? (scheduledClasses || []).find((schedule: any) => {
                      if (currentCourse && schedule.course_id === currentCourse.course_id) return false;
                      if (schedule.room_id !== selectedRoom) return false;
                      return schedule.week_number === selectedWeek && 
                             schedule.day_of_week === day.value && 
                             (schedule.period === startPeriod || schedule.period === endPeriod);
                    }) : null;
                    
                    if (roomConflict) {
                      const conflictCourse = (courses || []).find((c: any) => c.id === roomConflict.course_id);
                      return `教室已被占用（${conflictCourse?.course_name || '未知课程'}）`;
                    }

                    return '该时段被禁排';
                  };
                  
                  // 计算整个学期中该时间槽的可用周次
                  const calculateAvailableWeeks = () => {
                    let availableWeeks = 0;
                    const totalWeeks = 17; // 默认17周
                    
                    for (let week = 1; week <= totalWeeks; week++) {
                      // 检查传统禁排时段
                      const isWeekBlockedByConfig = (blockedSlots || []).some(slot => {
                        // 检查学期是否匹配
                        if (slot.semester_label && slot.semester_label !== selectedSemesterLabel) {
                          return false;
                        }
                        
                        // 检查是否指定了班级
                        if (slot.class_associations && slot.class_associations.length > 0) {
                          const hasClassAssociation = slot.class_associations?.some((assoc: any) => {
                            if (typeof assoc === 'string') {
                              return assoc === currentClassId || assoc === currentClassName || 
                                     currentClassName?.includes(assoc) || assoc.includes(currentClassName || '');
                            } else {
                              return assoc?.id === currentClassId || 
                                     assoc?.name === currentClassName ||
                                     assoc?.id === currentClassName ||
                                     assoc?.name === currentClassId ||
                                     currentClassName?.includes(assoc?.name || '') ||
                                     (assoc?.name || '').includes(currentClassName || '');
                            }
                          }) || false;
                          if (!hasClassAssociation) {
                            return false;
                          }
                        }
                        
                        // 检查每周循环禁排
                        if (slot.type === 'recurring' && slot.day_of_week === day.value) {
                          if (slot.start_period != null && slot.end_period != null) {
                            return (startPeriod >= slot.start_period && startPeriod <= slot.end_period) || 
                                   (endPeriod >= slot.start_period && endPeriod <= slot.end_period);
                          }
                          return false; // 未指定节次范围时不禁排
                        }
                        
                        // 检查特定周次的特定星期禁排
                        if (slot.type === 'specific' && slot.specific_week_days) {
                          const isSpecificWeekDay = slot.specific_week_days?.some(wd => wd.week === week && wd.day === day.value) || false;
                          if (isSpecificWeekDay) {
                            if (slot.start_period != null && slot.end_period != null) {
                              return (startPeriod >= slot.start_period && startPeriod <= slot.end_period) || 
                                     (endPeriod >= slot.start_period && endPeriod <= slot.end_period);
                            }
                            return false; // 未指定节次范围时不禁排
                          }
                        }
                        
                        // 检查特定周次的特定天禁排
                        if (slot.type === 'specific' && slot.week_number === week && slot.day_of_week === day.value) {
                          if (slot.start_period != null && slot.end_period != null) {
                            return (startPeriod >= slot.start_period && startPeriod <= slot.end_period) || 
                                   (endPeriod >= slot.start_period && endPeriod <= slot.end_period);
                          }
                          return false; // 未指定节次范围时不禁排
                        }
                        
                        // 检查全周禁排（仅当未使用 specific_week_days 时）
                        if (slot.type === 'specific' && slot.week_number === week && (!slot.specific_week_days || slot.specific_week_days.length === 0)) {
                          if (slot.start_period != null && slot.end_period != null) {
                            return (startPeriod >= slot.start_period && startPeriod <= slot.end_period) || 
                                   (endPeriod >= slot.start_period && endPeriod <= slot.end_period);
                          }
                          return false; // 未指定节次范围时不禁排
                        }
                        
                        return false;
                      });
                      
                      // 检查通适大课禁排
                      const isWeekBlockedByLargeClass = (largeClassEntries || []).some(entry => {
                        // 检查班级是否匹配
                        if (currentClassName && entry.class_name !== currentClassName) {
                          return false;
                        }
                        
                        // 检查星期是否匹配
                        if (entry.day_of_week !== day.value) {
                          return false;
                        }
                        
                        // 检查节次是否匹配
                        if (startPeriod < entry.period_start || endPeriod > entry.period_end) {
                          return false;
                        }
                        
                        // 检查周次是否匹配
                        const weeks = parseWeekRange(entry.week_range || '');
                        return weeks.includes(week);
                      });
                      
                      // 检查导入的禁排时间
                      const isWeekBlockedByImported = (importedBlockedTimes || []).some(item => {
                        // 检查班级是否匹配
                        if (currentClassName && item.class_name !== currentClassName) {
                          return false;
                        }
                        // 检查周次是否匹配
                        if (!item.weeks.includes(week)) {
                          return false;
                        }
                        // 检查星期是否匹配
                        if (item.day !== day.value) {
                          return false;
                        }
                        // 检查节次是否匹配
                        return (item.periods.includes(startPeriod) || item.periods.includes(endPeriod));
                      });
                      
                      // 检查教室占用（选择教室后）
                      const isWeekBlockedByRoom = selectedRoom ? (scheduledClasses || []).some(schedule => {
                        if (currentCourse && schedule.course_id === currentCourse.course_id) return false;
                        if (schedule.room_id !== selectedRoom) return false;
                        if (schedule.week_number !== week || schedule.day_of_week !== day.value) return false;
                        return schedule.period === startPeriod || schedule.period === endPeriod;
                      }) : false;
                      
                      // 如果该周次没有被禁排，则计数
                      if (!isWeekBlockedByConfig && !isWeekBlockedByLargeClass && !isWeekBlockedByImported && !isWeekBlockedByRoom) {
                        availableWeeks++;
                      }
                    }
                    
                    return availableWeeks;
                  };
                  
                  const availableWeeks = calculateAvailableWeeks();
                  
                  // 最终禁排状态
                  const isBlocked = isBlockedByConfig || isBlockedByLargeClass || isBlockedByTeacherConflict || isBlockedByImported || isBlockedByRoomConflict;
                  const blockReason = isBlocked ? getBlockReason() : '';
                  
                  return (
                    <div
                      key={`${day.value}-${majorPeriod}`}
                      className={`flex items-center justify-center py-4 rounded-md transition-all duration-200 ${
                        isBlocked
                          ? 'bg-red-100 border border-red-300 cursor-not-allowed'
                          : isScheduled
                          ? 'bg-purple-100 border border-purple-300 cursor-pointer hover:bg-purple-200'
                          : isSelected
                          ? 'bg-purple-100 border-2 border-purple-500 cursor-pointer'
                          : 'bg-green-100 border border-green-300 cursor-pointer hover:bg-green-200'
                      }`}
                      onClick={() => {
                        if (!isBlocked) {
                          // 检查大节是否已经被完全选择
                          const startSelected = (selectedTimeSlots || []).some(
                            slot => slot?.week === selectedWeek && slot?.day === day.value && slot?.period === startPeriod
                          );
                          const endSelected = (selectedTimeSlots || []).some(
                            slot => slot?.week === selectedWeek && slot?.day === day.value && slot?.period === endPeriod
                          );
                          
                          if (startSelected && endSelected) {
                            // 如果大节已经被完全选择，则取消选择整个大节
                            onTimeSlotClick(selectedWeek, day.value, startPeriod);
                            onTimeSlotClick(selectedWeek, day.value, endPeriod);
                          } else {
                            // 否则选择整个大节
                            if (!startSelected) {
                              onTimeSlotClick(selectedWeek, day.value, startPeriod);
                            }
                            if (!endSelected) {
                              onTimeSlotClick(selectedWeek, day.value, endPeriod);
                            }
                          }
                        }
                      }}
                      onMouseDown={() => !isBlocked && onDragStart(day.value, startPeriod)}
                      onMouseEnter={() => !isBlocked && onDragEnter(day.value, startPeriod)}
                      onMouseUp={() => onDragEnd()}
                      title={isBlocked ? blockReason : ''}
                    >
                      {isBlocked && (
                        <span className="text-xs text-red-600">禁排</span>
                      )}
                      {!isBlocked && isScheduled && (
                        <CheckCircle className="w-4 h-4 text-green-600" />
                      )}
                      {!isBlocked && !isScheduled && !isSelected && (
                        <span className="text-xs text-green-600">第{selectedWeek}周 剩{availableWeeks}周</span>
                      )}
                      {!isBlocked && isSelected && (
                        <Check className="w-4 h-4 text-purple-600" />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default TimeGrid;
