---
name: push-on-done
description: When the user confirms that modifications are complete (完成修改, 修改完成, 确认修改, 推送到仓库, push, 推送), stages all changes, commits, and pushes to origin (yinyueximanage). Use only after the user explicitly signals that edits are done and they want to push.
---

# 完成修改后自动推送

## 触发场景

用户明确表示修改已完成并要推送时执行，例如：
- 「完成修改」「修改完成」「确认修改」
- 「推送到仓库」「推送」「push」
- 「保存并推送」「提交并推送」

## 执行步骤

1. **确认工作区**：`git status` 查看是否有未提交变更；若无变更，告知用户并结束。

2. **暂存并提交**：
   - 执行：`git add .`
   - 提交：`git commit -m "<消息>"`
   - 若用户已给出提交说明，直接使用；否则根据本次对话中的修改内容生成简短中文说明（如「fix: 修复排课周选择逻辑」「feat: 教学日历接口对接」）。

3. **推送**：
   - 执行：`git push origin $(git rev-parse --abbrev-ref HEAD)`
   - 若推送失败（如冲突、网络、权限），把错误信息原样告知用户并给出处理建议。

## 约定

- 仓库远程为 `origin`，对应 GitHub：`xygood/yinyueximanage`。
- 只推当前分支，不执行 `git pull` 或切换分支。
- 用户未明确说「完成修改」「推送」等时，不要主动执行推送。
