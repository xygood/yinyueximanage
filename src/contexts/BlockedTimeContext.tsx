import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';

interface BlockedTime {
  id: string;
  class_associations: Array<{name: string}>;
  weeks: number[];
  day_of_week: number;
  periods: number[];
  reason: string;
  source_type: string;
  course_name?: string;
  teacher_name?: string;
  imported_at: string;
}

interface BlockedTimeCache {
  data: BlockedTime[];
  timestamp: number;
  version: string;
}

interface BlockedTimeContextType {
  allData: BlockedTime[];
  isLoading: boolean;
  loadProgress: number; // 加载进度 0-100
  hasLoaded: boolean; // 是否已加载完成
  isLoadingFromCache: boolean; // 是否正在从缓存读取
  loadBlockedTimes: () => Promise<void>;
  refreshBlockedTimes: () => Promise<void>;
  deleteBlockedTime: (id: string) => Promise<boolean>;
  clearAllBlockedTimes: () => Promise<boolean>;
  getBlockedTimesByClass: (className: string) => BlockedTime[];
}

const CACHE_KEY = 'blockedTimesCache';
const CACHE_VERSION = '1.0';
const CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7天过期
const LEGACY_CACHE_KEY = 'music_scheduler_imported_blocked_times'; // 兼容 ArrangeClass 的缓存 key

const BlockedTimeContext = createContext<BlockedTimeContextType | undefined>(undefined);

export const BlockedTimeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [allData, setAllData] = useState<BlockedTime[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [isLoadingFromCache, setIsLoadingFromCache] = useState(true);

  // 从 localStorage 读取缓存
  const loadFromCache = useCallback((): BlockedTime[] | null => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (!cached) return null;

      const cacheData: BlockedTimeCache = JSON.parse(cached);

      // 检查版本
      if (cacheData.version !== CACHE_VERSION) {
        localStorage.removeItem(CACHE_KEY);
        return null;
      }

      // 检查是否过期
      const now = Date.now();
      if (now - cacheData.timestamp > CACHE_EXPIRY) {
        localStorage.removeItem(CACHE_KEY);
        return null;
      }

      return cacheData.data;
    } catch (error) {
      console.error('读取缓存失败:', error);
      return null;
    }
  }, []);

  // 保存到 localStorage
  const saveToCache = useCallback((data: BlockedTime[]) => {
    try {
      // 保存到新缓存（用于 AdminDashboard）
      const cacheData: BlockedTimeCache = {
        data,
        timestamp: Date.now(),
        version: CACHE_VERSION
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));

      // 同时保存到旧缓存（用于 ArrangeClass 兼容）
      // 转换数据格式以兼容 ArrangeClass 的读取逻辑
      const legacyData = data.map(item => {
        // 处理班级名称，确保格式一致（添加"音乐学"前缀）
        const classNames = item.class_associations?.map((a: any) => {
          const name = a.name || '';
          // 如果名称已经是"音乐学XXX"格式，直接使用
          if (name.startsWith('音乐学')) {
            return name;
          }
          // 否则添加"音乐学"前缀
          return `音乐学${name}`;
        }) || [];
        
        return {
          id: item.id,
          class_name: classNames.join(', '),
          weeks: item.weeks,
          day: item.day_of_week,
          periods: item.periods,
          reason: item.reason,
          source_type: item.source_type,
          teacher_name: item.teacher_name,
          course_name: item.course_name,
          imported_at: item.imported_at
        };
      });
      // 确保旧缓存一定被写入，即使数据为空也要写入空数组
      try {
        localStorage.setItem(LEGACY_CACHE_KEY, JSON.stringify(legacyData));
        console.log('旧缓存已保存:', LEGACY_CACHE_KEY, legacyData.length, '条');
      } catch (legacyError) {
        console.error('保存旧缓存失败:', legacyError);
      }

      console.log('禁排数据已同步到两个缓存:', data.length, '条');
    } catch (error) {
      console.error('保存缓存失败:', error);
    }
  }, []);

  // 清除缓存
  const clearCache = useCallback(() => {
    try {
      localStorage.removeItem(CACHE_KEY);
      localStorage.removeItem(LEGACY_CACHE_KEY); // 同时清除旧缓存
    } catch (error) {
      console.error('清除缓存失败:', error);
    }
  }, []);

  // 检查旧缓存是否存在且有效
  const loadFromLegacyCache = useCallback((): BlockedTime[] | null => {
    try {
      const legacyCached = localStorage.getItem(LEGACY_CACHE_KEY);
      if (!legacyCached) return null;

      const legacyData = JSON.parse(legacyCached);
      if (Array.isArray(legacyData) && legacyData.length > 0) {
        // 转换旧格式为新格式
        return legacyData.map((item: any) => ({
          id: item.id,
          class_associations: item.class_name ? item.class_name.split(',').map((name: string) => ({ name: name.trim() })) : [],
          weeks: item.weeks || [],
          day_of_week: item.day,
          periods: item.periods || [],
          reason: item.reason || '',
          source_type: item.source_type || 'system_blocked',
          course_name: item.course_name,
          teacher_name: item.teacher_name,
          imported_at: item.imported_at
        }));
      }
      return null;
    } catch (error) {
      console.error('读取旧缓存失败:', error);
      return null;
    }
  }, []);

  // 组件挂载时自动加载数据
  useEffect(() => {
    const initLoad = async () => {
      // 首先尝试从新缓存加载
      let cachedData = loadFromCache();

      // 如果新缓存没有，尝试从旧缓存加载
      if (!cachedData || cachedData.length === 0) {
        cachedData = loadFromLegacyCache();
        if (cachedData && cachedData.length > 0) {
          console.log('从旧缓存加载禁排数据:', cachedData.length, '条');
          // 同步到新缓存
          saveToCache(cachedData);
        }
      }

      if (cachedData && cachedData.length > 0) {
        // 有缓存，立即使用
        setAllData(cachedData);
        setHasLoaded(true);
        setIsLoadingFromCache(false);
        console.log('禁排数据已从缓存加载:', cachedData.length, '条');

        // 同时确保旧缓存也存在（用于 ArrangeClass 兼容）
        const legacyExists = localStorage.getItem(LEGACY_CACHE_KEY);
        if (!legacyExists) {
          // 如果旧缓存不存在，重新保存一次以同步
          saveToCache(cachedData);
        }
      } else {
        // 无缓存，需要从服务器加载
        setIsLoadingFromCache(false);
        console.log('缓存中没有禁排数据，需要从服务器加载');
      }
    };

    initLoad();
  }, [loadFromCache, loadFromLegacyCache, saveToCache]);

  // 从服务器加载数据
  const loadFromServer = useCallback(async (): Promise<BlockedTime[]> => {
    setIsLoading(true);
    setLoadProgress(0);

    try {
      // 模拟进度条
      const progressInterval = setInterval(() => {
        setLoadProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 10;
        });
      }, 200);

      const response = await fetch('/api/imported-blocked-times');
      const result = await response.json();

      clearInterval(progressInterval);
      setLoadProgress(100);

      if (result.success && result.data) {
        // 保存到缓存
        saveToCache(result.data);
        return result.data;
      }
      return [];
    } catch (error) {
      console.error('从服务器加载禁排时间失败:', error);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [saveToCache]);

  // 加载禁排数据（首次）
  const loadBlockedTimes = useCallback(async () => {
    if (hasLoaded) return; // 已经加载过，不再重复加载

    const data = await loadFromServer();
    if (data.length > 0) {
      setAllData(data);
      setHasLoaded(true);
    }
  }, [hasLoaded, loadFromServer]);

  // 刷新禁排数据
  const refreshBlockedTimes = useCallback(async () => {
    const data = await loadFromServer();
    setAllData(data);
    setHasLoaded(true);
  }, [loadFromServer]);

  // 删除单条禁排时间
  const deleteBlockedTime = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/imported-blocked-times/${id}`, {
        method: 'DELETE'
      });
      const result = await response.json();

      if (result.success) {
        setAllData(prev => {
          const newData = prev.filter(item => item.id !== id);
          saveToCache(newData); // 更新缓存
          return newData;
        });
        return true;
      }
      return false;
    } catch (error) {
      console.error('删除禁排时间失败:', error);
      return false;
    }
  }, [saveToCache]);

  // 清空所有禁排时间
  const clearAllBlockedTimes = useCallback(async () => {
    try {
      const response = await fetch('/api/imported-blocked-times/clear', {
        method: 'POST'
      });
      const result = await response.json();

      if (result.success) {
        setAllData([]);
        clearCache(); // 清除缓存
        return true;
      }
      return false;
    } catch (error) {
      console.error('清空禁排时间失败:', error);
      return false;
    }
  }, [clearCache]);

  // 根据班级获取禁排时间
  const getBlockedTimesByClass = useCallback((className: string) => {
    if (!className) return allData;
    return allData.filter(item => {
      const classNames = item.class_associations?.map(a => a.name) || [];
      return classNames.includes(className);
    });
  }, [allData]);

  const value = useMemo(() => ({
    allData,
    isLoading,
    loadProgress,
    hasLoaded,
    isLoadingFromCache,
    loadBlockedTimes,
    refreshBlockedTimes,
    deleteBlockedTime,
    clearAllBlockedTimes,
    getBlockedTimesByClass
  }), [allData, isLoading, loadProgress, hasLoaded, isLoadingFromCache, loadBlockedTimes, refreshBlockedTimes, deleteBlockedTime, clearAllBlockedTimes, getBlockedTimesByClass]);

  return (
    <BlockedTimeContext.Provider value={value}>
      {children}
    </BlockedTimeContext.Provider>
  );
};

export const useBlockedTime = () => {
  const context = useContext(BlockedTimeContext);
  if (context === undefined) {
    throw new Error('useBlockedTime must be used within a BlockedTimeProvider');
  }
  return context;
};
