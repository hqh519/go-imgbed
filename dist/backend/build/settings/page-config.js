"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAGE_CONFIG_DEFAULTS = void 0;
exports.PAGE_CONFIG_DEFAULTS = {
    "config": [
        {
            "id": "siteTitle",
            "label": "网站标题",
            "label_en": "Site Title",
            "placeholder": "Sanyue ImgHub",
            "category": "全局设置",
            "category_en": "Global Settings"
        },
        {
            "id": "siteIcon",
            "label": "网站图标",
            "label_en": "Site Icon",
            "category": "全局设置",
            "category_en": "Global Settings"
        },
        {
            "id": "defaultLanguage",
            "label": "默认语言",
            "label_en": "Default Language",
            "type": "select",
            "options": [
                {
                    "label": "简体中文",
                    "value": "zh-CN",
                    "label_en": "简体中文"
                },
                {
                    "label": "English",
                    "value": "en",
                    "label_en": "English"
                }
            ],
            "default": "zh-CN",
            "category": "全局设置",
            "category_en": "Global Settings"
        },
        {
            "id": "ownerName",
            "label": "网站名称",
            "label_en": "Site Name",
            "placeholder": "Sanyue ImgHub",
            "category": "全局设置",
            "category_en": "Global Settings"
        },
        {
            "id": "logoUrl",
            "label": "网站Logo",
            "label_en": "Site Logo",
            "category": "全局设置",
            "category_en": "Global Settings"
        },
        {
            "id": "logoLink",
            "label": "Logo跳转链接",
            "label_en": "Logo Link",
            "placeholder": "https://github.com/hqh519/go-imgbed",
            "tooltip": "点击Logo时跳转的链接，留空则使用默认GitHub链接",
            "tooltip_en": "URL to navigate when clicking the logo. Leave empty for default GitHub link",
            "category": "全局设置",
            "category_en": "Global Settings"
        },
        {
            "id": "wallpaperEnabled",
            "label": "启用背景图",
            "label_en": "Enable Background Image",
            "type": "boolean",
            "default": true,
            "tooltip": "控制所有页面的背景图开关，关闭后将使用纯色背景",
            "tooltip_en": "Toggle background images across all pages. When off, a solid color background will be used",
            "category": "全局设置",
            "category_en": "Global Settings"
        },
        {
            "id": "bkOpacity",
            "label": "背景图透明度",
            "label_en": "Background Opacity",
            "placeholder": "1",
            "tooltip": "0-1 之间的小数",
            "tooltip_en": "Decimal between 0 and 1",
            "category": "全局设置",
            "category_en": "Global Settings"
        },
        {
            "id": "urlPrefix",
            "label": "默认URL前缀",
            "label_en": "Default URL Prefix",
            "tooltip": "自定义URL前缀，如：https://img.a.com/file/，留空则使用当前域名 <br/> 设置后将应用于客户端和管理端 <br/> 该选项用于CDN加速等场景，请确保自定义前缀可访问",
            "tooltip_en": "Custom URL prefix, e.g. https://img.a.com/file/. Leave empty to use current domain <br/> Applies to both client and admin <br/> This option is intended for scenarios such as CDN acceleration. Make sure the custom prefix is accessible",
            "category": "全局设置",
            "category_en": "Global Settings"
        },
        {
            "id": "announcement",
            "label": "公告",
            "label_en": "Announcement",
            "type": "textarea",
            "tooltip": "支持HTML标签",
            "tooltip_en": "Supports HTML tags",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "showDirectorySuggestions",
            "label": "目录候选项",
            "label_en": "Directory Suggestions",
            "type": "boolean",
            "default": true,
            "tooltip": "控制上传页面是否展示目录树选择器",
            "tooltip_en": "Show directory tree picker on upload page",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "defaultUploadFolder",
            "label": "默认上传目录",
            "label_en": "Default Upload Directory",
            "placeholder": "留空则按「年份/月份」自动分类，如 2026/10",
            "placeholder_en": "Leave empty to auto-classify by year/month, e.g. 2026/10",
            "tooltip": "上传时未指定目录则使用这里的目录；留空则按「年份/月份」自动创建分类（每次上传实时计算）",
            "tooltip_en": "Used when no directory is specified on upload. Leave empty to auto-create by year/month",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "defaultUploadNameType",
            "label": "默认命名方式",
            "label_en": "Default Naming",
            "type": "select",
            "options": [
                {
                    "label": "默认",
                    "value": "default",
                    "label_en": "Default"
                },
                {
                    "label": "仅前缀",
                    "value": "index",
                    "label_en": "Prefix Only"
                },
                {
                    "label": "仅原名",
                    "value": "origin",
                    "label_en": "Original Name"
                },
                {
                    "label": "短链接",
                    "value": "short",
                    "label_en": "Short Link"
                }
            ],
            "placeholder": "default",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "defaultUrlForm",
            "label": "默认外链格式",
            "label_en": "Default URL Format",
            "type": "select",
            "options": [
                {
                    "label": "URL",
                    "value": "url",
                    "label_en": "URL"
                },
                {
                    "label": "Markdown",
                    "value": "md",
                    "label_en": "Markdown"
                },
                {
                    "label": "HTML",
                    "value": "html",
                    "label_en": "HTML"
                },
                {
                    "label": "BBCode",
                    "value": "ubb",
                    "label_en": "BBCode"
                }
            ],
            "default": "url",
            "tooltip": "上传成功后默认复制/展示的链接格式",
            "tooltip_en": "Default link format shown/copied after upload",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "videoTranscodeIncompatible",
            "label": "视频兼容转码",
            "label_en": "Video Compatibility Transcode",
            "type": "boolean",
            "default": true,
            "tooltip": "开启后：上传 H.265/HEVC、ProRes、MPEG-4 Part 2 等浏览器无法播放编码的视频时，服务器自动转码为 H.264（需 ffmpeg，已内置）。已经是 H.264/AV1/VP9 的视频不会转码，无额外开销。与压缩开关相互独立",
            "tooltip_en": "When on: videos encoded in H.265/HEVC, ProRes or MPEG-4 Part 2 (which browsers cannot play) are automatically transcoded to H.264 (requires ffmpeg, bundled). H.264/AV1/VP9 videos pass through untouched. Independent of the compression switch",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "defaultConvertToWebp",
            "label": "默认转换WebP",
            "label_en": "Default Convert to WebP",
            "type": "boolean",
            "default": false,
            "tooltip": "上传前将图片转换为WebP格式，可有效减小文件体积",
            "tooltip_en": "Convert images to WebP before upload to reduce file size",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "defaultCustomerCompress",
            "label": "默认开启压缩",
            "label_en": "Default Compression",
            "type": "boolean",
            "default": true,
            "tooltip": "开启后：前端上传页默认压缩；API Token / WebDAV 上传的文件同样走压缩。支持图片（jpg/png/webp，png 保持透明）、视频与音频（需服务器安装 ffmpeg）；gif 等无法压缩的格式会自动跳过，压缩失败也会跳过直接上传",
            "tooltip_en": "When on: uploads from the web UI, API tokens and WebDAV are all compressed. Supports images (jpg/png/webp, PNG keeps transparency), video and audio (requires ffmpeg). GIF and other unsupported formats are skipped, and failures fall back to the original file",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "defaultCompressBar",
            "label": "最小压缩阈值",
            "label_en": "Min Compress Threshold",
            "placeholder": "5",
            "tooltip": "图片大小超过此值将自动压缩，单位MB，范围1-20",
            "tooltip_en": "Auto-compress when image exceeds this size (MB), range 1-20",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "defaultCompressQuality",
            "label": "默认压缩期望",
            "label_en": "Default Compress Target",
            "placeholder": "80",
            "tooltip": "压缩后体积占原文件的百分比，范围 10-100。例如填 80 表示把原文件压缩到约 80% 的体积",
            "tooltip_en": "Target size as a percentage of the original (10-100). e.g. 80 means compress to ~80% of original size",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "uploadBkImg",
            "label": "上传页背景图",
            "label_en": "Upload Background",
            "tooltip": "1.填写 bing 使用必应壁纸轮播 <br/> 2.填写 [\"url1\",\"url2\"] 使用多张图片轮播 <br/> 3.填写 [\"url\"] 使用单张图片",
            "tooltip_en": "1. Enter \"bing\" for Bing wallpaper rotation <br/> 2. Enter [\"url1\",\"url2\"] for multiple images <br/> 3. Enter [\"url\"] for a single image",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "adminLoginBkImg",
            "label": "登录页背景图",
            "label_en": "Login Background",
            "tooltip": "1.填写 bing 使用必应壁纸轮播 <br/> 2.填写 [\"url1\",\"url2\"] 使用多张图片轮播 <br/> 3.填写 [\"url\"] 使用单张图片",
            "tooltip_en": "1. Enter \"bing\" for Bing wallpaper rotation <br/> 2. Enter [\"url1\",\"url2\"] for multiple images <br/> 3. Enter [\"url\"] for a single image",
            "category": "管理端设置",
            "category_en": "Admin Settings"
        },
        {
            "id": "adminBkImg",
            "label": "管理页背景图",
            "label_en": "Admin Background",
            "tooltip": "1.填写 bing 使用必应壁纸轮播 <br/> 2.填写 [\"url1\",\"url2\"] 使用多张图片轮播 <br/> 3.填写 [\"url\"] 使用单张图片",
            "tooltip_en": "1. Enter \"bing\" for Bing wallpaper rotation <br/> 2. Enter [\"url1\",\"url2\"] for multiple images <br/> 3. Enter [\"url\"] for a single image",
            "category": "管理端设置",
            "category_en": "Admin Settings"
        },
        {
            "id": "footerLink",
            "label": "页脚传送门链接",
            "label_en": "Footer Portal Link",
            "type": "textarea",
            "rows": 8,
            "placeholder": "<a href=\"/\">传送门</a>\n<script>/* 统计代码等 */</script>",
            "tooltip": "多行文本框，支持直接粘贴 HTML / JS 代码（如统计代码、备案号、多条自定义链接等）。内容会注入到页面页脚的默认版权文字之后；贴入的 <script> 会正常执行",
            "tooltip_en": "Multi-line field; paste HTML / JS directly (analytics snippets, ICP number, multiple custom links). Injected after the default footer text, and <script> tags will execute",
            "category": "页脚设置",
            "category_en": "Footer Settings"
        },
        {
            "id": "disableFooter",
            "label": "隐藏页脚",
            "label_en": "Hide Footer",
            "type": "boolean",
            "default": false,
            "tooltip": "开启后前台页面底部不显示页脚（含上面的自定义代码）",
            "tooltip_en": "Hide the footer (including custom code above) on public pages",
            "category": "页脚设置",
            "category_en": "Footer Settings"
        },
        {
            "id": "allowedExtensions",
            "label": "允许的上传格式",
            "label_en": "Allowed File Extensions",
            "placeholder": "jpg,png,gif,jpeg,webp,bmp,mp4,webm,mov,m4v,mp3,m4a,aac,ogg",
            "tooltip": "英文逗号分隔，不带点号。前端会同时校验扩展名与文件真实类型（magic bytes），双重校验不通过将拒收",
            "tooltip_en": "Comma-separated, without dots. Both extension and real file signature (magic bytes) are validated",
            "category": "客户端设置",
            "category_en": "Client Settings"
        },
        {
            "id": "maxUploadSizeMB",
            "label": "单文件大小上限",
            "label_en": "Max Upload Size",
            "placeholder": "1024",
            "default": 1024,
            "tooltip": "单位 MB，留空默认 1024。分片/暂存上传已落盘，可放心调大（如 1024）以上传大视频；超过上限仍会被拒绝",
            "tooltip_en": "Unit: MB. Defaults to 1024 when empty. Chunked/staged uploads are written to disk, so a larger value (e.g. 1024) is safe for big videos",
            "category": "客户端设置",
            "category_en": "Client Settings"
        }
    ]
};
