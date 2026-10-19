/**
 * 路径解析：定位当前 profile 的 cordis.patch.yml（MCP 服务行的落盘位置）。
 *
 * 优先级（从最可靠到兜底）：
 *   1. 宿主服务 `profileContext.patchPath` —— 官方 config-editor 用的就是它；
 *   2. 环境变量 `DSH_PROFILE_DIR` —— DSH 启动时注入的绝对路径；
 *   3. `DSH_HOME/profiles/<DSH_PROFILE|desktop>/cordis.patch.yml`。
 *
 * 刻意不做「dirname 向上找」这类启发式：写错文件比报错更糟（会污染别的
 * profile 或别的目录）。三条路都失败时**抛错**，由调用方转成页面上的
 * 可读提示。
 */
import path from "node:path"

/** profile 清单文件名（用于校验目录确实是 profile）。 */
export const PROFILE_PATCH_FILENAME = "cordis.patch.yml"

/**
 * 从宿主 ctx 解析 profile patch 的绝对路径。
 *
 * @param ctx - 宿主插件上下文（可为 undefined，此时只走环境变量）
 * @returns 绝对路径
 * @throws 三条路都拿不到时
 */
export function resolvePatchPath(ctx) {
  /*
   * 1) 官方 profileContext：这是 config-editor 的 documentPath 来源，
   *    也是唯一能反映「--profile / 自定义 profile 目录」的权威值。
   */
  try {
    const profileContext = ctx?.get?.("profileContext")
    const patchPath = profileContext?.patchPath
    if (typeof patchPath === "string" && patchPath !== "") return patchPath
  } catch {
    /* 服务未就绪：继续走环境变量 */
  }

  /* 2) DSH_PROFILE_DIR。 */
  const dir = process.env.DSH_PROFILE_DIR
  if (typeof dir === "string" && dir !== "") {
    return path.join(dir, PROFILE_PATCH_FILENAME)
  }

  /* 3) DSH_HOME + profile 名。 */
  const home = process.env.DSH_HOME
  if (typeof home === "string" && home !== "") {
    const profile = process.env.DSH_PROFILE || "desktop"
    return path.join(home, "profiles", profile, PROFILE_PATCH_FILENAME)
  }

  throw new Error(
    "无法定位 profile 的 cordis.patch.yml：" +
      "profileContext.patchPath、DSH_PROFILE_DIR、DSH_HOME 均不可用",
  )
}

/**
 * 解析 profile 目录（写文件锁要用它）。
 *
 * @param ctx - 宿主插件上下文
 * @returns 绝对路径
 */
export function resolveProfileDir(ctx) {
  return path.dirname(resolvePatchPath(ctx))
}
