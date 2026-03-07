# `major-class-schedule` 页面排课逻辑梳理（重要参考）

本文档总结 `http://localhost:5173/major-class-schedule`（实现文件 `src/pages/MajorClassSchedule_Simple.tsx`）当前的排课业务逻辑与数据流，覆盖：

- 课程列表与合班上课（多选）
- 时间网格选择（单选/批量/框选）
- 禁排（配置禁排 + 导入禁排 + 排课同步为禁排）
- 冲突检测（占用冲突/教师冲突等）
- 排课结果列表展示、编辑、删除
- 当前实现中的关键假设与已知局限（便于后续优化）

> 说明：本文档描述的是**当前代码的“实际行为”**，并不代表理想设计。代码会持续演进，建议每次大改后同步更新本文档。

---

## 1. 关键文件与组件

- **页面容器**：`src/pages/MajorClassSchedule_Simple.tsx`
- **课程列表**：`src/components/MajorClassSchedule/CourseList.tsx`
- **时间网格**：`src/components/MajorClassSchedule/TimeGrid.tsx`
- **排课结果列表**：`src/components/MajorClassSchedule/ScheduleResult.tsx`
- **通用工具函数**：`src/components/MajorClassSchedule/utils.ts`
- **类型**：`src/components/MajorClassSchedule/types.ts`
- **服务层**：`src/services/index.ts`（根据 `VITE_USE_DATABASE` 切换数据库/API与 localStorage 实现）

---

## 2. 数据模型（前端视角）

### 2.1 课程排课状态 `CourseScheduleStatus`

用于课程列表的“课程-班级组合”展示与选择，关键字段（见 `types.ts`）：

- **主键**：`id`（通常形如 `${course.id}_${classId}`）
- **关联**：`course_id`、`class_id`、`teacher_id`、`teacher_name`
- **状态**：`status`（`pending | in_progress | completed | ...`）
- **课时**：`total_hours`、`scheduled_hours`

> 注意：页面里“是否已完成/待排课”通常是通过检查是否存在该 `course_id + class_id` 的排课记录来推导。

### 2.2 排课记录 `scheduledClasses`

页面内维护的排课记录数组（`scheduledClasses` state）来源于：

- 页面初始化：`scheduleService.getAll()`
- 保存/删除后：再次 `scheduleService.getAll()` 刷新

排课记录字段（当前前端生成）：

- `course_id`、`class_id`、`room_id`
- `week_number`、`day_of_week`、`period`（注意：页面以“两节连排”方式展示/选择，实际会生成两条 period 记录）
- `status`：默认 `draft`
- `created_at`
- 额外：数据库模式下，保存时会带 `semester_label`（由本次修复引入）

---

## 3. 初始化与数据加载（页面入口）

在 `MajorClassSchedule_Simple.tsx` 的数据加载 `useEffect(fetchData)` 中会并发获取：

- `courseService.getAll()`
- `scheduleService.getAll()` → 设置到 `scheduledClasses`
- `roomService.getAll()`、`classService.getAll()`
- `blockedSlotService.getBySemester(selectedSemesterLabel)`
- `weekConfigService.getBySemester(selectedSemesterLabel)`（用于总周数/学期开始日期）
- `largeClassScheduleService.getEntries(selectedSemesterLabel)`

另外会从 localStorage 读取：

- `music_scheduler_imported_blocked_times`（Excel 导入的禁排）

然后过滤课程：**只取 `teaching_type === '专业大课'`** 生成 `courseScheduleStatuses`。

---

## 4. 课程列表逻辑（含合班上课）

对应组件：`CourseList.tsx`

### 4.1 单击行：设置“当前课程”

- 点击表格行触发 `onCourseSelect(courseStatus)`：
  - `currentCourse = courseStatus`
  - `selectedClass = courseStatus.class_id`
  - `selectedRoom` 会被清空（要求用户手动选择教室）

### 4.2 复选框：合班上课（多选）

- 每行都有 checkbox，切换会触发 `handleCourseToggle(courseStatus)`：
  - 维护 `selectedCourses: string[]`（存的是 `CourseScheduleStatus.id`）

**合班上课的语义**（当前实现）：

- 当 `selectedCourses.length > 1` 时，保存/排课会为每个被选中的 `CourseScheduleStatus` 生成排课记录（每个班级都生成一份，属于“同时间同教室多班级同时上课”的效果）。

> 注意：合班上课的“分组显示”主要体现在结果列表的分组与行展示上，底层仍是多条 `course_id + class_id + time` 记录。

---

## 5. 时间网格逻辑（两节连排 + 单选/批量 + 框选）

对应组件：`TimeGrid.tsx`

### 5.1 两节连排的展示模型

时间网格按“5个大节”渲染，每个大节代表两节课：

- 大节 1 → period 1-2
- 大节 2 → period 3-4
- ...
- 大节 5 → period 9-10

因此，一个格子被选择时，页面的 `selectedTimeSlots` 通常会包含两条记录（start/end 两个 period）。

### 5.2 选择模式

`selectionMode`：

- `single`：单选
- `batch`：批量选择（页面层会结合 `batchWeeks` 等参数生成多周选择）

> 目前批量选择的具体“生成多周 slot”实现既有页面层逻辑，也有 `utils.ts` 中的 `processBatchSelection`，存在重复/分叉实现的情况。

### 5.3 禁排判定（TimeGrid 内）

TimeGrid 内对“格子是否禁排”的判定来源比较复杂，主要包含：

1) **配置禁排**：`blockedSlots`（来自 `blockedSlotService.getBySemester`）
   - 会检查 `semester_label` 是否匹配
   - 支持 `recurring`（每周固定）与 `specific`（特定周/特定周+星期）两种
   - 支持按 `class_associations` 限定班级（字符串或对象两种格式）

2) **导入禁排**：`importedBlockedTimes`（来自 localStorage 的 excel 导入）
   - TimeGrid 会解析其中的 `weeks`、`day`、`periods` 等字段，决定是否禁排

3) **通识大课/其它占用**：`largeClassEntries`（用于显示/占用提示）

> 禁排逻辑的“数据源”分散在多个列表中（blockedSlots / importedBlockedTimes / largeClassEntries），并且各自字段结构不同，这是后续重构/统一数据模型的重点方向。

**禁排原因显示错误（已修复）**：若配置禁排使用“特定周次+星期”即 `specific_week_days`（如行政例会仅周三），后端可能同时存在 `week_number`。此前“全周禁排”分支在 `slot.week_number === selectedWeek` 时即成立，导致该周所有星期都被误判为禁排、禁排原因显示为“行政例会”的周次/节次错误。修复方式：仅当 `(!slot.specific_week_days || slot.specific_week_days.length === 0)` 时才走“全周禁排”逻辑，避免与“特定周次+星期”冲突。

---

## 6. 冲突检测逻辑

### 6.1 工具函数 `utils.ts` 中的冲突检测

`src/components/MajorClassSchedule/utils.ts` 提供：

- **时间占用冲突**：任意 `scheduledClasses` 中存在同 `week_number + day_of_week + period`
- **教师冲突**：同一教师在同时间段已有课（通过 `course.teacher_id` 比较）

注意：该实现返回的冲突类型 `type` 使用的是 `'time'`，教师冲突也归类为 `'time'`（消息不同）。

### 6.2 页面内冲突检测（`MajorClassSchedule_Simple.tsx`）

页面内也存在一套冲突检测（与 utils 中相似但更复杂的版本），特点包括：

- 会去重 `selectedTimeSlots`
- 会检查“新选择列表里是否重复”
- 在 `handleSaveSchedule` 中有“排除当前课程已有排课”的逻辑（避免编辑时把旧记录当冲突）

> 当前实现存在“工具函数冲突检测”和“页面内冲突检测”并存的情况。后续建议收敛为单一冲突检测入口，避免规则不一致。

---

## 7. 保存排课（两条入口）

页面目前有两条保存入口：

### 7.1 `handleSchedule`（课程列表区域的“排课/保存”）

流程概览：

- 前置：`currentCourse` 存在、`selectedTimeSlots` 非空
- 去重时间槽
- 冲突检测（如有冲突则中断）
- 生成 `newSchedules`
  - 单班：对当前 `course_id + class_id` 生成记录
  - 合班：对 `selectedCourses` 中每个 `CourseScheduleStatus` 生成记录
- **持久化**
  - **数据库模式（VITE_USE_DATABASE=true）**：先删旧记录（按 `course_id + class_id` 组合），再 `scheduleService.createMany(newSchedules)` 写入后端
  - **本地模式**：写入 localStorage key `music_scheduler_scheduled_classes`
- 清空选择、`scheduleService.getAll()` 刷新列表、弹成功提示

### 7.2 `handleSaveSchedule`（页面下方“当前排课信息”绿色块的“保存”）

流程更严格，额外包含：

- **必须选择教室**（`selectedRoom`）
- **课时校验**：按照奇数节次槽计数 \(\times 2\) 得到 `scheduledHours`，要求等于课程总学时（否则提示继续排或减少）
- 冲突检测（带“排除当前课程已有排课”的逻辑）
- 生成 `newSchedules`（合班/单班）
- **持久化**（同上：数据库模式写后端、本地模式写 localStorage）
- **把排课同步为“导入禁排”**：调用 `addScheduleToBlockedTimes(newSchedules, currentCourse)`（见下一节）
- 把 `courseScheduleStatuses` 中当前课程标为 `completed`
- `scheduleService.getAll()` 刷新、WebSocket 广播（`websocketService.sendCourseUpdate`）

---

## 8. 排课同步为禁排（核心机制）

目标：排完课后，把“该课程上课时间”写入 `importedBlockedTimes`，用于后续禁排判定/展示。

### 8.1 删除旧禁排：`removeScheduleFromBlockedTimes(courseId, classId)`

- 通过 `courseId` 找课程名，组合 reason：`{course_name}上课`
- 通过 `classId` 找到 `class_name`
- 在 `importedBlockedTimes` 中删除所有：
  - `item.class_name === className`
  - `item.reason === '{course_name}上课'`
- 更新 state + 写回 localStorage：`music_scheduler_imported_blocked_times`

### 8.2 添加禁排：`addScheduleToBlockedTimes(schedules, course)`

- 先调用 `removeScheduleFromBlockedTimes` 避免重复
- 按 `(className, day_of_week, reason)` 分组收集所有 `week_number` 与 `period`
  - 注意：这里的 key **不包含 period**，period 只是累积数组（同一天同原因合并）
- 生成新的禁排项：
  - `{ class_name, weeks: number[], day: number, periods: number[], reason }`
- 合并到 `importedBlockedTimes`（若同 `class_name + day + reason` 则合并 weeks/periods）
- 写回 localStorage

> 重要特性：同步禁排记录是写在 localStorage（导入禁排列表）里，即使数据库模式下保存排课，禁排同步仍是本地持久化。

---

## 9. 排课结果列表（展示/编辑/删除）

对应组件：`ScheduleResult.tsx`

### 9.1 展示分组逻辑

- 输入：`scheduledClasses`（来自页面 state，通常是 `scheduleService.getAll()` 结果）
- 以 `course_id + room_id + class_id` 作为分组 key
- 只展示满足以下条件的课程：
  - `courseInfo.course_type === '理论课'` **或** `courseInfo.teaching_type === '专业大课'`
- 在每个分组内，再按 `(day_of_week, period)` 聚合为 timeGroups，并将偶数 period 合并到前一个奇数 period 的显示中（两节连排）
- 显示字段：课程、教师、班级、人数、教室、合并后的排课时间、已排课时等

### 9.2 编辑逻辑（从结果列表点“编辑”）

页面处理函数：`handleEditGroup(group)`

- 根据 `group.schedules` 生成 `courseStatus` 并设置：
  - `currentCourse`、`selectedClass`、`selectedRoom`
  - `selectedTimeSlots`（根据原排课周次生成奇数+偶数 period 的 slots）
- 同时会从前端 state 中移除原排课记录（避免页面上仍显示旧结果）
- 最终用户在绿色块重新选择时间后，使用 `handleSaveSchedule` 保存覆盖

### 9.3 删除逻辑

删除按钮会逐条调用 `scheduleService.delete(schedule.id)`，然后重新 `scheduleService.getAll()` 刷新。

---

## 10. 批量选择与批量排课

### 10.1 批量选择（多周）

页面层维护：

- `batchWeeks: number[]`（默认 1..16）
- `selectionMode: 'single' | 'batch'`

TimeGrid 的批量选择会将多周的 slots 加入 `selectedTimeSlots`（并在禁排条件下跳过）。

### 10.2 批量排课 `handleBatchSchedule`

当前实现要点：

- 会把 `selectedTimeSlots` 扩展到 `batchWeeks` 覆盖的所有周次，再去重
- 冲突检测
- 生成 `newSchedules`
- **持久化：目前仍以 localStorage 合并保存为主**（`music_scheduler_scheduled_classes`），然后再 `scheduleService.getAll()` 刷新

> 注意：`handleBatchSchedule` 目前尚未完全收敛到数据库模式的“删旧 + 批量写后端”策略。若后续要完全数据库化，需要把此函数与 `handleSaveSchedule` 对齐。

---

## 11. 已知局限与后续优化方向（建议）

- **数据源混杂**：排课记录（DB）与禁排记录（localStorage）并存，字段结构不统一。
- **冲突检测多套逻辑并存**：`utils.ts` 与页面内都在做冲突检测，规则可能漂移。
- **批量排课未完全数据库化**：`handleBatchSchedule` 仍主要写 localStorage（待与数据库模式统一）。
- **合班的分组与编辑**：结果展示按 `course_id-room_id-class_id` 分行，若要“真正合班合并显示”需要额外的 group_id 或合班标识（后端模型已有 `group_id` 字段可利用）。
- **禁排合并粒度**：`addScheduleToBlockedTimes` 以 `(class, day, reason)` 合并，会把同一天不同节次放在同一条记录的 `periods` 数组里；若需要区分不同节次组合（例如 3-4 与 9-10 分开），需要调整 key 包含 period 范围。

---

## 12. 关键 localStorage keys（当前页面会读写）

- `music_scheduler_imported_blocked_times`：导入禁排 + 排课同步禁排的“统一存储”
- `music_scheduler_scheduled_classes`：仅本地模式或历史逻辑中用于存储排课（数据库模式下应逐步弃用）

