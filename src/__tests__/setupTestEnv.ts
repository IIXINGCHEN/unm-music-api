/**
 * 测试环境前置初始化。
 *
 * 在加载任何被测模块**之前**运行（经 `tsx --import` 注册），
 * 为测试补齐必需的环境变量。
 *
 * 为什么需要：configEnv 在模块加载时执行 parseEnv，而 MONITOR_SECRET_KEY
 * 现在是必填项（缺失即 process.exit(1)）。CI 与贡献者本地都没有 .env，
 * 若不在此处提供，任何导入 config 链的测试文件都会整片崩溃 ——
 * 测试必须自足，不能依赖外部 .env 文件的存在。
 *
 * 这里刻意不走 dotenv：只用 process.env 的默认赋值语义（??=），
 * 使得真实环境已提供的值（例如 CI 的 env 块）优先，不被覆盖。
 */

// 仅用于让模块完成初始化的测试值，与任何真实部署的密钥无关。
process.env.MONITOR_SECRET_KEY ??= "test-only-monitor-key-not-a-real-secret";

// 其余开关给出确定的测试基线，避免受运行环境残留影响。
process.env.ENABLE_RATE_LIMIT ??= "true";
process.env.ALLOWED_DOMAIN ??= "*";
process.env.NODE_ENV ??= "test";
