// ============================================================
// PostureGuard - AI 姿态守护
// ============================================================

// --- Constants ---
const EVOLUTION_STAGES = [
    { level: 1, emoji: '🦐', name: '小虾米', title: '姿态新手', xpNeeded: 100 },
    { level: 2, emoji: '🍤', name: '虾仁', title: '初学端正', xpNeeded: 300 },
    { level: 3, emoji: '🐟', name: '小鱼', title: '姿态学徒', xpNeeded: 600 },
    { level: 4, emoji: '🐠', name: '热带鱼', title: '坐姿达人', xpNeeded: 1000 },
    { level: 5, emoji: '🐡', name: '河豚', title: '体态专家', xpNeeded: 1500 },
    { level: 6, emoji: '🦈', name: '小鲨鱼', title: '姿态高手', xpNeeded: 2200 },
    { level: 7, emoji: '🐬', name: '海豚', title: '优雅使者', xpNeeded: 3000 },
    { level: 8, emoji: '🐋', name: '蓝鲸', title: '体态大师', xpNeeded: 4000 },
    { level: 9, emoji: '🐉', name: '神龙', title: '姿态传奇', xpNeeded: 5500 },
    { level: 10, emoji: '👑', name: '王者', title: '完美体态', xpNeeded: Infinity },
];

const ACHIEVEMENTS = [
    { id: 'first_session', icon: '🎯', name: '初次启动', desc: '完成第一次监测' },
    { id: 'hour_1', icon: '⏰', name: '一小时挑战', desc: '累计监测1小时' },
    { id: 'hour_10', icon: '🕐', name: '十小时坚持', desc: '累计监测10小时' },
    { id: 'perfect_5min', icon: '💎', name: '完美五分钟', desc: '连续5分钟满分' },
    { id: 'streak_3', icon: '🔥', name: '三日连胜', desc: '连续3天使用' },
    { id: 'streak_7', icon: '🏆', name: '周冠军', desc: '连续7天使用' },
    { id: 'alerts_0', icon: '🧘', name: '零提醒大师', desc: '一次会话0次提醒（>10min）' },
    { id: 'level_5', icon: '⭐', name: '半程达人', desc: '达到等级5' },
    { id: 'level_10', icon: '👑', name: '最终进化', desc: '达到等级10' },
];

// --- State ---
let state = {
    isMonitoring: false,
    score: 0,
    displayedScore: -1, // last score shown on screen (for jitter prevention)
    sessionStartTime: null,
    sessionGoodFrames: 0,
    sessionTotalFrames: 0,
    sessionAlerts: 0,
    sessionXP: 0,
    badPostureStartTime: null,
    lastAlertTime: 0,
    alertLevel: 0,         // 0=none, 1=visual, 2=toast, 3=sound+notification
    consecutivePerfectTime: 0,
    lastScoreTime: 0,
    justCorrected: false,  // did user just fix posture after alert?
};

// --- Storage ---
function loadData() {
    const defaults = {
        totalXP: 0,
        level: 1,
        sessions: [],
        achievements: [],
        dailyScores: {},
        settings: {
            sensitivity: 5,
            alertDelay: 20,
            sitInterval: 45,
            waterInterval: 45,
            notifications: true,
            sound: true,
        },
        lastActiveDate: null,
        streak: 0,
    };
    try {
        const saved = JSON.parse(localStorage.getItem('postureGuard') || '{}');
        return { ...defaults, ...saved, settings: { ...defaults.settings, ...(saved.settings || {}) } };
    } catch {
        return defaults;
    }
}

function saveData(data) {
    localStorage.setItem('postureGuard', JSON.stringify(data));
}

let appData = loadData();

// --- DOM Refs ---
const $ = (sel) => document.querySelector(sel);
const webcam = $('#webcam');
const poseCanvas = $('#pose-canvas');
const ctx = poseCanvas.getContext('2d');
const btnStart = $('#btn-start');
const btnStop = $('#btn-stop');
const placeholder = $('#camera-placeholder');
const scoreNumber = $('#score-number');
const scoreRingFill = $('#score-ring-fill');
const postureStatus = $('#posture-status');
const sessionTimeEl = $('#session-time');
const sessionGoodEl = $('#session-good');
const sessionAlertsEl = $('#session-alerts');
const sessionXPEl = $('#session-xp-value');
const toast = $('#toast');

// --- Tab Navigation ---
document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        $(`#tab-${tab.dataset.tab}`).classList.add('active');
        if (tab.dataset.tab === 'stats') updateStatsUI();
        if (tab.dataset.tab === 'game') updateGameUI();
    });
});

// --- Posture Detection using MediaPipe ---
let poseLandmarker = null;
let animationFrameId = null;

// CDN sources with fallbacks (jsdelivr -> unpkg -> cdnjs)
const MEDIAPIPE_CDN_LIST = [
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18',
    'https://unpkg.com/@mediapipe/tasks-vision@0.10.18',
];

const MODEL_URL_LIST = [
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    'https://cdn.jsdelivr.net/gh/nicehash/mediapipe-models@main/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
];

async function tryImport(cdnBase) {
    return await import(cdnBase + '/vision_bundle.mjs');
}

async function initPoseDetection() {
    let visionModule = null;
    let usedCdn = null;

    // Try each CDN for the MediaPipe module
    for (const cdn of MEDIAPIPE_CDN_LIST) {
        try {
            visionModule = await tryImport(cdn);
            usedCdn = cdn;
            break;
        } catch (e) {
            console.warn('CDN failed:', cdn, e.message);
        }
    }

    if (!visionModule) {
        throw new Error('无法加载 AI 模型库，请检查网络连接。如果你在国内，可能需要使用 VPN。');
    }

    const { PoseLandmarker, FilesetResolver, DrawingUtils } = visionModule;

    const filesetResolver = await FilesetResolver.forVisionTasks(
        usedCdn + '/wasm'
    );

    // Try each model URL
    let lastError = null;
    for (const modelUrl of MODEL_URL_LIST) {
        try {
            poseLandmarker = await PoseLandmarker.createFromOptions(filesetResolver, {
                baseOptions: {
                    modelAssetPath: modelUrl,
                    delegate: 'GPU',
                },
                runningMode: 'VIDEO',
                numPoses: 1,
            });
            break;
        } catch (e) {
            console.warn('Model URL failed:', modelUrl, e.message);
            lastError = e;
        }
    }

    if (!poseLandmarker) {
        throw new Error('无法加载姿态检测模型。如果你在国内，storage.googleapis.com 可能被屏蔽，请尝试使用 VPN。');
    }

    window._drawingUtils = DrawingUtils;
    window._PoseLandmarker = PoseLandmarker;
}

// ============================================================
// Posture Score Calculation — designed for FRONT-FACING webcam
// ============================================================
//
// Key insight: a front-facing camera CANNOT see forward/backward lean
// directly. Instead, slouching shows up as:
//   1. Head drops DOWN → ear-to-shoulder Y gap shrinks
//   2. Nose drops DOWN → nose-to-shoulder Y gap shrinks
//   3. Shoulders RISE (relative to head) → same effect
//
// What should NOT affect score:
//   - Turning head left/right (normal movement)
//   - Leaning slightly to talk to someone
//
// So we focus almost entirely on VERTICAL (Y-axis) changes
// and IGNORE horizontal (X-axis) movement.
// ============================================================

// -- Smoothing: Exponential Moving Average --
let emaScore = null;
const EMA_ALPHA = 0.1;  // lower = smoother, more stable

// -- Calibration --
let calibration = { samples: [], baseline: null, isCalibrating: true };

function median(arr) {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function calibrateBaseline(metrics) {
    calibration.samples.push(metrics);
    if (calibration.samples.length >= 45) {
        const med = (key) => median(calibration.samples.map(m => m[key]));
        calibration.baseline = {
            earShoulderY: med('earShoulderY'),     // primary: vertical gap ear↔shoulder
            noseShoulderY: med('noseShoulderY'),   // secondary: vertical gap nose↔shoulder
            shoulderHipY: med('shoulderHipY'),     // tertiary: vertical gap shoulder↔hip
        };
        calibration.isCalibrating = false;
    }
}

function extractPostureMetrics(landmarks) {
    const lm = landmarks[0];

    const nose           = lm[0];
    const leftEar        = lm[7];
    const rightEar       = lm[8];
    const leftShoulder   = lm[11];
    const rightShoulder  = lm[12];
    const leftHip        = lm[23];
    const rightHip       = lm[24];

    if (!nose || !leftShoulder || !rightShoulder || !leftEar || !rightEar) return null;

    const shoulderMidY = (leftShoulder.y + rightShoulder.y) / 2;
    const earMidY      = (leftEar.y + rightEar.y) / 2;
    const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x) || 0.01;

    // ---- All metrics are VERTICAL only, normalized by shoulder width ----

    // 1. Ear-to-Shoulder vertical distance (normalized)
    //    This is the #1 indicator of slouching from a front camera.
    //    Slouching → head drops → this value DECREASES
    const earShoulderY = (shoulderMidY - earMidY) / shoulderWidth;

    // 2. Nose-to-Shoulder vertical distance (normalized)
    //    Similar to above but nose drops even more dramatically when slouching
    const noseShoulderY = (shoulderMidY - nose.y) / shoulderWidth;

    // 3. Shoulder-to-Hip vertical distance (if hips visible)
    //    When you hunch, your torso compresses → this distance shrinks
    let shoulderHipY = 0;
    if (leftHip && rightHip) {
        const hipMidY = (leftHip.y + rightHip.y) / 2;
        shoulderHipY = (hipMidY - shoulderMidY) / shoulderWidth;
    }

    // 4. Shoulder tilt (left vs right Y difference, normalized)
    //    Only penalize significant asymmetry, not minor head turns
    const shoulderTilt = Math.abs(leftShoulder.y - rightShoulder.y) / shoulderWidth;

    return { earShoulderY, noseShoulderY, shoulderHipY, shoulderTilt, shoulderWidth };
}

function calculatePostureScore(landmarks) {
    if (!landmarks || landmarks.length === 0) return null;

    const metrics = extractPostureMetrics(landmarks);
    if (!metrics) return null;

    if (calibration.isCalibrating) {
        calibrateBaseline(metrics);
        return null;
    }

    const base = calibration.baseline;
    const sens = appData.settings.sensitivity;
    const sensMultiplier = 0.5 + (sens / 10) * 1.0; // 1→0.6, 5→1.0, 10→1.5

    let score = 100;

    // ---- PRIMARY: Head drop (ear-shoulder Y gap shrinking) ----
    // This catches the "shrimp posture" — head sinking toward shoulders
    // A 10% drop from baseline = noticeable slouch
    // A 25%+ drop = severe slouch
    const earDrop = (base.earShoulderY - metrics.earShoulderY) / (base.earShoulderY || 0.01);
    // earDrop > 0 means head has dropped. earDrop of 0.1 = 10% drop from baseline
    if (earDrop > 0.03) { // 3% deadzone for natural micro-movement
        // Progressive penalty: mild → steep
        const penalty = (earDrop - 0.03);
        score -= penalty * 250 * sensMultiplier;
    }

    // ---- SECONDARY: Nose drop (nose-shoulder Y gap shrinking) ----
    // Catches chin-tuck and forward head drop that ear metric might miss
    const noseDrop = (base.noseShoulderY - metrics.noseShoulderY) / (base.noseShoulderY || 0.01);
    if (noseDrop > 0.04) {
        score -= (noseDrop - 0.04) * 150 * sensMultiplier;
    }

    // ---- TERTIARY: Torso compression (shoulder-hip gap shrinking) ----
    // When you hunch forward, your upper body compresses
    if (base.shoulderHipY > 0 && metrics.shoulderHipY > 0) {
        const torsoCompress = (base.shoulderHipY - metrics.shoulderHipY) / (base.shoulderHipY || 0.01);
        if (torsoCompress > 0.05) {
            score -= (torsoCompress - 0.05) * 100 * sensMultiplier;
        }
    }

    // ---- MINOR: Shoulder tilt ----
    // Only penalize large persistent tilts (> 15% of shoulder width)
    if (metrics.shoulderTilt > 0.15) {
        score -= (metrics.shoulderTilt - 0.15) * 40 * sensMultiplier;
    }

    // NOTE: We intentionally do NOT penalize:
    // - Head turning left/right (X-axis movement)
    // - Brief movements (handled by EMA smoothing)
    // - Leaning to one side briefly

    const rawScore = Math.round(Math.max(0, Math.min(100, score)));

    // --- EMA Smoothing ---
    if (emaScore === null) {
        emaScore = rawScore;
    } else {
        emaScore = EMA_ALPHA * rawScore + (1 - EMA_ALPHA) * emaScore;
    }

    return Math.round(emaScore);
}

// --- Drawing ---
function drawPose(landmarks) {
    ctx.clearRect(0, 0, poseCanvas.width, poseCanvas.height);
    if (!landmarks || landmarks.length === 0) return;

    const PoseLandmarker = window._PoseLandmarker;
    const DrawingUtils = window._drawingUtils;
    if (!DrawingUtils || !PoseLandmarker) return;

    const drawingUtils = new DrawingUtils(ctx);
    for (const landmark of landmarks) {
        drawingUtils.drawLandmarks(landmark, {
            radius: 3,
            color: '#6C5CE7',
            fillColor: '#A29BFE',
        });
        drawingUtils.drawConnectors(landmark, PoseLandmarker.POSE_CONNECTIONS, {
            color: '#6C5CE744',
            lineWidth: 2,
        });
    }
}

// --- Detection Loop ---
let lastVideoTime = -1;

function detectLoop() {
    if (!state.isMonitoring || !poseLandmarker) return;

    if (webcam.readyState >= 2) {
        poseCanvas.width = webcam.videoWidth;
        poseCanvas.height = webcam.videoHeight;

        const now = performance.now();
        if (webcam.currentTime !== lastVideoTime) {
            lastVideoTime = webcam.currentTime;
            const result = poseLandmarker.detectForVideo(webcam, now);

            if (result.landmarks && result.landmarks.length > 0) {
                drawPose(result.landmarks);

                // During calibration, show progress
                if (calibration.isCalibrating) {
                    const progress = Math.min(100, Math.round(calibration.samples.length / 45 * 100));
                    scoreNumber.textContent = '...';
                    postureStatus.querySelector('.status-text').textContent =
                        `校准中...请保持端正坐姿 (${progress}%)`;
                    postureStatus.className = 'posture-status status-idle';
                    // Still call to collect calibration data
                    calculatePostureScore(result.landmarks);
                } else {
                    const score = calculatePostureScore(result.landmarks);
                    if (score !== null) {
                        updateScore(score);
                    }
                }
            }
        }
    }

    animationFrameId = requestAnimationFrame(detectLoop);
}

// --- Score Display & Alert System ---
// Design based on UX research: progressive escalation to prevent alert fatigue
// Reference: NN/g alert fatigue studies, Smashing Magazine notification UX

// Alert escalation thresholds (seconds of continuous bad posture)
// GENTLE_TOAST uses user's setting; others are relative to it
function getAlertThresholds() {
    const toastDelay = appData.settings.alertDelay || 20;
    return {
        VISUAL_ONLY: 5,                       // Just UI color change (no interruption)
        GENTLE_TOAST: toastDelay,             // Show a toast (user configurable)
        FULL_ALERT: toastDelay + 25,          // Toast + sound + browser notification
        REPEAT_INTERVAL: 90,                  // Repeat full alert every N seconds
    };
}

function updateScore(score) {
    state.score = score;
    state.sessionTotalFrames++;

    const isGood = score >= 60;
    if (isGood) {
        state.sessionGoodFrames++;
    }

    // --- Jitter Prevention: only update display when change is meaningful ---
    const shouldUpdateDisplay = state.displayedScore < 0
        || Math.abs(score - state.displayedScore) >= 2;

    if (shouldUpdateDisplay) {
        state.displayedScore = score;
        scoreNumber.textContent = score;

        // Ring fill
        const circumference = 534;
        const offset = circumference - (score / 100) * circumference;
        scoreRingFill.style.strokeDashoffset = offset;

        // Ring color (smooth transitions via CSS)
        if (score >= 70) {
            scoreRingFill.style.stroke = 'var(--success)';
        } else if (score >= 40) {
            scoreRingFill.style.stroke = 'var(--warning)';
        } else {
            scoreRingFill.style.stroke = 'var(--danger)';
        }
    }

    // --- Status text (less frequent updates) ---
    const now = Date.now();
    if (isGood) {
        // Check if user just corrected after being warned
        if (state.alertLevel > 0 && state.badPostureStartTime) {
            state.justCorrected = true;
            showToast('👍', '坐姿已纠正！', '继续保持', 'success');
        }
        postureStatus.className = 'posture-status status-good';
        postureStatus.querySelector('.status-text').textContent = '姿态良好';
        state.badPostureStartTime = null;
        state.alertLevel = 0;

        // Track consecutive good time for achievement
        if (score >= 90) {
            if (!state.lastScoreTime) state.lastScoreTime = now;
            state.consecutivePerfectTime += (now - state.lastScoreTime) / 1000;
        } else {
            state.consecutivePerfectTime = 0;
        }
    } else {
        // --- Progressive Alert Escalation ---
        if (!state.badPostureStartTime) {
            state.badPostureStartTime = now;
            state.alertLevel = 0;
        }
        state.justCorrected = false;

        const badDuration = (now - state.badPostureStartTime) / 1000;

        if (badDuration < getAlertThresholds().VISUAL_ONLY) {
            // Brief dip — just show yellow status, no alarm
            postureStatus.className = 'posture-status status-bad';
            postureStatus.querySelector('.status-text').textContent = '注意坐姿';
        } else if (badDuration < getAlertThresholds().GENTLE_TOAST) {
            // Level 1: sustained bad posture — visual warning
            postureStatus.className = 'posture-status status-bad';
            postureStatus.querySelector('.status-text').textContent = '请调整坐姿';
            if (state.alertLevel < 1) {
                state.alertLevel = 1;
            }
        } else if (badDuration < getAlertThresholds().FULL_ALERT) {
            // Level 2: prolonged bad posture — gentle toast (once)
            postureStatus.querySelector('.status-text').textContent =
                `已驼背 ${Math.floor(badDuration)}秒`;
            if (state.alertLevel < 2) {
                state.alertLevel = 2;
                triggerAlert('gentle');
            }
        } else {
            // Level 3: severe — full alert with sound & notification
            postureStatus.querySelector('.status-text').textContent =
                `已驼背 ${Math.floor(badDuration)}秒`;
            if (state.alertLevel < 3) {
                state.alertLevel = 3;
                triggerAlert('full');
            }
            // Repeat full alert at intervals (but not too often)
            if (now - state.lastAlertTime > getAlertThresholds().REPEAT_INTERVAL * 1000) {
                triggerAlert('full');
            }
        }
        state.consecutivePerfectTime = 0;
    }
    state.lastScoreTime = now;

    // XP: earn 1 XP per ~2 seconds of good posture
    if (isGood && state.sessionTotalFrames % 60 === 0) {
        state.sessionXP++;
        sessionXPEl.textContent = `+${state.sessionXP} XP`;
    }

    // Update session time display (once per second is enough)
    if (state.sessionStartTime && state.sessionTotalFrames % 30 === 0) {
        const elapsed = Math.floor((now - state.sessionStartTime) / 1000);
        const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const secs = (elapsed % 60).toString().padStart(2, '0');
        sessionTimeEl.textContent = `${mins}:${secs}`;
    }

    const goodPct = state.sessionTotalFrames > 0
        ? Math.round((state.sessionGoodFrames / state.sessionTotalFrames) * 100)
        : 0;
    sessionGoodEl.textContent = `${goodPct}%`;
    sessionAlertsEl.textContent = state.sessionAlerts;

    // Record score for daily stats (sampled)
    recordDailyScore(score);

    // Check achievements
    checkAchievements();
}

function showToast(icon, title, message, type) {
    const toastIcon = toast.querySelector('.toast-icon');
    const toastTitle = toast.querySelector('.toast-text strong');
    const toastMsg = toast.querySelector('.toast-text p');
    toastIcon.textContent = icon;
    toastTitle.textContent = title;
    toastMsg.textContent = message;

    // Style by type
    const toastContent = toast.querySelector('.toast-content');
    toastContent.style.background = type === 'success' ? 'var(--success)' : 'var(--danger)';

    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3500);
}

function triggerAlert(level) {
    state.lastAlertTime = Date.now();
    const badSecs = state.badPostureStartTime
        ? Math.floor((Date.now() - state.badPostureStartTime) / 1000) : 0;

    if (level === 'gentle') {
        // Gentle toast — no sound, no browser notification
        showToast('🦐', '注意姿态', '你已经驼背一会儿了，调整一下吧', 'warning');
        state.sessionAlerts++;
    } else if (level === 'full') {
        // Full alert — toast + sound + notification
        showToast('⚠️', '驼背提醒！',
            `你已连续驼背 ${badSecs} 秒，请立即调整坐姿`, 'warning');
        state.sessionAlerts++;

        if (appData.settings.sound) {
            playAlertSound();
        }

        if (appData.settings.notifications && Notification.permission === 'granted') {
            new Notification('PostureGuard - 驼背提醒', {
                body: `你已连续驼背 ${badSecs} 秒，请调整坐姿！`,
                icon: '🦐',
                silent: true,
            });
        }
    }
}

function playAlertSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        // Two-tone gentle chime (not harsh beep)
        [500, 400].forEach((freq, i) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.2, audioCtx.currentTime + i * 0.2);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + i * 0.2 + 0.3);
            osc.start(audioCtx.currentTime + i * 0.2);
            osc.stop(audioCtx.currentTime + i * 0.2 + 0.3);
        });
    } catch (e) {
        // Audio not supported
    }
}

// --- Daily Score Recording ---
function recordDailyScore(score) {
    const today = new Date().toISOString().split('T')[0];
    if (!appData.dailyScores[today]) {
        appData.dailyScores[today] = { scores: [], totalTime: 0 };
    }
    // Sample: only record every 30th frame to save space
    if (state.sessionTotalFrames % 30 === 0) {
        appData.dailyScores[today].scores.push(score);
    }
}

// --- Session Management ---
async function startMonitoring() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: 640, height: 480 },
        });
        webcam.srcObject = stream;
        await webcam.play();

        placeholder.classList.add('hidden');
        btnStart.style.display = 'none';
        btnStop.style.display = '';

        // Init pose detection if not done
        if (!poseLandmarker) {
            scoreNumber.textContent = '...';
            postureStatus.querySelector('.status-text').textContent = 'AI 模型加载中...';
            await initPoseDetection();
        }

        // Request notification permission
        if (appData.settings.notifications && Notification.permission === 'default') {
            await Notification.requestPermission();
        }

        // Reset calibration, smoothing, and session state
        calibration = { samples: [], baseline: null, isCalibrating: true };
        emaScore = null;
        state.isMonitoring = true;
        state.displayedScore = -1;
        state.alertLevel = 0;
        state.justCorrected = false;
        state.sessionStartTime = Date.now();
        state.sessionGoodFrames = 0;
        state.sessionTotalFrames = 0;
        state.sessionAlerts = 0;
        state.sessionXP = 0;
        state.badPostureStartTime = null;
        state.consecutivePerfectTime = 0;
        lastVideoTime = -1;

        postureStatus.className = 'posture-status status-good';
        postureStatus.querySelector('.status-text').textContent = '检测中...';

        startWellnessTimers();
        detectLoop();
    } catch (err) {
        console.error('Start monitoring error:', err);
        // Show friendly error in the UI instead of just alert
        const msg = err.message || String(err);
        if (msg.includes('getUserMedia') || msg.includes('Permission') || msg.includes('NotAllowed')) {
            alert('无法访问摄像头，请允许摄像头权限后重试。');
        } else if (msg.includes('无法加载')) {
            alert(msg);
        } else {
            alert('启动失败: ' + msg + '\n\n提示：如果你在国内，AI模型可能需要科学上网才能加载。');
        }
        // Reset UI
        btnStart.style.display = '';
        btnStop.style.display = 'none';
        placeholder.classList.remove('hidden');
        scoreNumber.textContent = '--';
        postureStatus.className = 'posture-status status-idle';
        postureStatus.querySelector('.status-text').textContent = '等待开始';
    }
}

function stopMonitoring() {
    state.isMonitoring = false;
    stopWellnessTimers();

    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    // Stop camera
    if (webcam.srcObject) {
        webcam.srcObject.getTracks().forEach(t => t.stop());
        webcam.srcObject = null;
    }

    placeholder.classList.remove('hidden');
    btnStart.style.display = '';
    btnStop.style.display = 'none';

    // Save session
    const sessionDuration = state.sessionStartTime
        ? Math.floor((Date.now() - state.sessionStartTime) / 1000)
        : 0;

    if (sessionDuration > 5) {
        const goodPct = state.sessionTotalFrames > 0
            ? Math.round((state.sessionGoodFrames / state.sessionTotalFrames) * 100)
            : 0;

        const session = {
            date: new Date().toISOString(),
            duration: sessionDuration,
            goodPercent: goodPct,
            alerts: state.sessionAlerts,
            avgScore: state.score,
            xpEarned: state.sessionXP,
        };

        appData.sessions.push(session);
        appData.totalXP += state.sessionXP;

        // Update daily time
        const today = new Date().toISOString().split('T')[0];
        if (appData.dailyScores[today]) {
            appData.dailyScores[today].totalTime += sessionDuration;
        }

        // Update streak
        updateStreak();

        // Level up check
        updateLevel();

        saveData(appData);
    }

    // Reset display
    postureStatus.className = 'posture-status status-idle';
    postureStatus.querySelector('.status-text').textContent = '等待开始';
    ctx.clearRect(0, 0, poseCanvas.width, poseCanvas.height);
}

btnStart.addEventListener('click', startMonitoring);
btnStop.addEventListener('click', stopMonitoring);

// --- Gamification ---
function updateLevel() {
    let newLevel = 1;
    for (let i = EVOLUTION_STAGES.length - 1; i >= 0; i--) {
        if (appData.totalXP >= EVOLUTION_STAGES[i].xpNeeded) {
            newLevel = EVOLUTION_STAGES[i].level + 1;
            break;
        }
        if (i === 0 && appData.totalXP < EVOLUTION_STAGES[0].xpNeeded) {
            newLevel = 1;
        }
    }
    // Find the correct level based on accumulated XP thresholds
    newLevel = 1;
    for (const stage of EVOLUTION_STAGES) {
        if (appData.totalXP >= stage.xpNeeded) {
            newLevel = stage.level + 1;
        } else {
            break;
        }
    }
    newLevel = Math.min(newLevel, 10);
    appData.level = newLevel;
}

function updateStreak() {
    const today = new Date().toISOString().split('T')[0];
    if (appData.lastActiveDate) {
        const lastDate = new Date(appData.lastActiveDate);
        const todayDate = new Date(today);
        const diffDays = Math.floor((todayDate - lastDate) / 86400000);
        if (diffDays === 1) {
            appData.streak++;
        } else if (diffDays > 1) {
            appData.streak = 1;
        }
    } else {
        appData.streak = 1;
    }
    appData.lastActiveDate = today;
}

function updateGameUI() {
    const level = appData.level;
    const stage = EVOLUTION_STAGES[level - 1];

    $('#shrimp-avatar .shrimp-emoji').textContent = stage.emoji;
    $('#shrimp-name').textContent = stage.name;
    $('#shrimp-title').textContent = stage.title;
    $('#level-badge').textContent = `Lv.${level}`;

    // XP bar
    const prevXP = level > 1 ? EVOLUTION_STAGES[level - 2].xpNeeded : 0;
    const nextXP = stage.xpNeeded;
    const currentLevelXP = appData.totalXP - prevXP;
    const neededXP = nextXP - prevXP;
    const pct = nextXP === Infinity ? 100 : Math.min(100, (currentLevelXP / neededXP) * 100);

    $('#xp-bar-fill').style.width = `${pct}%`;
    $('#xp-current').textContent = appData.totalXP;
    $('#xp-needed').textContent = nextXP === Infinity ? 'MAX' : nextXP;

    // Evolution stages
    const stagesEl = $('#evolution-stages');
    stagesEl.innerHTML = EVOLUTION_STAGES.map(s => {
        const cls = s.level < level ? 'unlocked' : s.level === level ? 'current' : '';
        return `<div class="evo-stage ${cls}">
            <span class="evo-emoji">${s.emoji}</span>
            <span class="evo-label">Lv.${s.level} ${s.name}</span>
        </div>`;
    }).join('');

    // Achievements
    const achieveEl = $('#achievement-grid');
    achieveEl.innerHTML = ACHIEVEMENTS.map(a => {
        const earned = appData.achievements.includes(a.id);
        return `<div class="achievement-card ${earned ? 'earned' : ''}">
            <span class="achievement-icon">${a.icon}</span>
            <div class="achievement-info">
                <div class="achievement-name">${a.name}</div>
                <div class="achievement-desc">${a.desc}</div>
            </div>
        </div>`;
    }).join('');
}

function checkAchievements() {
    const earned = appData.achievements;
    const totalTimeSec = appData.sessions.reduce((s, sess) => s + sess.duration, 0);
    const sessionTimeSec = state.sessionStartTime ? (Date.now() - state.sessionStartTime) / 1000 : 0;

    function earn(id) {
        if (!earned.includes(id)) {
            earned.push(id);
            appData.achievements = earned;
        }
    }

    if (appData.sessions.length >= 1 || state.sessionTotalFrames > 0) earn('first_session');
    if (totalTimeSec + sessionTimeSec >= 3600) earn('hour_1');
    if (totalTimeSec + sessionTimeSec >= 36000) earn('hour_10');
    if (state.consecutivePerfectTime >= 300) earn('perfect_5min');
    if (appData.streak >= 3) earn('streak_3');
    if (appData.streak >= 7) earn('streak_7');
    if (sessionTimeSec > 600 && state.sessionAlerts === 0) earn('alerts_0');
    if (appData.level >= 5) earn('level_5');
    if (appData.level >= 10) earn('level_10');
}

// --- Statistics ---
function updateStatsUI() {
    const sessions = appData.sessions;
    const totalTime = sessions.reduce((s, sess) => s + sess.duration, 0);
    const totalAlerts = sessions.reduce((s, sess) => s + sess.alerts, 0);
    const avgScore = sessions.length > 0
        ? Math.round(sessions.reduce((s, sess) => s + sess.goodPercent, 0) / sessions.length)
        : '--';

    $('#stats-total-sessions').textContent = sessions.length;
    $('#stats-total-time').textContent = totalTime >= 3600
        ? `${(totalTime / 3600).toFixed(1)}h`
        : `${Math.floor(totalTime / 60)}m`;
    $('#stats-avg-score').textContent = avgScore;
    $('#stats-total-alerts').textContent = totalAlerts;

    if (typeof Chart !== 'undefined') {
        renderWeeklyChart();
        renderDistributionChart();
        renderDurationChart();
    }
}

function getLast7Days() {
    const days = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        days.push(d.toISOString().split('T')[0]);
    }
    return days;
}

let weeklyChart, distChart, durationChart;

function renderWeeklyChart() {
    const days = getLast7Days();
    const labels = days.map(d => d.slice(5));
    const data = days.map(d => {
        const dayData = appData.dailyScores[d];
        if (!dayData || dayData.scores.length === 0) return 0;
        return Math.round(dayData.scores.reduce((a, b) => a + b, 0) / dayData.scores.length);
    });

    if (weeklyChart) weeklyChart.destroy();
    weeklyChart = new Chart($('#chart-weekly'), {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: '平均评分',
                data,
                borderColor: '#6C5CE7',
                backgroundColor: 'rgba(108, 92, 231, 0.1)',
                fill: true,
                tension: 0.4,
                pointRadius: 4,
                pointBackgroundColor: '#6C5CE7',
            }],
        },
        options: {
            responsive: true,
            scales: {
                y: { min: 0, max: 100, ticks: { color: '#8888AA' }, grid: { color: '#2A2A4A' } },
                x: { ticks: { color: '#8888AA' }, grid: { color: '#2A2A4A' } },
            },
            plugins: { legend: { display: false } },
        },
    });
}

function renderDistributionChart() {
    const today = new Date().toISOString().split('T')[0];
    const dayData = appData.dailyScores[today];
    let good = 0, fair = 0, bad = 0;
    if (dayData && dayData.scores.length > 0) {
        dayData.scores.forEach(s => {
            if (s >= 70) good++;
            else if (s >= 40) fair++;
            else bad++;
        });
    }

    if (distChart) distChart.destroy();
    distChart = new Chart($('#chart-distribution'), {
        type: 'doughnut',
        data: {
            labels: ['良好 (70+)', '一般 (40-69)', '较差 (<40)'],
            datasets: [{
                data: [good || 0, fair || 0, bad || 0],
                backgroundColor: ['#00B894', '#FDCB6E', '#E17055'],
                borderWidth: 0,
            }],
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom', labels: { color: '#8888AA', padding: 16 } },
            },
        },
    });
}

function renderDurationChart() {
    const days = getLast7Days();
    const labels = days.map(d => d.slice(5));
    const data = days.map(d => {
        const dayData = appData.dailyScores[d];
        return dayData ? Math.round(dayData.totalTime / 60) : 0;
    });

    if (durationChart) durationChart.destroy();
    durationChart = new Chart($('#chart-duration'), {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: '监测时长 (分钟)',
                data,
                backgroundColor: '#A29BFE',
                borderRadius: 6,
            }],
        },
        options: {
            responsive: true,
            scales: {
                y: { beginAtZero: true, ticks: { color: '#8888AA' }, grid: { color: '#2A2A4A' } },
                x: { ticks: { color: '#8888AA' }, grid: { color: '#2A2A4A' } },
            },
            plugins: { legend: { display: false } },
        },
    });
}

// --- Settings ---
function initSettings() {
    const s = appData.settings;
    $('#setting-sensitivity').value = s.sensitivity;
    $('#sensitivity-value').textContent = s.sensitivity;
    $('#setting-alert-delay').value = s.alertDelay;
    $('#setting-sit-interval').value = s.sitInterval || 45;
    $('#setting-water-interval').value = s.waterInterval || 45;
    $('#setting-notifications').checked = s.notifications;
    $('#setting-sound').checked = s.sound;

    $('#setting-sensitivity').addEventListener('input', (e) => {
        appData.settings.sensitivity = parseInt(e.target.value);
        $('#sensitivity-value').textContent = e.target.value;
        saveData(appData);
    });

    $('#setting-alert-delay').addEventListener('change', (e) => {
        appData.settings.alertDelay = parseInt(e.target.value) || 20;
        saveData(appData);
    });

    $('#setting-sit-interval').addEventListener('change', (e) => {
        appData.settings.sitInterval = parseInt(e.target.value) || 45;
        saveData(appData);
    });

    $('#setting-water-interval').addEventListener('change', (e) => {
        appData.settings.waterInterval = parseInt(e.target.value) || 45;
        saveData(appData);
    });

    $('#setting-notifications').addEventListener('change', (e) => {
        appData.settings.notifications = e.target.checked;
        if (e.target.checked && Notification.permission === 'default') {
            Notification.requestPermission();
        }
        saveData(appData);
    });

    $('#setting-sound').addEventListener('change', (e) => {
        appData.settings.sound = e.target.checked;
        saveData(appData);
    });

    $('#btn-export-data').addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(appData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `postureGuard_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    $('#btn-clear-data').addEventListener('click', () => {
        if (confirm('确定要清除所有数据吗？此操作不可撤销。')) {
            localStorage.removeItem('postureGuard');
            appData = loadData();
            updateGameUI();
            updateStatsUI();
        }
    });
}

// --- Wellness Timers (sit + water) ---
let wellnessTimers = {
    sitStart: null,       // when user started sitting
    waterStart: null,     // when user last drank water
    sitAlerted: false,    // already alerted this cycle?
    waterAlerted: false,
    intervalId: null,
};

const sitTimerEl = $('#sit-timer');
const waterTimerEl = $('#water-timer');
const timerSitCard = $('#timer-sit');
const timerWaterCard = $('#timer-water');

function startWellnessTimers() {
    const now = Date.now();
    wellnessTimers.sitStart = now;
    wellnessTimers.waterStart = now;
    wellnessTimers.sitAlerted = false;
    wellnessTimers.waterAlerted = false;

    // Update every second
    if (wellnessTimers.intervalId) clearInterval(wellnessTimers.intervalId);
    wellnessTimers.intervalId = setInterval(updateWellnessTimers, 1000);
}

function stopWellnessTimers() {
    if (wellnessTimers.intervalId) {
        clearInterval(wellnessTimers.intervalId);
        wellnessTimers.intervalId = null;
    }
    sitTimerEl.textContent = '00:00';
    waterTimerEl.textContent = '00:00';
    timerSitCard.className = 'timer-card';
    timerWaterCard.className = 'timer-card';
}

function formatTimer(ms) {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
    const s = (totalSec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function updateWellnessTimers() {
    if (!state.isMonitoring) return;
    const now = Date.now();

    const sitIntervalMs = (appData.settings.sitInterval || 45) * 60 * 1000;
    const waterIntervalMs = (appData.settings.waterInterval || 45) * 60 * 1000;

    // --- Sit timer ---
    const sitElapsed = now - wellnessTimers.sitStart;
    sitTimerEl.textContent = formatTimer(sitElapsed);

    // Visual states: warning at 80%, alert at 100%
    const sitRatio = sitElapsed / sitIntervalMs;
    if (sitRatio >= 1) {
        timerSitCard.className = 'timer-card alert';
        if (!wellnessTimers.sitAlerted) {
            wellnessTimers.sitAlerted = true;
            triggerWellnessAlert('sit');
        }
    } else if (sitRatio >= 0.8) {
        timerSitCard.className = 'timer-card warning';
    } else {
        timerSitCard.className = 'timer-card';
    }

    // --- Water timer ---
    const waterElapsed = now - wellnessTimers.waterStart;
    waterTimerEl.textContent = formatTimer(waterElapsed);

    const waterRatio = waterElapsed / waterIntervalMs;
    if (waterRatio >= 1) {
        timerWaterCard.className = 'timer-card alert';
        if (!wellnessTimers.waterAlerted) {
            wellnessTimers.waterAlerted = true;
            triggerWellnessAlert('water');
        }
    } else if (waterRatio >= 0.8) {
        timerWaterCard.className = 'timer-card warning';
    } else {
        timerWaterCard.className = 'timer-card';
    }
}

function triggerWellnessAlert(type) {
    const isWater = type === 'water';
    const icon = isWater ? '💧' : '🪑';
    const title = isWater ? '该喝水了！' : '该起身活动了！';
    const mins = isWater ? appData.settings.waterInterval : appData.settings.sitInterval;
    const msg = isWater
        ? `你已经 ${mins} 分钟没喝水了，喝点水吧`
        : `你已经连续坐了 ${mins} 分钟，站起来活动一下`;

    showToast(icon, title, msg, 'warning');

    if (appData.settings.sound) {
        playAlertSound();
    }

    if (appData.settings.notifications && Notification.permission === 'granted') {
        new Notification(`PostureGuard - ${title}`, { body: msg, silent: true });
    }
}

// Button handlers
$('#btn-stood-up').addEventListener('click', () => {
    wellnessTimers.sitStart = Date.now();
    wellnessTimers.sitAlerted = false;
    timerSitCard.className = 'timer-card';
    showToast('🏃', '已记录起身', '计时已重置，继续保持活动', 'success');
});

$('#btn-drank-water').addEventListener('click', () => {
    wellnessTimers.waterStart = Date.now();
    wellnessTimers.waterAlerted = false;
    timerWaterCard.className = 'timer-card';
    showToast('💧', '已记录喝水', '计时已重置，保持水分摄入', 'success');
});

// --- Init ---
function init() {
    initSettings();
    updateGameUI();
}

init();
