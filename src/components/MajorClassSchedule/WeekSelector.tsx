import React from 'react';
import { CalendarDays } from 'lucide-react';
import { isWeekBlocked } from './utils';

interface WeekSelectorProps {
  totalWeeks: number;
  selectedWeek: number;
  scheduledClasses: any[];
  currentCourse: any;
  selectedClass: string;
  classes: any[];
  blockedSlots: any[];
  importedBlockedTimes: any[];
  onWeekChange: (week: number) => void;
  semesterStartDate?: string;
}

const WeekSelector: React.FC<WeekSelectorProps> = ({
  totalWeeks,
  selectedWeek,
  scheduledClasses,
  currentCourse,
  selectedClass,
  classes,
  blockedSlots,
  importedBlockedTimes,
  onWeekChange,
  semesterStartDate
}) => {
  // 计算指定周次的日期范围
  const getWeekDateRange = (week: number): string => {
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
      
      // 计算目标周的周日
      const targetSunday = new Date(targetMonday);
      targetSunday.setDate(targetMonday.getDate() + 6);
      
      // 格式化日期（MM-DD）
      const formatDate = (date: Date) => {
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        return `${month}-${day}`;
      };
      
      return `${formatDate(targetMonday)}~${formatDate(targetSunday)}`;
    } catch (error) {
      return '';
    }
  };
  return (
    <div>
      <div className="flex items-center mb-2">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-purple-600" />
          周次选择
        </h2>
        <span className="text-xs font-bold text-white ml-2 px-3 py-1 bg-purple-600 rounded-full">
          当前第{selectedWeek}周（{getWeekDateRange(selectedWeek)}）
        </span>
        <div className="ml-3 flex items-center gap-3">
          <span className="inline-flex items-center text-xs font-medium">
            <span className="inline-block w-3 h-3 bg-gray-100 border border-gray-300 rounded mr-1"></span>
            不禁排
          </span>
          <span className="inline-flex items-center text-xs font-medium">
            <span className="inline-block w-3 h-3 bg-orange-100 border border-orange-300 rounded mr-1"></span>
            部分禁排
          </span>
          <span className="inline-flex items-center text-xs font-medium">
            <span className="inline-block w-3 h-3 bg-red-100 border border-red-300 rounded mr-1"></span>
            全周禁排
          </span>
        </div>
      </div>
      
      <div className="flex flex-wrap gap-1">
        {Array.from({ length: totalWeeks }, (_, i) => i + 1).map(week => {
          // 检查当前周次是否已经被排课
          const isScheduled = scheduledClasses.some(sc => 
            sc.course_id === currentCourse?.course_id && 
            sc.class_id === currentCourse?.class_id && 
            sc.week_number === week
          );
          
          // 检查当前周次是否为禁排周次（考虑班级）
          const currentClassId = selectedClass || currentCourse?.class_id;
          const currentClassName = classes.find(c => c.class_id === currentClassId)?.class_name;
          
          // 检查是否为全周禁排
          const isFullyBlocked = isWeekBlocked(week, blockedSlots, currentClassId, currentClassName);
          
          // 检查是否有部分禁排
          const hasPartialBlock = (() => {
            // 如果是全周禁排，则不是部分禁排
            if (isFullyBlocked) {
              return false;
            }
            
            // 检查传统禁排时段
            const hasBlockedSlot = blockedSlots.some(slot => {
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
              
              if (slot.type === 'specific') {
                // 检查特定周次的星期几禁排
                if (slot.specific_week_days && slot.specific_week_days.some(wd => wd.week === week)) {
                  return true;
                }
                // 检查特定周次的特定天禁排
                if (slot.week_number === week && slot.day_of_week) {
                  return true;
                }
              }
              return false;
            });
            
            // 检查导入的禁排时间
            const hasImportedBlock = importedBlockedTimes.some(item => {
              // 检查班级是否匹配
              if (currentClassName && item.class_name !== currentClassName) {
                return false;
              }
              // 检查周次是否匹配
              return item.weeks.includes(week);
            });
            
            return hasBlockedSlot || hasImportedBlock;
          })();
          
          // 检查导入的禁排时间是否为全周禁排
          const hasImportedFullWeekBlock = (() => {
            if (!currentClassName) return false;
            
            // 获取该周的所有禁排记录
            const weekBlockedItems = importedBlockedTimes.filter(item => 
              item.class_name === currentClassName && item.weeks.includes(week)
            );
            
            // 检查每一天是否所有节次都禁排（1-10节）
            const daysWithFullBlock = new Set();
            weekBlockedItems.forEach(item => {
              // 检查是否包含所有节次（1-10节）
              const hasAllPeriods = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].every(period => 
                item.periods.includes(period)
              );
              if (hasAllPeriods) {
                daysWithFullBlock.add(item.day);
              }
            });
            
            // 如果一周7天都全禁排，则认为是全周禁排
            return daysWithFullBlock.size === 7;
          })();
          
          // 只有全周禁排的周次才会被禁用
          const isBlocked = isFullyBlocked || hasImportedFullWeekBlock;
          
          return (
            <button
              key={week}
              onClick={() => !isBlocked && onWeekChange(week)}
              className={`px-2 py-1.5 rounded-md text-sm font-medium transition-colors flex flex-col items-center leading-tight ${
                isBlocked
                  ? 'bg-red-100 text-red-700 border border-red-300 cursor-not-allowed'
                  : selectedWeek === week
                  ? 'bg-purple-600 text-white'
                  : hasPartialBlock
                  ? 'bg-orange-100 text-orange-700 border border-orange-300 hover:bg-orange-200'
                  : isScheduled
                  ? 'bg-green-100 text-green-700 border border-green-300'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
              disabled={isBlocked}
            >
              <span>{week}{selectedWeek === week && '✓'}{isBlocked && '✗'}{hasPartialBlock && !isBlocked && '⚠'}</span>
              <span className="text-[10px] opacity-75 mt-0.5">{getWeekDateRange(week)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default WeekSelector;
