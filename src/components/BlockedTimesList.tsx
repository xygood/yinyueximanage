import React, { useState, useEffect, useMemo } from 'react';
import { Trash2, RefreshCw, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useBlockedTime } from '../contexts/BlockedTimeContext';

interface MergedBlockedTime {
  className: string;
  dayOfWeek: number;
  reason: string;
  weeks: number[];
  periods: number[];
  items: any[];
}

const BlockedTimesList: React.FC<{ isAdmin?: boolean }> = ({ isAdmin = false }) => {
  const { 
    allData, 
    isLoading, 
    refreshBlockedTimes, 
    deleteBlockedTime, 
    clearAllBlockedTimes,
    getBlockedTimesByClass 
  } = useBlockedTime();
  
  // 只保留班级筛选
  const [selectedClass, setSelectedClass] = useState<string>('');
  
  // 班级列表（从数据中提取）
  const [classList, setClassList] = useState<string[]>([]);
  
  // 前端分页 - 默认只显示10条，减少渲染压力
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const pageSizeOptions = [10, 20, 50, 100];

  // 从数据中提取班级列表
  useEffect(() => {
    const classes = new Set<string>();
    allData.forEach((item: any) => {
      if (item.class_associations) {
        item.class_associations.forEach((assoc: any) => {
          if (assoc.name) {
            classes.add(assoc.name);
          }
        });
      }
    });
    setClassList(Array.from(classes).sort());
  }, [allData]);

  // 监听导入事件，刷新数据
  useEffect(() => {
    const handleImport = () => {
      refreshBlockedTimes();
    };
    window.addEventListener('blockedTimesImported', handleImport);
    return () => {
      window.removeEventListener('blockedTimesImported', handleImport);
    };
  }, [refreshBlockedTimes]);

  // 前端筛选：根据选择的班级过滤数据
  const filteredData = useMemo(() => {
    return getBlockedTimesByClass(selectedClass);
  }, [selectedClass, allData, getBlockedTimesByClass]);

  // 筛选后重置到第一页
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedClass]);

  // 将连续的数字格式化为范围格式（如 [3,4,5] -> "3-5"）
  const formatRanges = (numbers: number[]): string => {
    if (numbers.length === 0) return '';
    
    const sorted = [...numbers].sort((a, b) => a - b);
    const result: string[] = [];
    let start = sorted[0];
    let end = sorted[0];
    
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === end + 1) {
        end = sorted[i];
      } else {
        if (start === end) {
          result.push(`${start}`);
        } else {
          result.push(`${start}-${end}`);
        }
        start = sorted[i];
        end = sorted[i];
      }
    }
    
    if (start === end) {
      result.push(`${start}`);
    } else {
      result.push(`${start}-${end}`);
    }
    
    return result.join('、');
  };

  // 合并数据：按班级、星期、禁排原因分组，然后按周次和节次进一步分组
  // 注意：这个函数只影响显示，不影响原始数据的加载和存储
  const mergeData = (data: any[]): MergedBlockedTime[] => {
    // 第一步：按班级、星期、禁排原因分组
    const groupMap = new Map<string, any[]>();
    
    data.forEach(item => {
      const className = item.class_associations?.map((a: any) => a.name).join(', ') || '-';
      const dayOfWeek = item.day_of_week;
      const reason = item.reason;
      const key = `${className}-${dayOfWeek}-${reason}`;
      
      if (groupMap.has(key)) {
        groupMap.get(key)!.push(item);
      } else {
        groupMap.set(key, [item]);
      }
    });
    
    // 第二步：在每个分组内，按周次和节次进一步分组
    const result: MergedBlockedTime[] = [];
    
    groupMap.forEach((items, key) => {
      const [className, dayOfWeekStr, reason] = key.split('-');
      const dayOfWeek = parseInt(dayOfWeekStr);
      
      // 按节次分组
      const periodGroups = new Map<string, { weeks: Set<number>; items: any[] }>();
      
      items.forEach(item => {
        // 将节次数组转换为字符串作为key
        const periodsKey = [...item.periods].sort((a: number, b: number) => a - b).join(',');
        
        if (periodGroups.has(periodsKey)) {
          const group = periodGroups.get(periodsKey)!;
          item.weeks.forEach((week: number) => group.weeks.add(week));
          group.items.push(item);
        } else {
          periodGroups.set(periodsKey, {
            weeks: new Set(item.weeks),
            items: [item]
          });
        }
      });
      
      // 将分组结果转换为数组
      periodGroups.forEach((group, periodsKey) => {
        result.push({
          className,
          dayOfWeek,
          reason,
          weeks: Array.from(group.weeks).sort((a, b) => a - b),
          periods: periodsKey.split(',').map(Number),
          items: group.items
        });
      });
    });
    
    // 排序：先按班级，再按星期，最后按节次
    return result.sort((a, b) => {
      if (a.className !== b.className) {
        return a.className.localeCompare(b.className);
      }
      if (a.dayOfWeek !== b.dayOfWeek) {
        return a.dayOfWeek - b.dayOfWeek;
      }
      // 按第一个节次排序
      return (a.periods[0] || 0) - (b.periods[0] || 0);
    });
  };

  // 星期映射
  const dayMap: {[key: number]: string} = {
    1: '周一', 2: '周二', 3: '周三', 4: '周四', 
    5: '周五', 6: '周六', 7: '周日'
  };

  // 使用 useMemo 优化性能，避免每次渲染都重新计算
  const mergedData = useMemo(() => mergeData(filteredData), [filteredData]);
  
  // 前端分页计算
  const totalItems = mergedData.length;
  const totalPages = Math.ceil(totalItems / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const paginatedData = useMemo(() => mergedData.slice(startIndex, endIndex), [mergedData, startIndex, endIndex]);

  // 删除单条
  const handleDelete = async (id: string) => {
    if (!confirm('确定删除这条禁排时间吗？')) return;
    const success = await deleteBlockedTime(id);
    if (!success) {
      alert('删除失败');
    }
  };

  // 清空所有
  const handleClearAll = async () => {
    if (!confirm('确定清空所有禁排时间吗？此操作不可恢复！')) return;
    const success = await clearAllBlockedTimes();
    if (success) {
      alert('已清空所有数据');
    } else {
      alert('清空失败');
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-800">禁排时间列表</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={refreshBlockedTimes}
            disabled={isLoading}
            className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
            刷新
          </button>
          {isAdmin && (
            <button
              onClick={handleClearAll}
              className="inline-flex items-center px-3 py-1.5 border border-red-300 text-sm font-medium rounded-md text-red-700 bg-red-50 hover:bg-red-100"
            >
              清空所有
            </button>
          )}
        </div>
      </div>

      {/* 班级筛选栏 */}
      <div className="flex flex-wrap gap-3 mb-4 p-4 bg-gray-50 rounded-lg">
        <select
          value={selectedClass}
          onChange={e => setSelectedClass(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          style={{ width: '180px' }}
        >
          <option value="">所有班级</option>
          {classList.map(cls => (
            <option key={cls} value={cls}>{cls}</option>
          ))}
        </select>
        
        {selectedClass && (
          <button
            onClick={() => setSelectedClass('')}
            className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
          >
            <X className="w-4 h-4 mr-1" />
            清除筛选
          </button>
        )}
      </div>

      {/* 性能提示 */}
      {totalItems > 100 && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md text-sm text-yellow-800">
          数据量较大（{totalItems}条），已启用分页显示。建议每页显示较少条数以提高性能。
        </div>
      )}

      {/* 数据表格 - 限制最大高度 */}
      <div className="overflow-x-auto" style={{ maxHeight: '600px', overflowY: 'auto' }}>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">序号</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">班级</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">周次</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">星期</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">节次</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">禁排原因</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  加载中...
                </td>
              </tr>
            ) : paginatedData.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  暂无禁排时间数据
                </td>
              </tr>
            ) : (
              paginatedData.map((item, index) => (
                <tr key={`${item.className}-${item.dayOfWeek}-${item.reason}-${startIndex + index}`} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-900">
                    {startIndex + index + 1}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900">
                    {item.className}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900">
                    {formatRanges(item.weeks)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900">
                    {dayMap[item.dayOfWeek] || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900">
                    {formatRanges(item.periods)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900">
                    <div className="flex items-center gap-2">
                      <span>{item.reason}</span>
                      {item.items[0].source_type === 'large_class' && item.items[0].teacher_name && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                          {item.items[0].teacher_name}
                        </span>
                      )}
                      {item.items[0].source_type === 'system_blocked' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800">
                          系统禁排
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900">
                    {isAdmin ? (
                      <button
                        onClick={() => {
                          if (confirm('确定删除这些禁排时间吗？')) {
                            item.items.forEach((item: any) => handleDelete(item.id));
                          }
                        }}
                        className="text-red-600 hover:text-red-900 inline-flex items-center"
                      >
                        <Trash2 className="w-4 h-4 mr-1" />
                        删除
                      </button>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 分页信息 */}
      <div className="flex items-center justify-between mt-4">
        <div className="flex items-center gap-4">
          <div className="text-sm text-gray-500">
            显示 {startIndex + 1} 到 {endIndex} 共 {totalItems} 条
            {selectedClass && ` (已筛选: ${selectedClass})`}
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span>每页显示：</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="px-2 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              {pageSizeOptions.map(size => (
                <option key={size} value={size}>{size}条</option>
              ))}
            </select>
          </div>
        </div>
        
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              className="px-3 py-1 border border-gray-300 rounded-md text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              首页
            </button>
            <button
              onClick={() => setCurrentPage(currentPage - 1)}
              disabled={currentPage === 1}
              className="px-3 py-1 border border-gray-300 rounded-md text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            
            <span className="px-3 py-1 text-sm text-gray-600">
              {currentPage} / {totalPages}
            </span>
            
            <button
              onClick={() => setCurrentPage(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="px-3 py-1 border border-gray-300 rounded-md text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
              className="px-3 py-1 border border-gray-300 rounded-md text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              末页
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default BlockedTimesList;
