/* 库洛米每日打卡 · 配置与工具 */
'use strict';

const STORE_KEY = 'kuromi_checkin_v2';
const APP_SCHEMA_VERSION = 3;
const CLOCK_DRIFT_MS = 5 * 60 * 1000;
const OFFLINE_TIME_LIMIT_MS = 7 * 24 * 60 * 60 * 1000;
const COSTUME_CATEGORIES = {
  bow: 'head', flower: 'head', strawberry: 'head', star: 'head',
  tophat: 'head', cap: 'head', crown: 'head',
  bowtie: 'clothes', scarf: 'clothes', glasses: 'accessory'
};

/* ---------- 工具 ---------- */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const uid = () => Math.random().toString(36).slice(2, 9);
const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
function trustedDateMs() {
  try {
    if (typeof AndroidApp !== 'undefined' && AndroidApp.getTrustedTimeState) {
      const value = JSON.parse(AndroidApp.getTrustedTimeState());
      if (value && Number(value.nowMs) && (value.online || Number(value.ageMs) <= OFFLINE_TIME_LIMIT_MS)) return Number(value.nowMs);
    }
  } catch (e) { /* local clock fallback */ }
  return Date.now();
}
const todayIndex = () => (new Date(trustedDateMs()).getDay() + 6) % 7;
function todayStr() {
  const d = new Date(trustedDateMs());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const MOOD_MAP = {
  happy: { emoji: '😊', label: '开心' },
  excited: { emoji: '🤩', label: '兴奋' },
  sad: { emoji: '😢', label: '难过' },
  angry: { emoji: '😡', label: '生气' },
  sleepy: { emoji: '😴', label: '困困' }
};
/* 10 种可兑换造型（头饰 / 配饰 / 衣服），用积分兑换后自由穿脱 */
const COSTUMES = [
  { key: 'bow', emoji: '🎀', name: '蝴蝶结', cost: 30 },
  { key: 'flower', emoji: '🌸', name: '花朵发夹', cost: 50 },
  { key: 'strawberry', emoji: '🍓', name: '草莓头饰', cost: 60 },
  { key: 'star', emoji: '⭐', name: '星星发箍', cost: 80 },
  { key: 'glasses', emoji: '🕶️', name: '酷墨镜', cost: 100 },
  { key: 'bowtie', emoji: '👔', name: '小领结', cost: 120 },
  { key: 'scarf', emoji: '🧣', name: '暖围巾', cost: 150 },
  { key: 'tophat', emoji: '🎩', name: '小礼帽', cost: 200 },
  { key: 'cap', emoji: '🧢', name: '棒球帽', cost: 260 },
  { key: 'crown', emoji: '👑', name: '小皇冠', cost: 350 }
];

/* 分享链接（已发布到线上，可在平板直接打开） */
const SHARE_URL = 'https://hujjmya.github.io/kuromi-checkin/';

/* ---------- 默认数据 ---------- */
function defaultState() {
  return {
    version: APP_SCHEMA_VERSION,
    date: todayStr(),
    petType: 'cat',
    petName: '小库',
    totalPoints: 0,
    lifetimePoints: 0,
    planMode: 'school',
    templates: {
      school: ['早起自己穿衣', '认真刷牙洗脸', '完成学校作业', '读 20 分钟书', '运动打卡', '帮爸爸妈妈做家务', '9 点前睡觉'],
      weekend: ['睡到自然醒', '吃营养早餐', '户外运动 1 小时', '读喜欢的绘本', '帮家里大扫除', '画一幅画 / 做手工', '早睡养精神']
    },
    plan: [],
    plansByMode: { school: [], weekend: [] },
    sport: {
      options: ['跳绳', '跑步', '拍球', '游泳', '体操', '骑车'],
      selected: '跳绳',
      week: [null, null, null, null, null, null, null],
      weekKey: ''
    },
    books: [],
    mood: { date: null, mood: null, text: '' },
    rewards: [
      { id: 'r1', emoji: '📺', name: '看动画片 15 分钟', cost: 30 },
      { id: 'r2', emoji: '🍬', name: '一份小零食', cost: 50 },
      { id: 'r3', emoji: '🛝', name: '去公园玩一次', cost: 80 },
      { id: 'r4', emoji: '🎨', name: '新画笔 / 贴纸', cost: 120 },
      { id: 'r5', emoji: '🧸', name: '新玩具一个', cost: 200 }
    ],
    redeemed: [],
    costumes: { bow: false, flower: false, strawberry: false, star: false, glasses: false, bowtie: false, scarf: false, tophat: false, cap: false, crown: false },
    owned: {},
    history: {},
    audit: [],
    clock: { lastSeenMs: Date.now(), lastTrustedMs: 0, lastTrustedAt: 0 }
  };
}
