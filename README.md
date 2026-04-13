# Take a Break - 别工作啦

> AI 驱动的坐姿守护 & 健康提醒工具，用摄像头实时监测你的坐姿，帮你告别驼背、久坐和忘记喝水。

[在线体验](https://jazzy-flan-09ae5c.netlify.app/) | [GitHub](https://github.com/EricGeng123/take-a-break)

---

## 功能亮点

### 实时姿态监测
- 基于 MediaPipe Pose AI 模型，通过前置摄像头实时分析坐姿
- 针对前置摄像头专门优化的检测算法，只关注垂直方向变化（驼背），忽略正常的左右转头
- 开始监测时自动校准你的"标准坐姿"，后续评分基于你自己的基准
- EMA 平滑算法消除分数抖动，评分稳定可靠

### 智能提醒系统
- **渐进式驼背提醒**：短暂动一下不打扰，持续驼背才逐步升级提醒（视觉 → 弹窗 → 声音+通知）
- **久坐提醒**：连续坐 45 分钟自动提醒你起身活动
- **喝水提醒**：45 分钟没喝水就提醒你补充水分
- 所有提醒间隔均可自定义

### 数据统计
- 近 7 天姿态评分趋势图
- 每日姿态分布（良好/一般/较差）
- 每日监测时长统计

### 游戏化成长
- XP 经验值系统：坐姿好就能积累经验
- 10 级进化体系：从小虾米进化到王者
- 9 个成就解锁

### 隐私优先
- 100% 本地运行，所有 AI 推理在浏览器端完成
- 不上传任何摄像头画面
- 数据存储在浏览器 localStorage

---

## 快速开始

### 在线使用
直接访问：[https://jazzy-flan-09ae5c.netlify.app/](https://jazzy-flan-09ae5c.netlify.app/)

### 本地运行
```bash
# 克隆项目
git clone https://github.com/EricGeng123/take-a-break.git
cd take-a-break

# 启动本地服务器（任选一种）
npx serve .
# 或
python3 -m http.server 8000
```
然后打开浏览器访问 `http://localhost:8000`

---

## 技术栈

| 技术 | 用途 |
|------|------|
| [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) | 人体姿态检测（33个关键点） |
| [Chart.js](https://www.chartjs.org/) | 数据可视化图表 |
| Vanilla JS | 零框架，轻量快速 |
| Web Audio API | 提醒音效 |
| Notification API | 浏览器原生通知 |
| localStorage | 本地数据持久化 |

---

## 检测算法说明

本项目针对 **前置摄像头** 场景专门设计了检测算法：

- **核心指标**：耳-肩垂直距离、鼻-肩垂直距离、肩-臀垂直距离（全部只看 Y 轴）
- **忽略水平移动**：左右转头不会误触发扣分
- **校准基线**：开始时采集 45 帧取中位数建立个人基准
- **EMA 平滑**：指数移动平均消除逐帧抖动（alpha=0.1）
- **尺度无关**：所有距离按肩宽归一化，远近摄像头不影响

---

## 项目结构

```
take-a-break/
  index.html    # 主页面
  style.css     # 样式（深色主题）
  app.js        # 全部逻辑（检测、评分、提醒、统计、游戏化）
```

---

## 许可证

[MIT License](LICENSE)

---

Built with AI by [EricGeng123](https://github.com/EricGeng123)
