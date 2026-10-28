/**
 * 从「网页设置」迁移到「其他设置 → 上传相关配置」的配置项 ID。
 *
 * 数据仍存在 sysConfig 的 page 分区（config 数组）里，只是 UI 搬家：
 *   · 网页设置（SysCogPage）不再重复展示这些项，但保存时仍整份回写，值不丢；
 *   · 其他设置（SysCogOthers）按这个清单筛出来渲染，保存时回写 page 分区。
 *
 * 两边共用同一份清单，避免以后新增/调整时出现「一边展示一边不展示」的错位。
 */
export const UPLOAD_DEFAULT_CONFIG_IDS = [
  'showDirectorySuggestions', // 目录候选项
  'defaultUploadFolder', // 默认上传目录
  'defaultUploadNameType', // 默认命名方式
  'defaultUrlForm', // 默认外链格式
  'videoTranscodeIncompatible', // 视频兼容转码（v2.8.5 由网页设置迁入）
  'defaultConvertToWebp', // 默认转换 WebP
  'defaultCustomerCompress', // 默认开启压缩
  'defaultCompressBar', // 最小压缩阈值
  'defaultCompressQuality', // 默认压缩期望
  'allowedExtensions', // 允许的上传格式
  'maxUploadSizeMB', // 单文件大小上限
];

export default UPLOAD_DEFAULT_CONFIG_IDS;
