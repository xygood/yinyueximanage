# ArrangeClass.tsx 代码拆分迁移方案

> 本方案采用"渐进式迁移"策略，确保每一步都可回滚，不影响现有功能。

---

## 一、迁移原则

1. **先创建新文件，不修改原文件** - 新文件独立存在，原文件保持不变
2. **逐步迁移，每步测试** - 每完成一个模块，立即测试验证
3. **保留原文件备份** - 随时可以回滚到原版本
4. **功能零影响** - 只移动代码位置，不改变任何逻辑

---

## 二、目标目录结构

```
src/pages/arrange-class/
├── index.tsx                    # 入口文件（最后创建）
├── ArrangeClass.tsx             # 主组件（精简后）
├── types.ts                     # 类型定义
├── constants.ts                 # 常量定义
├── hooks/
│   ├── index.ts                 # Hooks 导出入口
│   ├── useScheduleData.ts       # 数据加载
│   ├── useTimeGrid.ts           # 时间网格
│   ├── useStudentGroup.ts       # 学生分组
│   ├── useScheduleProgress.ts   # 排课进度
│   └── useBlockedTimes.ts       # 禁排时间
├── utils/
│   ├── index.ts                 # 工具函数导出入口
│   ├── validation.ts            # 验证函数
│   ├── scheduleUtils.ts         # 排课工具
│   └── timeUtils.ts             # 时间工具
└── components/
    ├── index.ts                 # 组件导出入口
    ├── TimeGrid.tsx             # 时间网格组件
    ├── WeekSelector.tsx         # 周次选择器
    ├── StudentList.tsx          # 学生列表
    ├── GroupPanel.tsx           # 小组面板
    ├── ScheduleResults.tsx      # 排课结果
    ├── BlockedTimesList.tsx     # 禁排时间列表
    └── RightPanel.tsx           # 右侧面板
```

---

## 三、迁移阶段规划

### 阶段 0：准备工作

**任务**：
1. 备份原文件
2. 创建目标目录结构
3. 创建空的占位文件

**验证**：
- 目录结构正确
- 原文件未被修改

**回滚方式**：
- 删除新创建的目录即可

---

### 阶段 1：提取类型定义

**创建文件**：`src/pages/arrange-class/types.ts`

**迁移内容**：
```typescript
// 从 ArrangeClass.tsx 第 56-106 行提取
interface Class { ... }
interface ScheduledClassDisplay { ... }
interface StudentGroup { ... }
// 其他接口定义
```

**原文件处理**：
- 暂不修改原文件
- 新文件独立存在

**验证**：
- 新文件编译无错误
- 原页面功能正常

**回滚方式**：
- 删除 types.ts

---

### 阶段 2：提取常量定义

**创建文件**：`src/pages/arrange-class/constants.ts`

**迁移内容**：
```typescript
// 从 ArrangeClass.tsx 提取
const WEEKDAYS = [ ... ];
const PERIOD_CONFIG = [ ... ];
const FACULTIES = [ ... ];
const INSTRUMENT_TO_FACULTY = { ... };
```

**验证**：
- 新文件编译无错误
- 原页面功能正常

**回滚方式**：
- 删除 constants.ts

---

### 阶段 3：提取工具函数

**创建文件**：
- `src/pages/arrange-class/utils/validation.ts`
- `src/pages/arrange-class/utils/scheduleUtils.ts`
- `src/pages/arrange-class/utils/timeUtils.ts`
- `src/pages/arrange-class/utils/index.ts`

**迁移内容**：
```typescript
// validation.ts
export const validateGroup = ( ... ) => { ... };
export const validateCurrentGroup = ( ... ) => { ... };
export const checkBlockedSlotConflict = async ( ... ) => { ... };
export const checkLargeClassConflict = async ( ... ) => { ... };
export const checkWeekRangeConflict = async ( ... ) => { ... };

// scheduleUtils.ts
export const formatScheduleTime = ( ... ) => { ... };
export const calculateRemainingHours = async ( ... ) => { ... };
export const getStudentClassType = ( ... ) => { ... };

// timeUtils.ts
export const getWeekDays = ( ... ) => { ... };
export const getDayDate = ( ... ) => { ... };
```

**验证**：
- 新文件编译无错误
- 原页面功能正常

**回滚方式**：
- 删除 utils 目录

---

### 阶段 4：提取 Hooks

**创建文件**：
- `src/pages/arrange-class/hooks/useScheduleData.ts`
- `src/pages/arrange-class/hooks/useTimeGrid.ts`
- `src/pages/arrange-class/hooks/useStudentGroup.ts`
- `src/pages/arrange-class/hooks/useBlockedTimes.ts`
- `src/pages/arrange-class/hooks/index.ts`

**迁移内容**：
```typescript
// useScheduleData.ts
export function useScheduleData() {
  const [loading, setLoading] = useState(true);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  // ... 数据加载相关状态和逻辑
  return { loading, teachers, students, courses, ... };
}

// useTimeGrid.ts
export function useTimeGrid() {
  const [selectedWeek, setSelectedWeek] = useState(1);
  const [selectedTimeSlots, setSelectedTimeSlots] = useState([]);
  // ... 时间网格相关状态和逻辑
  return { selectedWeek, selectedTimeSlots, handleTimeSlotClick, ... };
}

// useStudentGroup.ts
export function useStudentGroup() {
  const [groupStudents, setGroupStudents] = useState<Student[]>([]);
  // ... 分组相关状态和逻辑
  return { groupStudents, addToGroup, removeFromGroup, ... };
}
```

**验证**：
- 新文件编译无错误
- 原页面功能正常

**回滚方式**：
- 删除 hooks 目录

---

### 阶段 5：提取组件

**创建文件**：
- `src/pages/arrange-class/components/TimeGrid.tsx`
- `src/pages/arrange-class/components/WeekSelector.tsx`
- `src/pages/arrange-class/components/ScheduleResults.tsx`
- `src/pages/arrange-class/components/BlockedTimesList.tsx`
- `src/pages/arrange-class/components/index.ts`

**迁移内容**：
```typescript
// TimeGrid.tsx
interface TimeGridProps {
  selectedWeek: number;
  selectedTimeSlots: Array<{...}>;
  timeGridStatus: Array<Array<{...}>>;
  onTimeSlotClick: (day: number, period: number) => void;
  // ...
}

export const TimeGrid: React.FC<TimeGridProps> = (props) => {
  // 从原 renderTimeGrid 函数迁移渲染逻辑
  return ( ... );
};

// ScheduleResults.tsx
interface ScheduleResultsProps {
  scheduleResults: ScheduleResult[];
  onDeleteSchedule: (result: any) => void;
  // ...
}

export const ScheduleResults: React.FC<ScheduleResultsProps> = (props) => {
  // 从原 renderScheduleResults 函数迁移渲染逻辑
  return ( ... );
};
```

**验证**：
- 新文件编译无错误
- 原页面功能正常

**回滚方式**：
- 删除 components 目录

---

### 阶段 6：创建新的主组件

**创建文件**：`src/pages/arrange-class/ArrangeClass.tsx`

**迁移内容**：
```typescript
// 从原文件迁移，使用新提取的模块
import { Class, ScheduledClassDisplay, StudentGroup } from './types';
import { WEEKDAYS, PERIOD_CONFIG, FACULTIES } from './constants';
import { useScheduleData } from './hooks/useScheduleData';
import { useTimeGrid } from './hooks/useTimeGrid';
import { useStudentGroup } from './hooks/useStudentGroup';
import { TimeGrid } from './components/TimeGrid';
import { ScheduleResults } from './components/ScheduleResults';
import { validateGroup } from './utils/validation';

export default function ArrangeClass() {
  const { loading, teachers, students, courses } = useScheduleData();
  const { selectedWeek, selectedTimeSlots, handleTimeSlotClick } = useTimeGrid();
  const { groupStudents, addToGroup, removeFromGroup } = useStudentGroup();
  
  // 主组件只保留状态协调逻辑
  
  return (
    <div className="...">
      <TimeGrid 
        selectedWeek={selectedWeek}
        selectedTimeSlots={selectedTimeSlots}
        onTimeSlotClick={handleTimeSlotClick}
      />
      <ScheduleResults 
        scheduleResults={scheduleResults}
        onDeleteSchedule={handleDeleteSchedule}
      />
    </div>
  );
}
```

**验证**：
- 新主组件编译无错误
- 原页面功能正常

**回滚方式**：
- 删除 ArrangeClass.tsx，继续使用原文件

---

### 阶段 7：切换入口

**创建文件**：`src/pages/arrange-class/index.tsx`

**内容**：
```typescript
// 方式一：静态导入
export { default } from './ArrangeClass';

// 方式二：懒加载（可选）
import { lazy, Suspense } from 'react';
const ArrangeClass = lazy(() => import('./ArrangeClass'));

export default function ArrangeClassPage() {
  return (
    <Suspense fallback={<div>加载中...</div>}>
      <ArrangeClass />
    </Suspense>
  );
}
```

**修改路由**：
```typescript
// src/App.tsx 或路由配置文件
// 原：import ArrangeClass from './pages/ArrangeClass';
// 改：import ArrangeClass from './pages/arrange-class';
```

**验证**：
- 页面路由正常
- 所有功能正常

**回滚方式**：
- 恢复路由配置中的导入路径

---

### 阶段 8：清理

**任务**：
1. 删除原 `ArrangeClass.tsx` 文件（或重命名为 `ArrangeClass.tsx.backup`）
2. 更新所有导入路径
3. 最终测试

**验证**：
- 所有页面功能正常
- 无编译错误
- 无运行时错误

---

## 四、每个阶段的验证清单

### 功能验证清单

| 功能 | 测试方法 | 预期结果 |
|-----|---------|---------|
| 页面加载 | 访问 /arrange-class | 页面正常显示 |
| 学生列表 | 查看主项/副项学生列表 | 数据正确显示 |
| 时间网格 | 点击选择时段 | 选择正常 |
| 批量选择 | 使用批量选择模式 | 自动填充正常 |
| 排课保存 | 选择时段后保存 | 排课成功 |
| 排课删除 | 删除排课记录 | 删除成功 |
| 禁排显示 | 查看禁排时段 | 显示正确 |
| 进度计算 | 查看学生进度 | 计算正确 |

### 编译验证

```bash
# 每个阶段运行
npm run build

# 预期：无错误，无警告
```

### 类型验证

```bash
# 每个阶段运行
npm run typecheck

# 预期：无类型错误
```

---

## 五、回滚方案

### 快速回滚

如果任何阶段出现问题：

1. **删除新创建的文件/目录**
2. **恢复路由导入路径**（如果已修改）
3. **原文件从未被修改，直接可用**

### 完整回滚步骤

```bash
# 1. 删除新目录
rm -rf src/pages/arrange-class/

# 2. 恢复路由配置（如果已修改）
git checkout src/App.tsx

# 3. 重新构建
npm run build
```

---

## 六、时间估算

| 阶段 | 预计时间 | 说明 |
|-----|---------|------|
| 阶段 0：准备 | 10分钟 | 创建目录结构 |
| 阶段 1：类型 | 15分钟 | 提取接口定义 |
| 阶段 2：常量 | 10分钟 | 提取常量 |
| 阶段 3：工具函数 | 30分钟 | 提取工具函数 |
| 阶段 4：Hooks | 60分钟 | 提取 Hooks |
| 阶段 5：组件 | 90分钟 | 提取组件 |
| 阶段 6：主组件 | 60分钟 | 重构主组件 |
| 阶段 7：切换入口 | 15分钟 | 修改路由 |
| 阶段 8：清理 | 15分钟 | 删除原文件 |
| **总计** | **约5小时** | 可分多次完成 |

---

## 七、注意事项

1. **不要跳过阶段** - 按顺序执行，确保每步都验证通过
2. **不要修改逻辑** - 只移动代码，不改变任何业务逻辑
3. **保持接口一致** - 函数签名、参数、返回值完全不变
4. **及时提交** - 每完成一个阶段，提交一次代码
5. **保留备份** - 原文件在阶段 8 之前不要删除

---

**文档版本**: 1.0.0  
**创建日期**: 2026-02-26
