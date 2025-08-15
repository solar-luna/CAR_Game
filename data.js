window.RACING_CONFIG = {
  theme: {
    roadColor: 0x2a2f3a,
    stripeColor: 0xffffff,
    carBodyColor: 0x18e0ff,
    carAccentColor: 0x1060ff,
    obstacleColor: 0xff4060,
    skyColorTop: 0x1b2340,
    skyColorBottom: 0x0e1227,
  },
  world: {
    roadWidth: 28,
    stripeLength: 6,
    stripeGap: 10,
    laneHalfWidth: 6.5,
    spawnZStart: -80,
    spawnZEnd: -800,
    fogNear: 30,
    fogFar: 320,
  },
  car: {
    maxSpeed: 90,          // m/s ≈ 324 km/h（更快）
    accel: 28,             // m/s^2（更快加速）
    brakeDecel: 48,
    naturalDecel: 8,
    steerSpeed: 18,        // m/s 横向
    maxSteerX: 14,         // 赛道半宽保护（随赛道加宽）
  },
  gameplay: {
    obstacleCount: 24,
    baseScoreRate: 2.0,    // 每秒基础分
    speedScoreFactor: 0.35,// 速度加成
    hitPenalty: 150,
    // 氮气/漂移/道具/AI 配置
    nitroMax: 100,         // 氮气最大值
    nitroGainPerSecond: 12,// 自然回充
    nitroConsumePerSecond: 60, // 使用时消耗
    nitroBoost: 36,        // 氮气附加速度 (m/s)（更强）
    driftGripLoss: 0.35,   // 漂移时横向抓地降低比例
    driftScoreRate: 1.2,   // 漂移每秒额外分
    pickupCount: 10,       // 道具数量
    aiCarCount: 5,         // AI 车辆
    pickupNitroAmount: 35, // 道具-氮气补充
    pickupScoreAmount: 200,// 道具-分数奖励
    aiSpeedMin: 18,        // AI 最小车速（m/s）
    aiSpeedMax: 58,        // AI 最大车速（m/s）
    aiSteerSpeed: 6,       // AI 横向转向速度（m/s）
  },
};
